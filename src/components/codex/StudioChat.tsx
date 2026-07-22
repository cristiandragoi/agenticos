import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Target, CheckCircle2, XCircle, AlertTriangle, WifiOff, RefreshCw, FileCode, Terminal, Clock } from 'lucide-react';
import { useCodexStore } from '../../store/codexStore';
import { normalizeExecutionEvent } from '../../utils/normalize';
import { TERMINAL_GOAL_STATES, pairToolExecutions } from '../../presenters/executionStatus';
import { CurrentActionCard } from './CurrentActionCard';
import { ExecutionTimeline } from './ExecutionTimeline';
import { RunSettings } from './RunSettings';

function formatElapsed(createdAt?: string): string {
  if (!createdAt) return '—';
  const start = new Date(createdAt).getTime();
  if (isNaN(start)) return '—';
  const ms = Math.max(0, Date.now() - start);
  const secs = Math.floor(ms / 1000) % 60;
  const mins = Math.floor(ms / 60000) % 60;
  const hours = Math.floor(ms / 3600000);
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

/** Final result card shown when the run reaches a terminal state. */
const FinalSummaryCard: React.FC<{ goalStatus: string | null; goal: any; events: any[] }> = ({ goalStatus, goal, events }) => {
  const status = (goalStatus || '').toLowerCase();
  if (!TERMINAL_GOAL_STATES.includes(status)) return null;

  const executions = pairToolExecutions(events, false);
  const toolsRun = executions.length;
  const toolsFailed = executions.filter(e => e.state === 'failed').length;
  const filesTouched = Array.from(new Set(executions.map(e => e.filePath).filter(Boolean)));
  const lastError = [...events].reverse().find(e => e.error)?.error;
  const finishEvent = [...events].reverse().find(e => e.eventType === 'agent_completed' || e.eventType === 'task_completed');
  const finishMessage = (finishEvent?.message || '').replace(/^Goal finished:\s*/, '');

  const isCompleted = status === 'completed';
  const isFailed = status === 'failed';

  return (
    <div
      data-testid="codex-final-summary"
      className={`border rounded-lg p-4 ${
        isCompleted ? 'border-blue-500/40 bg-blue-500/5' :
        isFailed ? 'border-rose-500/40 bg-rose-500/5' :
        'border-slate-600/50 bg-slate-700/10'
      }`}
    >
      <div className="flex items-center gap-2 mb-3">
        {isCompleted ? <CheckCircle2 size={16} className="text-blue-400" /> :
         isFailed ? <XCircle size={16} className="text-rose-400" /> :
         <AlertTriangle size={16} className="text-slate-400" />}
        <span className={`text-sm font-bold ${
          isCompleted ? 'text-blue-400' : isFailed ? 'text-rose-400' : 'text-slate-300'
        }`}>
          {isCompleted ? 'Task completed' : isFailed ? 'Execution failed' : 'Execution stopped'}
        </span>
        <span className="text-[11px] text-slate-500 ml-auto flex items-center gap-1">
          <Clock size={10} /> {formatElapsed(goal?.createdAt)}
        </span>
      </div>

      {isCompleted && finishMessage && (
        <p className="text-[13px] text-slate-300 mb-3 whitespace-pre-wrap">{finishMessage}</p>
      )}
      {isFailed && lastError && (
        <p className="text-[13px] text-rose-300 mb-3 break-all">{lastError}</p>
      )}

      <div className="grid grid-cols-3 gap-2 text-[11px]">
        <div className="bg-[#0A0F16] border border-slate-700/40 rounded p-2 flex flex-col">
          <span className="text-slate-500 uppercase tracking-wider">Tools run</span>
          <span className="text-slate-200 font-mono">{toolsRun}{toolsFailed > 0 ? ` (${toolsFailed} failed)` : ''}</span>
        </div>
        <div className="bg-[#0A0F16] border border-slate-700/40 rounded p-2 flex flex-col col-span-2 min-w-0">
          <span className="text-slate-500 uppercase tracking-wider">Files touched</span>
          <span className="text-purple-400 font-mono truncate" title={filesTouched.join(', ')}>
            {filesTouched.length > 0 ? filesTouched.join(', ') : '—'}
          </span>
        </div>
      </div>

      {isFailed && (
        <p className="text-[11px] text-slate-500 mt-3">
          Use Resume in the status card above to continue from the last checkpoint, or inspect Advanced Diagnostics for details.
        </p>
      )}
    </div>
  );
};

/**
 * Primary CodeX execution view. One predictable vertical scroll containing:
 * goal header → run settings summary → sticky current-action card →
 * live timeline with tool cards → final summary. No developer panels
 * are required to understand what CodeX is doing.
 */
export const StudioChat = ({ activeGoalId }: { activeGoalId: string | null }) => {
  const { events, goalStatus, connectionState, runSettings, reconnectStream } = useCodexStore();
  const [goal, setGoal] = useState<any>(null);

  const status = (goalStatus || '').toLowerCase();
  const isTerminal = TERMINAL_GOAL_STATES.includes(status);
  const runIsActive = !!goalStatus && !isTerminal && status !== 'paused';

  // Fetch goal metadata (prompt text, createdAt, runSummary).
  useEffect(() => {
    if (!activeGoalId) {
      setGoal(null);
      return;
    }
    let cancelled = false;
    const fetchGoal = async () => {
      try {
        const res = await fetch(`/api/chat/agents/goal/${activeGoalId}`);
        if (res.ok && !cancelled) setGoal(await res.json());
      } catch (e) {}
    };
    fetchGoal();
    if (isTerminal) return;
    const interval = setInterval(fetchGoal, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [activeGoalId, isTerminal]);

  const normalizedEvents = useMemo(() => {
    return (events || [])
      .map(normalizeExecutionEvent)
      .sort((a: any, b: any) => (a.sequence ?? 0) - (b.sequence ?? 0));
  }, [events]);

  // Auto-follow the stream unless the user scrolled up.
  const scrollRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && followRef.current) el.scrollTop = el.scrollHeight;
  }, [normalizedEvents.length, isTerminal]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const showDisconnectWarning = connectionState === 'disconnected' && !!activeGoalId && !!goalStatus && !isTerminal;

  return (
    <div className="h-full overflow-y-auto bg-[#0A0F16]" ref={scrollRef} onScroll={handleScroll}>
      {/* Sticky current action card — always visible while scrolling */}
      <CurrentActionCard goal={goal} />

      <div className="mx-auto max-w-4xl px-4 pt-4 pb-24 flex flex-col gap-4">
        {/* Goal header */}
        <div className="bg-[#111823] border border-slate-700/50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Target size={14} className="text-emerald-500 shrink-0" />
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Goal</span>
            <span className={`ml-auto text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${
              isTerminal
                ? status === 'completed' ? 'text-blue-400 border-blue-500/40 bg-blue-500/10' : 'text-rose-400 border-rose-500/40 bg-rose-500/10'
                : 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10'
            }`}>
              {goalStatus || 'queued'}
            </span>
          </div>
          <p className="text-[13px] text-slate-200 whitespace-pre-wrap leading-relaxed">
            {goal?.originalGoal || 'Loading goal…'}
          </p>
        </div>

        {/* Run settings — compact summary during a run, read-only */}
        <RunSettings values={runSettings} disabled defaultOpen={false} />

        {/* Disconnection warning — events stay visible, run state is kept */}
        {showDisconnectWarning && (
          <div className="flex items-center gap-3 border border-amber-500/40 bg-amber-500/10 rounded-lg px-3 py-2">
            <WifiOff size={14} className="text-amber-400 shrink-0" />
            <span className="text-[12px] text-amber-300 flex-1">
              The live event stream disconnected. Events shown below may be stale — the run itself is unaffected.
            </span>
            <button
              onClick={reconnectStream}
              className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-amber-500/40 text-amber-300 hover:bg-amber-500/10 transition-colors shrink-0"
            >
              <RefreshCw size={11} /> Reconnect
            </button>
          </div>
        )}

        {/* Live timeline */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-slate-500">
            <Terminal size={12} /> Live Timeline
            <span className="normal-case tracking-normal font-normal text-slate-600">
              {normalizedEvents.length} events
            </span>
          </div>
          <ExecutionTimeline events={normalizedEvents} runIsActive={runIsActive} />
        </div>

        {/* Result summary */}
        <FinalSummaryCard goalStatus={goalStatus} goal={goal} events={normalizedEvents} />

        {/* Files touched quick list */}
        {isTerminal && (
          <div className="flex items-center gap-2 text-[11px] text-slate-600 justify-center pb-4">
            <FileCode size={11} />
            <span>Open Advanced Diagnostics below for terminal output, logs, raw events, and exports.</span>
          </div>
        )}
      </div>
    </div>
  );
};
