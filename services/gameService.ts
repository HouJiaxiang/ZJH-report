import { Room, Player, LogEntry } from '../types';
import { AVATARS } from '../constants';
import { supabase } from '../lib/supabase';

// Helper to generate IDs
const generateId = () => Math.random().toString(36).substr(2, 9);
const generateRoomCode = () => Math.floor(1000 + Math.random() * 9000).toString();
const MAX_PLAYERS = 15;

// --- DB Helpers ---

const fetchRoomData = async (roomId: string): Promise<Room | null> => {
  const { data, error } = await supabase
    .from('rooms')
    .select('content')
    .eq('id', roomId)
    .single();

  if (error || !data) return null;
  return data.content as Room;
};

const updateRoomData = async (room: Room) => {
  const { error } = await supabase
    .from('rooms')
    .update({ content: room, updated_at: new Date() })
    .eq('id', room.id);
  
  if (error) {
    console.error('Error updating room:', error);
    throw new Error('Sync failed');
  }
};

// --- Service Methods ---

export const createRoom = async (hostName: string, ante: number = 5): Promise<{ roomId: string; userId: string }> => {
  let roomId = generateRoomCode();
  // Simple check to avoid collision
  const existing = await fetchRoomData(roomId);
  if (existing) roomId = generateRoomCode();

  const hostId = generateId();
  const hostPlayer: Player = {
    id: hostId,
    nickname: hostName,
    avatar: AVATARS[Math.floor(Math.random() * AVATARS.length)],
    balance: 0,
    status: 'active',
    cardStatus: 'blind',
    isOnline: true,
    isHost: true,
  };

  const newRoom: Room = {
    id: roomId,
    hostId,
    status: 'waiting',
    pot: 0,
    ante,
    roundCount: 0,
    createdAt: Date.now(),
    players: { [hostId]: hostPlayer },
    logs: [{
      id: generateId(),
      timestamp: Date.now(),
      userId: 'system',
      userName: '系统',
      action: `${hostName} 创建了房间`,
      type: 'system'
    }],
  };

  const { error } = await supabase
    .from('rooms')
    .insert([{ id: roomId, content: newRoom }]);

  if (error) throw error;
  return { roomId, userId: hostId };
};

export const joinRoom = async (roomId: string, nickname: string): Promise<{ userId: string }> => {
  const room = await fetchRoomData(roomId);
  if (!room) throw new Error('房间不存在');

  // Check Capacity
  if (Object.keys(room.players).length >= MAX_PLAYERS) {
    throw new Error(`房间已满 (限 ${MAX_PLAYERS} 人)`);
  }

  const userId = generateId();
  const newPlayer: Player = {
    id: userId,
    nickname,
    avatar: AVATARS[Math.floor(Math.random() * AVATARS.length)],
    balance: 0,
    status: 'active',
    cardStatus: 'blind',
    isOnline: true,
    isHost: false,
  };

  room.players[userId] = newPlayer;
  room.logs.push({
    id: generateId(),
    timestamp: Date.now(),
    userId: userId,
    userName: nickname,
    action: `${nickname} 加入了房间`,
    type: 'system'
  });

  await updateRoomData(room);
  return { userId };
};

export const leaveRoom = async (roomId: string, userId: string) => {
  const room = await fetchRoomData(roomId);
  if (!room) return;

  const player = room.players[userId];
  if (!player) return; // Player already gone

  // Remove player
  delete room.players[userId];

  const remainingIds = Object.keys(room.players);

  // If no players left, delete the room
  if (remainingIds.length === 0) {
    await disbandRoom(roomId);
    return;
  }

  // Handle Host Transfer if necessary
  if (player.isHost) {
    const newHostId = remainingIds[0];
    room.hostId = newHostId;
    room.players[newHostId].isHost = true;
    
    room.logs.push({
      id: generateId(),
      timestamp: Date.now(),
      userId: 'system',
      userName: '系统',
      action: `${player.nickname} 离开，房主转移给 ${room.players[newHostId].nickname}`,
      type: 'system'
    });
  } else {
    room.logs.push({
      id: generateId(),
      timestamp: Date.now(),
      userId: 'system',
      userName: '系统',
      action: `${player.nickname} 离开了房间`,
      type: 'system'
    });
  }

  await updateRoomData(room);
};

export const disbandRoom = async (roomId: string) => {
  // Directly delete the row from DB. 
  // The subscription 'DELETE' event will handle notifying clients.
  const { error } = await supabase
    .from('rooms')
    .delete()
    .eq('id', roomId);

  if (error) throw error;
};

export const getRoom = async (roomId: string): Promise<Room | null> => {
  return await fetchRoomData(roomId);
};

// --- Realtime Subscription ---

