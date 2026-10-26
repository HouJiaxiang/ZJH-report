import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Room } from '../types';

const db = new PGlite();
const host=randomUUID(), friend=randomUUID(), stranger=randomUUID();
before(async()=>{
  await db.exec(`create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon,authenticated;
    create table public.rooms(id text primary key,content jsonb,updated_at timestamptz default now());
    grant all on public.rooms to public,anon,authenticated;
    alter table public.rooms enable row level security;
    create policy legacy on public.rooms for all using(true) with check(true);`);
  for(const file of ['20261026024146_atomic_room_actions.sql','20261026033410_anonymous_room_identity.sql'])
    await db.exec(readFileSync(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8'));
});
after(()=>db.close());
const queryAs = async <T=any>(uid:string,sql:string,args:any[]=[],role='authenticated')=> db.transaction(async tx=>{
  await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[uid]);
  await tx.exec(`set local role ${role}`);
  return (await tx.query<T>(sql,args)).rows;
});
const create=async(uid: string=host,request=randomUUID())=>(await queryAs<{r:Room}>(uid,'select public.create_room($1,$2,$3,$4) r',[request,'Host',1,'']))[0].r;
const act=async(room:Room,uid:string,action:string,args={},actor=uid,request=randomUUID())=>(await queryAs<{r:Room}>(uid,'select public.room_action($1,$2,$3,$4,$5) r',[room.id,actor,action,JSON.stringify(args),request]))[0].r;

test('verified guest may create and join; outsiders cannot read member ledgers',async()=>{
  const r=await create();
  assert.equal(r.hostId,host);
  assert.equal(r.protocol,2);
  assert.equal((await queryAs(host,'select content from rooms where id=$1',[r.id])).length,1);
  assert.equal((await queryAs(stranger,'select content from rooms where id=$1',[r.id])).length,0);
  const preview=(await queryAs(stranger,'select public.preview_room($1) r',[r.id]))[0].r;
  assert.equal(preview.hostName,'Host'); assert.equal(preview.playerCount,1);
  assert.equal(preview.players,undefined); assert.equal(preview.logs,undefined);
  await act(r,friend,'join',{nickname:'Friend'});
  assert.equal((await queryAs(friend,'select content from rooms where id=$1',[r.id])).length,1);
});
test('forged host IDs fail even when caller knows every public player ID',async()=>{
  const r=await create(); await act(r,friend,'join',{nickname:'Friend'});
  for(const action of ['rename','start','kick','disband','settle','bet'])
    await assert.rejects(act(r,friend,action,{nickname:'Forged',target:host,round:0,amount:1},host),/无法验证/);
  await assert.rejects(act(r,friend,'kick',{target:host}),/只有房主/);
  await assert.rejects(act(r,stranger,'join',{nickname:'Host'},host),/无法验证/);
});
test('direct writes/deletes and internal mutation engine are inaccessible',async()=>{
  const r=await create();
  for(const sql of ['delete from rooms where id=$1',"update rooms set content='{}' where id=$1","insert into rooms(id,content) values ($1,'{}')"])
    await assert.rejects(queryAs(host,sql,[r.id]),/permission denied/);
  await assert.rejects(queryAs(host,'select private.apply_room_action($1,$2,$3,$4,$5)',[r.id,host,'disband','{}',randomUUID()]),/permission denied/);
  await assert.rejects(queryAs(host,'select * from private.room_creations'),/permission denied/);
});
test('unauthenticated anon and null identity cannot create or mutate',async()=>{
  await assert.rejects(queryAs('',"select public.create_room($1,'Guest',1,'')",[randomUUID()],'anon'),/permission denied/);
  await assert.rejects(create(''),/访客身份/);
});
test('create retries return the same room and do not overwrite later state',async()=>{
  const uid=randomUUID(), request=randomUUID();
  const r=await create(uid,request);
  await act(r,uid,'rename',{nickname:'Changed'});
  const again=await create(uid,request);
  assert.equal(again.id,r.id); assert.equal(again.players[uid].nickname,'Changed');
  await assert.rejects(queryAs(uid,"select public.create_room($1,'Other',1,'')",[request]),/请求编号冲突/);
});
test('normal atomic play works through the identity gateway',async()=>{
  const r=await create(randomUUID()); const uid=r.hostId;
  await act(r,friend,'join',{nickname:'Friend'});
  await act(r,uid,'start',{round:0});
  const req=randomUUID();
  await act(r,friend,'bet',{amount:9,round:1},friend,req);
  const again=await act(r,friend,'bet',{amount:9,round:1},friend,req);
  assert.equal(again.pot,11);
  const settled=await act(r,uid,'settle',{target:friend,round:1});
  assert.equal(Object.values(settled.players).reduce((n,p)=>n+p.balance,settled.pot),0);
  const kicked=await act(r,uid,'kick',{target:friend});
  await assert.rejects(act(r,friend,'rename',{nickname:'Other'}),/不在房间/);
  const rejoined=await act(r,friend,'join',{nickname:'Friend again'});
  assert.equal(rejoined.players[friend].balance,kicked.players[friend].balance);
  assert.equal(rejoined.players[friend].removed,undefined);
});
test('legacy rooms are preserved but cannot be claimed by public nickname or old ID',async()=>{
  const id='legacy'; const legacy={id,hostId:'old-id',players:{'old-id':{nickname:'Host',balance:20}},pot:0,logs:[]};
  await db.query('insert into rooms(id,content) values($1,$2)',[id,JSON.stringify(legacy)]);
  await assert.rejects(act({id} as Room,host,'join',{nickname:'Host'}),/旧版房间/);
  assert.equal((await queryAs(host,'select content from rooms where id=$1',[id])).length,0);
  const raw=await db.query<{content:any}>('select content from rooms where id=$1',[id]);
  assert.deepEqual(raw.rows[0].content,legacy);
});
