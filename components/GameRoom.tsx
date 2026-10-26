import React, { useState, useRef } from 'react';
import { Room, Player } from '../types';
import { startRound, placeBet, fold, lookAtCards, settleRound, transferCredits, leaveRoom, disbandRoom, kickPlayer, renamePlayer, retryPendingAction, hasPendingAction } from '../services/gameService';
import { PotDisplay } from './PotDisplay';
import { RoomHistory } from './RoomHistory';
import { PlayerCard } from './PlayerCard';
import { Controls } from './Controls';
import { Modal } from './Modal';
import { Button } from './Button';
import { Copy, Check, Settings, LogOut, AlertTriangle, Pencil, UserMinus, History } from 'lucide-react';

interface GameRoomProps {
  room: Room;
  me: Player;
  connectionStatus: 'CONNECTING' | 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'CLOSED';
}

export const GameRoom: React.FC<GameRoomProps> = ({ room, me, connectionStatus }) => {
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [transferAmount, setTransferAmount] = useState<string>('');
  const [showSettleModal, setShowSettleModal] = useState(false);
  const [showExitModal, setShowExitModal] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [showRename, setShowRename] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [nickname, setNickname] = useState(me.nickname);
  const [kickTarget, setKickTarget] = useState<string | null>(null);
  const run = async (action: () => Promise<unknown>, done?: () => void) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try { await action(); done?.(); }
    catch (e) { setError(e instanceof Error ? e.message : '操作失败，请检查网络'); }
    finally { busyRef.current = false; setBusy(false); }
  };

  // Sorting players: Me first, then others
  const playersList = Object.values(room.players).filter(p => !p.removed);
  const removedPlayers = Object.values(room.players).filter(p => p.removed);
  const sortedPlayers = [
    ...playersList.filter(p => p.id === me.id),
    ...playersList.filter(p => p.id !== me.id)
  ];

  const activePlayers = playersList.filter(p => p.status !== 'folded');

  const handlePlayerClick = (playerId: string) => {
    if (playerId === me.id) {
      setNickname(me.nickname);
      setShowRename(true);
    } else {
      setSelectedPlayerId(playerId);
    }
  };

  const handleTransfer = async () => {
    if (!selectedPlayerId || !transferAmount) return;
    const amount = Number(transferAmount);
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1000000) return setError('积分须为 1 到 1000000 的整数');
    
    await run(() => transferCredits(room.id, me.id, selectedPlayerId, amount), () => {
      setSelectedPlayerId(null);
      setTransferAmount('');
    });
  };

  const handleSettle = async (winnerId: string) => {
    await run(() => settleRound(room.id, me.id, winnerId, room.roundCount), () => setShowSettleModal(false));
  };

  const handleLeave = async () => {
    await run(() => leaveRoom(room.id, me.id));
  };

  const handleDisband = async () => {
    await run(() => disbandRoom(room.id, me.id));
  };

  const copyRoomId = () => {
    navigator.clipboard.writeText(room.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Connection Status UI Helpers
  const getConnectionIcon = () => {
    switch (connectionStatus) {
      case 'SUBSCRIBED':
        return <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)] animate-pulse"></div>;
      case 'CONNECTING':
        return <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></div>;
      default:
        return <div className="w-2 h-2 rounded-full bg-rose-500"></div>;
    }
  };
  
  const getConnectionText = () => {
    if (connectionStatus === 'SUBSCRIBED') return '实时同步中';
    if (connectionStatus === 'CONNECTING') return '连接中...';
    return '连接断开';
  };

  return (
    <div className="min-h-screen bg-slate-950 pb-24">
      {(busy || error || hasPendingAction(room.id)) && (
        <div role="status" className="fixed top-0 left-0 right-0 z-[60] bg-slate-900 border-b border-slate-600 p-3 text-center text-sm text-white">
          {busy ? '正在提交...' : error || '有一笔操作等待确认'}
          {!busy && hasPendingAction(room.id) && <button className="ml-3 text-amber-400 underline" onClick={() => run(() => retryPendingAction(room.id))}>重试未确认操作</button>}
          {!busy && !hasPendingAction(room.id) && <button className="ml-3 underline" onClick={() => setError('')}>关闭</button>}
        </div>
      )}
      {/* Top Header */}
      <div className="sticky top-0 z-30">
        <div className="bg-slate-900/95 backdrop-blur-sm px-4 py-3 flex justify-between items-center border-b border-slate-800 shadow-lg">
          <div className="flex flex-col gap-1">
            <button 
              onClick={copyRoomId}
              className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 transition-colors px-3 py-1.5 rounded-lg border border-slate-700 active:scale-95"
            >
              <div className="flex flex-col items-start">
                <span className="text-[10px] uppercase text-slate-500 font-bold tracking-wider">房间号</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-xl font-mono font-bold text-amber-500 tracking-wider">{room.id}</span>
                  {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} className="text-slate-400" />}
                </div>
              </div>
            </button>
            
            {/* Connection Status & Ante Info */}
            <div className="flex items-center gap-2 ml-1">
              <div className="flex items-center gap-1.5">
                {getConnectionIcon()}
                <span className={`text-[10px] font-medium ${connectionStatus === 'SUBSCRIBED' ? 'text-emerald-500/70' : 'text-slate-500'}`}>
                  {getConnectionText()}
                </span>
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <button title="修改我的昵称" aria-label="修改我的昵称" onClick={() => { setNickname(me.nickname); setShowRename(true); }} className="self-center p-2 text-slate-300"><Pencil size={18} /></button>
            <div className="flex flex-col items-end gap-1">
              {/* Ante Display */}
              <div className="flex items-center gap-1.5 bg-slate-800/80 px-2 py-0.5 rounded border border-slate-700/50">
                <Settings size={10} className="text-slate-500" />
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">底注:</span>
                <span className="text-xs font-mono font-bold text-amber-500">{room.ante}</span>
              </div>

              {/* My Balance */}
              <div className="flex flex-col items-end">
                  <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">我的资产</span>
                  <span className={`font-mono font-bold text-lg leading-none ${me.balance >= 0 ? 'text-rose-500' : 'text-emerald-500'}`}>
                    {me.balance > 0 ? '+' : ''}{me.balance}
                  </span>
              </div>
            </div>

            {/* Exit Button */}
            <button 
              onClick={() => setShowExitModal(true)}
              className="ml-1 self-center bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 p-2.5 rounded-xl border border-slate-700 transition-all"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
        
        {/* Pot Display with Settle Button */}
        <PotDisplay 
          pot={room.pot} 
          logs={room.logs} 
          roundCount={room.roundCount} 
          onShowHistory={() => setShowHistory(true)}
          isHost={me.isHost}
          onSettle={room.status === 'playing' ? () => setShowSettleModal(true) : undefined}
        />
      </div>

      {/* Grid */}
      <div className="p-4 grid grid-cols-3 gap-3">
        {sortedPlayers.map(player => (
          <PlayerCard 
            key={player.id}
            player={player}
            isMe={player.id === me.id}
            onClick={() => handlePlayerClick(player.id)}
          />
        ))}
      </div>

      {/* Controls */}
      <div className="px-4 pb-3 flex justify-end">
        <button onClick={() => setShowHistory(true)} className="flex items-center gap-2 py-2 text-sm text-slate-300"><History size={16} />房间记录</button>
      </div>
      {showHistory && <RoomHistory key={room.id} roomId={room.id} onClose={() => setShowHistory(false)} />}
      {removedPlayers.length > 0 && <details className="px-4 pb-4 text-sm text-slate-400"><summary>已离开成员的积分记录</summary>{removedPlayers.map(p => <div key={p.id} className="flex justify-between py-1"><span className="break-all">{p.nickname}</span><span>{p.balance}</span></div>)}</details>}
      <Controls 
        player={me}
        roomStatus={room.status}
        roundCount={room.roundCount}
        busy={busy || hasPendingAction(room.id)}
        onBet={(amount) => run(() => placeBet(room.id, me.id, amount, room.roundCount))}
        onFold={() => run(() => fold(room.id, me.id, room.roundCount))}
        onLook={() => run(() => lookAtCards(room.id, me.id, room.roundCount))}
        onStartRound={(ante) => run(() => startRound(room.id, me.id, room.roundCount, ante))}
        onSettle={() => setShowSettleModal(true)}
      />

      {/* Transfer Modal */}
      <Modal
        isOpen={!!selectedPlayerId}
        onClose={() => setSelectedPlayerId(null)}
        title={room.players[selectedPlayerId || '']?.nickname || '成员管理'}
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-400">
            直接转账给该玩家 (喜钱/借款)。不影响奖池。
          </p>
          <input
            type="number"
            value={transferAmount}
            onChange={(e) => setTransferAmount(e.target.value)}
            placeholder="金额"
            className="w-full bg-slate-950 border border-slate-700 text-white rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500"
            autoFocus
          />
          <div className="flex gap-2">
            <Button variant="secondary" fullWidth onClick={() => setSelectedPlayerId(null)}>取消</Button>
            <Button variant="success" fullWidth disabled={busy} onClick={handleTransfer}>转账</Button>
          </div>
          {me.isHost && <Button variant="danger" fullWidth disabled={busy || room.status === 'playing'} onClick={() => { setKickTarget(selectedPlayerId); setSelectedPlayerId(null); }}><UserMinus size={16} className="mr-2" />{room.status === 'playing' ? '结算后可移出成员' : '移出房间'}</Button>}
        </div>
      </Modal>

      <Modal isOpen={showRename} onClose={() => setShowRename(false)} title="修改我的昵称">
        <input aria-label="新昵称" maxLength={20} value={nickname} onChange={e => setNickname(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-white mb-4" />
        <Button fullWidth disabled={busy || !nickname.trim()} onClick={() => run(() => renamePlayer(room.id, me.id, nickname), () => setShowRename(false))}>保存昵称</Button>
      </Modal>
      <Modal isOpen={!!kickTarget} onClose={() => setKickTarget(null)} title="确认移出成员">
        <p className="text-slate-300 mb-4 break-words">将 {room.players[kickTarget || '']?.nickname} 移出房间？该成员的积分和历史记录会保留。</p>
        <Button variant="danger" fullWidth disabled={busy} onClick={() => run(() => kickPlayer(room.id, me.id, kickTarget!), () => setKickTarget(null))}>确认移出</Button>
      </Modal>

      {/* Settlement Modal */}
      <Modal
        isOpen={showSettleModal}
        onClose={() => setShowSettleModal(false)}
        title="选择赢家"
      >
        <div className="space-y-2 max-h-[60vh] overflow-y-auto">
          <p className="text-xs text-slate-500 mb-2 uppercase tracking-wider">存活玩家</p>
          {activePlayers.map(p => (
            <button
              key={p.id}
              disabled={busy}
              onClick={() => handleSettle(p.id)}
              className="w-full flex items-center justify-between p-3 rounded-lg bg-slate-800 hover:bg-slate-700 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">{p.avatar}</span>
                <span className="font-medium text-white">{p.nickname}</span>
              </div>
              {p.cardStatus === 'seen' && <span className="text-xs bg-indigo-900 text-indigo-300 px-2 py-1 rounded">看牌</span>}
            </button>
          ))}
          
          {activePlayers.length === 0 && (
             <div className="text-center text-slate-500 py-4">没有存活玩家。</div>
          )}

          <div className="pt-4 border-t border-slate-800 mt-4">
            <p className="text-xs text-slate-500 mb-2 uppercase tracking-wider">弃牌玩家 (强制指定)</p>
            {playersList.filter(p => p.status === 'folded').map(p => (
               <button
               key={p.id}
               disabled={busy}
               onClick={() => handleSettle(p.id)}
               className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-slate-800 transition-colors opacity-60"
             >
               <div className="flex items-center gap-3">
                 <span className="text-xl grayscale">{p.avatar}</span>
                 <span className="font-medium text-slate-300">{p.nickname}</span>
               </div>
             </button>
            ))}
          </div>
        </div>
      </Modal>

      {/* Exit/Disband Modal */}
      <Modal
        isOpen={showExitModal}
        onClose={() => setShowExitModal(false)}
        title={me.isHost ? "管理房间" : "退出房间"}
      >
        <div className="space-y-4">
          <div className="bg-slate-950 p-4 rounded-lg flex items-start gap-3 border border-slate-800">
            <AlertTriangle className="text-amber-500 shrink-0" size={24} />
            <div>
              <p className="text-sm text-slate-300">
                {me.isHost 
                  ? "你是房主。你可以选择解散房间（所有人退出）或仅自己离开（房主权限将顺延给下一位玩家）。" 
                  : "确定要退出当前房间吗？你的战绩将会保留在当前战局中。"
                }
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {room.status === 'playing' && <p className="text-amber-400 text-sm">请先结算本轮，再退出或解散房间。</p>}
            {me.isHost ? (
              <>
                 <Button 
                   variant="danger" 
                   fullWidth 
                   size="lg" 
                   onClick={handleDisband}
                   disabled={busy || room.status === 'playing'}
                  >
                   💥 解散房间 (所有人退出)
                 </Button>
                 <Button 
                   variant="secondary" 
                   fullWidth 
                   size="lg" 
                   onClick={handleLeave}
                   disabled={busy || room.status === 'playing'}
                  >
                   👋 仅自己离开 (转移房主)
                 </Button>
              </>
            ) : (
              <Button 
                variant="danger" 
                fullWidth 
                size="lg" 
                onClick={handleLeave}
                disabled={busy || room.status === 'playing'}
              >
                退出房间
              </Button>
            )}
            <button 
              onClick={() => setShowExitModal(false)} 
              className="text-slate-500 text-sm py-2 hover:text-white"
            >
              取消
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
