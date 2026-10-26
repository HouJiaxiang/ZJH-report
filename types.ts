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
  removed?: boolean;
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
  protocol?: number;
  id: string;
  hostId: string;
  status: RoomStatus;
  pot: number;
  ante: number;
  roundCount: number;
  createdAt: number;
  revision?: number;
  closed?: boolean;
  players: Record<string, Player>;
  // Latest event only; the full ledger is fetched via room_history.
  logs: LogEntry[];
}

export interface HistoryPage {
  entries: { cursor: string; event: LogEntry }[];
  nextCursor: string | null;
}

export interface GameState {
  room: Room | null;
  me: Player | null;
}

export interface RoomPreview {
  id: string;
  hostName: string;
  playerCount: number;
  pot: number;
  status: RoomStatus;
}
