import { Room, Player, LogEntry, PlayerStatus } from '../types';
import { STORAGE_KEY, AVATARS } from '../constants';

// Helper to generate IDs
const generateId = () => Math.random().toString(36).substr(2, 9);
const generateRoomCode = () => Math.floor(1000 + Math.random() * 9000).toString();

// Low-level DB access
const getDb = (): Record<string, Room> => {
  const data = localStorage.getItem(STORAGE_KEY);
  return data ? JSON.parse(data) : {};
};

const saveDb = (db: Record<string, Room>) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
};

// --- Service Methods ---

export const createRoom = async (hostName: string, ante: number = 5): Promise<{ roomId: string; userId: string }> => {
  const db = getDb();
  let roomId = generateRoomCode();
  while (db[roomId]) {
    roomId = generateRoomCode();
  }

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

  db[roomId] = newRoom;
  saveDb(db);
  return { roomId, userId: hostId };
};

export const joinRoom = async (roomId: string, nickname: string): Promise<{ userId: string }> => {
  const db = getDb();
  const room = db[roomId];
  if (!room) throw new Error('Room not found');

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

  saveDb(db);
  return { userId };
};

export const getRoom = (roomId: string): Room | null => {
  const db = getDb();
  return db[roomId] || null;
};

// --- Game Actions ---

export const startRound = async (roomId: string) => {
  const db = getDb();
  const room = db[roomId];
  if (!room) return;

  room.status = 'playing';
  room.roundCount += 1;
  let potAdd = 0;

  Object.values(room.players).forEach(p => {
    // Only active players pay ante? Or everyone? Assuming everyone who isn't busted/offline
    // Implementation: Reset everyone to active and blind, deduct ante
    p.status = 'active';
    p.cardStatus = 'blind';
    p.balance -= room.ante;
    potAdd += room.ante;
  });

  room.pot += potAdd;
  room.logs.push({
    id: generateId(),
    timestamp: Date.now(),
    userId: 'system',
    userName: '系统',
    action: `第 ${room.roundCount} 轮开始，已扣底注`,
    type: 'system'
  });

  saveDb(db);
};

export const placeBet = async (roomId: string, userId: string, amount: number) => {
  const db = getDb();
  const room = db[roomId];
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

  saveDb(db);
};

export const fold = async (roomId: string, userId: string) => {
  const db = getDb();
  const room = db[roomId];
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

  saveDb(db);
};

export const lookAtCards = async (roomId: string, userId: string) => {
  const db = getDb();
  const room = db[roomId];
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
    saveDb(db);
  }
};

export const settleRound = async (roomId: string, winnerId: string) => {
  const db = getDb();
  const room = db[roomId];
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

  saveDb(db);
};

export const transferCredits = async (roomId: string, fromId: string, toId: string, amount: number) => {
  const db = getDb();
  const room = db[roomId];
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

  saveDb(db);
};