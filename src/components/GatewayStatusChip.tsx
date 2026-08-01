import React, { useEffect, useState } from 'react';

interface GatewayStatus {
  gateway: string;
  status: 'online' | 'offline' | 'error' | 'loading' | 'degraded';
  port?: number;
  configured?: boolean;
  latencyMs?: number;
  providerMetrics?: any;
}

const GatewayStatusChip: React.FC = () => {
  const [state, setState] = useState<GatewayStatus>({ gateway: 'GatewayRouter', status: 'loading' });

  const fetchStatus = async () => {
    try {
      // Actually fetch the new endpoint that returns the gateway state from Phase 2
      const res = await fetch('/api/health/gateway', { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data = await res.json();
        
        let derivedStatus: GatewayStatus['status'] = 'online';
        if (!data.reachable) derivedStatus = 'error';
        else if (data.status === 'degraded') derivedStatus = 'degraded';

        setState({
          gateway: data.providerName || data.gateway || 'GatewayRouter',
          status: derivedStatus,
          port: data.port,
          latencyMs: data.latencyMs
        });
      } else {
        setState(s => ({ ...s, status: 'error' }));
      }
    } catch {
      setState(s => ({ ...s, status: 'offline' }));
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30_000);
    
    // Also listen to SSE events if available globally? For now we just poll.
    return () => clearInterval(interval);
  }, []);

  const dot = {
    online: 'bg-emerald-400 shadow-emerald-400/60 shadow-sm',
    degraded: 'bg-amber-400 shadow-amber-400/60 shadow-sm',
    offline: 'bg-red-500',
    error: 'bg-red-500 animate-pulse',
    loading: 'bg-slate-500 animate-pulse',
  }[state.status];

  const label = {
    online: `Gateway: ${state.gateway}`,
    degraded: `Gateway: ${state.gateway} (Slow)`,
    offline: `Gateway: offline`,
    error: `Gateway: error`,
    loading: `Gateway: …`,
  }[state.status];

  const textColor = {
    online: 'text-emerald-400',
    degraded: 'text-amber-400',
    offline: 'text-red-400',
    error: 'text-red-400',
    loading: 'text-slate-500',
  }[state.status];

  return (
    <a
      href="http://localhost:20128/dashboard"
      target="_blank"
      rel="noopener noreferrer"
      title={`Gateway dashboard — port ${state.port ?? 20128}${state.latencyMs ? ` — ${Math.round(state.latencyMs)}ms` : ''}`}
      className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-800/60 border border-slate-700/50 hover:border-slate-600 hover:bg-slate-800 transition-all cursor-pointer group"
    >
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
      <span className={`text-[10px] font-medium tracking-wide ${textColor} group-hover:brightness-125 transition-all`}>
        {label}
        {state.latencyMs ? ` (${Math.round(state.latencyMs)}ms)` : ''}
      </span>
    </a>
  );
};

export default GatewayStatusChip;

