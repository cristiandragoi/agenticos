import React, { useState } from 'react';
import type { ChatMessage } from '../../types';

interface ProviderDetailsPanelProps {
  message: ChatMessage;
  onClose: () => void;
}

export const ProviderDetailsPanel: React.FC<ProviderDetailsPanelProps> = React.memo(({ message, onClose }) => {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const { gateway } = message;

  if (!gateway) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
      <div 
        className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-sm overflow-hidden flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-details-title"
      >
        <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-800/30">
          <h2 id="provider-details-title" className="text-sm font-semibold text-slate-200">Provider Details</h2>
          <button 
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors p-1"
            aria-label="Close details"
          >
            ✕
          </button>
        </div>

        <div className="p-4 space-y-4 text-sm text-slate-300">
          <div className="grid grid-cols-2 gap-y-2">
            <span className="text-slate-500">Provider</span>
            <span className="font-medium text-slate-200">{gateway.provider || 'Unknown'}</span>
            
            <span className="text-slate-500">Model</span>
            <span className="font-medium text-slate-200">{gateway.model || 'Unknown'}</span>
            
            <span className="text-slate-500">Status</span>
            <span>{gateway.status}</span>
            
            <span className="text-slate-500">Duration</span>
            <span>{gateway.durationMs ? `${gateway.durationMs}ms` : 'Unavailable'}</span>
            
            <span className="text-slate-500">Total Tokens</span>
            <span>{gateway.totalTokens ?? 'Unavailable'}</span>
          </div>

          <button 
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-xs text-emerald-400 hover:text-emerald-300 underline underline-offset-2"
          >
            {showAdvanced ? 'Hide Advanced Diagnostics' : 'Show Advanced Diagnostics'}
          </button>

          {showAdvanced && (
            <div className="p-3 bg-slate-950 rounded border border-slate-800 space-y-2 text-xs">
              <div className="grid grid-cols-2 gap-y-1">
                <span className="text-slate-500">Prompt Tokens</span>
                <span>{gateway.promptTokens ?? 'Unavailable'}</span>
                
                <span className="text-slate-500">Completion Tokens</span>
                <span>{gateway.completionTokens ?? 'Unavailable'}</span>
                
                <span className="text-slate-500">Tokens / sec</span>
                <span>{gateway.tokensPerSecond ? gateway.tokensPerSecond.toFixed(1) : 'Unavailable'}</span>
                
                <span className="text-slate-500">Estimated Cost</span>
                <span>{gateway.estimatedCost !== undefined && gateway.estimatedCost !== null ? `$${gateway.estimatedCost.toFixed(5)}` : 'Unavailable'}</span>
                
                <span className="text-slate-500">Initial Latency</span>
                <span>{gateway.latencyMs ? `${gateway.latencyMs}ms` : 'Unavailable'}</span>
                
                <span className="text-slate-500">Fallback Count</span>
                <span>{gateway.fallbackCount ?? 0}</span>
                
                <span className="text-slate-500">Task Profile</span>
                <span>{gateway.taskProfile ?? 'default'}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
