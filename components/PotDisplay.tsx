import React, { useEffect, useRef } from 'react';
import { LogEntry } from '../types';

interface PotDisplayProps {
  pot: number;
  logs: LogEntry[];
  roundCount: number;
}

export const PotDisplay: React.FC<PotDisplayProps> = ({ pot, logs, roundCount }) => {
  const tickerRef = useRef<HTMLDivElement>(null);
  const lastLog = logs[logs.length - 1];

  // Animation for pot changes could go here
  
  return (
    <div className="flex flex-col items-center w-full bg-slate-900/50 border-b border-slate-800 backdrop-blur-md pt-4 pb-2">
       <div className="text-xs text-slate-500 uppercase tracking-widest mb-1">
        第 {roundCount} 轮 • 池底
      </div>
      <div className="text-6xl font-mono font-bold text-amber-400 drop-shadow-[0_0_15px_rgba(251,191,36,0.3)] mb-4">
        {pot}
      </div>

      {/* Ticker */}
      <div className="w-full bg-black/40 h-8 flex items-center overflow-hidden relative">
        <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-slate-950 to-transparent z-10"></div>
        <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-slate-950 to-transparent z-10"></div>
        
        <div className="flex-1 flex items-center justify-center text-sm font-mono text-green-400 px-4 whitespace-nowrap overflow-hidden text-ellipsis">
          {lastLog ? (
            <span className="animate-pulse">
              [{new Date(lastLog.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit' })}] {lastLog.action}
            </span>
          ) : (
            <span className="text-slate-600">等待行动...</span>
          )}
        </div>
      </div>
    </div>
  );
};