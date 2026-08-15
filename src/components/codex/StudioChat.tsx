import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileCode,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Send,
  Square,
  Target,
  Terminal,
  WifiOff,
  XCircle,
  Copy,
  Check,
  History,
  ChevronRight,
  Plus
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useCodexStore } from '../../store/codexStore';
import { normalizeExecutionEvent } from '../../utils/normalize';
import { TERMINAL_GOAL_STATES, pairToolExecutions } from '../../presenters/executionStatus';
import { CurrentActionCard } from './CurrentActionCard';
import { ExecutionTimeline } from './ExecutionTimeline';
import { RunSettings } from './RunSettings';
import { CODEX_REPOSITORY, isRepositoryOnlyTask } from '../../config/codexRuntime';
import { buildCodexGoalPayload } from '../../features/codex/buildCodexGoalPayload';
import { apiFetch } from '../../api/client';
import ErrorBoundary from '../ErrorBoundary';

function formatElapsed(createdAt?: string | number): string {
  if (!createdAt) return '-';
  const start = typeof createdAt === 'number' ? createdAt : new Date(createdAt).getTime();
  if (isNaN(start)) return '-';
  const ms = Math.max(0, Date.now() - start);
  const secs = Math.floor(ms / 1000) % 60;
  const mins = Math.floor(ms / 60000) % 60;
  const hours = Math.floor(ms / 3600000);
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

function formatDate(ts?: string | number): string {
  if (!ts) return '';
  const d = typeof ts === 'number' ? new Date(ts) : new Date(ts);
  if (isNaN(d.getTime())) return String(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const CopyButton = ({ text, label }: { text: string; label: string }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  return (
    <button 
      onClick={handleCopy} 
      className="px-2 py-0.5 text-[10px] flex items-center gap-1 rounded bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-slate-200 border border-slate-700/60 transition-colors"
      aria-label={label}
      title={label}
    >
      {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
      <span>{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );
};

const MarkdownComponents = {
  pre({ children, ...props }: any) {
    const codeElement = children as React.ReactElement<any>;
    const codeText = codeElement?.props?.children || '';
    return (
      <div className="relative my-2">
        <div className="absolute top-2 right-2 z-10">
          <CopyButton text={String(codeText).replace(/\n$/, '')} label="Copy code" />
        </div>
        <pre className="bg-[#090C10] p-3 pt-6 rounded border border-slate-800 overflow-x-auto text-[11px] font-mono text-slate-300" {...props}>
          {children}
        </pre>
      </div>
    );
  },
  code({ className, children, ...props }: any) {
    return <code className={`${className || ''} bg-[#090C10] px-1.5 py-0.5 rounded text-[11px] font-mono text-purple-300 border border-slate-800`} {...props}>{children}</code>;
  },
  h1({ children, ...props }: any) {
    return <h1 className="text-[14px] font-bold text-slate-100 mt-3 mb-1.5 border-b border-slate-700/40 pb-1" {...props}>{children}</h1>;
  },
  h2({ children, ...props }: any) {
    return <h2 className="text-[13px] font-bold text-slate-200 mt-2.5 mb-1" {...props}>{children}</h2>;
  },
  h3({ children, ...props }: any) {
    return <h3 className="text-[12px] font-bold text-emerald-400 mt-2 mb-1" {...props}>{children}</h3>;
  },
  p({ children, ...props }: any) {
    return <p className="mb-1.5 leading-relaxed text-slate-300" {...props}>{children}</p>;
  },
  ul({ children, ...props }: any) {
    return <ul className="list-disc list-inside mb-2 space-y-0.5 text-slate-300" {...props}>{children}</ul>;
  },
  ol({ children, ...props }: any) {
    return <ol className="list-decimal list-inside mb-2 space-y-0.5 text-slate-300" {...props}>{children}</ol>;
  },
  li({ children, ...props }: any) {
    return <li className="text-[12px] leading-relaxed" {...props}>{children}</li>;
  }
};

const FinalSummaryCard: React.FC<{ goalStatus: string | null; goal: any; events: any[] }> = ({ goalStatus, goal, events }) => {
  const status = (goalStatus || goal?.status || '').toLowerCase();
  if (!TERMINAL_GOAL_STATES.includes(status)) return null;

  const finishEvent = [...events].reverse().find(e => 
    e.eventType === 'agent_completed' || 
    e.eventType === 'task_completed' || 
    e.state === 'completed' || 
    e.tool === 'finish' ||
    (typeof e.payload === 'object' && e.payload?.finalAnswer) ||
    (typeof e.payload === 'string' && e.payload.includes('finalAnswer'))
  );
  
  let payloadObj = finishEvent?.payload;
  if (typeof payloadObj === 'string') {
    try { payloadObj = JSON.parse(payloadObj); } catch {}
  }
  
  let runSummaryObj = goal?.runSummary;
  if (typeof runSummaryObj === 'string') {
    try { runSummaryObj = JSON.parse(runSummaryObj); } catch {}
  }

  const rawFinishMessage = typeof payloadObj?.finalAnswer === 'string'
    ? payloadObj.finalAnswer
    : typeof runSummaryObj?.finalAnswer === 'string'
      ? runSummaryObj.finalAnswer
      : typeof runSummaryObj?.message === 'string'
        ? runSummaryObj.message
        : typeof goal?.finalAnswer === 'string'
          ? goal.finalAnswer
          : typeof finishEvent?.message === 'string' && !finishEvent.message.startsWith('Executing')
            ? finishEvent.message
            : typeof goal?.runSummary === 'string'
              ? goal.runSummary
              : '';
               
  const finishMessage = String(rawFinishMessage || '').replace(/^Goal finished:\s*/i, '').trim();

  const isCompleted = status === 'completed';
  const isFailed = status === 'failed' || status === 'timed_out';

  return (
    <ErrorBoundary name="FinalSummaryCard">
      <div
        data-testid="codex-final-summary"
        className={`border rounded-lg p-4 flex flex-col gap-3 ${
          isCompleted ? 'border-blue-500/40 bg-blue-500/5' :
          isFailed ? 'border-rose-500/40 bg-rose-500/5' :
          'border-slate-600/50 bg-slate-700/10'
        }`}
      >
        <div className="flex items-center gap-2">
          {isCompleted ? <CheckCircle2 size={16} className="text-blue-400" /> :
           isFailed ? <XCircle size={16} className="text-rose-400" /> :
           <AlertTriangle size={16} className="text-slate-400" />}
          <span className={`text-sm font-bold ${isCompleted ? 'text-blue-400' : isFailed ? 'text-rose-400' : 'text-slate-300'}`}>
            {isCompleted ? 'Task completed' : isFailed ? 'Execution failed' : 'Execution stopped'}
          </span>
          <span className="text-[11px] text-slate-500 ml-auto flex items-center gap-1">
            <Clock size={10} /> {formatElapsed(goal?.createdAt)}
          </span>
        </div>

        {isCompleted && finishMessage && (
          <div data-testid="codex-final-result-card" className="bg-[#0A0F16] border border-blue-500/30 rounded-md p-4 flex flex-col gap-2">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="text-[11px] font-bold uppercase tracking-widest text-blue-400 flex items-center gap-1.5">
                <CheckCircle2 size={13} /> FINAL RESULT
              </span>
              <CopyButton text={finishMessage} label="Copy result" />
            </div>
            <div className="text-[13px] text-slate-200 leading-relaxed font-sans overflow-x-auto">
              <ErrorBoundary name="MarkdownResult">
                <ReactMarkdown components={MarkdownComponents}>
                  {finishMessage}
                </ReactMarkdown>
              </ErrorBoundary>
            </div>
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
};

/** Recent Goals list for hydration and rapid goal switching. */
const RecentGoalsSection: React.FC<{
  goals: any[];
  activeGoalId: string | null;
  onSelectGoal?: (id: string) => void;
  onNewGoal?: () => void;
}> = ({ goals, activeGoalId, onSelectGoal, onNewGoal }) => {
  if (!goals || goals.length === 0) return null;

  return (
    <div data-testid="codex-recent-goals" className="bg-[#111823] border border-slate-700/50 rounded-lg p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-slate-400">
          <History size={13} className="text-emerald-400" />
          <span>Recent Goals ({goals.length})</span>
        </div>
        {onNewGoal && (
          <button
            onClick={onNewGoal}
            className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 transition-colors"
          >
            <Plus size={12} />
            <span>New Task</span>
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-2 max-h-56 overflow-y-auto pr-1">
        {goals.slice(0, 10).map(g => {
          const isSelected = g.id === activeGoalId;
          const status = (g.status || 'queued').toLowerCase();
          const isDone = status === 'completed';
          const isFail = status === 'failed' || status === 'timed_out';
          const hasResult = !!(g.runSummary || g.finalAnswer);

          return (
            <div
              key={g.id}
              onClick={() => onSelectGoal?.(g.id)}
              className={`p-2.5 rounded border transition-all cursor-pointer flex items-center justify-between gap-3 text-left ${
                isSelected
                  ? 'border-emerald-500/60 bg-emerald-950/20 shadow-sm'
                  : 'border-slate-800 bg-[#0A0F16] hover:border-slate-700 hover:bg-[#0E1520]'
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[9px] font-bold uppercase px-1.5 py-0.2 rounded border ${
                    isDone ? 'border-blue-500/40 text-blue-400 bg-blue-500/10' :
                    isFail ? 'border-rose-500/40 text-rose-400 bg-rose-500/10' :
                    status === 'stopped' ? 'border-slate-600 text-slate-400 bg-slate-800' :
                    'border-emerald-500/40 text-emerald-400 bg-emerald-500/10'
                  }`}>
                    {status}
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono">{formatDate(g.createdAt || g.updatedAt)}</span>
                  {hasResult && (
                    <span className="text-[9px] text-blue-400/90 bg-blue-900/30 px-1 rounded border border-blue-800/40">
                      Result Available
                    </span>
                  )}
                </div>
                <p className="text-[12px] text-slate-200 truncate font-medium">
                  {g.originalGoal || 'Untitled Goal'}
                </p>
              </div>

              <ChevronRight size={14} className={isSelected ? 'text-emerald-400' : 'text-slate-600'} />
            </div>
          );
        })}
      </div>
    </div>
  );
};

interface StudioChatProps {
  activeGoalId: string | null;
  onGoalCreated?: (id: string) => void;
  goals?: any[];
  onSelectGoal?: (id: string) => void;
  onNewGoal?: () => void;
}

export const StudioChat: React.FC<StudioChatProps> = ({
  activeGoalId,
  onGoalCreated,
  goals = [],
  onSelectGoal,
  onNewGoal
}) => {
  const {
    events,
    goalStatus,
    setGoalStatus,
    connectionState,
    setConnectionState,
    reconnectStream,
    runSettings,
    input,
    setInput,
    isPlanning,
    setIsPlanning,
    isStarting,
    setIsStarting,
    resetForNewTask,
  } = useCodexStore();

  const [goal, setGoal] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Fetch full goal details when activeGoalId changes
  useEffect(() => {
    if (!activeGoalId) {
      setGoal(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/api/chat/agents/goal/${activeGoalId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setGoal(data);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [activeGoalId]);

  const normalizedEvents = useMemo(() => events.map(normalizeExecutionEvent), [events]);
  const status = (goalStatus || '').toLowerCase();
  const isTerminal = TERMINAL_GOAL_STATES.includes(status);

  // Re-fetch full goal when goalStatus transitions to terminal state so runSummary is populated
  useEffect(() => {
    if (!activeGoalId || !isTerminal) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/api/chat/agents/goal/${activeGoalId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setGoal(data);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [activeGoalId, isTerminal, goalStatus]);
  const runIsActive = !!activeGoalId && !isTerminal && status !== 'paused';

  const approvalVisible = status === 'waiting_for_approval';
  const pauseVisible = runIsActive && status !== 'pause_requested';
  const stopVisible = runIsActive;
  const canResume = ['paused', 'failed', 'stopped'].includes(status);
  const sendVisible = !runIsActive || isTerminal;
  const cancelVisible = isPlanning || isStarting;

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events, autoScroll]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 50);
  };

  const handleSend = async () => {
    if (!input.trim() || isPlanning || isStarting) return;
    setError(null);
    setIsPlanning(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const payload = buildCodexGoalPayload({
        goal: input.trim(),
        repositoryRoot: runSettings.workspacePath || CODEX_REPOSITORY,
        approvalPolicy: runSettings.approvalPolicy,
        validationProvider: runSettings.valProvider,
        executionProviderId: runSettings.executionProviderId,
      });

      const res = await apiFetch('/api/chat/agents/goal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start CodeX goal.');

      const newGoalId = data.goalId || data.id;
      setInput('');
      setIsPlanning(false);
      onGoalCreated?.(newGoalId);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      setError(err?.message || 'Failed to create goal.');
      setIsPlanning(false);
    }
  };

  const handleNewTask = () => {
    resetForNewTask();
    onNewGoal?.();
  };

  const handleStop = async () => {
    if (!activeGoalId) return;
    setGoalStatus('stopping');
    await apiFetch(`/api/chat/agents/goal/${activeGoalId}/pause`, { method: 'POST' }).catch(() => undefined);
    setGoalStatus('stopped');
  };

  const handleCancel = () => {
    abortRef.current?.abort();
    setIsPlanning(false);
    setIsStarting(false);
    setConnectionState(activeGoalId ? connectionState : 'idle_connected');
  };

  const handlePause = async () => {
    if (!activeGoalId) return;
    await apiFetch(`/api/chat/agents/goal/${activeGoalId}/pause`, { method: 'POST' }).catch(() => undefined);
    setGoalStatus('pause_requested');
  };

  const handleApproval = async (action: 'approve' | 'reject') => {
    if (!activeGoalId) return;
    setError(null);
    setIsStarting(action === 'approve');
    try {
      const res = await apiFetch(`/api/chat/agents/goal/${activeGoalId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Failed to ${action} CodeX task.`);
      setGoalStatus(action === 'approve' ? (data.status || 'queued') : (data.status || 'stopped'));
      if (action === 'reject') setConnectionState('idle_connected');
    } catch (err: any) {
      setError(err?.message || `Failed to ${action} CodeX task.`);
    } finally {
      setIsStarting(false);
    }
  };

  const handleResume = async () => {
    if (!activeGoalId || !canResume) return;
    setIsStarting(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/chat/agents/goal/${activeGoalId}/resume`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to resume CodeX task.');
      setGoalStatus('queued');
    } catch (err: any) {
      setError(err?.message || 'Failed to resume CodeX task.');
    } finally {
      setIsStarting(false);
    }
  };

  const showDisconnectWarning = ['disconnected', 'reconnecting'].includes(connectionState) && !!activeGoalId && !!goalStatus && !isTerminal && !['paused', 'waiting_for_approval', 'stopping'].includes(status);

  return (
    <ErrorBoundary name="StudioChat">
      <div className="h-full flex flex-col bg-[#0A0F16]">
        <div className="flex-1 overflow-y-auto" ref={scrollRef} onScroll={handleScroll}>
          <CurrentActionCard goal={goal} />

          <div className="mx-auto max-w-4xl px-4 pt-4 pb-24 flex flex-col gap-4">
            <div className="bg-[#111823] border border-slate-700/50 rounded-lg p-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-[12px]">
              <div><span className="text-slate-500 uppercase tracking-wider">Repository:</span> <span className="font-mono text-emerald-300">{runSettings.workspacePath || CODEX_REPOSITORY}</span></div>
            </div>

            {/* Persistent Goals List */}
            <RecentGoalsSection
              goals={goals}
              activeGoalId={activeGoalId}
              onSelectGoal={onSelectGoal}
              onNewGoal={handleNewTask}
            />

            {activeGoalId ? (
              <div className="bg-[#111823] border border-slate-700/50 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Target size={14} className="text-emerald-500 shrink-0" />
                  <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Selected Goal</span>
                  <span className={`ml-auto text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${
                    isTerminal
                      ? status === 'completed' ? 'text-blue-400 border-blue-500/40 bg-blue-500/10' : 'text-rose-400 border-rose-500/40 bg-rose-500/10'
                      : 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10'
                  }`}>
                    {goalStatus || 'queued'}
                  </span>
                </div>
                <p className="text-[13px] text-slate-200 whitespace-pre-wrap leading-relaxed">
                  {goal?.originalGoal || 'Loading goal...'}
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-6 text-slate-500">
                <Target size={20} className="text-emerald-500 mb-2" />
                <span className="text-xs">Select a previous goal above or describe a new goal below.</span>
              </div>
            )}

            <RunSettings values={runSettings} disabled defaultOpen={false} />

            {approvalVisible && (
              <div className="border border-amber-500/40 bg-amber-500/10 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle size={16} className="text-amber-400 shrink-0" />
                  <span className="text-sm font-bold text-amber-200">Approval required</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[12px] mb-3">
                  <div>
                    <div className="text-slate-500 uppercase tracking-wider mb-1">Reason</div>
                    <div className="text-slate-200">CodeX requires confirmation before continuing this action.</div>
                  </div>
                  <div>
                    <div className="text-slate-500 uppercase tracking-wider mb-1">Proposed action</div>
                    <div className="text-slate-200">{normalizedEvents.at(-1)?.userMessage || normalizedEvents.at(-1)?.message || 'Continue CodeX execution'}</div>
                  </div>
                  <div>
                    <div className="text-slate-500 uppercase tracking-wider mb-1">Affected file/tool</div>
                    <div className="font-mono text-slate-200 truncate">
                      {normalizedEvents.at(-1)?.filePath || normalizedEvents.at(-1)?.tool || 'Goal approval'}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => handleApproval('approve')} disabled={isStarting} className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-emerald-500/40 bg-emerald-600 text-white hover:bg-emerald-500 text-[12px] disabled:opacity-50">
                    <CheckCircle2 size={13} /> Approve
                  </button>
                  <button onClick={() => handleApproval('reject')} disabled={isStarting} className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-rose-500/40 text-rose-300 hover:bg-rose-500/10 text-[12px] disabled:opacity-50">
                    <XCircle size={13} /> Reject
                  </button>
                </div>
              </div>
            )}

            {status === 'stopped' && (
              <div className="border border-slate-600/50 bg-slate-700/10 rounded-lg p-4">
                <div className="text-sm font-bold text-slate-200 mb-3">Execution stopped.</div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => document.querySelector('[data-testid="codex-timeline"]')?.scrollIntoView()} className="px-3 py-1.5 rounded border border-slate-600 text-slate-300 hover:bg-slate-700/40 text-[12px]">
                    View logs
                  </button>
                </div>
              </div>
            )}

            {showDisconnectWarning && (
              <div className="flex items-center gap-3 border border-amber-500/40 bg-amber-500/10 rounded-lg px-3 py-2">
                <WifiOff size={14} className="text-amber-400 shrink-0" />
                <span className="text-[12px] text-amber-300 flex-1">
                  The live event stream disconnected. Events shown below may be stale; the run itself is unaffected.
                </span>
                <button
                  onClick={reconnectStream}
                  className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-amber-500/40 text-amber-300 hover:bg-amber-500/10 transition-colors shrink-0"
                >
                  <RefreshCw size={11} /> Reconnect
                </button>
              </div>
            )}

            {activeGoalId && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-slate-500">
                  <Terminal size={12} /> Live Timeline
                  <span className="normal-case tracking-normal font-normal text-slate-600">
                    {normalizedEvents.length} events
                  </span>
                </div>
                <ExecutionTimeline events={normalizedEvents} runIsActive={runIsActive} />
              </div>
            )}

            <FinalSummaryCard goalStatus={goalStatus} goal={goal} events={normalizedEvents} />

            {isTerminal && (
              <div className="flex items-center gap-2 text-[11px] text-slate-600 justify-center pb-4">
                <FileCode size={11} />
                <span>Open Advanced Diagnostics below for terminal output, logs, raw events, and exports.</span>
              </div>
            )}
          </div>
        </div>

        <div data-testid="codex-composer" className="shrink-0 border-t border-slate-700/50 bg-[#111823] px-4 py-3">
          <div className="mx-auto max-w-4xl">
            {error && (
              <div className="mb-2 text-[12px] text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded px-3 py-2">
                {error}
              </div>
            )}
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="What should CodeX do?"
              aria-label="What should CodeX do?"
              className="w-full min-h-[72px] bg-[#0A0F16] border border-slate-700 rounded-md px-3 py-2 text-[13px] text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500 resize-none"
              disabled={isPlanning || isStarting}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />
            <div className="flex items-center justify-between mt-2 gap-2">
              <div className="text-[11px] text-slate-500 truncate">
                Repository is configuration only and will not be used as the task text.
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={handleNewTask} className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-600 text-slate-300 hover:bg-slate-700/40 text-[12px]">
                  <RotateCcw size={13} /> New Task
                </button>
                {cancelVisible && (
                  <button onClick={handleCancel} className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-amber-500/40 text-amber-300 hover:bg-amber-500/10 text-[12px]">
                    Cancel
                  </button>
                )}
                {stopVisible && (
                  <button onClick={handleStop} className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-rose-500/40 text-rose-300 hover:bg-rose-500/10 text-[12px]">
                    <Square size={13} /> {status === 'stopping' ? 'Stopping...' : 'Stop'}
                  </button>
                )}
                {pauseVisible && (
                  <button onClick={handlePause} className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-600 text-slate-300 hover:bg-slate-700/40 text-[12px]">
                    <Pause size={13} /> Pause
                  </button>
                )}
                {canResume && (
                  <button onClick={handleResume} disabled={isStarting} className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-600 text-slate-300 hover:bg-slate-700/40 text-[12px] disabled:opacity-50">
                    <Play size={13} /> Resume
                  </button>
                )}
                {sendVisible && (
                  <button onClick={handleSend} disabled={!input.trim() || isPlanning || isStarting} className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-emerald-500/40 bg-emerald-600 text-white hover:bg-emerald-500 text-[12px] disabled:opacity-50 disabled:cursor-not-allowed">
                    <Send size={13} /> Send
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
};
