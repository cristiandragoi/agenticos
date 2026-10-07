import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../api/client';
import { ShieldCheck, Cpu, Mic, Volume2, DollarSign, RefreshCw } from 'lucide-react';

export const ProviderCostStatusCard: React.FC = () => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const fetchStatus = async () => {
    try {
      setLoading(true);
      const res = await apiFetch('/api/system/providers/status');
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch {} finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 8000);
    return () => clearInterval(interval);
  }, []);

  if (!data) return null;

  const costMode = data.costMode || 'LOW_COST';
  const totalSpend = data.summary?.totalSpendUsd ?? 0;

  return (
    <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-2.5 text-xs space-y-1.5" data-testid="provider-cost-status">
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-1.5">
        <div className="flex items-center gap-1 text-[11px] font-bold text-slate-300">
          <ShieldCheck size={13} className="text-cyan-400" />
          <span>Providers & Cost Policy</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
            COST MODE: {costMode}
          </span>
          <button onClick={fetchStatus} title="Refresh" className="text-slate-500 hover:text-slate-300">
            <RefreshCw size={10} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[10px] font-mono pt-0.5">
        <div className="space-y-1">
          <div className="flex items-center justify-between text-slate-400">
            <span className="flex items-center gap-1"><Mic size={10} className="text-emerald-400" /> STT:</span>
            <span className={data.stt?.status === 'ONLINE' ? 'text-emerald-400 font-bold' : 'text-amber-400'}>
              {data.stt?.primary} — {data.stt?.status}
            </span>
          </div>
          <div className="flex items-center justify-between text-slate-500">
            <span>STT FALLBACK:</span>
            <span className="text-slate-300">{data.stt?.fallback} — {data.stt?.fallbackStatus}</span>
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between text-slate-400">
            <span className="flex items-center gap-1"><Cpu size={10} className="text-purple-400" /> PLANNER:</span>
            <span className="text-purple-300 font-bold">{data.planner?.name} — {data.planner?.status}</span>
          </div>
          <div className="flex items-center justify-between text-slate-400">
            <span>WORKER:</span>
            <span className="text-cyan-300 truncate max-w-[110px]" title={data.worker?.selected}>
              {data.worker?.selected}
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 pt-1 border-t border-slate-900">
        <span className="flex items-center gap-1">
          <Volume2 size={10} className="text-sky-400" /> TTS: {data.tts?.primary} — {data.tts?.status}
        </span>
        <span className="flex items-center gap-0.5 text-emerald-400 font-bold">
          <DollarSign size={10} /> SESSION: ${totalSpend.toFixed(4)}
        </span>
      </div>
    </div>
  );
};
