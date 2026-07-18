import React, { useEffect, useState } from 'react';

interface GatewayStatus {
  gateway: string;
  status: 'online' | 'offline' | 'error' | 'loading';
  port?: number;
  configured?: boolean;
}

const GatewayStatusChip: React.FC = () => {
  const [state, setState] = useState<GatewayStatus>({ gateway: 'OmniRoute', status: 'loading' });

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/health/gateway', { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data = await res.json();
        setState(data);
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
    return () => clearInterval(interval);
  }, []);

  const dot = {
    online: 'bg-emerald-400 shadow-emerald-400/60 shadow-sm',
    offline: 'bg-red-500',
    error: 'bg-amber-400',
    loading: 'bg-slate-500 animate-pulse',
  }[state.status];

  const label = {
    online: `Gateway: ${state.gateway} (auto)`,
    offline: `Gateway: offline`,
    error: `Gateway: error`,
    loading: `Gateway: …`,
  }[state.status];

  const textColor = {
    online: 'text-emerald-400',
    offline: 'text-red-400',
    error: 'text-amber-400',
    loading: 'text-slate-500',
  }[state.status];

  return (
    <a
      href="http://localhost:20128/dashboard"
      target="_blank"
      rel="noopener noreferrer"
      title={`OmniRoute dashboard — port ${state.port ?? 20128}`}
      className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-800/60 border border-slate-700/50 hover:border-slate-600 hover:bg-slate-800 transition-all cursor-pointer group"
    >
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
      <span className={`text-[10px] font-medium tracking-wide ${textColor} group-hover:brightness-125 transition-all`}>
        {label}
      </span>
    </a>
  );
};

export default GatewayStatusChip;

