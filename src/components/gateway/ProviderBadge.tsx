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

  const meta = ((message as any).metadata || {}) as Record<string, any>;
  const provider = message.gateway?.provider || meta.provider;
  const model = message.gateway?.model || meta.model;

  if (!provider) {
    return null;
  }

  // Orchestrator messages (task delegation, routing events, investigations)
  // are NOT LLM executions — label them clearly so they are never mistaken
  // for the actual provider/model that ran.
  if (provider === 'agentic-os') {
    return (
      <span
        className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full border border-slate-700"
        title="Orchestrator (AgenticOS routing layer), not the LLM provider/model"
      >
        ORCHESTRATOR · agentic-os / {model || 'registry'}
      </span>
    );
  }

  const { status } = message.gateway || {};
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
