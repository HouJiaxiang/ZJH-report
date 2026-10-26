import React from 'react';
import { LogEntry } from '../types';
import { Crown, ChevronRight } from 'lucide-react';

interface PotDisplayProps {
  pot: number;
  logs: LogEntry[];
  roundCount: number;
  isHost?: boolean;
  onSettle?: () => void;
  onShowHistory: () => void;
}

export const PotDisplay: React.FC<PotDisplayProps> = ({ pot, logs, roundCount, isHost, onSettle, onShowHistory }) => {
  const lastLog = logs[logs.length - 1];

  return (
    <div className="flex flex-col items-center w-full bg-slate-900/50 border-b border-slate-800 backdrop-blur-md pt-4 pb-2">
       <div className="text-xs text-slate-500 uppercase tracking-widest mb-1">
        第 {roundCount} 轮 • 池底
      </div>

      {/* Pot Number & Settle Button Container */}
      <div className="relative w-full flex justify-center items-center mb-4 px-4">
        <div className="text-6xl font-mono font-bold text-amber-400 drop-shadow-[0_0_15px_rgba(251,191,36,0.3)]">
          {pot}
        </div>

        {/* Host Settle Button - Aligned with Pot */}
        {isHost && onSettle && (
            <button 
              onClick={onSettle}
              className="absolute right-4 top-1/2 -translate-y-1/2 bg-slate-800/80 hover:bg-slate-700 text-amber-500 border border-amber-500/30 p-2.5 rounded-xl backdrop-blur-md transition-all active:scale-95 shadow-lg shadow-amber-900/10 group flex flex-col items-center justify-center gap-0.5"
            >
               <Crown size={20} className="fill-amber-500/10 text-amber-500 group-hover:fill-amber-500 transition-colors" />
               <span className="text-[10px] font-bold block leading-none">结算</span>
            </button>
        )}
      </div>

      {/* Ticker */}
      <button
        type="button"
        onClick={onShowHistory}
        aria-label="查看最近50条房间动态"
        title="查看最近50条房间动态"
        className="w-full min-h-11 bg-black/40 hover:bg-slate-800/70 flex items-center gap-2 px-4 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400 focus-visible:-outline-offset-2"
      >
        <span className="min-w-0 flex-1 truncate text-sm font-mono text-green-400">
          {lastLog ? (
            <span>
              [{new Date(lastLog.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit' })}] {lastLog.action}
            </span>
          ) : (
            <span className="text-slate-600">等待行动...</span>
          )}
        </span>
        <ChevronRight size={16} className="shrink-0 text-slate-400" aria-hidden="true" />
      </button>
    </div>
  );
};
