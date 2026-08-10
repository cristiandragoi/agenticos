import React, { useEffect, useState } from 'react';
import { apiFetch, apiUrl } from '../api/client';

interface GatewayFallback {
  provider?: string;
  reachable?: boolean;
  active?: boolean;
  currentModel?: string | null;
}

interface GatewayStatus {
  gateway: string;
  status: 'online' | 'offline' | 'error' | 'loading' | 'degraded' | 'fallback';
  port?: number;
  configured?: boolean;
  latencyMs?: number;
  providerMetrics?: any;
  fallback?: GatewayFallback;
}

const GatewayStatusChip: React.FC = () => {
  const [state, setState] = useState<GatewayStatus>({ gateway: 'GatewayRouter', status: 'loading' });

  const fetchStatus = async () => {
    try {
      // Actually fetch the new endpoint that returns the gateway state from Phase 2
      const res = await apiFetch('/api/health/gateway', { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data = await res.json();
        
        let derivedStatus: GatewayStatus['status'] = 'online';
        // `reachable` is optional: the health endpoint may omit it entirely.
        // Only an explicit reachable:false or an explicit error/offline status
        // marks the gateway as failed — an absent field must not read as failure.
        const gatewayDown = data.reachable === false || data.status === 'error' || data.status === 'offline';
        if (gatewayDown) {
          // §6 (stabilization) gateway/fallback truth: a down gateway with an
          // ACTIVE local fallback (Ollama etc.) is NOT a dead end — Jarvis is
          // still operating, just through the fallback. Say so explicitly
          // instead of a bare "Gateway: offline".
          const fb: GatewayFallback | undefined = data.fallback;
          derivedStatus = fb?.active && fb.reachable !== false ? 'fallback' : 'error';
        } else if (data.status === 'degraded') derivedStatus = 'degraded';

        setState({
          gateway: data.providerName || data.gateway || 'GatewayRouter',
          status: derivedStatus,
          port: data.port,
          latencyMs: data.latencyMs,
          fallback: data.fallback
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

  const fallbackName = state.fallback?.provider || 'local provider';
  const fallbackModel = state.fallback?.currentModel ? ` / ${state.fallback.currentModel}` : '';

  const dot = {
    online: 'bg-emerald-400 shadow-emerald-400/60 shadow-sm',
    degraded: 'bg-amber-400 shadow-amber-400/60 shadow-sm',
    fallback: 'bg-amber-400 shadow-amber-400/60 shadow-sm',
    offline: 'bg-red-500',
    error: 'bg-red-500 animate-pulse',
    loading: 'bg-slate-500 animate-pulse',
  }[state.status];

  const label = {
    // Jarvis runtime-display truth: the top badge is GLOBAL GATEWAY HEALTH
    // (the router's configured primary provider), NOT Jarvis's active model.
    // Label it as such so it never reads as "the model Jarvis is using".
    online: `GATEWAY · ${state.gateway}`,
    degraded: `GATEWAY · ${state.gateway} (Slow)`,
    // §6: the down gateway + active fallback is explained, not hidden.
    fallback: `GATEWAY · ${state.gateway} offline → Active LLM: ${fallbackName}${fallbackModel} (fallback active)`,
    offline: `GATEWAY · offline`,
    error: `GATEWAY · error`,
    loading: `GATEWAY · …`,
  }[state.status];

  const textColor = {
    online: 'text-emerald-400',
    degraded: 'text-amber-400',
    fallback: 'text-amber-400',
    offline: 'text-red-400',
    error: 'text-red-400',
    loading: 'text-slate-500',
  }[state.status];

  return (
    <a
      href="http://localhost:20128/dashboard"
      target="_blank"
      rel="noopener noreferrer"
      title={`Gateway health — the router's configured primary provider (${state.gateway}). This is NOT Jarvis's active model; see Jarvis status for the current turn's provider/model. Port ${state.port ?? 20128}${state.latencyMs ? ` — ${Math.round(state.latencyMs)}ms` : ''}`}
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

