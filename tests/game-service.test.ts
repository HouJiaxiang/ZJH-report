import { test, mock, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { supabase } from '../lib/supabase';
import { placeBet, retryPendingAction, hasPendingAction, subscribeToRoom, getRoomHistory } from '../services/gameService';

const values = new Map<string,string>();
Object.defineProperty(globalThis,'localStorage',{value:{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k)}, configurable:true});
afterEach(()=>{mock.restoreAll();values.clear();});
beforeEach(()=>{mock.method(supabase.auth,'getSession',async()=>({data:{session:{user:{id:'a'}}},error:null}) as any);});

test('history is fetched separately in bounded pages with lossless string cursors',async()=>{
  const page={entries:[],nextCursor:null};
  const rpc=mock.method(supabase,'rpc',async()=>({data:page,error:null}));
  assert.deepEqual(await getRoomHistory('test','9007199254740993'),page);
  assert.deepEqual(rpc.mock.calls[0].arguments,['room_history',{p_room_id:'test',p_before:'9007199254740993',p_limit:50}]);
  assert.equal(hasPendingAction('test'),false);
  rpc.mock.mockImplementation(async()=>({data:null,error:{message:'无权查看房间记录'}}));
  await assert.rejects(getRoomHistory('test'),/无权/);
});

test('one RPC per bet, with round guard and no read-before-write',async()=>{
  const rpc=mock.method(supabase,'rpc',async()=>({data:{id:'test',revision:1},error:null}));
  const from=mock.method(supabase,'from',()=>{throw new Error('unexpected fetch');});
  await placeBet('test','a',5,1);
  assert.equal(rpc.mock.calls.length,1);
  assert.equal(from.mock.calls.length,0);
  assert.deepEqual(rpc.mock.calls[0].arguments[1].p_args,{amount:5,round:1});
  assert.equal(hasPendingAction('test'),false);
});
test('uncertain result blocks new bets and retries the SAME request after reload',async()=>{
  const rpc=mock.method(supabase,'rpc',async()=>({data:null,error:{code:'',message:'Failed to fetch'}}));
  await assert.rejects(placeBet('test','a',5,1), /结果尚未确认/);
  const saved=values.get('zjh_pending_test');
  assert.equal(hasPendingAction('test'),true);
  await assert.rejects(placeBet('test','a',8,1), /上一笔/);
  assert.equal(rpc.mock.calls.length,1);
  rpc.mock.mockImplementation(async()=>({data:{id:'test',revision:2},error:null}));
  await retryPendingAction('test');
  assert.deepEqual(rpc.mock.calls[1].arguments[1],JSON.parse(saved!));
  assert.equal(hasPendingAction('test'),false);
});
test('a server validation failure clears pending state and remains visible',async()=>{
  mock.method(supabase,'rpc',async()=>({data:null,error:{code:'P0001',message:'本轮已经结算'}}));
  await assert.rejects(placeBet('test','a',5,1), /已经结算/);
  assert.equal(hasPendingAction('test'),false);
});
test('rapid duplicate taps do not create a second mutation',async()=>{
  let finish!: (x:any)=>void;
  let started!: ()=>void;
  const rpcStarted = new Promise<void>(resolve=>{started=resolve;});
  const rpc=mock.method(supabase,'rpc',()=>new Promise(resolve=>{finish=resolve;started();}));
  const first=placeBet('test','a',5,1);
  await assert.rejects(placeBet('test','a',5,1),/上一笔/);
  await rpcStarted;
  finish({data:{id:'test',revision:1},error:null});
  await first;
  assert.equal(rpc.mock.calls.length,1);
});
test('RPC response updates immediately; late realtime versions cannot roll it back',async()=>{
  Object.defineProperty(globalThis,'window',{value:{setInterval:()=>1,clearInterval:()=>{},addEventListener:()=>{},removeEventListener:()=>{}},configurable:true});
  Object.defineProperty(globalThis,'document',{value:{visibilityState:'visible',addEventListener:()=>{},removeEventListener:()=>{}},configurable:true});
  let receive!:(p:any)=>void;
  const channel={on:(_event:any,_filter:any,fn:any)=>{receive=fn;return channel;},subscribe:()=>channel};
  mock.method(supabase,'channel',()=>channel as any);
  mock.method(supabase,'removeChannel',async()=> 'ok');
  mock.method(supabase,'rpc',async()=>({data:{id:'test',revision:3},error:null}));
  const versions:number[]=[];
  const cleanup=subscribeToRoom('test',r=>versions.push(r!.revision!));
  receive({new:{content:{id:'test',revision:2}}});
  await placeBet('test','a',5,1);
  receive({new:{content:{id:'test',revision:1}}});
  assert.deepEqual(versions,[2,3]);
  cleanup();
  receive({new:{content:{id:'test',revision:4}}});
  assert.deepEqual(versions,[2,3]);
});
