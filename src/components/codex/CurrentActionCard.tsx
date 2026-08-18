import React, { useEffect, useMemo, useState } from 'react';
import {
  Wifi, WifiOff, RefreshCw, Pause, Play, Square, Loader2,
  Terminal, FileCode, Cpu, User, Clock, ArrowRight, Bot
} from 'lucide-react';
import { useCodexStore } from '../../store/codexStore';
import {
  deriveCurrentAction,
  RUN_STATUS_STYLES,
  TERMINAL_GOAL_STATES,
  type ConnectionState
} from '../../presenters/executionStatus';
import { getToolLabel } from '../../presenters/EventPresenter';
import { normalizeExecutionEvent } from '../../utils/normalize';
import { apiFetch, apiUrl } from '../../api/client';

const CONNECTION_STYLE: Record<ConnectionState, { dot: string; text: string; label: string }> = {
  idle_connected: { dot: 'bg-emerald-500', text: 'text-emerald-400', label: 'Ready' },
  connecting: { dot: 'bg-amber-500 animate-pulse', text: 'text-amber-400', label: 'Connecting' },
  connected: { dot: 'bg-emerald-500', text: 'text-emerald-400', label: 'Connected' },
  reconnecting: { dot: 'bg-amber-500 animate-pulse', text: 'text-amber-400', label: 'Reconnecting' },
  disconnected: { dot: 'bg-rose-500', text: 'text-rose-400', label: 'Disconnected' },
  backend_unreachable: { dot: 'bg-rose-500', text: 'text-rose-400', label: 'Backend unavailable' }
};

