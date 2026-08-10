import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, FileCode, Pause, Play, RefreshCw, RotateCcw, Send, Square, Target, Terminal, WifiOff, XCircle } from 'lucide-react';
import { useCodexStore } from '../../store/codexStore';
import { normalizeExecutionEvent } from '../../utils/normalize';
import { TERMINAL_GOAL_STATES, pairToolExecutions } from '../../presenters/executionStatus';
import { CurrentActionCard } from './CurrentActionCard';
import { ExecutionTimeline } from './ExecutionTimeline';
import { RunSettings } from './RunSettings';
import { CODEX_REPOSITORY, isRepositoryOnlyTask } from '../../config/codexRuntime';
import { buildCodexGoalPayload } from '../../features/codex/buildCodexGoalPayload';
import { apiFetch } from '../../api/client';

function formatElapsed(createdAt?: string): string {
  if (!createdAt) return '-';
  const start = new Date(createdAt).getTime();
  if (isNaN(start)) return '-';
  const ms = Math.max(0, Date.now() - start);
  const secs = Math.floor(ms / 1000) % 60;
  const mins = Math.floor(ms / 60000) % 60;
  const hours = Math.floor(ms / 3600000);
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

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
  const isFailed = status === 'failed' || status === 'timed_out';

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
        <span className={`text-sm font-bold ${isCompleted ? 'text-blue-400' : isFailed ? 'text-rose-400' : 'text-slate-300'}`}>
          {isCompleted ? 'Task completed' : isFailed ? 'Execution failed' : 'Execution stopped'}
        </span>
        <span className="text-[11px] text-slate-500 ml-auto flex items-center gap-1">
          <Clock size={10} /> {formatElapsed(goal?.createdAt)}
        </span>
      </div>

      {isCompleted && finishMessage && <p className="text-[13px] text-slate-300 mb-3 whitespace-pre-wrap">{finishMessage}</p>}
      {isFailed && lastError && <p className="text-[13px] text-rose-300 mb-3 break-all">{lastError}</p>}

      <div className="grid grid-cols-3 gap-2 text-[11px]">
        <div className="bg-[#0A0F16] border border-slate-700/40 rounded p-2 flex flex-col">
          <span className="text-slate-500 uppercase tracking-wider">Tools run</span>
          <span className="text-slate-200 font-mono">{toolsRun}{toolsFailed > 0 ? ` (${toolsFailed} failed)` : ''}</span>
        </div>
        <div className="bg-[#0A0F16] border border-slate-700/40 rounded p-2 flex flex-col col-span-2 min-w-0">
          <span className="text-slate-500 uppercase tracking-wider">Files touched</span>
          <span className="text-purple-400 font-mono truncate" title={filesTouched.join(', ')}>
            {filesTouched.length > 0 ? filesTouched.join(', ') : '-'}
          </span>
        </div>
      </div>
    </div>
  );
};

