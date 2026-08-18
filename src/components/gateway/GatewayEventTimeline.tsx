import React, { useState } from 'react';
import type { GatewayUiEvent } from '../../types';

interface GatewayEventTimelineProps {
  events: GatewayUiEvent[];
}

export const GatewayEventTimeline: React.FC<GatewayEventTimelineProps> = ({ events }) => {
  const [expanded, setExpanded] = useState(false);

  if (!events || events.length === 0) return null;

  return (
    <div className="mt-2 text-xs border border-slate-800 rounded-md overflow-hidden bg-slate-900/50">
      <button 
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-3 py-1.5 flex justify-between items-center bg-slate-800/50 hover:bg-slate-800 transition-colors text-slate-400"
      >
        <span>Gateway Activity ({events.length} events)</span>
        <span>{expanded ? '▲' : '▼'}</span>
      </button>
      
      {expanded && (
        <div className="p-3 space-y-2 max-h-48 overflow-y-auto">
          {events.map((ev, i) => (
            <div key={i} className="flex gap-3 text-slate-300">
              <span className="text-slate-500 shrink-0 font-mono text-[10px] pt-0.5">
                {new Date(ev.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              <div className="flex-1">
                {ev.type === 'selected' && <span>{ev.provider} selected</span>}
                {ev.type === 'fallback' && <span className="text-amber-400">Fallback to {ev.target}: {ev.reason}</span>}
                {ev.type === 'failed' && <span className="text-red-400">Failed: {ev.reason}</span>}
                {ev.type === 'interrupted' && <span className="text-red-400">Stream permanently interrupted</span>}
                {ev.type === 'completed' && <span className="text-emerald-400">Completed{ev.durationMs ? ` in ${ev.durationMs}ms` : ''}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
