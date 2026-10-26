import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Room } from '../types';

const db = new PGlite();
const migration = readFileSync(new URL('../supabase/migrations/20261026024146_atomic_room_actions.sql', import.meta.url), 'utf8');
before(async () => {
  await db.exec(`create role anon; create role authenticated;
    create table public.rooms (id text primary key, content jsonb not null, updated_at timestamptz default now());`);
  await db.exec(migration);
  await db.exec(`create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
  for (const file of ['20261026033410_anonymous_room_identity.sql', '20261026060408_bounded_room_history.sql'])
    await db.exec(readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
});
after(() => db.close());
const create = async () => {
  const id = randomUUID();
  const room = { id, protocol: 2, hostId: 'host', status: 'waiting', pot: 0, ante: 1, roundCount: 0, revision: 0, createdAt: 0,
    players: { host: { id: 'host', nickname: 'Host', avatar: '', balance: 0, status: 'active', cardStatus: 'blind', isOnline: true, isHost: true } }, logs: [] };
  await db.query('insert into rooms (id,content) values ($1,$2)', [id, JSON.stringify(room)]);
  return id;
};
const act = async (id: string, actor: string, action: string, args = {}, request = randomUUID()) => {
  const result = await db.query<{ room: Room }>('select private.apply_room_action($1,$2,$3,$4,$5) as room', [id, actor, action, JSON.stringify(args), request]);
  return result.rows[0].room;
};
const read = async (id: string) => (await db.query<{content: Room}>('select content from rooms where id=$1',[id])).rows[0].content;
const history = async (id: string) => (await db.query<{event: Room['logs'][number]}>('select event from private.room_events where room_id=$1 order by sequence',[id])).rows.map(r=>r.event);
const conserved = (r: Room) => assert.equal(Object.values(r.players).reduce((n,p) => n+p.balance, r.pot), 0);
const started = async () => {
  const id = await create();
  await act(id, 'a', 'join', {nickname:'Alice'});
  await act(id, 'b', 'join', {nickname:'Bob'});
  await act(id, 'host', 'start', {round:0, ante:1});
  return id;
};

test('interleaved bets, transfers and look actions preserve every credit', async () => {
  const id = await started();
  // PGlite queues requests on one connection; this exercises interleaving, not multi-session lock contention.
  await Promise.all(Array.from({length:60}, (_,i) => act(id, i%2 ? 'a':'b', 'bet', {amount:2, round:1})));
  await act(id, 'a', 'look', {round:1});
  const r = await act(id, 'a', 'transfer', {target:'b', amount:7});
  assert.equal(r.pot, 123);
  assert.equal(r.players.a.balance, -68);
  assert.equal(r.players.b.balance, -54);
  assert.equal((await history(id)).filter(l=>l.type==='bet').length,60);
  assert.equal(r.logs.length,1);
  conserved(r);
});
test('lost-response retries apply once, even after a later settlement', async () => {
  const id = await started(); const request = randomUUID();
  await act(id,'a','bet',{amount:8,round:1},request);
  const retried = await act(id,'a','bet',{amount:8,round:1},request);
  assert.equal(retried.pot,11);
  await assert.rejects(act(id,'a','bet',{amount:9,round:1},request), /请求编号冲突/);
  const settled = await act(id,'host','settle',{target:'a',round:1});
  assert.deepEqual(await act(id,'a','bet',{amount:8,round:1},request),settled);
  conserved(settled);
});
test('negative, fractional, excessive, missing and malformed amounts roll back', async () => {
  const id = await started(); const old = await read(id);
  for (const amount of [-1,0,1.5,1000001,null,'bad']) await assert.rejects(act(id,'a','bet',{amount,round:1}));
  assert.deepEqual(await read(id),old);
});
test('late bets cannot cross a round boundary; double start/settle are rejected', async () => {
  const id = await started();
  await assert.rejects(act(id,'host','start',{round:1}), /先结算/);
  await act(id,'host','settle',{target:'a',round:1});
  await assert.rejects(act(id,'host','settle',{target:'a',round:1}), /已经结算/);
  await act(id,'host','start',{round:1});
  await assert.rejects(act(id,'b','bet',{amount:1,round:1}), /轮次已变化/);
  await act(id,'b','fold',{round:2});
  await assert.rejects(act(id,'b','bet',{amount:1,round:2}), /弃牌/);
  conserved(await read(id));
});
test('kick requires host ID and waiting state, archives credit, rejects removed member', async () => {
  const id = await started();
  await assert.rejects(act(id,'a','kick',{target:'b'}), /只有房主/);
  await assert.rejects(act(id,'host','kick',{target:'b'}), /先结算/);
  await act(id,'host','settle',{target:'b',round:1});
  await assert.rejects(act(id,'host','kick',{target:'host'}), /不能踢出自己/);
  const before = await read(id);
  const after = await act(id,'host','kick',{target:'b'});
  assert.equal(after.players.b.removed,true);
  assert.equal(after.players.b.balance,before.players.b.balance);
  await assert.rejects(act(id,'b','rename',{nickname:'New'}), /不在房间/);
  await assert.rejects(act(id,'a','transfer',{target:'b',amount:1}), /不在房间/);
  const next = await act(id,'host','start',{round:1});
  assert.equal(next.pot,2);
  assert.equal(next.players.b.balance,before.players.b.balance);
  conserved(next);
});
test('rename preserves identity, credit, and historical log names', async () => {
  const id = await started();
  const old = await read(id);
  const oldLogs = await history(id);
  const r = await act(id,'a','rename',{nickname:'  Alice 2  '});
  assert.equal(r.players.a.nickname,'Alice 2');
  assert.equal(r.players.a.id,'a');
  assert.equal(r.players.a.balance,old.players.a.balance);
  assert.deepEqual((await history(id)).slice(0,-1),oldLogs);
  await assert.rejects(act(id,'a','rename',{nickname:' '}));
  await assert.rejects(act(id,'a','rename',{nickname:'x'.repeat(21)}));
});
test('leaving transfers host; disband is archived and retryable', async () => {
  const id = await create();
  await act(id,'a','join',{nickname:'Alice'});
  const r = await act(id,'host','leave');
  assert.equal(r.hostId,'a');
  assert.equal(r.players.a.isHost,true);
  const request=randomUUID();
  const closed = await act(id,'a','disband',{},request);
  assert.equal(closed.closed,true);
  assert.deepEqual(await act(id,'a','disband',{},request),closed);
  await assert.rejects(act(id,'b','join',{nickname:'Bob'}), /已解散/);
});
test('legacy whole-room overwrites are blocked', async () => {
  const id = await started();
  await assert.rejects(db.query("update rooms set content=jsonb_set(content,'{pot}','999') where id=$1",[id]), /版本过旧/);
  conserved(await read(id));
});
test('15-member capacity is enforced without deleting archived balances', async () => {
  const id=await create();
  for(let i=0;i<14;i++) await act(id,`p${i}`,'join',{nickname:`P${i}`});
  await assert.rejects(act(id,'extra','join',{nickname:'Extra'}), /房间已满/);
  await act(id,'host','kick',{target:'p0'});
  const r=await act(id,'extra','join',{nickname:'Extra'});
  assert.equal(Object.values(r.players).filter(p=>!p.removed).length,15);
  assert.equal(r.players.p0.removed,true);
});
