import assert from 'node:assert/strict';

if (process.env.RUN_LIVE_SMOKE !== '1') throw new Error('Set RUN_LIVE_SMOKE=1 to create disposable live test data');
const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_ANON_KEY;
if (!url || !key) throw new Error('Explicit Supabase configuration required');
const api = async (path, token, body) => {
  const res = await fetch(`${url}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { apikey: key, ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${res.status}: ${data.message || data.msg || data.error_description || data.code}`);
  return data;
};
const guest = () => api('/auth/v1/signup', null, { data: { test: 'release-smoke' } });
const a = await guest();
const b = await guest();
console.log(JSON.stringify({ testUsers: [a.user.id, b.user.id] }));
const rpc = (who, name, args) => api(`/rest/v1/rpc/${name}`, who.access_token, args);
let room = await rpc(a, 'create_room', { p_request_id: crypto.randomUUID(), p_nickname: 'ReleaseTestHost', p_ante: 1, p_avatar: 'A' });
console.log(JSON.stringify({ testRoom: room.id }));
const action = (who, name, args = {}, request = crypto.randomUUID()) => rpc(who, 'room_action', {
  p_room_id: room.id, p_actor: who.user.id, p_action: name, p_args: args, p_request_id: request,
});
const conserved = r => assert.equal(r.pot + Object.values(r.players).reduce((s, p) => s + p.balance, 0), 0);
await assert.rejects(rpc(b, 'room_history', { p_room_id: room.id }));
await action(b, 'join', { nickname: 'ReleaseTestGuest', avatar: 'B' });
room = await action(a, 'start', { round: 0 });
const request = crypto.randomUUID();
const batch = await Promise.all(Array.from({ length: 20 }, (_, i) => action(i % 2 ? a : b, 'bet', { amount: 2, round: 1 })));
batch.forEach(conserved);
room = await action(a, 'bet', { amount: 3, round: 1 }, request);
assert.equal(room.pot, 45);
const revision = room.revision;
room = await action(a, 'bet', { amount: 3, round: 1 }, request);
assert.equal(room.revision, revision);
assert.equal(room.pot, 45);
room = await action(a, 'transfer', { target: b.user.id, amount: 7 });
conserved(room);
room = await action(a, 'settle', { target: b.user.id, round: 1 });
assert.equal(room.pot, 0);
conserved(room);
room = await action(b, 'rename', { nickname: 'ReleaseTestRenamed' });
assert.equal(room.players[b.user.id].nickname, 'ReleaseTestRenamed');
room = await action(a, 'kick', { target: b.user.id });
assert.equal(room.players[b.user.id].removed, true);
await assert.rejects(action(b, 'rename', { nickname: 'Blocked' }));
const history = await rpc(a, 'room_history', { p_room_id: room.id, p_limit: 50 });
assert.equal(room.logs.length, 1);
assert.equal(history.entries.length, 27);
assert.equal(history.entries.filter(({ event }) => event.type === 'bet').length, 21);
assert.ok(history.entries.some(({ event }) => event.type === 'transfer' && event.amount === 7 && event.action.includes('ReleaseTestGuest')));
assert.ok(history.entries.some(({ event }) => event.action.includes('轮开始') && event.userName === 'ReleaseTestHost'));
console.log(JSON.stringify({ result: 'PASS', concurrentBets: 20, finalRevision: room.revision, snapshotBytes: JSON.stringify(room).length, historyEntries: history.entries.length }));
await action(a, 'disband');
