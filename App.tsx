import React, { useState, useEffect } from 'react';
import { Lobby } from './components/Lobby';
import { GameRoom } from './components/GameRoom';
import { GameState } from './types';
import { getRoom } from './services/gameService';
import { POLL_INTERVAL_MS, SESSION_KEY } from './constants';

const App: React.FC = () => {
  const [gameState, setGameState] = useState<GameState>({ room: null, me: null });
  const [isLoading, setIsLoading] = useState(true);

  // Load session from local storage on mount
  useEffect(() => {
    const session = localStorage.getItem(SESSION_KEY);
    if (session) {
      try {
        const { roomId, userId } = JSON.parse(session);
        const room = getRoom(roomId);
        if (room && room.players[userId]) {
          setGameState({ room, me: room.players[userId] });
        } else {
          localStorage.removeItem(SESSION_KEY);
        }
      } catch (e) {
        localStorage.removeItem(SESSION_KEY);
      }
    }
    setIsLoading(false);
  }, []);

  // Polling for real-time updates
  useEffect(() => {
    if (!gameState.room || !gameState.me) return;

    const intervalId = setInterval(() => {
      const updatedRoom = getRoom(gameState.room!.id);
      if (updatedRoom) {
        // Check if I was kicked or room deleted
        if (!updatedRoom.players[gameState.me!.id]) {
           alert('你已被移出房间。');
           localStorage.removeItem(SESSION_KEY);
           setGameState({ room: null, me: null });
           return;
        }

        setGameState(prev => ({
          room: updatedRoom,
          me: updatedRoom.players[prev.me!.id]
        }));
      } else {
        // Room deleted
        localStorage.removeItem(SESSION_KEY);
        setGameState({ room: null, me: null });
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [gameState.room?.id, gameState.me?.id]);

  const handleJoin = (roomId: string, userId: string) => {
    const room = getRoom(roomId);
    if (room && room.players[userId]) {
      const me = room.players[userId];
      setGameState({ room, me });
      localStorage.setItem(SESSION_KEY, JSON.stringify({ roomId, userId }));
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-500">
        加载中...
      </div>
    );
  }

  if (!gameState.room || !gameState.me) {
    return <Lobby onJoin={handleJoin} />;
  }

  return <GameRoom room={gameState.room} me={gameState.me} />;
};

export default App;