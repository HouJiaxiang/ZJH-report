import React, { useState } from 'react';
import { createRoom, joinRoom, previewRoom as fetchPreview } from '../services/gameService';
import { Button } from './Button';
import { Modal } from './Modal';
import { RoomPreview } from '../types';

interface LobbyProps {
  onJoin: (roomId: string, userId: string) => Promise<void>;
  notice?: string;
}

export const Lobby: React.FC<LobbyProps> = ({ onJoin, notice }) => {
  const [name, setName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [activeTab, setActiveTab] = useState<'join' | 'create'>('join');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  
  // Preview State
  const [previewRoom, setPreviewRoom] = useState<RoomPreview | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const handleCreate = async () => {
    if (!name) return setError('请输入昵称');
    setLoading(true);
    setError('');
    try {
      const { roomId, userId } = await createRoom(name);
      await onJoin(roomId, userId);
    } catch (e: any) {
      console.error('Create room failed:', e);
      let msg = e.message || '创建房间失败';
      
      // 翻译常见的数据库错误，帮助用户排查
      if (msg.includes('relation "rooms" does not exist')) {
        msg = '错误：数据库表 "rooms" 不存在。请去 Supabase SQL Editor 运行建表脚本。';
      } else if (msg.includes('row-level security')) {
        msg = '错误：权限不足。请检查数据库授权配置，不要关闭 RLS。';
      }
      
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handlePreview = async () => {
    if (!name) return setError('请先输入昵称');
    if (roomCode.length !== 4) return setError('无效的房间号');
    
    setError('');
    setLoading(true);
    try {
      const room = await fetchPreview(roomCode);
      if (!room) return setError('找不到房间或房间已解散');
      
      setPreviewRoom(room);
      setShowPreview(true);
    } catch (e: any) {
      console.error('Preview room failed:', e);
      setError(e.message || '查找房间出错');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmJoin = async () => {
    if (!previewRoom) return;
    setLoading(true);
    setError('');
    try {
      const { userId } = await joinRoom(previewRoom.id, name);
      await onJoin(previewRoom.id, userId);
    } catch (e: any) {
      setError(e.message || '加入房间失败');
    } finally {
      setLoading(false);
      setShowPreview(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-gradient-to-br from-slate-900 to-black">
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <h1 className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-yellow-600 mb-2">
            炸金花云记分
          </h1>
          <p className="text-slate-400 text-sm">好友实时记分牌</p>
        </div>

        <div className="bg-slate-900/50 backdrop-blur-xl border border-slate-800 rounded-2xl p-6 shadow-2xl">
          {/* Tabs */}
          <div className="flex gap-2 p-1 bg-slate-950/50 rounded-lg mb-6">
            <button 
              onClick={() => { setActiveTab('join'); setError(''); }}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${activeTab === 'join' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
            >
              加入房间
            </button>
            <button 
              onClick={() => { setActiveTab('create'); setError(''); }}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${activeTab === 'create' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
            >
              创建房间
            </button>
          </div>

          <div className="space-y-4">
            {notice && <p role="status" className="text-sm text-amber-300">{notice}</p>}
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">你的昵称</label>
              <input
                type="text"
                maxLength={20}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：赌神"
                className="w-full bg-slate-950 border border-slate-700 text-white rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-amber-500/50 placeholder-slate-600"
              />
            </div>

            {activeTab === 'join' && (
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">房间号</label>
                <input
                  type="text"
                  maxLength={4}
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value)}
                  placeholder="例如：8821"
                  className="w-full bg-slate-950 border border-slate-700 text-white rounded-lg px-4 py-3 font-mono text-center tracking-widest text-lg focus:outline-none focus:ring-2 focus:ring-amber-500/50 placeholder-slate-600"
                />
              </div>
            )}

            {error && <div className="p-3 rounded-lg bg-rose-950/50 border border-rose-900/50 text-rose-400 text-xs text-center leading-relaxed font-medium">{error}</div>}

            <Button 
              fullWidth 
              size="lg"
              onClick={activeTab === 'join' ? handlePreview : handleCreate}
              disabled={loading}
            >
              {loading ? '处理中...' : (activeTab === 'join' ? '查找房间' : '创建房间')}
            </Button>
          </div>
        </div>
      </div>

      {/* Preview Modal */}
      <Modal 
        isOpen={showPreview} 
        onClose={() => setShowPreview(false)} 
        title="房间预览"
      >
        {previewRoom && (
          <div className="space-y-4">
            <div className="text-center p-4 bg-slate-950 rounded-lg">
              <div className="text-sm text-slate-400">房间号</div>
              <div className="text-3xl font-mono text-amber-400 font-bold">{previewRoom.id}</div>
            </div>
            
            <div className="space-y-2">
              <div className="flex justify-between text-sm border-b border-slate-800 pb-2">
                <span className="text-slate-400">房主</span>
                <span className="text-white font-medium">
                  {previewRoom.hostName}
                </span>
              </div>
              <div className="flex justify-between text-sm border-b border-slate-800 pb-2">
                <span className="text-slate-400">玩家</span>
                <span className="text-white font-medium">{previewRoom.playerCount} / 15</span>
              </div>
              <div className="flex justify-between text-sm border-b border-slate-800 pb-2">
                <span className="text-slate-400">池底</span>
                <span className="text-amber-400 font-medium">{previewRoom.pot}</span>
              </div>
            </div>

            <Button fullWidth onClick={handleConfirmJoin} disabled={loading}>
              确认加入
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
};