export const StudioChat = ({ activeGoalId, onGoalCreated }: { activeGoalId: string | null; onGoalCreated?: (id: string) => void }) => {
  const {
    events, setEvents,
    goalStatus, setGoalStatus,
    connectionState, setConnectionState,
    runSettings,
    reconnectStream, streamNonce,
    input, setInput,
    isPlanning, setIsPlanning,
    isStarting, setIsStarting,
    resetForNewTask
  } = useCodexStore();

  const [goal, setGoal] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasCheckpoint, setHasCheckpoint] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);

  const status = (goalStatus || '').toLowerCase();
  const isTerminal = TERMINAL_GOAL_STATES.includes(status);
  const activeRunStatuses = ['validating', 'planning', 'starting', 'running', 'executing', 'reviewing', 'retrying', 'queued', 'reasoning'];
  const runIsActive = !!goalStatus && !isTerminal && status !== 'paused' && status !== 'waiting_for_approval';
  const stopVisible = !!activeGoalId && (
    activeRunStatuses.includes(status) ||
    status === 'paused' ||
    (connectionState === 'reconnecting' && !!goalStatus && !isTerminal)
  );
  const pauseVisible = !!activeGoalId && activeRunStatuses.includes(status);
  const sendVisible = !activeGoalId || isTerminal || !goalStatus;
  const cancelVisible = isPlanning || ['validating', 'planning'].includes(status);
  const canResume = !!activeGoalId && hasCheckpoint && !!goal?.originalGoal?.trim() && ['paused', 'failed', 'stopped', 'interrupted'].includes(status);
  const approvalVisible = !!activeGoalId && status === 'waiting_for_approval';

  useEffect(() => {
    if (activeGoalId) return;
    let cancelled = false;
    setConnectionState('connecting');
    apiFetch('/api/chat/agents/goals')
      .then(res => {
        if (cancelled) return;
        setConnectionState(res.ok ? 'idle_connected' : 'backend_unreachable');
      })
      .catch(() => {
        if (!cancelled) setConnectionState('backend_unreachable');
      });
    return () => { cancelled = true; };
  }, [activeGoalId, setConnectionState, streamNonce]);

  useEffect(() => {
    if (!activeGoalId) {
      setGoal(null);
      setHasCheckpoint(false);
      return;
    }
    let cancelled = false;
    const fetchGoal = async () => {
      try {
        const res = await apiFetch(`/api/chat/agents/goal/${activeGoalId}`);
        if (res.ok && !cancelled) {
          const data = await res.json();
          setGoal(data);
          if (data?.status) setGoalStatus(data.status);
        }
      } catch {}
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

  useEffect(() => {
    if (!activeGoalId) {
      setHasCheckpoint(false);
      return;
    }
    let cancelled = false;
    apiFetch(`/api/chat/agents/goal/${activeGoalId}/checkpoints`)
      .then(res => res.ok ? res.json() : [])
      .then(data => { if (!cancelled) setHasCheckpoint(Array.isArray(data) && data.length > 0); })
      .catch(() => { if (!cancelled) setHasCheckpoint(false); });
    return () => { cancelled = true; };
  }, [activeGoalId, normalizedEvents.length]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && followRef.current) el.scrollTop = el.scrollHeight;
  }, [normalizedEvents.length, isTerminal]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const handleNewTask = async () => {
    abortRef.current?.abort();
    if (activeGoalId && runIsActive) {
      await apiFetch(`/api/chat/agents/goal/${activeGoalId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'abort' })
      }).catch(() => undefined);
    }
    setGoal(null);
    setHasCheckpoint(false);
    setError(null);
    resetForNewTask();
  };

  const handleSend = async () => {
    const task = input.trim();
    setError(null);
    if (!task || isRepositoryOnlyTask(task, runSettings.workspacePath || CODEX_REPOSITORY)) {
      setError('Describe what you want CodeX to do.');
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsPlanning(true);
    setIsStarting(false);
    setEvents([]);
    setConnectionState('connecting');

    try {
      const res = await apiFetch('/api/chat/agents/goal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify(buildCodexGoalPayload({
          goal: task,
          repositoryRoot: runSettings.workspacePath || CODEX_REPOSITORY,
          approvalPolicy: 'auto',
          validationProvider: runSettings.valProvider,
          assignment: runSettings.routing
            ? { routingMode: runSettings.routing.mode, providerId: runSettings.routing.providerId, modelId: runSettings.routing.modelId, enabled: true }
            : null,
          explicitRoutingOverride: true,
          executionProviderId: runSettings.executionProviderId === 'none' ? 'auto' : runSettings.executionProviderId
        }))
      });
      const data = await res.json();
      if (!res.ok || !data.goalId) throw new Error(data.error || 'Failed to create CodeX task.');
      setInput('');
      onGoalCreated?.(data.goalId);
    } catch (err: any) {
      if (err?.name !== 'AbortError') setError(err?.message || 'Failed to create CodeX task.');
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setIsPlanning(false);
    }
  };

  const handleStop = async () => {
    abortRef.current?.abort();
    setError(null);
    setIsPlanning(false);
    setIsStarting(false);
    setGoalStatus('stopping');
    setConnectionState('idle_connected');
    if (activeGoalId) {
      await apiFetch(`/api/chat/agents/goal/${activeGoalId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'abort' })
      }).catch(() => undefined);
    }
    setGoalStatus('stopped');
    setConnectionState('idle_connected');
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
    <div className="h-full flex flex-col bg-[#0A0F16]">
      <div className="flex-1 overflow-y-auto" ref={scrollRef} onScroll={handleScroll}>
        <CurrentActionCard goal={goal} />

        <div className="mx-auto max-w-4xl px-4 pt-4 pb-24 flex flex-col gap-4">
          <div className="bg-[#111823] border border-slate-700/50 rounded-lg p-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-[12px]">
            <div><span className="text-slate-500 uppercase tracking-wider">Repository:</span> <span className="font-mono text-emerald-300">{runSettings.workspacePath || CODEX_REPOSITORY}</span></div>
          </div>

          {activeGoalId ? (
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
                {goal?.originalGoal || 'Loading goal...'}
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-slate-500">
              <Target size={24} className="text-emerald-500 mb-3" />
              <span className="text-sm">Ready for a new CodeX task.</span>
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

          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-slate-500">
              <Terminal size={12} /> Live Timeline
              <span className="normal-case tracking-normal font-normal text-slate-600">
                {normalizedEvents.length} events
              </span>
            </div>
            <ExecutionTimeline events={normalizedEvents} runIsActive={runIsActive} />
          </div>

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
  );
};
