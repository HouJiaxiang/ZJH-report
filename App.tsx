import React, { useState, useEffect, useRef } from 'react';
import { Lobby } from './components/Lobby';
import { GameRoom } from './components/GameRoom';
import { GameState } from './types';
import { getRoom, subscribeToRoom } from './services/gameService';
import { SESSION_KEY } from './constants';
import { isConfigured } from './lib/supabase';
import { AlertTriangle, ExternalLink, Copy } from 'lucide-react';

const App: React.FC = () => {
  const [gameState, setGameState] = useState<GameState>({ room: null, me: null });
  const [isLoading, setIsLoading] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState<'CONNECTING' | 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'CLOSED'>('CONNECTING');
  
  // Track subscription cleanup
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // Initial Session Load
  useEffect(() => {
    if (!isConfigured) {
      setIsLoading(false);
      return;
    }

    const initSession = async () => {
      const session = localStorage.getItem(SESSION_KEY);
      if (session) {
        try {
          const { roomId, userId } = JSON.parse(session);
          const room = await getRoom(roomId);
          if (room && room.players[userId]) {
            setGameState({ room, me: room.players[userId] });
            setupSubscription(roomId, userId);
          } else {
            localStorage.removeItem(SESSION_KEY);
          }
        } catch (e) {
          localStorage.removeItem(SESSION_KEY);
        }
      }
      setIsLoading(false);
    };

    initSession();

    return () => {
      if (unsubscribeRef.current) unsubscribeRef.current();
    };
  }, []);

  const setupSubscription = (roomId: string, userId: string) => {
    // Cleanup previous sub if exists
    if (unsubscribeRef.current) unsubscribeRef.current();

    const cleanup = subscribeToRoom(
      roomId, 
      (updatedRoom) => {
         // Check if I was kicked
         if (!updatedRoom.players[userId]) {
           alert('你已被移出房间。');
           localStorage.removeItem(SESSION_KEY);
           setGameState({ room: null, me: null });
           if (unsubscribeRef.current) unsubscribeRef.current();
           return;
         }

         setGameState(prev => ({
           room: updatedRoom,
           me: updatedRoom.players[userId]
         }));
      },
      (status) => {
        setConnectionStatus(status);
      }
    );

    unsubscribeRef.current = cleanup;
  };

  const handleJoin = async (roomId: string, userId: string) => {
    // Initial fetch
    const room = await getRoom(roomId);
    if (room && room.players[userId]) {
      setGameState({ room, me: room.players[userId] });
      localStorage.setItem(SESSION_KEY, JSON.stringify({ roomId, userId }));
      
      // Start Realtime Listener
      setupSubscription(roomId, userId);
    }
  };

  if (!isConfigured) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-200 p-6 font-sans">
        <div className="max-w-xl w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl relative overflow-hidden">
          {/* Background decoration */}
          <div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl pointer-events-none"></div>
          
          <div className="flex items-center gap-4 mb-6 relative z-10">
            <div className="bg-amber-500/10 p-3 rounded-xl border border-amber-500/20">
              <AlertTriangle size={32} className="text-amber-500" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white">连接云数据库</h2>
              <p className="text-slate-400 text-sm">需要简单的配置才能启动多人联机功能</p>
            </div>
          </div>

          <div className="space-y-6 relative z-10">
            <div className="bg-slate-950 rounded-xl border border-slate-800 p-5">
              <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4 flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-slate-800 flex items-center justify-center text-xs">1</span>
                获取 API 密钥
              </h3>
              <p className="text-slate-400 text-sm mb-3 leading-relaxed">
                访问 Supabase 控制台，进入 <b>Project Settings</b> &rarr; <b>API</b> 页面。
              </p>
              <a 
                href="https://supabase.com/dashboard/project/_/settings/api" 
                target="_blank" 
                rel="noreferrer"
                className="inline-flex items-center gap-2 text-amber-500 hover:text-amber-400 text-sm font-medium transition-colors hover:underline"
              >
                前往 Supabase API 设置 <ExternalLink size={14} />
              </a>
            </div>

            <div className="bg-slate-950 rounded-xl border border-slate-800 p-5">
               <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4 flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-slate-800 flex items-center justify-center text-xs">2</span>
                修改配置文件
              </h3>
              <p className="text-slate-400 text-sm mb-3">
                打开项目中的 <code className="bg-slate-800 px-1.5 py-0.5 rounded text-slate-200 text-xs font-mono">lib/supabase.ts</code> 文件，填入你的信息：
              </p>
              
              <div className="bg-black/80 rounded-lg border border-slate-800 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2 bg-slate-900/50 border-b border-slate-800">
                  <span className="text-xs text-slate-500 font-mono">lib/supabase.ts</span>
                </div>
                <div className="p-4 overflow-x-auto">
                  <pre className="font-mono text-xs leading-relaxed">
<span className="text-slate-500">// 1. 填入 Project URL (例如 https://xyz.supabase.co)</span>
<span className="text-purple-400">const</span> <span className="text-blue-400">SUPABASE_URL</span> = <span className="text-emerald-400">'在此处粘贴 URL'</span>;

<span className="text-slate-500">// 2. 填入 anon public Key</span>
<span className="text-purple-400">const</span> <span className="text-blue-400">SUPABASE_ANON_KEY</span> = <span className="text-emerald-400">'在此处粘贴 Key'</span>;
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-500 flex-col gap-4">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500"></div>
        <p>正在连接云端服务器...</p>
      </div>
    );
  }

  if (!gameState.room || !gameState.me) {
    return <Lobby onJoin={handleJoin} />;
  }

  return (
    <GameRoom 
      room={gameState.room} 
      me={gameState.me} 
      connectionStatus={connectionStatus} 
    />
  );
};

export default App;