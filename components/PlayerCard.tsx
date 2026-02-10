import React from 'react';
import { Player } from '../types';
import { Eye, EyeOff, Crown } from 'lucide-react';

interface PlayerCardProps {
  player: Player;
  isMe: boolean;
  onClick: () => void;
}

export const PlayerCard: React.FC<PlayerCardProps> = ({ player, isMe, onClick }) => {
  const isFolded = player.status === 'folded';
  const isSeen = player.cardStatus === 'seen';
  
  // Balance Color Logic: Red for Positive (+), Green for Negative (-) as per prompt
  const balanceColor = player.balance >= 0 ? 'text-rose-500' : 'text-emerald-500';

  return (
    <div 
      onClick={onClick}
      className={`
        relative flex flex-col items-center p-3 rounded-xl border transition-all cursor-pointer select-none
        ${isFolded ? 'opacity-50 grayscale bg-slate-900 border-slate-800' : 'bg-slate-800/50 border-slate-700 hover:border-slate-500'}
        ${isMe ? 'ring-2 ring-amber-500/50' : ''}
      `}
    >
      {/* Avatar & Badges */}
      <div className="relative mb-2">
        <div className="text-4xl filter drop-shadow-lg">{player.avatar}</div>
        {player.isHost && (
          <div className="absolute -top-2 -right-2 text-amber-400 bg-slate-900 rounded-full p-0.5">
            <Crown size={14} fill="currentColor" />
          </div>
        )}
        {!isFolded && (
           <div className={`absolute -bottom-1 -right-1 p-1 rounded-full ${isSeen ? 'bg-indigo-500 text-white' : 'bg-slate-600 text-slate-300'}`}>
             {isSeen ? <Eye size={12} /> : <EyeOff size={12} />}
           </div>
        )}
      </div>

      {/* Name */}
      <div className="text-xs font-medium text-slate-300 mb-1 truncate w-full text-center">
        {player.nickname} {isMe && '(我)'}
      </div>

      {/* Balance */}
      <div className={`text-sm font-bold font-mono ${balanceColor}`}>
        {player.balance > 0 ? '+' : ''}{player.balance}
      </div>

      {/* Status Overlay for Folded */}
      {isFolded && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/20 rounded-xl">
          <span className="text-xs font-bold text-slate-200 bg-slate-900/80 px-2 py-1 rounded">弃牌</span>
        </div>
      )}
    </div>
  );
};