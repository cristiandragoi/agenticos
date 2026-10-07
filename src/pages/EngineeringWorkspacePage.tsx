// @ts-nocheck
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Cpu, Terminal, Play, Pause, RefreshCw, ExternalLink, CheckCircle2,
  XCircle, Clock, AlertTriangle, ShieldCheck, FileCode, Search,
  GitCommit, ArrowRight, Layers, FileText, Check, Copy, History,
  Activity, Zap, Info, AlertOctagon, ChevronDown, ChevronRight,
  Database, MonitorPlay, RotateCcw, StopCircle, CornerDownRight,
  FolderGit2, CheckSquare, Volume2, Mic
} from 'lucide-react';
import { apiFetch, apiUrl } from '../api/client';

interface EngineeringWorkerSession {
  taskId: string;
  goalId?: string | null;
  workerId: string;
  antigravityConversationId: string;
  antigravitySessionId?: string | null;
  workspace: string;
  createdAt: string;
  lastHeartbeat: string;
  status: string;
  transcriptPath?: string | null;
  title?: string | null;
  currentStage?: string | null;
  currentFile?: string | null;
  currentCommand?: string | null;
  lastOutput?: string | null;
  filesRead: string[];
  filesChanged: string[];
  testsPassed: number;
  testsFailed: number;
  buildStatus: string;
  errors: string[];
  metadata?: Record<string, any>;
}

interface EngineeringExecutionEvent {
  id: string;
  timestamp: string;
  workerId: string;
  taskId?: string;
  goalId?: string;
  runId?: string;
  type?: string;
  eventType?: string;
  summary?: string;
  file?: string;
  command?: string;
  output?: string;
  exitCode?: number;
  changedFiles?: string[];
  metadata?: Record<string, any>;
}

interface AntigravityHealth {
  status: 'ONLINE' | 'OFFLINE' | 'RECONNECTING' | 'DISCONNECTED' | 'BUSY';
  desktopRunning: boolean;
  activeConversationId?: string;
  agentapiAvailable?: boolean;
  isolationMode: string;
  note: string;
  queueStatus?: {
    isExecuting: boolean;
    queueLength: number;
    currentTaskId: string | null;
  };
  error?: string;
}

