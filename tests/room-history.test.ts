import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Room, HistoryPage } from '../types';

const db = new PGlite();
const host = randomUUID(), friend = randomUUID(), outsider = randomUUID();
const migratedRequest = randomUUID();
let migrated: Room;
let oldLogs: Room['logs'];
const migration = (name: string) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const asUser = async <T = any>(uid: string, sql: string, args: any[] = [], role = 'authenticated') => db.transaction(async tx => {
  await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [uid]);
  await tx.exec(`set local role ${role}`);
  return (await tx.query<T>(sql, args)).rows;
});
const create = async (uid = host) => (await asUser<{r: Room}>(uid, "select public.create_room($1,'Host',1,'') r", [randomUUID()]))[0].r;
const act = async (id: string, uid: string, action: string, args = {}, request = randomUUID()) =>
  (await asUser<{r: Room}>(uid, 'select public.room_action($1,$2,$3,$4,$5) r', [id, uid, action, JSON.stringify(args), request]))[0].r;
const page = async (id: string, uid: string = host, cursor: string | null = null, limit = 50) =>
  (await asUser<{r: HistoryPage}>(uid, 'select public.room_history($1,$2,$3) r', [id, cursor, limit]))[0].r;
const read = async (id: string) => (await db.query<{content: Room}>('select content from rooms where id=$1', [id])).rows[0].content;
const eventCount = async (id: string) => Number((await db.query<{n: number}>('select count(*) n from private.room_events where room_id=$1', [id])).rows[0].n);

before(async () => {
  await db.exec(`create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon,authenticated;
    create table rooms(id text primary key, content jsonb not null, updated_at timestamptz default now());`);
  const initial = migration('20261026024146_atomic_room_actions.sql');
  await db.exec(initial);
  await db.exec(migration('20261026033410_anonymous_room_identity.sql'));
  migrated = await create();
  await act(migrated.id, friend, 'join', {nickname: 'Friend'});
  migrated = await act(migrated.id, host, 'rename', {nickname: 'Renamed'}, migratedRequest);
  oldLogs = migrated.logs;
  await db.query('insert into rooms(id,content) values($1,$2)', ['legacy-history', JSON.stringify({logs: [{id: 'old', action: 'untouched'}]})]);
  // The previous engine exists only inside this local benchmark database.
  const oldEngine = initial.slice(initial.indexOf('create or replace function'), initial.indexOf('\nrevoke all on function'))
    .replace('public.room_action(', 'private.baseline_room_action(');
  await db.exec(oldEngine);
  await db.exec(migration('20261026060408_bounded_room_history.sql'));
});
after(() => db.close());

test('migration preserves old ledger and retries while compacting verified rooms only', async () => {
  const compact = await read(migrated.id);
  assert.equal(compact.logs.length, 1);
  assert.equal(compact.revision, migrated.revision! + 1);
  assert.deepEqual(compact.players, migrated.players);
  const entries = (await page(migrated.id)).entries.map(x => x.event).reverse();
  const publicLogs = oldLogs.map(({_command, ...event}: any) => event);
  assert.deepEqual(entries, publicLogs);
  assert.deepEqual(await act(migrated.id, host, 'rename', {nickname: 'Renamed'}, migratedRequest), compact);
  await assert.rejects(act(migrated.id, host, 'rename', {nickname: 'Different'}, migratedRequest), /请求编号冲突/);
  assert.deepEqual(await read('legacy-history'), {logs: [{id: 'old', action: 'untouched'}]});
});

test('cursor pages have no gaps or duplicates when new events arrive', async () => {
  const r = await create();
  for (let i = 0; i < 123; i++) await act(r.id, host, 'rename', {nickname: `Name ${i}`});
  const first = await page(r.id);
  assert.equal(first.entries.length, 50);
  await act(r.id, host, 'rename', {nickname: 'New while reading'});
  const second = await page(r.id, host, first.nextCursor);
  const third = await page(r.id, host, second.nextCursor);
  assert.equal(second.entries.length, 50);
  assert.equal(third.entries.length, 23);
  assert.equal(third.nextCursor, null);
  const events = [...first.entries, ...second.entries, ...third.entries];
  assert.equal(new Set(events.map(e => e.event.id)).size, 123);
  assert.equal(events[0].event.action, 'Name 121 改名为 Name 122');
  assert.equal((await page(r.id)).entries[0].event.action, 'Name 122 改名为 New while reading');
  assert.ok(events.every(x => !('_command' in x.event)));
  assert.equal((await page(r.id, host, '1')).entries.length, 0);
  for (const limit of [0, -1, 101]) await assert.rejects(page(r.id, host, null, limit), /分页/);
  await assert.rejects(page(r.id, host, '0'), /分页/);
  await assert.rejects(asUser(host, 'select public.room_history($1,null,null)', [r.id]), /分页/);
});

