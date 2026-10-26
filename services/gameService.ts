import { Room, RoomPreview } from '../types';
import { AVATARS } from '../constants';
import { supabase } from '../lib/supabase';
import { ensureIdentity } from './identity';
import { SESSION_KEY } from '../constants';

type Listener = (room: Room | null) => void;
type SubscriptionStatus = 'CONNECTING' | 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'CLOSED';
const listeners = new Map<string, Set<Listener>>();
const publish = (id: string, room: Room | null) => listeners.get(id)?.forEach(fn => fn(room));
const pendingKey = (id: string) => `zjh_pending_${id}`;
const locks = new Set<string>();
type Command = { p_room_id: string; p_actor: string; p_action: string; p_args: Record<string, unknown>; p_request_id: string };

export const getRoom = async (roomId: string): Promise<Room | null> => {
  await ensureIdentity();
  const { data, error } = await supabase.from('rooms').select('content').eq('id', roomId).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.content as Room ?? null;
};
export const previewRoom = async (roomId: string): Promise<RoomPreview | null> => {
  await ensureIdentity();
  const { data, error } = await supabase.rpc('preview_room', { p_room_id: roomId });
  if (error) throw new Error(error.message);
  return data as RoomPreview | null;
};
export const hasPendingAction = (id: string) => !!localStorage.getItem(pendingKey(id));

const send = async (command: Command): Promise<Room | null> => {
  if (locks.has(command.p_room_id)) throw new Error('操作正在提交，请稍候');
  locks.add(command.p_room_id);
  try {
    const identity = await ensureIdentity();
    if (command.p_actor !== identity) throw new Error('本机身份已变化，不能接管原成员的操作');
    const { data, error } = await supabase.rpc('room_action', command);
    if (error) {
      // Only explicit database/validation rejections are definitive. Network errors may hide a commit.
      if (error.code && (/^[0-9A-Z]{5}$/.test(error.code) || error.code === 'PGRST202')) {
        localStorage.removeItem(pendingKey(command.p_room_id));
        throw new Error(error.message);
      }
      throw new Error('结果尚未确认，请点击“重试未确认操作”，不要重复下注');
    }
    localStorage.removeItem(pendingKey(command.p_room_id));
    const room = data as Room;
    publish(command.p_room_id, room);
    return room;
  } finally { locks.delete(command.p_room_id); }
};

const act = async (roomId: string, actor: string, action: string, args: Record<string, unknown> = {}) => {
  if (hasPendingAction(roomId)) throw new Error('上一笔操作尚未确认，请先重试未确认操作');
  const command: Command = { p_room_id: roomId, p_actor: actor, p_action: action, p_args: args, p_request_id: crypto.randomUUID() };
  localStorage.setItem(pendingKey(roomId), JSON.stringify(command));
  return send(command);
};
export const retryPendingAction = async (roomId: string) => {
  const saved = localStorage.getItem(pendingKey(roomId));
  if (saved) return send(JSON.parse(saved));
};

export const createRoom = async (hostName: string, ante = 5) => {
  const nickname = hostName.trim();
  if (!nickname || nickname.length > 20) throw new Error('昵称须为 1 到 20 个字符');
  const userId = await ensureIdentity();
  const key = `zjh_pending_create_${userId}`;
  const saved = localStorage.getItem(key);
  const args = saved ? JSON.parse(saved) : { p_request_id: crypto.randomUUID(), p_nickname: nickname, p_ante: ante, p_avatar: AVATARS[0] };
  localStorage.setItem(key, JSON.stringify(args));
  const { data, error } = await supabase.rpc('create_room', args);
  if (error) {
    if (error.code && /^[0-9A-Z]{5}$/.test(error.code)) localStorage.removeItem(key);
    throw new Error(error.code ? error.message : '创建结果尚未确认，请再次点击创建以恢复同一个房间');
  }
  const room = data as Room;
  if (room.closed) {
    localStorage.removeItem(key);
    throw new Error('上次创建的房间已解散，请重新创建');
  }
  localStorage.setItem(SESSION_KEY, JSON.stringify({ roomId: room.id, userId }));
  localStorage.removeItem(key);
  return { roomId: room.id, userId };
};
export const joinRoom = async (roomId: string, nickname: string) => {
  const userId = await ensureIdentity();
  const pending = localStorage.getItem(pendingKey(roomId));
  if (pending) {
    const command: Command = JSON.parse(pending);
    if (command.p_action !== 'join' || command.p_actor !== userId) throw new Error('该房间有未确认操作，请先恢复原会话');
    await send(command);
    localStorage.setItem(SESSION_KEY, JSON.stringify({ roomId, userId }));
    return { userId };
  }
  await act(roomId, userId, 'join', { nickname, avatar: AVATARS[Math.floor(Math.random() * AVATARS.length)] });
  localStorage.setItem(SESSION_KEY, JSON.stringify({ roomId, userId }));
  return { userId };
};

export const startRound = (id: string, actor: string, round: number, ante?: number) => act(id, actor, 'start', { round, ante });
export const placeBet = (id: string, actor: string, amount: number, round: number) => act(id, actor, 'bet', { amount, round });
export const fold = (id: string, actor: string, round: number) => act(id, actor, 'fold', { round });
export const lookAtCards = (id: string, actor: string, round: number) => act(id, actor, 'look', { round });
export const settleRound = (id: string, actor: string, target: string, round: number) => act(id, actor, 'settle', { target, round });
export const transferCredits = (id: string, actor: string, target: string, amount: number) => act(id, actor, 'transfer', { target, amount });
export const leaveRoom = (id: string, actor: string) => act(id, actor, 'leave');
export const disbandRoom = (id: string, actor: string) => act(id, actor, 'disband');
export const kickPlayer = (id: string, actor: string, target: string) => act(id, actor, 'kick', { target });
export const renamePlayer = (id: string, actor: string, nickname: string) => act(id, actor, 'rename', { nickname });

export const subscribeToRoom = (roomId: string, onUpdate: Listener, onStatusChange?: (status: SubscriptionStatus) => void, initialRevision = -1) => {
  let disposed = false;
  let refreshing = false;
  let revision = initialRevision;
  const accept: Listener = room => {
    if (disposed || (room && (room.revision ?? 0) < revision)) return;
    revision = room?.revision ?? revision;
    onUpdate(room);
  };
  const local = listeners.get(roomId) ?? new Set<Listener>();
  local.add(accept);
  listeners.set(roomId, local);
  const refresh = async () => {
    if (disposed || refreshing || document.visibilityState === 'hidden') return;
    refreshing = true;
    try { accept(await getRoom(roomId)); }
    catch { if (!disposed) onStatusChange?.('CHANNEL_ERROR'); }
    finally { refreshing = false; }
  };
  onStatusChange?.('CONNECTING');
  const channel = supabase.channel(`room-${roomId}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` }, payload => accept(payload.new.content as Room))
    .subscribe(status => {
      if (disposed) return;
      onStatusChange?.(status === 'TIMED_OUT' ? 'CHANNEL_ERROR' : status as SubscriptionStatus);
      if (status === 'SUBSCRIBED') void refresh();
    });
  const interval = window.setInterval(refresh, 15000);
  window.addEventListener('online', refresh);
  document.addEventListener('visibilitychange', refresh);
  return () => {
    disposed = true;
    window.clearInterval(interval);
    window.removeEventListener('online', refresh);
    document.removeEventListener('visibilitychange', refresh);
    local.delete(accept);
    if (!local.size) listeners.delete(roomId);
    void supabase.removeChannel(channel);
  };
};