export const EngineeringWorkspacePage: React.FC = () => {
  // Worker Selection & Composer State
  const [composerWorker, setComposerWorker] = useState<'antigravity' | 'codex' | 'hermes'>('antigravity');
  const [composerTaskInput, setComposerTaskInput] = useState<string>('');
  const [composerWorkspace, setComposerWorkspace] = useState<string>('D:\\AgenticOS');

  // Active & Selected Sessions
  const [selectedHistoricalTaskId, setSelectedHistoricalTaskId] = useState<string | null>(() => {
    try {
      return localStorage.getItem('agenticos_selected_engineering_task') || null;
    } catch {
      return null;
    }
  });

  const [activeSession, setActiveSession] = useState<EngineeringWorkerSession | null>(null);
  const [sessions, setSessions] = useState<EngineeringWorkerSession[]>([]);
  const [events, setEvents] = useState<EngineeringExecutionEvent[]>([]);
  const [antigravityHealth, setAntigravityHealth] = useState<AntigravityHealth | null>(null);
  const [workerInfo, setWorkerInfo] = useState<any>(null);

  // UI state
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isExecutingAction, setIsExecutingAction] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [eventFilter, setEventFilter] = useState<string>('all');
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: 'info' | 'success' | 'warning' | 'error'; text: string } | null>(null);

  const eventStreamEndRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [voiceRuntimeState, setVoiceRuntimeState] = useState<any>(null);

  const fetchVoiceRuntime = useCallback(async () => {
    try {
      const res = await apiFetch('/api/voice/runtime-state');
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.runtimeState) {
          setVoiceRuntimeState(data.runtimeState);
        }
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchVoiceRuntime();
    const interval = setInterval(fetchVoiceRuntime, 3000);
    return () => clearInterval(interval);
  }, [fetchVoiceRuntime]);

  // Copy helper
  const copyToClipboard = (text: string, fieldId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldId);
    setTimeout(() => setCopiedField(null), 2000);
  };

  // Fetch live console state
  const fetchConsoleData = useCallback(async (isManual = false) => {
    if (isManual) setIsRefreshing(true);
    try {
      const url = `/control-plane/engineering/console?worker=${composerWorker}`;
      const res = await apiFetch(url);
      if (res.ok) {
        const data = await res.json();
        setWorkerInfo(data.worker);
        setAntigravityHealth(data.antigravityHealth || null);
        setSessions(data.sessions || []);

        // If user hasn't explicitly clicked a past session, track active session
        if (!selectedHistoricalTaskId) {
          setActiveSession(data.activeSession || null);
          setEvents(data.events || []);
        } else {
          // Keep sessions list fresh but preserve user selection
          const current = (data.sessions || []).find((s: any) => s.taskId === selectedHistoricalTaskId);
          if (current) {
            setActiveSession(current);
            // Also fetch task-specific events if not present
            try {
              const sessRes = await apiFetch(`/control-plane/engineering/sessions/${selectedHistoricalTaskId}`);
              if (sessRes.ok) {
                const sessData = await sessRes.json();
                if (sessData.events) setEvents(sessData.events);
              }
            } catch { /* best effort */ }
          } else {
            setActiveSession(data.activeSession || null);
            setEvents(data.events || []);
          }
        }
      }
    } catch (err: any) {
      console.warn('[EngineeringWorkspace] Polling error:', err?.message);
    } finally {
      setIsLoading(false);
      if (isManual) setIsRefreshing(false);
    }
  }, [composerWorker, selectedHistoricalTaskId]);

  // Load a historical session from durable SQLite store
  const loadHistoricalSession = async (taskId: string) => {
    setSelectedHistoricalTaskId(taskId);
    try {
      localStorage.setItem('agenticos_selected_engineering_task', taskId);
    } catch { /* best effort */ }

    setIsRefreshing(true);
    try {
      const url = `/control-plane/engineering/sessions/${taskId}`;
      const res = await apiFetch(url);
      if (res.ok) {
        const data = await res.json();
        setActiveSession(data.session);
        setEvents(data.events || []);
        setNotice({
          type: 'info',
          text: `Selected persisted session ${taskId} from durable SQLite history.`
        });
      }
    } catch (err: any) {
      setNotice({ type: 'error', text: `Failed to load session ${taskId}: ${err.message}` });
    } finally {
      setIsRefreshing(false);
    }
  };

  const returnToLiveSession = () => {
    setSelectedHistoricalTaskId(null);
    try {
      localStorage.removeItem('agenticos_selected_engineering_task');
    } catch { /* best effort */ }
    fetchConsoleData(true);
  };

  // 1. Permanent Composer: Delegate Task
  const handleDelegateTask = async () => {
    if (!composerTaskInput.trim()) {
      setNotice({ type: 'warning', text: 'Please enter a natural language task description before delegating.' });
      return;
    }
    setIsExecutingAction(true);
    try {
      const res = await apiFetch('/control-plane/engineering/delegate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          objective: composerTaskInput.trim(),
          worker: composerWorker,
          workspacePath: composerWorkspace.trim() || 'D:\\AgenticOS',
        }),
      });
      const data = await res.json();
      if (data.success || data.taskId) {
        setNotice({
          type: 'success',
          text: `Task ${data.taskId} delegated to ${data.worker ? data.worker.toUpperCase() : 'ANTIGRAVITY'}! Active session: ${data.conversationId || data.runId || 'bound'}.`
        });
        setSelectedHistoricalTaskId(data.taskId);
        try {
          localStorage.setItem('agenticos_selected_engineering_task', data.taskId);
        } catch { /* best effort */ }
        setComposerTaskInput('');
        setTimeout(() => fetchConsoleData(true), 400);
      } else {
        setNotice({ type: 'error', text: data.error || 'Failed to delegate engineering task.' });
      }
    } catch (err: any) {
      setNotice({ type: 'error', text: `Delegation error: ${err.message}` });
    } finally {
      setIsExecutingAction(false);
    }
  };

  // 2. Permanent Composer: Continue Current Task (Exact Task ID Reused)
  const handleContinueTask = async () => {
    const targetTaskId = selectedHistoricalTaskId || activeSession?.taskId;
    if (!targetTaskId) {
      setNotice({ type: 'warning', text: 'No active or selected task to continue. Please select a task from history or delegate a new task.' });
      return;
    }
    if (!composerTaskInput.trim()) {
      setNotice({ type: 'warning', text: 'Please enter continuation instructions or feedback in the composer input.' });
      return;
    }

    setIsExecutingAction(true);
    try {
      const res = await apiFetch('/control-plane/engineering/continue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: targetTaskId,
          instruction: composerTaskInput.trim(),
          workspacePath: composerWorkspace.trim() || 'D:\\AgenticOS',
        }),
      });
      const data = await res.json();
      if (data.success) {
        setNotice({
          type: 'success',
          text: `Continued existing task ${data.taskId}! Same task ID preserved. AntiGravity executing continuation instruction.`
        });
        setComposerTaskInput('');
        setTimeout(() => fetchConsoleData(true), 400);
      } else {
        setNotice({ type: 'error', text: data.error || `Failed to continue task ${targetTaskId}.` });
      }
    } catch (err: any) {
      setNotice({ type: 'error', text: `Continuation error: ${err.message}` });
    } finally {
      setIsExecutingAction(false);
    }
  };

  // 3. Permanent Composer: Resume Task
  const handleResumeTask = async () => {
    const targetTaskId = selectedHistoricalTaskId || activeSession?.taskId;
    if (!targetTaskId) {
      setNotice({ type: 'warning', text: 'No task selected to resume.' });
      return;
    }
    setIsExecutingAction(true);
    try {
      const res = await apiFetch('/control-plane/engineering/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: targetTaskId }),
      });
      const data = await res.json();
      if (data.success) {
        setNotice({
          type: 'success',
          text: `Task ${targetTaskId} resumed successfully.`
        });
        setTimeout(() => fetchConsoleData(true), 400);
      } else {
        setNotice({ type: 'warning', text: data.error || 'Failed to resume task.' });
      }
    } catch (err: any) {
      setNotice({ type: 'error', text: `Resume error: ${err.message}` });
    } finally {
      setIsExecutingAction(false);
    }
  };

  // 4. Permanent Composer: Cancel Task
  const handleCancelTask = async () => {
    const targetTaskId = selectedHistoricalTaskId || activeSession?.taskId;
    if (!targetTaskId) {
      setNotice({ type: 'warning', text: 'No active task to cancel.' });
      return;
    }
    setIsExecutingAction(true);
    try {
      const res = await apiFetch('/control-plane/engineering/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: targetTaskId,
          reason: 'User cancelled from Engineering Task Composer'
        }),
      });
      const data = await res.json();
      if (data.success) {
        setNotice({
          type: 'info',
          text: `Task ${targetTaskId} cancelled.`
        });
        setTimeout(() => fetchConsoleData(true), 400);
      } else {
        setNotice({ type: 'error', text: data.error || 'Failed to cancel task.' });
      }
    } catch (err: any) {
      setNotice({ type: 'error', text: `Cancel error: ${err.message}` });
    } finally {
      setIsExecutingAction(false);
    }
  };

  // Optional External Debug Button (Non-blocking, never auto-opened)
  const handleOpenAntigravityExternally = async () => {
    try {
      const res = await apiFetch('/control-plane/engineering/open-antigravity', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setNotice({
          type: 'info',
          text: `AntiGravity Desktop window focused for external debugging (${data.action}). AgenticOS remains authoritative.`
        });
      } else {
        setNotice({
          type: 'warning',
          text: `Notice: ${data.error || 'Desktop window focus request sent.'}`
        });
      }
    } catch (err: any) {
      setNotice({ type: 'error', text: `Open failed: ${err.message}` });
    }
  };

  // Reconnect sessions
  const handleReconnect = async () => {
    setIsRefreshing(true);
    try {
      const res = await apiFetch('/control-plane/engineering/reconnect', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setNotice({
          type: 'success',
          text: `Reconnected: ${data.reconnectedCount} session(s) re-attached, ${data.disconnectedCount} marked disconnected.`
        });
        await fetchConsoleData(false);
      } else {
        setNotice({ type: 'warning', text: `Reconnect notice: ${data.error || 'No active sessions to reconnect.'}` });
      }
    } catch (err: any) {
      setNotice({ type: 'error', text: `Reconnect failed: ${err.message}` });
    } finally {
      setIsRefreshing(false);
    }
  };

  // Auto-scroll event stream
  useEffect(() => {
    if (autoScroll && eventStreamEndRef.current) {
      eventStreamEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [events, autoScroll]);

  // Polling loop
  useEffect(() => {
    fetchConsoleData();
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      fetchConsoleData(false);
    }, 2000);
    return () => clearInterval(interval);
  }, [fetchConsoleData, autoRefresh]);

  // Filter events
  const filteredEvents = events.filter((ev) => {
    const type = (ev.eventType || ev.type || '').toUpperCase();
    if (eventFilter === 'all') return true;
    if (eventFilter === 'files') return type.includes('FILE') || type.includes('DIFF') || type.includes('REPOSITORY');
    if (eventFilter === 'commands') return type.includes('COMMAND');
    if (eventFilter === 'tests') return type.includes('TEST');
    if (eventFilter === 'build') return type.includes('BUILD');
    if (eventFilter === 'lifecycle') return ['WORKER_ACCEPTED', 'WORKER_DONE', 'VALIDATING', 'ARGUS_VERIFYING', 'COMPLETED'].includes(type);
    return true;
  });

  // Calculate Last Real Event for Requirement 7 (Visible Worker Ownership)
  const latestMachineEvent = events.length > 0 ? events[events.length - 1] : null;
  const lastRealEventCode = latestMachineEvent
    ? (latestMachineEvent.eventType || latestMachineEvent.type || 'WORKER_ACCEPTED')
    : (activeSession?.status === 'BUSY' ? 'COMMAND_STARTED' : 'AWAITING_WORKER');

  const currentActiveTaskId = selectedHistoricalTaskId || activeSession?.taskId;

  // Status badge helper
  const getStatusBadge = (status?: string) => {
    const s = (status || 'OFFLINE').toUpperCase();
    if (s === 'ONLINE') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          ONLINE
        </span>
      );
    }
    if (s === 'BUSY' || s === 'EXECUTING' || s === 'RUNNING') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
          BUSY / EXECUTING
        </span>
      );
    }
    if (s === 'COMPLETED') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-950 text-emerald-300 border border-emerald-800">
          <CheckCircle2 size={12} className="text-emerald-400" />
          COMPLETED
        </span>
      );
    }
    if (s === 'RECONNECTING') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30">
          <RefreshCw size={12} className="animate-spin text-amber-400" />
          RECONNECTING
        </span>
      );
    }
    if (s === 'DISCONNECTED' || s === 'BLOCKED') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/30">
          <AlertOctagon size={12} className="text-rose-400" />
          {s}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-800 text-slate-400 border border-slate-700">
        <span className="w-2 h-2 rounded-full bg-slate-500" />
        OFFLINE
      </span>
    );
  };

  // Event icon renderer
  const renderEventIcon = (type: string) => {
    switch (type) {
      case 'WORKER_ACCEPTED':
        return <CheckCircle2 size={14} className="text-cyan-400" />;
      case 'REPOSITORY_OPENED':
        return <Layers size={14} className="text-indigo-400" />;
      case 'FILE_SEARCH':
        return <Search size={14} className="text-sky-400" />;
      case 'FILE_READ':
        return <FileText size={14} className="text-blue-400" />;
      case 'FILE_EDITED':
      case 'DIFF_CREATED':
        return <FileCode size={14} className="text-amber-400" />;
      case 'COMMAND_STARTED':
        return <Terminal size={14} className="text-violet-400" />;
      case 'COMMAND_OUTPUT':
        return <Terminal size={14} className="text-emerald-400" />;
      case 'COMMAND_FAILED':
        return <XCircle size={14} className="text-rose-400" />;
      case 'TEST_STARTED':
        return <Clock size={14} className="text-purple-400" />;
      case 'TEST_PASSED':
        return <CheckCircle2 size={14} className="text-emerald-400" />;
      case 'TEST_FAILED':
        return <XCircle size={14} className="text-rose-400" />;
      case 'BUILD_STARTED':
        return <Zap size={14} className="text-yellow-400" />;
      case 'BUILD_PASSED':
        return <CheckCircle2 size={14} className="text-emerald-400" />;
      case 'WORKER_DONE':
        return <CheckCircle2 size={14} className="text-cyan-400" />;
      case 'VALIDATING':
        return <Activity size={14} className="text-pink-400 animate-spin" />;
      case 'ARGUS_VERIFYING':
        return <ShieldCheck size={14} className="text-amber-400" />;
      case 'COMPLETED':
        return <CheckCircle2 size={14} className="text-emerald-400" />;
      default:
        return <Info size={14} className="text-slate-400" />;
    }
  };

  return (
    <div className="flex flex-col h-full w-full bg-[#070b14] text-slate-100 overflow-y-auto font-sans">
      
      {/* ── Top Header & Global Status ── */}
      <header className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-3 px-6 py-3.5 bg-[#0a0f1d]/95 backdrop-blur-md border-b border-slate-800/80">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-cyan-600 to-blue-500 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <Cpu size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight text-white flex items-center gap-2">
              AGENTICOS ENGINEERING WORKSPACE
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800/50">
                Native Worker Host
              </span>
            </h1>
            <p className="text-xs text-slate-400">
              AntiGravity background engine with native AgenticOS control, zero-copy workflow &amp; live telemetry
            </p>
          </div>
        </div>

        {/* Global Action Controls */}
        <div className="flex items-center gap-2">
          {/* Optional External Debug Button */}
          <button
            onClick={handleOpenAntigravityExternally}
            title="Optional Debug: Focus external AntiGravity IDE window"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-md text-xs font-medium border border-slate-800 hover:border-slate-700 transition-all"
          >
            <ExternalLink size={13} className="text-slate-400" />
            <span>Open Externally (Debug)</span>
          </button>

          {/* Reconnect Sessions */}
          <button
            onClick={handleReconnect}
            disabled={isRefreshing}
            title="Scan & reconnect listeners to any active or detached sessions"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-md text-xs font-medium border border-slate-800 transition-all disabled:opacity-50"
          >
            <RefreshCw size={13} className={isRefreshing ? 'animate-spin text-cyan-400' : 'text-slate-400'} />
            <span>Reconnect</span>
          </button>

          {/* Auto Refresh Toggle */}
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`px-2.5 py-1.5 rounded-md text-xs font-medium border transition-all ${
              autoRefresh
                ? 'bg-cyan-950/60 border-cyan-800/80 text-cyan-400'
                : 'bg-slate-900 border-slate-800 text-slate-500'
            }`}
          >
            {autoRefresh ? 'Live Polling' : 'Paused'}
          </button>
        </div>
      </header>

      {/* ── Notice Banner ── */}
      {notice && (
        <div className={`mx-6 mt-3 px-4 py-2.5 rounded-lg border text-xs flex items-center justify-between ${
          notice.type === 'error'
            ? 'bg-rose-950/40 border-rose-800 text-rose-300'
            : notice.type === 'warning'
            ? 'bg-amber-950/40 border-amber-800 text-amber-300'
            : notice.type === 'success'
            ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300'
            : 'bg-cyan-950/40 border-cyan-800 text-cyan-300'
        }`}>
          <div className="flex items-center gap-2">
            <Info size={14} />
            <span className="font-mono">{notice.text}</span>
          </div>
          <button onClick={() => setNotice(null)} className="text-slate-400 hover:text-white font-bold ml-4">
            ×
          </button>
        </div>
      )}

      {/* ── REQUIREMENT 1: Permanent Engineering Task Composer ── */}
      <section className="mx-6 mt-4 p-5 bg-[#0b1222] border border-cyan-500/30 rounded-xl shadow-xl shadow-black/50">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Terminal size={17} className="text-cyan-400" />
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-200">
              Permanent Engineering Task Composer
            </h2>
            <span className="text-[10px] text-slate-500 font-mono">
              (Sole Authoritative UI • Converged with Jarvis Voice)
            </span>
          </div>

          {/* Worker Selector */}
          <div className="flex items-center gap-1.5 p-1 bg-slate-900 rounded-lg border border-slate-800 text-xs font-medium">
            <span className="text-[11px] text-slate-500 px-2">Worker:</span>
            <button
              onClick={() => setComposerWorker('antigravity')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition-all ${
                composerWorker === 'antigravity'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
            >
              <Cpu size={13} />
              <span>AntiGravity (Default)</span>
              {antigravityHealth?.status === 'ONLINE' && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              )}
            </button>
            <button
              onClick={() => setComposerWorker('codex')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition-all ${
                composerWorker === 'codex'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
            >
              <Terminal size={13} />
              <span>CodeX</span>
            </button>
            <button
              onClick={() => setComposerWorker('hermes')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition-all ${
                composerWorker === 'hermes'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
            >
              <MonitorPlay size={13} />
              <span>Hermes</span>
            </button>
          </div>
        </div>

        {/* Task Input Body */}
        <div className="mt-3.5 space-y-3">
          <div>
            <textarea
              id="engineering-task-composer-input"
              value={composerTaskInput}
              onChange={(e) => setComposerTaskInput(e.target.value)}
              placeholder="Describe engineering repair, inspection, or code task in natural language... (e.g. Inspect package.json and tell me the application version. Do not modify anything.)"
              rows={3}
              className="w-full p-3 bg-slate-950/80 border border-slate-700/80 rounded-lg text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono leading-relaxed resize-y"
            />
          </div>

          {/* Bottom Bar: Workspace Input & Four Authoritative Action Buttons */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            {/* Workspace Directory */}
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-400 font-medium flex items-center gap-1">
                <FolderGit2 size={13} className="text-slate-400" />
                Workspace:
              </span>
              <input
                type="text"
                value={composerWorkspace}
                onChange={(e) => setComposerWorkspace(e.target.value)}
                className="w-64 px-2.5 py-1 bg-slate-900 border border-slate-700 rounded text-xs text-slate-200 font-mono focus:outline-none focus:border-cyan-500"
                placeholder="D:\AgenticOS"
              />
            </div>

            {/* Action Buttons: Delegate Task | Continue Current Task | Resume | Cancel */}
            <div className="flex items-center gap-2">
              {/* Button 1: Delegate Task */}
              <button
                id="btn-delegate-engineering-task"
                onClick={handleDelegateTask}
                disabled={isExecutingAction || !composerTaskInput.trim()}
                title="Delegate task to selected worker via authoritative EngineeringDelegationService"
                className="flex items-center gap-1.5 px-3.5 py-1.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white rounded-md text-xs font-semibold shadow-sm transition-all disabled:opacity-50 cursor-pointer"
              >
                {isExecutingAction ? <RefreshCw size={13} className="animate-spin" /> : <Play size={13} />}
                <span>Delegate Task</span>
              </button>

              {/* Button 2: Continue Current Task */}
              <button
                id="btn-continue-engineering-task"
                onClick={handleContinueTask}
                disabled={isExecutingAction || !currentActiveTaskId || !composerTaskInput.trim()}
                title={currentActiveTaskId ? `Continue existing task ${currentActiveTaskId} (preserves same task ID)` : 'Select a task to continue'}
                className="flex items-center gap-1.5 px-3.5 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-md text-xs font-semibold shadow-sm transition-all disabled:opacity-40 cursor-pointer"
              >
                <CornerDownRight size={13} />
                <span>Continue Task {currentActiveTaskId ? `(${currentActiveTaskId.slice(0, 10)})` : ''}</span>
              </button>

              {/* Button 3: Resume */}
              <button
                id="btn-resume-engineering-task"
                onClick={handleResumeTask}
                disabled={isExecutingAction || !currentActiveTaskId}
                title="Resume paused/stalled task on active worker"
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md text-xs font-medium border border-slate-700 transition-all disabled:opacity-40 cursor-pointer"
              >
                <RotateCcw size={13} className="text-cyan-400" />
                <span>Resume</span>
              </button>

              {/* Button 4: Cancel */}
              <button
                id="btn-cancel-engineering-task"
                onClick={handleCancelTask}
                disabled={isExecutingAction || !currentActiveTaskId}
                title="Cancel current engineering task"
                className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 rounded-md text-xs font-medium border border-rose-800/60 transition-all disabled:opacity-40 cursor-pointer"
              >
                <StopCircle size={13} className="text-rose-400" />
                <span>Cancel</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ── REQUIREMENT 7: Visible Worker Ownership Card ── */}
      <section data-testid="worker-ownership-card" className="mx-6 mt-3 px-5 py-3 bg-[#0a101f] border border-slate-800 rounded-xl shadow-md flex flex-wrap items-center justify-between gap-4 text-xs font-mono">
        <div className="flex items-center gap-6">
          {/* Worker Ownership */}
          <div className="flex items-center gap-2">
            <span className="text-slate-500 uppercase text-[10px]">Worker:</span>
            <span className="font-bold text-cyan-300 flex items-center gap-1.5">
              <Cpu size={14} className="text-cyan-400" />
              {activeSession?.workerId ? activeSession.workerId.toUpperCase() : 'ANTIGRAVITY'}
            </span>
          </div>

          {/* Task ID */}
          <div className="flex items-center gap-2">
            <span className="text-slate-500 uppercase text-[10px]">Task:</span>
            <span className="font-semibold text-slate-200">
              {currentActiveTaskId || 'bgtask-none'}
            </span>
          </div>

          {/* Status */}
          <div className="flex items-center gap-2">
            <span className="text-slate-500 uppercase text-[10px]">Status:</span>
            <span>{getStatusBadge(activeSession?.status || antigravityHealth?.status)}</span>
          </div>
        </div>

        {/* Last Real Event (Requirement 7: never display generic prose) */}
        <div className="flex items-center gap-2 bg-slate-950/80 px-3 py-1.5 rounded-lg border border-slate-800">
          <span className="text-slate-500 uppercase text-[10px]">Last Real Event:</span>
          <span className="font-bold text-amber-300 flex items-center gap-1.5">
            {renderEventIcon(lastRealEventCode)}
            <span>{lastRealEventCode}</span>
          </span>
        </div>
      </section>

      {/* ── Main Two-Column Telemetry & Event Stream Grid ── */}
      <div className="flex-1 p-6 grid grid-cols-1 xl:grid-cols-12 gap-5">
        
        {/* LEFT COLUMN: Active Task Telemetry, Health, Verification & Blocker (5 cols) */}
        <div className="xl:col-span-5 flex flex-col gap-5">

          {/* Card 1: Active Task Full Identity & Mapping */}
          <div className="bg-[#0b1222] border border-slate-800/90 rounded-xl p-5 shadow-lg shadow-black/40">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Layers size={16} className="text-cyan-400" />
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                  CURRENT TASK TELEMETRY
                </h2>
              </div>
              {selectedHistoricalTaskId ? (
                <button
                  onClick={returnToLiveSession}
                  className="text-[11px] px-2 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800 hover:bg-cyan-900"
                >
                  Viewing Persisted • Return to Live
                </button>
              ) : (
                <span className="text-[11px] text-slate-500 font-mono">
                  Stage: <span className="text-cyan-400 font-medium">{activeSession?.currentStage || workerInfo?.currentStage || 'idle'}</span>
                </span>
              )}
            </div>

            {activeSession ? (
              <div className="mt-4 flex flex-col gap-3 text-xs">
                {/* Objective / Title */}
                <div>
                  <span className="text-slate-500 font-mono text-[10px] uppercase block">Objective / Title</span>
                  <div className="mt-1 font-semibold text-slate-200 text-sm bg-slate-900/80 p-2.5 rounded-lg border border-slate-800/80">
                    {activeSession.title || 'Engineering Task'}
                  </div>
                </div>

                {/* Task ID & GoalRun ID */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-2.5 bg-slate-900/60 rounded-lg border border-slate-800/60">
                    <span className="text-slate-500 font-mono text-[10px] uppercase block">Task ID</span>
                    <div className="flex items-center justify-between mt-1">
                      <span className="font-mono text-slate-300 truncate max-w-[150px]">{activeSession.taskId}</span>
                      <button
                        onClick={() => copyToClipboard(activeSession.taskId, 'taskId')}
                        className="text-slate-500 hover:text-slate-300 ml-1"
                        title="Copy Task ID"
                      >
                        {copiedField === 'taskId' ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                      </button>
                    </div>
                  </div>

                  <div className="p-2.5 bg-slate-900/60 rounded-lg border border-slate-800/60">
                    <span className="text-slate-500 font-mono text-[10px] uppercase block">GoalRun ID</span>
                    <div className="flex items-center justify-between mt-1">
                      <span className="font-mono text-slate-300 truncate max-w-[150px]">
                        {activeSession.goalId || 'Direct-Handoff'}
                      </span>
                      {activeSession.goalId && (
                        <button
                          onClick={() => copyToClipboard(activeSession.goalId!, 'goalId')}
                          className="text-slate-500 hover:text-slate-300 ml-1"
                          title="Copy Goal ID"
                        >
                          {copiedField === 'goalId' ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Worker & AntiGravity Session ID */}
                <div className="p-3 bg-slate-900/90 rounded-lg border border-slate-800 space-y-2 text-[11px] font-mono">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Worker:</span>
                    <span className="text-cyan-400 font-semibold uppercase">{activeSession.workerId || 'AntiGravity'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">AntiGravity Session ID:</span>
                    <div className="flex items-center gap-1">
                      <span className="text-slate-300 font-medium truncate max-w-[180px]">
                        {activeSession.antigravityConversationId || antigravityHealth?.activeConversationId || 'None bound'}
                      </span>
                      {(activeSession.antigravityConversationId || antigravityHealth?.activeConversationId) && (
                        <button
                          onClick={() => copyToClipboard(activeSession.antigravityConversationId || antigravityHealth?.activeConversationId || '', 'convId')}
                          className="text-slate-500 hover:text-slate-300"
                          title="Copy AntiGravity Session ID"
                        >
                          {copiedField === 'convId' ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">State / Stage:</span>
                    <span className="text-slate-300">{activeSession.currentStage || activeSession.status}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Workspace Root:</span>
                    <span className="text-slate-300 truncate max-w-[200px]" title={activeSession.workspace}>{activeSession.workspace}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Started At:</span>
                    <span className="text-slate-300">{new Date(activeSession.createdAt).toLocaleTimeString()}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-4 p-8 text-center text-slate-500 text-xs bg-slate-900/40 rounded-lg border border-dashed border-slate-800">
                <Cpu size={24} className="mx-auto mb-2 text-slate-600" />
                No engineering task currently selected.
                <p className="mt-1 text-slate-400">Enter a prompt in the composer above and click "Delegate Task".</p>
              </div>
            )}
          </div>

          {/* Card 2: Current Activity, Commands & Execution Output */}
          <div className="bg-[#0b1222] border border-slate-800/90 rounded-xl p-5 shadow-lg shadow-black/40">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Terminal size={16} className="text-emerald-400" />
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                  CURRENT ACTIVITY &amp; REPAIR STATE
                </h2>
              </div>
            </div>

            <div className="mt-4 space-y-3 text-xs">
              {/* Current File */}
              <div>
                <span className="text-slate-500 font-mono text-[10px] uppercase block mb-1">Current File</span>
                <div className="flex items-center gap-2 p-2 bg-slate-900/80 rounded-md border border-slate-800 font-mono text-slate-300 text-xs">
                  <FileCode size={14} className="text-amber-400 shrink-0" />
                  <span className="truncate">{activeSession?.currentFile || workerInfo?.currentFile || 'None active'}</span>
                </div>
              </div>

              {/* Current Command */}
              <div>
                <span className="text-slate-500 font-mono text-[10px] uppercase block mb-1">Current Command</span>
                <div className="p-2 bg-black/60 rounded-md border border-slate-800 font-mono text-emerald-400 text-[11px] truncate">
                  $ {activeSession?.currentCommand || workerInfo?.currentCommand || 'No command running'}
                </div>
              </div>

              {/* Command Output */}
              <div>
                <span className="text-slate-500 font-mono text-[10px] uppercase block mb-1">Command Output / Action Output</span>
                <div className="p-2.5 bg-black/70 rounded-md border border-slate-800/80 font-mono text-slate-300 text-[11px] max-h-36 overflow-y-auto whitespace-pre-wrap">
                  {activeSession?.lastOutput || workerInfo?.lastAction || 'No command output recorded.'}
                </div>
              </div>

              {/* Telemetry Grid: Files Read, Files Changed, Tests, Build */}
              <div className="pt-2 border-t border-slate-800/80 grid grid-cols-2 gap-2 text-[11px]">
                <div className="p-2 bg-slate-900/50 rounded border border-slate-800">
                  <span className="text-slate-500 block text-[10px]">Files Read (Inspected):</span>
                  <span className="font-semibold text-slate-200">
                    {(activeSession?.filesRead || workerInfo?.filesRead || []).length} files
                  </span>
                </div>

                <div className="p-2 bg-slate-900/50 rounded border border-slate-800">
                  <span className="text-slate-500 block text-[10px]">Files Changed:</span>
                  <span className="font-semibold text-amber-400">
                    {(activeSession?.filesChanged || workerInfo?.filesChanged || []).length} files
                  </span>
                </div>

                <div className="p-2 bg-slate-900/50 rounded border border-slate-800">
                  <span className="text-slate-500 block text-[10px]">Tests Passed / Failed:</span>
                  <span className="font-semibold">
                    <span className="text-emerald-400">{activeSession?.testsPassed ?? workerInfo?.testsPassedCount ?? 0}</span>
                    <span className="text-slate-600"> / </span>
                    <span className="text-rose-400">{activeSession?.testsFailed ?? workerInfo?.testsFailedCount ?? 0}</span>
                  </span>
                </div>

                <div className="p-2 bg-slate-900/50 rounded border border-slate-800">
                  <span className="text-slate-500 block text-[10px]">Build Status:</span>
                  <span className="font-semibold uppercase text-slate-300">
                    {activeSession?.buildStatus || workerInfo?.buildStatus || 'idle'}
                  </span>
                </div>
              </div>

              {/* Verification & Blocker Telemetry Cards (Requirement 3) */}
              <div className="pt-2 border-t border-slate-800/80 space-y-2">
                {/* Verification */}
                <div className="p-2.5 bg-slate-900/60 rounded-lg border border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <ShieldCheck size={14} className="text-cyan-400" />
                    <span className="text-[11px] font-semibold text-slate-300">Verification:</span>
                  </div>
                  <span className="text-[11px] font-mono font-semibold text-emerald-400">
                    {activeSession?.metadata?.verificationState || activeSession?.buildStatus === 'passed' ? 'PASSED / ARGUS CERTIFIED' : (activeSession?.status === 'COMPLETED' ? 'COMPLETED' : 'IN_PROGRESS')}
                  </span>
                </div>

                {/* Blocker Alert (Requirement 3 & 5) */}
                {activeSession?.metadata?.blocker || (activeSession?.errors && activeSession.errors.length > 0) ? (
                  <div className="p-2.5 bg-rose-950/40 border border-rose-800 rounded-lg text-rose-300 text-xs space-y-1">
                    <div className="flex items-center gap-1.5 font-bold">
                      <AlertTriangle size={13} className="text-rose-400" />
                      <span>Active Blocker:</span>
                    </div>
                    <div className="font-mono text-[11px] text-rose-200">
                      {activeSession?.metadata?.blocker || activeSession?.errors?.[0] || 'Unresolved execution blocker.'}
                    </div>
                  </div>
                ) : (
                  <div className="p-2 bg-slate-900/40 rounded border border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400 font-mono">
                    <span className="flex items-center gap-1.5">
                      <CheckCircle2 size={12} className="text-emerald-400" />
                      <span>Blocker State:</span>
                    </span>
                    <span className="text-emerald-400">None (Unobstructed)</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Card 3: Durable Task History (Requirement 8: Survives Restart) */}
          <div className="bg-[#0b1222] border border-slate-800/90 rounded-xl p-5 shadow-lg shadow-black/40">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Database size={16} className="text-cyan-400" />
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                  DURABLE TASK HISTORY (SQLITE)
                </h2>
              </div>
              <span className="text-[10px] text-cyan-400 bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-800/50">
                Survives App Restart
              </span>
            </div>

            <div className="mt-3 text-xs text-slate-400">
              AgenticOS persists full task history, session mappings, and event logs into durable SQLite tables.
            </div>

            <div className="mt-3 max-h-52 overflow-y-auto space-y-2">
              {sessions.length === 0 ? (
                <div className="p-4 text-center text-slate-600 text-xs">
                  No persisted sessions recorded yet.
                </div>
              ) : (
                sessions.map((sess) => {
                  const isSelected = currentActiveTaskId === sess.taskId;
                  return (
                    <div
                      key={sess.taskId}
                      onClick={() => loadHistoricalSession(sess.taskId)}
                      className={`p-2.5 rounded-lg border cursor-pointer transition-all ${
                        isSelected
                          ? 'bg-cyan-950/40 border-cyan-500/50 shadow-sm'
                          : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-200 truncate max-w-[190px]">
                          {sess.title || sess.taskId}
                        </span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                          sess.status === 'COMPLETED' ? 'bg-emerald-950 text-emerald-400' :
                          sess.status === 'BUSY' ? 'bg-cyan-950 text-cyan-400' :
                          sess.status === 'DISCONNECTED' ? 'bg-rose-950 text-rose-400' :
                          'bg-slate-800 text-slate-400'
                        }`}>
                          {sess.status}
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-1 text-[10px] text-slate-500 font-mono">
                        <span>ID: {sess.taskId.slice(0, 14)}…</span>
                        <span>{new Date(sess.createdAt).toLocaleTimeString()}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Card 4: Voice & Speech Runtime Inspector (Authoritative Telemetry) */}
          <div className="bg-[#0b1222] border border-slate-800/90 rounded-xl p-5 shadow-lg shadow-black/40">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Volume2 size={16} className="text-violet-400" />
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                  VOICE &amp; SPEECH RUNTIME INSPECTOR
                </h2>
              </div>
              <span className={`text-[10px] px-2 py-0.5 rounded font-mono border ${
                voiceRuntimeState?.playbackState === 'speaking'
                  ? 'bg-emerald-950 text-emerald-400 border-emerald-800 animate-pulse'
                  : voiceRuntimeState?.playbackState === 'synthesizing'
                  ? 'bg-amber-950 text-amber-400 border-amber-800 animate-pulse'
                  : 'bg-slate-900 text-slate-400 border-slate-800'
              }`}>
                {voiceRuntimeState?.playbackState ? voiceRuntimeState.playbackState.toUpperCase() : 'IDLE'}
              </span>
            </div>

            <div className="mt-3 space-y-2.5 text-xs">
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="p-2 bg-slate-900/60 rounded border border-slate-800">
                  <span className="text-slate-500 block text-[10px]">Active TTS Provider</span>
                  <span className="font-semibold text-violet-400 font-mono">
                    {voiceRuntimeState?.activeTtsProvider || 'voicestudio'}
                  </span>
                </div>
                <div className="p-2 bg-slate-900/60 rounded border border-slate-800">
                  <span className="text-slate-500 block text-[10px]">Active STT Provider</span>
                  <span className="font-semibold text-cyan-400 font-mono">
                    {voiceRuntimeState?.activeSttProvider || 'voicestudio'}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="p-2 bg-slate-900/60 rounded border border-slate-800">
                  <span className="text-slate-500 block text-[10px]">Active Voice</span>
                  <span className="font-semibold text-slate-200 font-mono truncate block" title={voiceRuntimeState?.activeVoice}>
                    {voiceRuntimeState?.activeVoice || 'aura-zeus-en'}
                  </span>
                </div>
                <div className="p-2 bg-slate-900/60 rounded border border-slate-800">
                  <span className="text-slate-500 block text-[10px]">Speech-End → Audio</span>
                  <span className="font-semibold text-emerald-400 font-mono">
                    {voiceRuntimeState?.speechEndToFirstAudioMs ? `${voiceRuntimeState.speechEndToFirstAudioMs} ms` : '—'}
                  </span>
                </div>
              </div>

              <div className="p-2 bg-slate-900/50 rounded border border-slate-800 flex items-center justify-between text-[11px]">
                <span className="text-slate-500">VoiceStudio Health</span>
                <span className={`font-mono font-semibold ${
                  voiceRuntimeState?.voiceStudioHealth?.healthy ? 'text-emerald-400' : 'text-amber-400'
                }`}>
                  {voiceRuntimeState?.voiceStudioHealth?.healthy ? 'HEALTHY (127.0.0.1:3900)' : 'UNAVAILABLE / STANDBY'}
                </span>
              </div>

              <div className="p-2 bg-slate-900/50 rounded border border-slate-800 flex items-center justify-between text-[11px]">
                <span className="text-slate-500">Fallback Status</span>
                <span className={`font-mono text-[10px] ${
                  voiceRuntimeState?.fallbackStatus?.isFallback ? 'text-amber-400' : 'text-emerald-400'
                }`}>
                  {voiceRuntimeState?.fallbackStatus?.isFallback
                    ? (voiceRuntimeState?.fallbackStatus?.fallbackReason || 'Deepgram Fallback Active')
                    : 'Primary Active (Zero Fallback)'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Chronological Live Event Stream (7 cols) */}
        <div className="xl:col-span-7 flex flex-col bg-[#0b1222] border border-slate-800/90 rounded-xl shadow-lg shadow-black/40 overflow-hidden">
          
          {/* Stream Header & Filters */}
          <div className="p-4 bg-[#0e1628] border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <History size={16} className="text-cyan-400" />
                <h2 className="text-xs font-bold uppercase tracking-wider text-white">
                  CHRONOLOGICAL LIVE EVENT STREAM
                </h2>
                <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                  {filteredEvents.length} events
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Real machine events emitted by AntiGravity worker &amp; transcripts
              </p>
            </div>

            {/* Filter Chips */}
            <div className="flex items-center gap-1">
              {['all', 'files', 'commands', 'tests', 'build', 'lifecycle'].map((f) => (
                <button
                  key={f}
                  onClick={() => setEventFilter(f)}
                  className={`px-2 py-1 rounded text-[11px] font-medium capitalize transition-all ${
                    eventFilter === f
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                      : 'text-slate-400 hover:text-slate-200 border border-transparent'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {/* Stream Body */}
          <div className="flex-1 p-4 overflow-y-auto max-h-[780px] space-y-3 font-mono text-xs">
            {filteredEvents.length === 0 ? (
              <div className="py-28 text-center text-slate-600">
                <Activity size={32} className="mx-auto mb-3 text-slate-700 animate-pulse" />
                <p className="text-sm font-semibold">Awaiting worker execution events...</p>
                <p className="text-xs text-slate-500 mt-1">Events will appear live as AntiGravity executes commands and inspects files.</p>
              </div>
            ) : (
              filteredEvents.map((ev, idx) => {
                const eventType = ev.eventType || ev.type || 'EVENT';
                const eventSummary = ev.summary || ev.metadata?.message || (ev.command ? `Run: ${ev.command}` : (ev.file ? `Target: ${ev.file}` : eventType));
                return (
                  <div
                    key={ev.id || idx}
                    className="p-3 bg-slate-900/80 rounded-lg border border-slate-800/80 hover:border-slate-700/90 transition-all flex flex-col gap-1.5"
                  >
                    <div className="flex items-center justify-between text-[11px]">
                      <div className="flex items-center gap-2">
                        {renderEventIcon(eventType)}
                        <span className="font-bold text-slate-200">{eventType}</span>
                        <span className="text-[10px] text-slate-500 uppercase px-1.5 py-0.2 bg-slate-800 rounded">
                          {ev.workerId}
                        </span>
                      </div>
                      <span className="text-slate-500 text-[10px]">
                        {ev.timestamp ? new Date(ev.timestamp).toLocaleTimeString() : ''}
                      </span>
                    </div>

                    {/* Summary */}
                    <div className="text-slate-300 font-sans text-xs">
                      {eventSummary}
                    </div>

                    {/* Optional File metadata */}
                    {ev.file && (
                      <div className="flex items-center gap-1.5 text-[11px] text-amber-300/90 bg-amber-950/20 px-2 py-1 rounded border border-amber-900/30">
                        <FileCode size={12} />
                        <span className="truncate">{ev.file}</span>
                      </div>
                    )}

                    {/* Optional Command */}
                    {ev.command && (
                      <div className="p-2 bg-black/70 rounded text-[11px] text-emerald-400 font-mono border border-slate-800/80 overflow-x-auto">
                        $ {ev.command}
                      </div>
                    )}

                    {/* Optional Output */}
                    {ev.output && (
                      <div className="p-2 bg-black/50 rounded text-[10px] text-slate-400 font-mono border border-slate-800/50 max-h-36 overflow-y-auto whitespace-pre-wrap">
                        {ev.output}
                      </div>
                    )}
                  </div>
                );
              })
            )}
            <div ref={eventStreamEndRef} />
          </div>

          {/* Stream Footer with Auto-Scroll toggle */}
          <div className="p-3 bg-[#0a0f1d] border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
            <span className="text-[11px]">
              Chronological log ordered from AntiGravity transcript ingestion.
            </span>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
                className="rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-0"
              />
              <span>Auto-scroll</span>
            </label>
          </div>
        </div>

      </div>
    </div>
  );
};

export default EngineeringWorkspacePage;
