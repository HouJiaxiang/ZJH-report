import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { HistoryPage } from '../types';
import { getRoomHistory } from '../services/gameService';
import { Modal } from './Modal';

export const RoomHistory: React.FC<{ roomId: string; onClose: () => void }> = ({ roomId, onClose }) => {
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [page, setPage] = useState<HistoryPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const before = cursors[cursors.length - 1];

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setPage(null);
    getRoomHistory(roomId, before)
      .then(result => { if (!cancelled) setPage(result); })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : '读取记录失败'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [roomId, before, reload]);

  const refresh = () => { setCursors([null]); setReload(n => n + 1); };
  return (
    <Modal isOpen onClose={onClose} title="房间记录">
      <div className="flex items-center justify-between gap-2 mb-3 text-sm text-slate-300">
        <span>第 {cursors.length} 页</span>
        <div className="flex gap-2">
          <button title="刷新最新记录" aria-label="刷新最新记录" disabled={loading} onClick={refresh} className="p-2 disabled:opacity-40"><RefreshCw size={18} /></button>
          <button title="上一页" aria-label="上一页" disabled={loading || cursors.length === 1} onClick={() => setCursors(c => c.slice(0, -1))} className="p-2 disabled:opacity-40"><ChevronLeft size={18} /></button>
          <button title="更早记录" aria-label="更早记录" disabled={loading || !page?.nextCursor} onClick={() => { if (page?.nextCursor) setCursors(c => [...c, page.nextCursor]); }} className="p-2 disabled:opacity-40"><ChevronRight size={18} /></button>
        </div>
      </div>
      <div className="min-h-[12rem]" aria-busy={loading}>
        {loading && <p role="status" className="py-6 text-center text-slate-400">加载中...</p>}
        {error && <div role="alert" className="text-rose-300 break-words"><p>{error}</p><button className="mt-3 underline" onClick={() => setReload(n => n + 1)}>重试</button></div>}
        {!loading && !error && page?.entries.length === 0 && <p className="py-6 text-center text-slate-400">暂无记录</p>}
        <ol className="divide-y divide-slate-800">
          {page?.entries.map(({ cursor, event }) => <li key={cursor} className="py-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-slate-400">
              <time dateTime={new Date(event.timestamp).toISOString()}>{new Date(event.timestamp).toLocaleString('zh-CN', {hour12: false})}</time>
              {event.userName && <span className="break-all">操作人：{event.userName}</span>}
            </div>
            <p className="text-sm text-slate-200 break-words mt-1">{event.action}</p>
          </li>)}
        </ol>
      </div>
    </Modal>
  );
};
