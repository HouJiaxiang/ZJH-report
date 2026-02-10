export type PlayerStatus = 'active' | 'folded' | 'bust';
export type CardStatus = 'blind' | 'seen';
export type RoomStatus = 'waiting' | 'playing';

export interface Player {
  id: string;
  nickname: string;
  avatar: string; // Emoji
  balance: number;
  status: PlayerStatus;
  cardStatus: CardStatus;
  isOnline: boolean;
  isHost: boolean;
}

export interface LogEntry {
  id: string;
  timestamp: number;
  userId: string;
  userName: string;
  action: string;
  amount?: number;
  type: 'bet' | 'fold' | 'look' | 'win' | 'transfer' | 'system';
}

export interface Room {
  id: string;
  hostId: string;
  status: RoomStatus;
  pot: number;
  ante: number;
  roundCount: number;
  createdAt: number;
  players: Record<string, Player>;
  logs: LogEntry[];
}

export interface GameState {
  room: Room | null;
  me: Player | null;
}