function formatElapsed(createdAt?: string, running?: boolean): string {
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

function formatTime(ts?: string): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

interface Props {
  goal: any | null;
}

/**
 * Always-visible sticky card answering "what is CodeX doing right now".
 * Also carries the connection badge and the Pause / Resume / Stop controls.
 */
export const CurrentActionCard: React.FC<Props> = ({ goal }) => {
  const {
    activeGoalId, goalStatus, setGoalStatus,
    events, connectionState, reconnectStream
  } = useCodexStore();

  const [now, setNow] = useState(Date.now());
  const [controlBusy, setControlBusy] = useState<string | null>(null);

  const normalizedEvents = useMemo(() => (events || []).map(normalizeExecutionEvent), [events]);
  const action = useMemo(
    () => deriveCurrentAction(goalStatus, normalizedEvents, connectionState),
    [goalStatus, normalizedEvents, connectionState]
  );

  const isTerminal = TERMINAL_GOAL_STATES.includes((goalStatus || '').toLowerCase());
  const isActive = !!goalStatus && !isTerminal && goalStatus !== 'paused';
  const status = (goalStatus || '').toLowerCase();

  useEffect(() => {
    if (!isActive) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [isActive]);

  const styles = RUN_STATUS_STYLES[action.color];
  const effectiveConnectionState = isTerminal || ['paused', 'waiting_for_approval'].includes(status)
    ? 'idle_connected'
    : connectionState;
  const conn = CONNECTION_STYLE[effectiveConnectionState];

  const callControl = async (kind: 'pause' | 'resume' | 'stop') => {
    if (!activeGoalId || controlBusy) return;
    setControlBusy(kind);
    try {
      if (kind === 'pause') {
        await apiFetch(`/api/chat/agents/goal/${activeGoalId}/pause`, { method: 'POST' });
        setGoalStatus('pause_requested');
      } else if (kind === 'resume') {
        await apiFetch(`/api/chat/agents/goal/${activeGoalId}/resume`, { method: 'POST' });
        setGoalStatus('queued');
      } else {
        await apiFetch(`/api/chat/agents/goal/${activeGoalId}/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'abort' })
        });
        setGoalStatus('stopped');
      }
    } catch {
      // Control failures surface via the event stream / next poll.
    } finally {
      setControlBusy(null);
    }
  };

  const canPause = false;
  const canResume = false;
  const canStop = false;

  const startedAt = goal?.createdAt;
  const elapsed = formatElapsed(startedAt, isActive);

  return (
    <div
      data-testid="codex-current-action"
      className={`sticky top-0 z-20 border-b ${styles.border} bg-[#0d1117]/95 backdrop-blur-sm`}
    >
      <div className={`mx-auto max-w-4xl px-4 py-3 border-x border-b rounded-b-lg ${styles.border} ${styles.bg}`}>
        {/* Top row: status + connection */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${styles.dot} ${action.isActive ? 'animate-pulse' : ''}`} />
            <span className={`text-[11px] font-bold uppercase tracking-widest ${styles.text}`}>
              {action.statusLabel}
            </span>
            <span className="text-sm text-slate-200 font-medium truncate" title={action.message}>
              {action.message}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Connection badge */}
            <span className={`flex items-center gap-1.5 text-[11px] ${conn.text}`} title="Event stream connection">
              {['disconnected', 'backend_unreachable'].includes(effectiveConnectionState) ? <WifiOff size={12} /> : <Wifi size={12} />}
              <span className={`w-1.5 h-1.5 rounded-full ${conn.dot}`} />
              {conn.label}
            </span>
            {effectiveConnectionState === 'backend_unreachable' && (
              <button
                onClick={reconnectStream}
                className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-rose-500/40 text-rose-300 hover:bg-rose-500/10 transition-colors"
              >
                <RefreshCw size={11} /> Retry connection
              </button>
            )}
            {effectiveConnectionState === 'disconnected' && !!activeGoalId && !!goalStatus && !isTerminal && !['paused', 'waiting_for_approval'].includes(status) && (
              <button
                onClick={reconnectStream}
                className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-rose-500/40 text-rose-300 hover:bg-rose-500/10 transition-colors"
              >
                <RefreshCw size={11} /> Reconnect
              </button>
            )}

            {/* Run controls */}
            {canPause && (
              <button
                onClick={() => callControl('pause')}
                disabled={!!controlBusy}
                className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-slate-600 text-slate-300 hover:bg-slate-700/40 transition-colors disabled:opacity-50"
              >
                {controlBusy === 'pause' ? <Loader2 size={11} className="animate-spin" /> : <Pause size={11} />} Pause
              </button>
            )}
            {canResume && (
              <button
                onClick={() => callControl('resume')}
                disabled={!!controlBusy}
                className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 transition-colors disabled:opacity-50"
              >
                {controlBusy === 'resume' ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />} Resume
              </button>
            )}
            {canStop && (
              <button
                onClick={() => callControl('stop')}
                disabled={!!controlBusy}
                className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-rose-500/40 text-rose-300 hover:bg-rose-500/10 transition-colors disabled:opacity-50"
              >
                {controlBusy === 'stop' ? <Loader2 size={11} className="animate-spin" /> : <Square size={11} />} Stop
              </button>
            )}
          </div>
        </div>

        {/* Detail grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-4 gap-y-2 mt-3 text-[11px]">
          <div className="flex flex-col min-w-0">
            <span className="text-slate-500 uppercase tracking-wider flex items-center gap-1"><User size={10} /> Agent</span>
            <span className="text-slate-300 truncate flex items-center gap-1"><Bot size={11} className="text-emerald-500" />{action.agent}</span>
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-slate-500 uppercase tracking-wider flex items-center gap-1"><Cpu size={10} /> {action.executionProvider ? 'Plan Provider' : 'Provider'}</span>
            <span className="text-slate-300 truncate">{action.provider && action.provider !== 'unknown' ? action.provider : '—'}</span>
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-slate-500 uppercase tracking-wider flex items-center gap-1"><Cpu size={10} /> {action.executionProvider ? 'Plan Model' : 'Model'}</span>
            <span className="text-slate-300 truncate font-mono">{action.model && action.model !== 'unknown' ? action.model : '—'}</span>
          </div>
          {action.executionProvider ? (
            <>
              <div className="flex flex-col min-w-0">
                <span className="text-slate-500 uppercase tracking-wider flex items-center gap-1"><Cpu size={10} /> Exec Provider</span>
                <span className="text-slate-300 truncate">{action.executionProvider}</span>
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-slate-500 uppercase tracking-wider flex items-center gap-1"><Terminal size={10} /> Tools Run</span>
                <span className="text-slate-300 truncate font-mono">{action.toolsRun}</span>
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-slate-500 uppercase tracking-wider flex items-center gap-1"><FileCode size={10} /> Files Chg</span>
                <span className="text-slate-300 truncate font-mono">{action.filesChanged}</span>
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-col min-w-0">
                <span className="text-slate-500 uppercase tracking-wider flex items-center gap-1"><Terminal size={10} /> Tool</span>
                <span className="text-slate-300 truncate font-mono">{action.tool ? getToolLabel(action.tool) : '—'}</span>
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-slate-500 uppercase tracking-wider flex items-center gap-1"><FileCode size={10} /> File</span>
                <span className="text-purple-400 truncate font-mono" title={action.filePath || action.command || ''}>
                  {action.filePath || action.command || '—'}
                </span>
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-slate-500 uppercase tracking-wider flex items-center gap-1"><Clock size={10} /> Elapsed</span>
                <span className="text-emerald-400 font-mono">{elapsed}</span>
              </div>
            </>
          )}
        </div>

        {/* Next action */}
        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-700/40 text-[11px] text-slate-400">
          <ArrowRight size={11} className="shrink-0" />
          <span className="uppercase tracking-wider text-slate-500">Next:</span>
          <span className="truncate">{action.nextAction}</span>
          {startedAt && (
            <span className="ml-auto text-slate-600 shrink-0">Started {formatTime(startedAt)}</span>
          )}
        </div>

        {action.error && (
          <div className="mt-2 text-[11px] text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded px-2 py-1 break-all">
            {action.error}
          </div>
        )}
      </div>
    </div>
  );
};
