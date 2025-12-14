import React, { useEffect, useRef } from 'react';
import { ChatEntry } from '../types';

interface ChatBoxProps {
  messages: ChatEntry[];
}

export const ChatBox: React.FC<ChatBoxProps> = ({ messages }) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (messages.length === 0) return null;

  return (
    <div className="absolute bottom-32 left-0 right-0 px-6 max-h-48 overflow-y-auto pointer-events-none fade-mask z-20 space-y-2">
      <style>{`
        .fade-mask {
          -webkit-mask-image: linear-gradient(to bottom, transparent, black 20%);
          mask-image: linear-gradient(to bottom, transparent, black 20%);
        }
      `}</style>
      {messages.map((msg) => (
        <div 
          key={msg.id} 
          className={`flex w-full ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
        >
          <div 
            className={`
              max-w-[80%] px-3 py-1.5 rounded-2xl text-xs backdrop-blur-md border 
              ${msg.role === 'user' 
                ? 'bg-zinc-800/50 border-zinc-700 text-zinc-200 rounded-tr-none' 
                : 'bg-red-900/20 border-red-500/30 text-red-100 rounded-tl-none'
              }
            `}
          >
            {msg.text}
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
};