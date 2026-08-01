import React, { useState } from 'react';

interface GatewayRetryControlsProps {
  onRetry: (forceProvider?: string) => void;
  isProcessing: boolean;
  providers?: string[]; // e.g. ['OmniRoot', 'NineRouter', 'Ollama Local']
}

export const GatewayRetryControls: React.FC<GatewayRetryControlsProps> = ({ onRetry, isProcessing, providers = ['OmniRoot', 'NineRouter', 'Ollama Local'] }) => {
  const [retrying, setRetrying] = useState(false);

  const handleRetry = (p?: string) => {
    if (isProcessing || retrying) return;
    setRetrying(true);
    onRetry(p);
    // State resets when a new request finishes or via parent
    setTimeout(() => setRetrying(false), 2000); 
  };

  return (
    <div className="flex flex-wrap gap-2 mt-3">
      <button 
        disabled={isProcessing || retrying}
        onClick={() => handleRetry()}
        className="text-xs bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white px-3 py-1.5 rounded-md transition-colors"
      >
        Retry automatically
      </button>
      
      {providers.map(p => (
        <button 
          key={p}
          disabled={isProcessing || retrying}
          onClick={() => handleRetry(p)}
          className="text-xs border border-slate-600 hover:bg-slate-800 disabled:opacity-50 text-slate-300 px-3 py-1.5 rounded-md transition-colors"
        >
          Retry with {p}
        </button>
      ))}
    </div>
  );
};
