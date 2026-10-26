import React from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-label={title} className="relative w-full max-w-md max-h-[85dvh] overflow-y-auto bg-slate-900 border border-slate-700 rounded-xl shadow-2xl animate-pulse-fast-once">
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <h3 className="text-lg font-semibold text-white break-words min-w-0">{title}</h3>
          <button aria-label="关闭对话框" onClick={onClose} className="shrink-0 text-slate-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>
        <div className="p-4">
          {children}
        </div>
      </div>
    </div>
  );
};