test('history is private, including receipts; former members retain ledger reads only', async () => {
  const r = await create();
  await act(r.id, friend, 'join', {nickname: 'Friend'});
  await act(r.id, host, 'kick', {target: friend});
  assert.equal((await page(r.id, friend)).entries.length, 2);
  await assert.rejects(act(r.id, friend, 'rename', {nickname: 'No'}), /不在房间/);
  await assert.rejects(page(r.id, outsider), /无权/);
  await assert.rejects(page('missing', host), /无权/);
  await assert.rejects(page(r.id, ''), /无权/);
  await assert.rejects(asUser('', 'select public.room_history($1)', [r.id], 'anon'), /permission denied/);
  for (const sql of ['select * from private.room_events', 'delete from private.room_events', "update private.room_events set event='{}'"])
    await assert.rejects(asUser(host, sql), /permission denied/);
  await assert.rejects(asUser(host, "insert into private.room_events(room_id,request_id,request_command,event) values($1,$2,'{}','{}')", [r.id, randomUUID()]), /permission denied/);
  await assert.rejects(asUser(host, "select nextval('private.room_events_sequence_seq')"), /permission denied/);
});

test('failed room write rolls back the event and receipt; same request may safely retry', async () => {
  const r = await create();
  const req = randomUUID();
  await db.exec(`create function private.fail_history_test() returns trigger language plpgsql as $$
    begin raise exception 'injected room write failure'; end $$;
    create trigger fail_history_test before update on rooms for each row execute function private.fail_history_test();`);
  try {
    await assert.rejects(act(r.id, host, 'rename', {nickname: 'Retry'}, req), /injected/);
    assert.equal(await eventCount(r.id), 0);
    assert.deepEqual(await read(r.id), r);
  } finally { await db.exec('drop trigger fail_history_test on rooms; drop function private.fail_history_test();'); }
  await act(r.id, host, 'rename', {nickname: 'Retry'}, req);
  await act(r.id, host, 'rename', {nickname: 'Retry'}, req);
  assert.equal(await eventCount(r.id), 1);
});

test('200 six-player rounds keep snapshots bounded and old retries safe', {timeout: 180000}, async t => {
  const players = [host, friend, ...Array.from({length: 4}, () => randomUUID())];
  const snapshots: Record<string, {round: number; bytes: number; roundMs: number}[]> = {};
  for (const mode of ['baseline', 'bounded']) {
    const r = await create(randomUUID());
    // Identical synthetic fixtures isolate history cost; no network or hosted Auth is involved.
    const fixture = {...r, hostId: host, players: Object.fromEntries(players.map((id, i) => [id, {...r.players[r.hostId], id, nickname: `Player ${i}`, isHost: i === 0}]))};
    await db.query('update rooms set content=$2 where id=$1', [r.id, JSON.stringify({...fixture, revision: 1})]);
    const fn = mode === 'baseline' ? 'private.baseline_room_action' : 'private.apply_room_action';
    const call = async (uid: string, action: string, args: object, req = randomUUID()) =>
      (await db.query<{r: Room}>(`select ${fn}($1,$2,$3,$4,$5) r`, [r.id, uid, action, JSON.stringify(args), req])).rows[0].r;
    const firstBet = randomUUID();
    snapshots[mode] = [];
    let current: Room = fixture;
    for (let round = 1; round <= 200; round++) {
      const begin = performance.now();
      await call(host, 'start', {round: round - 1});
      for (const uid of players) await call(uid, 'bet', {round, amount: 2}, round === 1 && uid === host ? firstBet : randomUUID());
      current = await call(host, 'settle', {round, target: players[round % players.length]});
      assert.equal(Object.values(current.players).reduce((n, p) => n + p.balance, current.pot), 0);
      if (mode === 'bounded') assert.equal(current.logs.length, 1);
      if ([1, 50, 100, 200].includes(round)) snapshots[mode].push({round, bytes: Buffer.byteLength(JSON.stringify(current)), roundMs: Math.round((performance.now() - begin) * 100) / 100});
    }
    assert.deepEqual(await call(host, 'bet', {round: 1, amount: 2}, firstBet), current);
    await assert.rejects(call(host, 'bet', {round: 1, amount: 3}, firstBet), /请求编号冲突/);
    if (mode === 'bounded') {
      assert.equal(await eventCount(r.id), 1600);
      const plan = await db.query('explain select request_command from private.room_events where room_id=$1 and request_id=$2', [r.id, firstBet]);
      assert.match(JSON.stringify(plan.rows), /Index Scan/);
      const historyPlan = await db.query('explain select sequence,event from private.room_events where room_id=$1 and sequence < 9000000 order by sequence desc limit 51', [r.id]);
      assert.match(JSON.stringify(historyPlan.rows), /room_events_history_idx/);
    }
  }
  assert.ok(snapshots.bounded[3].bytes < snapshots.bounded[0].bytes * 1.1);
  assert.ok(snapshots.baseline[3].bytes > snapshots.bounded[3].bytes * 50);
  t.diagnostic(JSON.stringify({note: 'Local single-connection PGlite; roundMs is illustrative, not production latency.', snapshots}));
});
