import React from 'react';
import { ListeningMode } from '../types';

interface ConfirmationModalProps {
  isOpen: boolean;
  title: string;
  description: string;
  onConfirm: () => void;
  onCancel: () => void;
  mode: ListeningMode;
}

export const ConfirmationModal: React.FC<ConfirmationModalProps> = ({ 
  isOpen, title, description, onConfirm, onCancel, mode 
}) => {
  if (!isOpen) return null;

  const isDay = mode === ListeningMode.SUN_DAY;

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-6 animate-in fade-in zoom-in duration-200">
      <div className={`w-full max-w-sm rounded-3xl p-8 shadow-2xl border transition-colors duration-500
        ${isDay ? 'bg-white/95 border-blue-200 text-slate-800' : 'bg-zinc-950/95 border-red-900/50 text-white'}
      `}>
        <h3 className={`text-xl font-bold mb-3 tracking-wide uppercase ${isDay ? 'text-blue-600' : 'text-red-500'}`}>
          {title}
        </h3>
        <p className={`text-sm mb-8 leading-relaxed ${isDay ? 'text-slate-500' : 'text-zinc-400'}`}>
          {description}
        </p>
        
        <div className="flex gap-4">
          <button 
            onClick={onCancel}
            className={`flex-1 py-4 rounded-xl text-xs font-bold uppercase tracking-wider border transition-all active:scale-95
              ${isDay ? 'border-slate-200 text-slate-500 hover:bg-slate-50' : 'border-zinc-800 text-zinc-400 hover:bg-zinc-900'}
            `}
          >
            Cancel
          </button>
          <button 
            onClick={() => {
                if (navigator.vibrate) navigator.vibrate(50);
                onConfirm();
            }}
            className={`flex-1 py-4 rounded-xl text-xs font-bold uppercase tracking-wider border transition-all active:scale-95 shadow-lg
               ${isDay ? 'bg-blue-500 border-blue-600 text-white shadow-blue-500/20' : 'bg-red-900/20 border-red-600 text-red-500 shadow-red-600/20'}
            `}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
};