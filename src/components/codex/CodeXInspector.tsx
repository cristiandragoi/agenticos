import React from 'react';
import { useCodexStore } from '../../store/codexStore';
import { Play, Pause, FastForward, CheckCircle2, XCircle, AlertTriangle, Eye, Edit3, Terminal, ShieldCheck, Settings2 } from 'lucide-react';
import { presentEvent, getStatusPresentation } from '../../presenters/EventPresenter';
import { normalizeExecutionEvent } from '../../utils/normalize';

const IconMap: Record<string, any> = {
  planning: Settings2,
  tool: Terminal,
  file: Eye,
  terminal: Terminal,
  validation: ShieldCheck,
  warning: AlertTriangle,
  error: XCircle,
  completed: CheckCircle2,
  system: Terminal
};

export const CodeXInspector = ({ activeGoalId }: { activeGoalId: string | null }) => {
  const { events: rawEvents } = useCodexStore();
  const goal: any = { id: activeGoalId, status: 'executing' };
  const goalId = activeGoalId || '';
  
  
  
  // Use normalized events
  const events = rawEvents.map((e: any) => normalizeExecutionEvent(e)).sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  
  const currentEvent = events[events.length - 1];

  if (!currentEvent) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-slate-500">
        <Terminal className="w-12 h-12 mb-4 opacity-20" />
        <p>No execution events recorded yet.</p>
      </div>
    );
  }

  const prevEvent = events.length > 1 ? events[events.length - 2] : undefined;
  const presented = presentEvent(currentEvent, prevEvent);
  
  const Icon = IconMap[presented.iconKey] || Terminal;

  return (
    <div className="flex flex-col h-full bg-[#0A0F16]">
      <div className="p-4 border-b border-slate-700/50 flex flex-col gap-4">
        <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider flex items-center gap-2">
          <ActivityIndicator active={goal.status === 'executing' || goal.status === 'planning'} />
          Inspector
        </h3>
        
        <div className={`p-4 rounded-xl border ${presented.backgroundClass} ${presented.borderClass} flex flex-col gap-3`}>
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg bg-black/20 ${presented.colorClass}`}>
              <Icon className="w-5 h-5" />
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold">
                {presented.badgeText}
              </span>
              <span className="text-sm text-slate-200 font-medium">
                {presented.title}
              </span>
            </div>
          </div>
          
          <div className="text-sm text-slate-400 leading-relaxed border-t border-slate-700/50 pt-3">
            {presented.explanation}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-6">
        {/* Runtime Context */}
        <div className="flex flex-col gap-2">
          <span className="text-xs uppercase tracking-wider font-semibold text-slate-500 mb-2">Runtime Context</span>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-slate-500">Provider</span>
              <span className="text-sm text-slate-300 font-medium">{currentEvent.provider}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-slate-500">Model</span>
              <span className="text-sm text-slate-300 font-medium truncate">{currentEvent.model}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-slate-500">Step</span>
              <span className="text-sm text-slate-300 font-medium">{currentEvent.step || 0}</span>
            </div>
            {currentEvent.durationMs && (
              <div className="flex flex-col gap-1">
                <span className="text-xs text-slate-500">Duration</span>
                <span className="text-sm text-slate-300 font-medium">{(currentEvent.durationMs / 1000).toFixed(2)}s</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const ActivityIndicator = ({ active }: { active: boolean }) => (
  <span className="relative flex h-2 w-2">
    {active && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>}
    <span className={`relative inline-flex rounded-full h-2 w-2 ${active ? 'bg-emerald-500' : 'bg-slate-600'}`}></span>
  </span>
);
