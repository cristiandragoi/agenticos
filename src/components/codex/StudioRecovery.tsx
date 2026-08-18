import React, { useState, useEffect } from 'react';
import { AlertTriangle, Play, XSquare } from 'lucide-react';
import { apiFetch, apiUrl } from '../../api/client';

interface Props {
  activeGoalId: string;
}

export const StudioRecovery: React.FC<Props> = ({ activeGoalId }) => {
  const [checkpoints, setCheckpoints] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiFetch(`/api/chat/agents/goal/${activeGoalId}/checkpoints`)
      .then(r => r.json())
      .then(data => setCheckpoints(data || []))
      .catch(() => {});
  }, [activeGoalId]);

  const handleApprove = async (action: 'resume' | 'abort') => {
    setLoading(true);
    await apiFetch(`/api/chat/agents/goal/${activeGoalId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action })
    });
    setLoading(false);
  };

  const latest = checkpoints.length > 0 ? checkpoints[checkpoints.length - 1] : null;

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 bg-[#0D1117] relative">
      <div className="absolute inset-0 bg-rose-500/5 backdrop-blur-[1px] pointer-events-none"></div>
      
      <div className="max-w-2xl w-full bg-[#111823] border border-rose-500/30 rounded-2xl p-8 shadow-[0_0_50px_rgba(244,63,94,0.1)] relative z-10">
        <div className="w-16 h-16 bg-rose-500/20 text-rose-500 rounded-2xl flex items-center justify-center mb-6 border border-rose-500/50">
          <AlertTriangle size={32} />
        </div>
        
        <h2 className="text-2xl font-bold text-slate-100 mb-2">Execution Halted: Recovery Required</h2>
        <p className="text-slate-400 mb-6 leading-relaxed">
          The workspace has diverged from CodeX's last known checkpoint. This usually happens if you modified files manually, or if the server crashed while a long-running command was modifying the filesystem.
        </p>

        {latest && (
          <div className="bg-[#090C10] border border-slate-700/50 rounded-xl p-5 mb-8">
            <h3 className="text-sm font-bold text-slate-300 mb-3 uppercase tracking-wider">Latest Checkpoint Data</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-slate-500 text-xs">Phase</div>
                <div className="font-mono text-emerald-400">{latest.executionPhase}</div>
              </div>
              <div>
                <div className="text-slate-500 text-xs">Expected Hash</div>
                <div className="font-mono text-indigo-400 truncate">{latest.workspaceHash}</div>
              </div>
            </div>
            {latest.changedFiles?.length > 0 && (
              <div className="mt-4">
                <div className="text-slate-500 text-xs mb-1">Tracked File Changes</div>
                <div className="font-mono text-xs text-slate-300 bg-slate-800/50 p-2 rounded">
                  {latest.changedFiles.map((f: string, i: number) => <div key={i}>{f}</div>)}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-4">
          <button 
            onClick={() => handleApprove('resume')}
            disabled={loading}
            className="flex-1 flex items-center justify-center gap-2 py-3 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl transition-colors disabled:opacity-50"
          >
            <Play size={18} /> Acknowledge Divergence & Resume
          </button>
          <button 
            onClick={() => handleApprove('abort')}
            disabled={loading}
            className="flex-1 flex items-center justify-center gap-2 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl border border-slate-700 transition-colors disabled:opacity-50"
          >
            <XSquare size={18} /> Abort Goal
          </button>
        </div>
      </div>
    </div>
  );
};
