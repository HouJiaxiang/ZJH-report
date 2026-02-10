import React, { useState, useEffect } from 'react';
import { Room, Player } from '../types';
import { startRound, placeBet, fold, lookAtCards, settleRound, transferCredits } from '../services/gameService';
import { PotDisplay } from './PotDisplay';
import { PlayerCard } from './PlayerCard';
import { Controls } from './Controls';
import { Modal } from './Modal';
import { Button } from './Button';

interface GameRoomProps {
  room: Room;
  me: Player;
}

export const GameRoom: React.FC<GameRoomProps> = ({ room, me }) => {
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [transferAmount, setTransferAmount] = useState<string>('');
  const [showSettleModal, setShowSettleModal] = useState(false);

  // Sorting players: Me first, then others
  const playersList = Object.values(room.players) as Player[];
  const sortedPlayers = [
    ...playersList.filter(p => p.id === me.id),
    ...playersList.filter(p => p.id !== me.id)
  ];

  const handlePlayerClick = (playerId: string) => {
    if (playerId !== me.id) {
      setSelectedPlayerId(playerId);
    }
  };

  const handleTransfer = async () => {
    if (!selectedPlayerId || !transferAmount) return;
    const amount = parseInt(transferAmount);
    if (isNaN(amount) || amount <= 0) return;
    
    await transferCredits(room.id, me.id, selectedPlayerId, amount);
    setSelectedPlayerId(null);
    setTransferAmount('');
  };

  const handleSettle = async (winnerId: string) => {
    await settleRound(room.id, winnerId);
    setShowSettleModal(false);
  };

  const activePlayers = playersList.filter(p => p.status !== 'folded');

  return (
    <div className="min-h-screen bg-slate-950 pb-24">
      {/* Top Header */}
      <div className="sticky top-0 z-30">
        <div className="bg-slate-950 px-4 py-2 flex justify-between items-center border-b border-slate-800">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-slate-500">房间</span>
            <span className="text-lg font-mono font-bold text-white">{room.id}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">我:</span>
            <span className={`font-mono font-bold ${me.balance >= 0 ? 'text-rose-500' : 'text-emerald-500'}`}>
              {me.balance > 0 ? '+' : ''}{me.balance}
            </span>
          </div>
        </div>
        <PotDisplay pot={room.pot} logs={room.logs} roundCount={room.roundCount} />
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
      <Controls 
        player={me}
        roomStatus={room.status}
        onBet={(amount) => placeBet(room.id, me.id, amount)}
        onFold={() => fold(room.id, me.id)}
        onLook={() => lookAtCards(room.id, me.id)}
        onStartRound={() => startRound(room.id)}
        onSettle={() => setShowSettleModal(true)}
      />

      {/* Transfer Modal */}
      <Modal
        isOpen={!!selectedPlayerId}
        onClose={() => setSelectedPlayerId(null)}
        title={`转账给 ${room.players[selectedPlayerId || '']?.nickname}`}
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
            <Button variant="success" fullWidth onClick={handleTransfer}>转账</Button>
          </div>
        </div>
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
    </div>
  );
};