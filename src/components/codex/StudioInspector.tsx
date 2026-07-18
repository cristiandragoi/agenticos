import React, { useState, useEffect } from 'react';
import { Target, Clock, Settings2, FileCode, Terminal, Play, Pause, FastForward, CheckCircle2, XCircle, AlertTriangle, Eye, Edit3, ShieldCheck } from 'lucide-react';
import { presentEvent } from '../../presenters/EventPresenter';
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

interface Props {
  activeGoalId: string | null;
}

export const StudioInspector: React.FC<Props> = ({ activeGoalId }) => {
  const [goal, setGoal] = useState<any>(null);
  const [elapsed, setElapsed] = useState<string>('0s');

  useEffect(() => {
    if (!activeGoalId) {
      setGoal(null);
      return;
    }
    const fetchGoal = async () => {
      try {
        const res = await fetch(`/api/chat/agents/goal/${activeGoalId}`);
        const data = await res.json();
        setGoal(data);
      } catch (e) {}
    };
    fetchGoal();
    const interval = setInterval(fetchGoal, 3000);
    return () => clearInterval(interval);
  }, [activeGoalId]);

  useEffect(() => {
    if (!goal) return;
    const timer = setInterval(() => {
      if (['completed', 'failed', 'stopped', 'paused'].includes(goal.status)) return;
      const ms = Date.now() - new Date(goal.createdAt).getTime();
      const secs = Math.floor(ms / 1000) % 60;
      const mins = Math.floor(ms / 60000);
      setElapsed(`${mins}m ${secs}s`);
    }, 1000);
    return () => clearInterval(timer);
  }, [goal]);

  if (!goal) {
    return (
      <div className="codex-inspector flex flex-col h-full bg-[#0d1117] border-l border-slate-800">
        <div className="p-3 border-b border-slate-800 text-sm font-bold uppercase tracking-wider text-slate-400">Inspector</div>
        <div className="flex-1 flex flex-col items-center justify-center text-slate-600">
          <Target size={24} className="mb-2" />
          <div className="text-xs">No active execution</div>
        </div>
      </div>
    );
  }

  const history = goal.history || [];
  const lastEvent = history.length > 0 ? history[history.length - 1] : null;
  const currentFile = lastEvent?.filePath || 'None';
  const currentTool = lastEvent?.tool || 'None';
  
  const provider = lastEvent?.provider || 'Unknown';
  const model = lastEvent?.model || 'Unknown';
  
  const isTerminal = ['completed', 'failed', 'stopped', 'paused'].includes(goal.status);
  const isWaiting = !isTerminal && (
    lastEvent?.lifecycleState === 'planning' || 
    lastEvent?.lifecycleState === 'retrying' || 
    lastEvent?.lifecycleState === 'waiting_for_approval' ||
    lastEvent?.eventType === 'tool_started'
  );

  let waitingFor = 'CodeX Engine';
  let waitingReason = 'Processing the next step.';
  let waitingAction = 'None required.';
  
  if (lastEvent?.lifecycleState === 'planning') {
    waitingFor = `Local model (${model})`;
    waitingReason = 'Generating a response.';
  } else if (lastEvent?.lifecycleState === 'retrying') {
    waitingFor = `Provider (${provider})`;
    waitingReason = 'Retrying previous failed request.';
  } else if (lastEvent?.lifecycleState === 'waiting_for_approval') {
    waitingFor = 'User approval';
    waitingReason = 'The planned changes require confirmation.';
    waitingAction = 'Please approve or reject the plan in the main chat.';
  } else if (lastEvent?.eventType === 'tool_started' && lastEvent?.tool === 'runCommand') {
    waitingFor = lastEvent?.command || 'Terminal Command';
    waitingReason = 'Executing terminal command.';
  }

  const lastCompletedEvents = history.filter((e: any) => e.lifecycleState === 'completed' || e.eventType?.includes('completed'));
  const lastCompletedAction = lastCompletedEvents.length > 0 ? lastCompletedEvents[lastCompletedEvents.length - 1].userMessage || 'Started task' : 'Started task';

  const ActionIcon = lastEvent ? (IconMap[presentEvent(normalizeExecutionEvent(lastEvent)).iconKey] || Target) : Target;

  return (
    <div className="codex-inspector flex flex-col h-full bg-[#0d1117] border-l border-slate-800 text-sm overflow-y-auto">
      <div className="p-3 border-b border-slate-800 text-xs font-bold uppercase tracking-wider text-slate-400 sticky top-0 bg-[#0d1117] z-10 flex items-center justify-between">
        <span>Workspace Inspector</span>
        {!isTerminal && <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>}
      </div>

      <div className="p-4 flex flex-col gap-6">
        
        {/* Waiting Panel */}
        {isWaiting && (
          <div className="flex flex-col gap-2 p-3 bg-blue-900/10 border border-blue-500/30 rounded-lg">
            <div className="flex items-center gap-2 text-blue-400 font-bold text-xs uppercase tracking-wider">
              <Clock size={14} className="animate-pulse" /> Waiting
            </div>
            <div className="grid grid-cols-1 gap-2 mt-2">
              <div className="flex flex-col">
                <span className="text-[10px] text-slate-500 uppercase">Waiting for</span>
                <span className="text-slate-300 text-xs flex items-center gap-1">• {waitingFor}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] text-slate-500 uppercase">Reason</span>
                <span className="text-slate-300 text-xs">{waitingReason}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] text-slate-500 uppercase">Last completed</span>
                <span className="text-slate-300 text-xs">{lastCompletedAction}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] text-slate-500 uppercase">Next</span>
                <span className="text-slate-300 text-xs">Determine next tool to run</span>
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] text-slate-500 uppercase">User Action</span>
                <span className={`text-xs ${lastEvent?.lifecycleState === 'waiting_for_approval' ? 'text-amber-400 font-bold' : 'text-slate-400'}`}>{waitingAction}</span>
              </div>
            </div>
          </div>
        )}

        {/* Run Details */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-emerald-500 font-semibold text-xs tracking-wider uppercase">
            <Target size={14} /> Execution Status
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-[#161b22] border border-slate-800 p-2 rounded flex flex-col">
              <span className="text-[10px] text-slate-500 uppercase">Run ID</span>
              <span className="text-slate-300 font-mono text-xs truncate" title={goal.id}>{goal.id.split('-')[0]}</span>
            </div>
            <div className="bg-[#161b22] border border-slate-800 p-2 rounded flex flex-col">
              <span className="text-[10px] text-slate-500 uppercase">Elapsed</span>
              <span className="text-emerald-400 font-mono text-xs flex items-center gap-1"><Clock size={10}/> {elapsed}</span>
            </div>
          </div>
        </div>

        {/* Status Timeline */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-purple-400 font-semibold text-xs tracking-wider uppercase">
            <Target size={14} /> Timeline
          </div>
          <div className="bg-[#161b22] border border-slate-800 rounded p-3 flex flex-col gap-3">
            
            <div className="flex flex-col gap-2">
              {/* Past */}
              <div className="flex flex-col gap-1">
                {lastCompletedEvents.slice(-3).map((e: any, idx: number) => {
                  const p = presentEvent(normalizeExecutionEvent(e));
                  const PIcon = (IconMap[p.iconKey] || Terminal);
                  return (
                    <div key={idx} className="flex items-start gap-2 text-xs">
                      <PIcon size={12} className={`${p.colorClass} mt-0.5 shrink-0`} />
                      <span className="text-slate-400 leading-tight truncate">{p.title}</span>
                    </div>
                  );
                })}
              </div>

              {/* Present */}
              {!isTerminal && lastEvent && (
                <div className="flex items-start gap-2 text-xs mt-1 bg-slate-800/30 p-1.5 rounded border border-slate-700/50">
                  <ActionIcon size={12} className={`${presentEvent(normalizeExecutionEvent(lastEvent)).colorClass} mt-0.5 shrink-0 animate-pulse`} />
                  <span className="text-slate-200 leading-tight font-medium">{presentEvent(normalizeExecutionEvent(lastEvent)).title}</span>
                </div>
              )}

              {/* Future */}
              {!isTerminal && (
                <div className="flex flex-col gap-1 mt-1">
                  <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mt-2 mb-1">Unknown</span>
                  <div className="flex items-start gap-2 text-xs opacity-50">
                    <div className="w-3 h-3 rounded-full border border-slate-500 flex items-center justify-center shrink-0 mt-0.5"><div className="w-1 h-1 bg-slate-500 rounded-full"></div></div>
                    <span className="text-slate-400 leading-tight">Next action will be determined after the current step completes.</span>
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 mt-2 pt-3 border-t border-slate-800">
              <div className="flex flex-col">
                <span className="text-[10px] text-slate-500 uppercase">Current Tool</span>
                <span className="text-slate-400 text-xs font-mono flex items-center gap-1 mt-1 truncate"><Terminal size={10} /> {currentTool}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] text-slate-500 uppercase">Active File</span>
                <span className="text-purple-400 text-xs font-mono flex items-center gap-1 mt-1 truncate" title={currentFile}><FileCode size={10} /> {currentFile}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Infrastructure Section */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-slate-400 font-semibold text-xs tracking-wider uppercase">
            <Settings2 size={14} /> Identity & Runtime
          </div>
          <div className="bg-[#161b22] border border-slate-800 rounded p-2 flex flex-col divide-y divide-slate-800">
            <div className="flex justify-between items-center py-2">
              <span className="text-[10px] text-slate-500 uppercase tracking-wider">Agent</span>
              <span className="text-xs text-slate-200 font-bold text-emerald-400">CodeX Agent v2</span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-[10px] text-slate-500 uppercase tracking-wider">Provider</span>
              <span className="text-xs text-slate-200 bg-slate-800 px-2 py-0.5 rounded">{provider}</span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-[10px] text-slate-500 uppercase tracking-wider">Runtime model</span>
              <span className="text-xs text-slate-200 bg-slate-800 px-2 py-0.5 rounded font-mono">{model}</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};
