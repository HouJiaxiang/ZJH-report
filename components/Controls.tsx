import React, { useState } from 'react';
import { Player, RoomStatus } from '../types';
import { Button } from './Button';
import { BET_AMOUNTS } from '../constants';
import { Eye, X, DollarSign, ChevronUp, Crown } from 'lucide-react';

interface ControlsProps {
  player: Player;
  roomStatus: RoomStatus;
  onBet: (amount: number) => void;
  onFold: () => void;
  onLook: () => void;
  onStartRound?: () => void;
  onSettle?: () => void;
}

export const Controls: React.FC<ControlsProps> = ({ 
  player, 
  roomStatus, 
  onBet, 
  onFold, 
  onLook,
  onStartRound,
  onSettle
}) => {
  const [showBetMenu, setShowBetMenu] = useState(false);
  const [customBet, setCustomBet] = useState('');

  const handleCustomBet = () => {
    const amount = parseInt(customBet);
    if (!isNaN(amount) && amount > 0) {
      onBet(amount);
      setShowBetMenu(false);
      setCustomBet('');
    }
  };

  // Host Controls (Waiting State)
  if (roomStatus === 'waiting' && player.isHost) {
    return (
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-slate-900 border-t border-slate-800 z-40">
        <Button onClick={onStartRound} fullWidth size="lg" className="shadow-lg shadow-amber-900/20">
          开始下一轮
        </Button>
      </div>
    );
  }

  // Host Controls (Playing State - Settle)
  if (roomStatus === 'playing' && player.isHost && player.status === 'folded') {
     // If host is folded, they can still settle.
     return (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-slate-900 border-t border-slate-800 z-40">
           <Button variant="ghost" onClick={onSettle} fullWidth size="lg" className="text-amber-500 border border-amber-900/30 bg-slate-800/50">
              <Crown size={20} className="mr-2" /> 
              🏆 结算本局
           </Button>
        </div>
     )
  }

  // Waiting State for Non-Host
  if (roomStatus === 'waiting') {
    return (
      <div className="fixed bottom-0 left-0 right-0 p-6 text-center bg-slate-900 border-t border-slate-800 text-slate-400">
        等待房主开始...
      </div>
    );
  }

  // Active Player Controls
  if (player.status === 'folded') {
    return (
      <div className="fixed bottom-0 left-0 right-0 p-6 text-center bg-slate-900 border-t border-slate-800 text-slate-500">
        你已弃牌。
        {player.isHost && (
            <div className="mt-4">
                <Button variant="secondary" size="lg" fullWidth onClick={onSettle} className="text-amber-500">
                    <Crown size={18} className="mr-2" /> 结算本局
                </Button>
            </div>
        )}
      </div>
    );
  }

  return (
    <>
      {/* Bet Amount Popup */}
      {showBetMenu && (
        <div className="fixed bottom-24 left-4 right-4 bg-slate-800 border border-slate-700 rounded-xl p-4 z-50 shadow-2xl animate-in slide-in-from-bottom-10 fade-in duration-200">
          {/* Preset Amounts */}
          <div className="grid grid-cols-4 gap-2 mb-4">
            {BET_AMOUNTS.map(amount => (
              <button
                key={amount}
                onClick={() => { onBet(amount); setShowBetMenu(false); }}
                className="bg-slate-700 hover:bg-emerald-600 text-white font-mono font-bold py-3 rounded-lg transition-colors"
              >
                +{amount}
              </button>
            ))}
          </div>

          {/* Custom Amount Input */}
          <div className="flex gap-2 pt-2 border-t border-slate-700/50 mb-2">
            <input
              type="number"
              value={customBet}
              onChange={(e) => setCustomBet(e.target.value)}
              placeholder="自定义金额"
              className="flex-1 bg-slate-950 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 font-mono"
            />
            <button 
              onClick={handleCustomBet}
              disabled={!customBet || parseInt(customBet) <= 0}
              className="bg-emerald-600 text-white font-bold px-4 py-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-emerald-500 transition-colors"
            >
              下注
            </button>
          </div>
          
          <button 
             onClick={() => setShowBetMenu(false)}
             className="w-full text-slate-400 text-sm py-2 hover:text-white"
          >
             取消
          </button>
        </div>
      )}

      {/* Main Bar */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-slate-900 border-t border-slate-800 z-40 flex gap-3 pb-safe">
        
        {/* Fold */}
        <button 
          onClick={onFold}
          className="flex-1 flex flex-col items-center justify-center bg-rose-950/50 text-rose-500 border border-rose-900/50 rounded-xl py-3 active:scale-95 transition-transform"
        >
          <X size={24} />
          <span className="text-xs font-bold mt-1">弃牌</span>
        </button>

        {/* Bet */}
        <button 
          onClick={() => setShowBetMenu(!showBetMenu)}
          className="flex-[2] flex flex-col items-center justify-center bg-emerald-600 text-white rounded-xl py-3 shadow-[0_0_15px_rgba(5,150,105,0.4)] active:scale-95 transition-transform"
        >
          {showBetMenu ? <ChevronUp size={24} /> : <DollarSign size={24} />}
          <span className="text-xs font-bold mt-1">下注</span>
        </button>

        {/* Look */}
        {player.cardStatus === 'blind' ? (
          <button 
            onClick={onLook}
            className="flex-1 flex flex-col items-center justify-center bg-indigo-950/50 text-indigo-400 border border-indigo-900/50 rounded-xl py-3 active:scale-95 transition-transform"
          >
            <Eye size={24} />
            <span className="text-xs font-bold mt-1">看牌</span>
          </button>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center bg-slate-800 text-slate-500 rounded-xl py-3 opacity-50 cursor-not-allowed">
            <Eye size={24} />
            <span className="text-xs font-bold mt-1">已看</span>
          </div>
        )}
      </div>
      
      {/* Floating Settle Button for Host if playing */}
      {player.isHost && (
          <div className="fixed top-20 right-4 z-30">
               <button 
                onClick={onSettle} 
                className="bg-slate-900/90 backdrop-blur-md text-sm font-bold text-amber-500 border border-amber-500/50 px-5 py-3 rounded-full flex items-center gap-2 hover:bg-slate-800 shadow-xl shadow-amber-900/20 active:scale-95 transition-all"
               >
                    <Crown size={18} className="fill-current"/> 结算本局
               </button>
          </div>
      )}
    </>
  );
};