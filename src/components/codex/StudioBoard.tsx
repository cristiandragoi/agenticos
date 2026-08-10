import React, { useState, useEffect } from 'react';
import { Target, Server, Shield, CheckCircle, Circle, PlayCircle, AlertTriangle, Clock } from 'lucide-react';
import { apiFetch, apiUrl } from '../../api/client';

interface Props {
  activeGoalId: string | null;
}

export const StudioBoard: React.FC<Props> = ({ activeGoalId }) => {
  const [steps, setSteps] = useState<any[]>([]);

  useEffect(() => {
    if (!activeGoalId) return;
    
    const fetchSteps = async () => {
      try {
        const res = await apiFetch(`/api/chat/agents/goal/${activeGoalId}/steps`);
        const data = await res.json();
        setSteps(Array.isArray(data) ? data : []);
      } catch (e) {}
    };

    fetchSteps();
    const interval = setInterval(fetchSteps, 3000);
    return () => clearInterval(interval);
  }, [activeGoalId]);

  const columns = [
    { id: 'backlog', label: 'Backlog', statuses: ['backlog'] },
    { id: 'planned', label: 'Planned', statuses: ['pending'] },
    { id: 'ready', label: 'Ready', statuses: ['ready'] },
    { id: 'in_progress', label: 'In Progress', statuses: ['started'] },
    { id: 'validation', label: 'Validation', statuses: ['validating'] },
    { id: 'review', label: 'Requires Review', statuses: ['interrupted', 'interrupted_requires_review'] },
    { id: 'blocked', label: 'Blocked', statuses: ['failed', 'blocked'] },
    { id: 'completed', label: 'Completed', statuses: ['completed'] }
  ];

  if (!activeGoalId) {
    return <div className="p-8 flex items-center justify-center h-full w-full text-slate-500 font-mono text-sm">No active goal selected.</div>;
  }

  const safeDate = (dateStr: any) => {
    if (!dateStr) return 'Waiting';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 'Invalid Date';
    return d.toLocaleTimeString();
  };

  return (
    <div className="flex h-full w-full overflow-x-auto p-6 gap-6 bg-[#090C10] hide-scrollbar">
      {columns.map(col => {
        const colSteps = steps.filter(s => col.statuses.includes(s.status));
        return (
          <div key={col.id} className="flex flex-col w-[320px] shrink-0">
            <div className="flex items-center justify-between mb-4 px-2">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">{col.label}</h3>
              <span className="bg-[#111823] text-slate-500 text-[10px] font-bold px-2 py-0.5 rounded-full border border-slate-800">
                {colSteps.length}
              </span>
            </div>
            
            <div className="flex flex-col gap-3">
              {colSteps.map(step => (
                <div key={step.id} className="bg-[#111823] border border-slate-700/60 rounded-xl p-4 shadow-sm hover:border-emerald-500/30 transition-colors group cursor-pointer">
                  <div className="flex items-start justify-between mb-2">
                    <span className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-widest">
                      Step {step.stepNumber || step.step_number || step.id}
                    </span>
                    {step.status === 'completed' && <CheckCircle size={14} className="text-emerald-400" />}
                    {step.status === 'started' && <PlayCircle size={14} className="text-amber-400 animate-pulse" />}
                    {['failed', 'blocked'].includes(step.status) && <AlertTriangle size={14} className="text-rose-400" />}
                    {step.status === 'interrupted' && <AlertTriangle size={14} className="text-amber-500" />}
                  </div>
                  
                  <h4 className="text-sm font-medium text-slate-200 mb-3 leading-snug">
                    {step.toolCall ? 
                      (typeof step.toolCall === 'string' ? JSON.parse(step.toolCall).toolAction || 'Execute Command' : step.toolCall.toolAction) 
                      : (step.description || 'Unknown Step')}
                  </h4>

                  <div className="flex items-center gap-2 mt-auto">
                    <div className="flex items-center gap-1 text-[10px] text-slate-500 bg-[#090C10] px-2 py-1 rounded-md border border-slate-800">
                      <Clock size={10} /> 
                      {safeDate(step.startedAt || step.started_at)}
                    </div>
                  </div>
                </div>
              ))}
              {colSteps.length === 0 && (
                <div className="h-24 rounded-xl border border-dashed border-slate-800/50 flex items-center justify-center text-xs text-slate-600 font-mono">
                  Empty
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
