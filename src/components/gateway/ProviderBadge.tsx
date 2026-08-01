import React from 'react';
import type { ChatMessage } from '../../types';

interface ProviderBadgeProps {
  message: ChatMessage;
  onClick?: () => void;
}

export const ProviderBadge: React.FC<ProviderBadgeProps> = ({ message, onClick }) => {
  if (message.agentId === 'agent-hermes') {
    return (
      <button 
        onClick={onClick}
        className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full border border-slate-700 hover:bg-slate-700 transition-colors"
        title="Hermes Runtime"
      >
        Hermes Runtime
      </button>
    );
  }

  if (!message.gateway || !message.gateway.provider) {
    return null;
  }

  const { status, provider } = message.gateway;
  let colorClass = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
  
  if (status === 'fallback' || status === 'routing') {
    colorClass = 'bg-amber-500/10 text-amber-400 border-amber-500/20';
  } else if (status === 'failed' || status === 'interrupted') {
    colorClass = 'bg-red-500/10 text-red-400 border-red-500/20';
  }

  return (
    <button 
      onClick={onClick}
      className={`text-[10px] px-2 py-0.5 rounded-full border hover:brightness-110 transition-all ${colorClass}`}
      title="Click for provider details"
    >
      {provider}
    </button>
  );
};