type SubscriptionStatus = 'CONNECTING' | 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'CLOSED';

export const subscribeToRoom = (
  roomId: string, 
  onUpdate: (room: Room | null) => void, // null means room deleted
  onStatusChange?: (status: SubscriptionStatus) => void
) => {
  if (onStatusChange) onStatusChange('CONNECTING');

  const channel = supabase
    .channel(`room-${roomId}`)
    .on(
      'postgres_changes',
      {
        event: '*', // Listen to INSERT, UPDATE, DELETE
        schema: 'public',
        table: 'rooms',
        filter: `id=eq.${roomId}`,
      },
      (payload) => {
        if (payload.eventType === 'DELETE') {
          // Room was deleted/disbanded
          onUpdate(null);
        } else if (payload.new && payload.new.content) {
          onUpdate(payload.new.content as Room);
        }
      }
    )
    .subscribe((status) => {
      console.log(`Realtime status for room ${roomId}:`, status);
      if (onStatusChange) {
        onStatusChange(status as SubscriptionStatus);
      }
    });

  return () => {
    supabase.removeChannel(channel);
  };
};

// --- Game Actions ---

export const startRound = async (roomId: string, initialAnte?: number) => {
  const room = await fetchRoomData(roomId);
  if (!room) return;

  if (room.roundCount === 0 && initialAnte) {
    room.ante = initialAnte;
  }

  room.status = 'playing';
  room.roundCount += 1;
  let potAdd = 0;

  Object.values(room.players).forEach(p => {
    p.status = 'active';
    p.cardStatus = 'blind';
    p.balance -= room.ante;
    potAdd += room.ante;
  });

  room.pot += potAdd;
  
  const anteMsg = (room.roundCount === 1 && initialAnte) ? ` (底注设为 ${initialAnte})` : '';

  room.logs.push({
    id: generateId(),
    timestamp: Date.now(),
    userId: 'system',
    userName: '系统',
    action: `第 ${room.roundCount} 轮开始，已扣底注${anteMsg}`,
    type: 'system'
  });

  await updateRoomData(room);
};

export const placeBet = async (roomId: string, userId: string, amount: number) => {
  const room = await fetchRoomData(roomId);
  if (!room) return;
  const player = room.players[userId];
  if (!player) return;

  player.balance -= amount;
  room.pot += amount;
  
  room.logs.push({
    id: generateId(),
    timestamp: Date.now(),
    userId: userId,
    userName: player.nickname,
    action: `${player.nickname} 下注 ${amount}`,
    amount,
    type: 'bet'
  });

  await updateRoomData(room);
};

export const fold = async (roomId: string, userId: string) => {
  const room = await fetchRoomData(roomId);
  if (!room) return;
  const player = room.players[userId];
  if (!player) return;

  player.status = 'folded';
  
  room.logs.push({
    id: generateId(),
    timestamp: Date.now(),
    userId: userId,
    userName: player.nickname,
    action: `${player.nickname} 弃牌`,
    type: 'fold'
  });

  await updateRoomData(room);
};

export const lookAtCards = async (roomId: string, userId: string) => {
  const room = await fetchRoomData(roomId);
  if (!room) return;
  const player = room.players[userId];
  if (!player) return;

  if (player.cardStatus === 'blind') {
    player.cardStatus = 'seen';
    room.logs.push({
      id: generateId(),
      timestamp: Date.now(),
      userId: userId,
      userName: player.nickname,
      action: `${player.nickname} 看牌`,
      type: 'look'
    });
    await updateRoomData(room);
  }
};

export const settleRound = async (roomId: string, winnerId: string) => {
  const room = await fetchRoomData(roomId);
  if (!room) return;
  const winner = room.players[winnerId];
  if (!winner) return;

  const winAmount = room.pot;
  winner.balance += winAmount;
  room.pot = 0;
  room.status = 'waiting';

  room.logs.push({
    id: generateId(),
    timestamp: Date.now(),
    userId: winnerId,
    userName: winner.nickname,
    action: `${winner.nickname} 赢走池底 (${winAmount})`,
    amount: winAmount,
    type: 'win'
  });

  await updateRoomData(room);
};

export const transferCredits = async (roomId: string, fromId: string, toId: string, amount: number) => {
  const room = await fetchRoomData(roomId);
  if (!room) return;
  const sender = room.players[fromId];
  const receiver = room.players[toId];
  if (!sender || !receiver) return;

  sender.balance -= amount;
  receiver.balance += amount;

  room.logs.push({
    id: generateId(),
    timestamp: Date.now(),
    userId: fromId,
    userName: sender.nickname,
    action: `${sender.nickname} 转给 ${receiver.nickname} ${amount}`,
    amount,
    type: 'transfer'
  });

  await updateRoomData(room);
};