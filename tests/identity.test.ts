import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { supabase } from '../lib/supabase';
import { ensureIdentity } from '../services/identity';
afterEach(()=>mock.restoreAll());

test('restores the same visitor without creating another identity', async()=>{
  mock.method(supabase.auth,'getSession',async()=>({data:{session:{user:{id:'visitor'}}},error:null}) as any);
  const signup=mock.method(supabase.auth,'signInAnonymously',async()=>{throw new Error('must not sign up');});
  assert.equal(await ensureIdentity(),'visitor');
  assert.equal(await ensureIdentity(),'visitor');
  assert.equal(signup.mock.calls.length,0);
});
test('simultaneous first actions create only one anonymous identity', async()=>{
  mock.method(supabase.auth,'getSession',async()=>({data:{session:null},error:null}));
  const signup=mock.method(supabase.auth,'signInAnonymously',async()=>({data:{user:{id:'new'}},error:null}) as any);
  assert.deepEqual(await Promise.all([ensureIdentity(),ensureIdentity(),ensureIdentity()]),['new','new','new']);
  assert.equal(signup.mock.calls.length,1);
});
test('disabled anonymous sign-in fails visibly without requesting personal information', async()=>{
  mock.method(supabase.auth,'getSession',async()=>({data:{session:null},error:null}));
  mock.method(supabase.auth,'signInAnonymously',async()=>({data:{user:null},error:{code:'anonymous_provider_disabled'}}) as any);
  await assert.rejects(ensureIdentity(),/服务尚未启用匿名访客/);
});
test('session read errors do not silently replace an existing identity',async()=>{
  mock.method(supabase.auth,'getSession',async()=>({data:{session:null},error:{message:'offline'}}) as any);
  const signup=mock.method(supabase.auth,'signInAnonymously',async()=>{throw new Error('must not replace');});
  await assert.rejects(ensureIdentity(),/本机身份/);
  assert.equal(signup.mock.calls.length,0);
});
