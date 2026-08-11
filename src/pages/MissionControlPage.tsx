// @ts-nocheck
import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, FolderOpen, CheckCircle, XCircle, Clock, Play, Pause, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../store/dataStore';
import { useProjects } from '../store/projectStore';
import { JarvisOrb } from '../components/jarvis/JarvisOrb';
import { JarvisConversationPanel } from '../components/jarvis/JarvisConversationPanel';
import { deriveJarvisOrbState, JARVIS_ORB_EVENTS } from '../components/jarvis/jarvisOrbState';
import { apiFetch } from '../api/client';

function cleanError(message?: string | null) {
  if (!message) return 'No details available.';
  const firstLine = String(message).split('\n')[0];
  return firstLine.replace(/\s+at\s+.*/i, '').slice(0, 180);
}

/** Map the backend's /api/jarvis/runtime-state `state` field to the
 *  JarvisRuntimeState type that deriveJarvisOrbState() consumes.
 *  This is the canonical bridge so the orb reflects real AgenticOS state. */
function backendStateToRuntimeState(s: string): any {
  switch (s) {
    case 'reasoning':  return 'thinking';      // → reasoning visual (cyan/white)
    case 'executing':  return 'executing';     // → executing visual (strong cyan)
    case 'delegated':  return 'delegating';    // → delegated visual (pink)
    case 'completed':  return 'completed';     // → completed visual (green)
    case 'error':      return 'error';         // → error visual (red)
    case 'warning':    return 'approval_required'; // → warning visual (yellow)
    case 'repairing':  return 'reviewing';     // → repairing visual (purple)
    default:           return 'idle';
  }
}

const TASK_STATUS_COLOR: Record<string, string> = {
  queued: '#64748b',
  planning: '#f5b50a',
  running: '#00d4ff',
  waiting_approval: '#f59e0b',
  paused: '#64748b',
  review: '#a855f7',
  completed: '#22c55e',
  blocked: '#f59e0b',
  failed: '#ef4444',
  cancelled: '#374151',
};

function TaskStatusIcon({ status }: { status: string }) {
  if (status === 'completed') return <CheckCircle size={11} style={{ color: '#22c55e' }} />;
  if (status === 'failed') return <XCircle size={11} style={{ color: '#ef4444' }} />;
  if (status === 'running') return <Play size={11} style={{ color: '#00d4ff' }} />;
  if (status === 'paused') return <Pause size={11} style={{ color: '#64748b' }} />;
  return <Clock size={11} style={{ color: '#64748b' }} />;
}

const MissionControlPage: React.FC = () => {
  const { isLoading, error, refresh } = useData();
  const { activeProject, projects } = useProjects();
  const navigate = useNavigate();

  // ── GLOBAL operations: cross-project visibility (Phase 9) ─────────────
  // Mission Control is global ops; Projects is project-specific ops.
  const [globalTasks, setGlobalTasks] = useState<any[]>([]);
  const [approvals, setApprovals] = useState<any[]>([]);
  const [globalLoading, setGlobalLoading] = useState(true);

  const pollGlobal = useCallback(async () => {
    try {
      const [tasksRes, apprRes] = await Promise.all([
        apiFetch('/api/background-tasks?limit=100'),
        apiFetch('/api/background-tasks/approvals'),
      ]);
      if (tasksRes.ok) { const d = await tasksRes.json(); if (Array.isArray(d)) setGlobalTasks(d); }
      if (apprRes.ok) { const d = await apprRes.json(); if (Array.isArray(d)) setApprovals(d); }
    } catch { /* best effort */ }
    setGlobalLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      await pollGlobal();
    };
    void tick();
    const id = window.setInterval(tick, 5000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [pollGlobal]);

  const projectName = (id?: string | null): string | null => {
    if (!id) return null;
    return projects.find((p) => p.id === id)?.name ?? null;
  };
  const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
  const activeTasks = globalTasks.filter((t) => !TERMINAL.has(t.status));
  const runningWork = activeTasks.filter((t) => t.status === 'running' || t.status === 'planning');
  const blockedWork = activeTasks.filter((t) => ['blocked', 'waiting_approval', 'paused'].includes(t.status));
  const queuedWork = activeTasks.filter((t) => t.status === 'queued');
  const failures = globalTasks.filter((t) => t.status === 'failed');
  const approvalTasks = approvals
    .map((a) => globalTasks.find((t) => t.taskId === a.taskId))
    .filter(Boolean) as any[];
  const activeProjectIds = new Set(activeTasks.map((t) => t.projectId).filter(Boolean));
  const activeProjects = projects.filter((p) => activeProjectIds.has(p.id));
  const delegatedAgents = [...new Set(activeTasks.map((t) => t.worker).filter(Boolean))];

  const openTask = (t: any) => {
    if (!t.projectId) return;
    navigate(`/projects?project=${encodeURIComponent(t.projectId)}&task=${encodeURIComponent(t.taskId)}`);
  };
  const openProject = (id: string) => navigate(`/projects?project=${encodeURIComponent(id)}`);
  const resolveApproval = async (taskId: string, choice: 'allow' | 'deny') => {
    try {
      await apiFetch(`/api/background-tasks/${taskId}/approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ choice }),
      });
    } catch { /* best effort */ }
  };

  // ── Jarvis orb wiring (real signals only) ────────────────────────────────
  const [playbackActive, setPlaybackActive] = useState(false);
  const [inputLevel, setInputLevel] = useState(0);
  const [outputLevel, setOutputLevel] = useState(0);
  const [backendOffline, setBackendOffline] = useState(false);
  const [micState, setMicState] = useState('idle');

  // ── REAL runtime state from backend (not coarse run filtering) ───────────
  const [backendRuntimeData, setBackendRuntimeData] = useState<any>({
    state: 'idle', activeAgent: null, activeProject: null,
    activeTask: null, pendingTaskCount: 0, projectTasks: [],
  });

  useEffect(() => {
    const onPlaybackStarted = () => setPlaybackActive(true);
    const onPlaybackEnded = () => setPlaybackActive(false);
    window.addEventListener(JARVIS_ORB_EVENTS.playbackStarted, onPlaybackStarted);
    window.addEventListener(JARVIS_ORB_EVENTS.playbackEnded, onPlaybackEnded);
    return () => {
      window.removeEventListener(JARVIS_ORB_EVENTS.playbackStarted, onPlaybackStarted);
      window.removeEventListener(JARVIS_ORB_EVENTS.playbackEnded, onPlaybackEnded);
    };
  }, []);

  useEffect(() => {
    const onInput = (e: any) => setInputLevel(e.detail?.level ?? 0);
    const onOutput = (e: any) => setOutputLevel(e.detail?.level ?? 0);
    window.addEventListener(JARVIS_ORB_EVENTS.inputLevel, onInput);
    window.addEventListener(JARVIS_ORB_EVENTS.outputLevel, onOutput);
    return () => {
      window.removeEventListener(JARVIS_ORB_EVENTS.inputLevel, onInput);
      window.removeEventListener(JARVIS_ORB_EVENTS.outputLevel, onOutput);
    };
  }, []);

  useEffect(() => {
    const onVoiceState = (e: any) => {
      const next = typeof e.detail === 'string' ? e.detail : 'idle';
      setMicState(next);
    };
    window.addEventListener(JARVIS_ORB_EVENTS.voiceState, onVoiceState);
    return () => window.removeEventListener(JARVIS_ORB_EVENTS.voiceState, onVoiceState);
  }, []);

  // Health probe (30s cadence)
  useEffect(() => {
    if (typeof fetch !== 'function') return;
    let cancelled = false;
    const checkHealth = async () => {
      try {
        const res = await apiFetch('/api/health/gateway');
        if (!res.ok) { if (!cancelled) setBackendOffline(true); return; }
        const data = await res.json();
        if (!cancelled) setBackendOffline(data?.status === 'offline');
      } catch { if (!cancelled) setBackendOffline(true); }
    };
    checkHealth();
    const id = window.setInterval(checkHealth, 30_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  // ── Poll /api/jarvis/runtime-state every 3s for real orb driving ─────────
  // This replaces the coarse "is any jarvis run active?" check.
  // The backend state field maps precisely to JarvisRuntimeState values,
  // which then flow through deriveJarvisOrbState() to produce the correct
  // semantic visual state (reasoning/executing/delegated/etc).
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await apiFetch('/api/jarvis/runtime-state');
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) setBackendRuntimeData(data);
      } catch { /* best effort — keep last known state */ }
    };
    poll();
    const id = window.setInterval(poll, 3000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  // Derive the orb's visual state from real backend state.
  // backendStateToRuntimeState() converts backend enum → JarvisRuntimeState.
  // deriveJarvisOrbState() applies mic/playback precedence then maps to visual.
  const runtimeState: any = backendStateToRuntimeState(backendRuntimeData.state);
  const orbState = deriveJarvisOrbState({ micState, playbackActive, runtimeState, backendOffline });

  // Project-aware tasks: use projectTasks from runtime-state (backend scoped)
  // or fall back to the active project from the project store.
  const projectTasks: any[] = backendRuntimeData.projectTasks || [];
  const displayProject = backendRuntimeData.activeProject || (activeProject ? { id: activeProject.id, name: activeProject.name } : null);

  if (isLoading) return null;

  return (
    <div className="h-full overflow-auto bg-[#0a0f16] text-slate-100" data-testid="mission-control-cockpit">
      <div className="mx-auto flex max-w-7xl flex-col gap-5 px-6 py-6">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800 pb-5">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-cyan-400">Workspace</div>
            <h1 className="mt-1 text-2xl font-semibold">Mission Control</h1>
            <p className="mt-1 text-sm text-slate-500">Talk to Jarvis — by voice or text. Everything else stays out of the way.</p>
          </div>
          <div className="flex items-center gap-3">
            {displayProject && (
              <div
                data-testid="mission-active-project-badge"
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: 'rgba(8,145,178,0.1)', border: '1px solid rgba(8,145,178,0.35)',
                  borderRadius: 6, padding: '5px 10px', fontSize: 11, fontWeight: 600,
                  color: '#67e8f9',
                }}
              >
                <FolderOpen size={12} style={{ color: '#0891b2' }} />
                {displayProject.name}
              </div>
            )}
            <button
              type="button"
              onClick={refresh}
              className="rounded border border-slate-700 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800"
            >
              Retry
            </button>
          </div>
        </header>

        {error && (
          <div className="rounded-md border border-rose-500/40 bg-rose-500/10 p-4" data-testid="mission-error-card">
            <div className="flex items-center gap-2 text-sm font-semibold text-rose-200">
              <AlertTriangle size={16} /> Backend unavailable
            </div>
            <p className="mt-2 text-sm text-rose-100">{cleanError(error)}</p>
            <div className="mt-3 flex gap-2">
              <button onClick={refresh} className="rounded border border-rose-400/50 px-3 py-1.5 text-xs text-rose-100">Retry</button>
              <button type="button" className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-400">Open diagnostics</button>
            </div>
          </div>
        )}

        {/* ── JARVIS MAIN FOCUS: orb + conversation ── */}
        <section
          className="rounded-md border border-slate-800 bg-slate-950/60 p-5"
          data-testid="mission-jarvis-orb"
        >
          <div className="flex flex-col items-start gap-6 lg:flex-row">
            <div className="flex shrink-0 flex-col items-center gap-3" style={{ width: 220 }}>
              <div style={{ width: 200, height: 236 }}>
                <JarvisOrb state={orbState} inputLevel={inputLevel} outputLevel={outputLevel} size={180} />
              </div>
              <div className="text-center">
                <div className="text-[11px] font-bold uppercase tracking-widest text-cyan-400">Jarvis</div>
                <div data-testid="mission-orb-state-label" className="mt-0.5 text-xs font-semibold text-slate-300">
                  {orbState.charAt(0).toUpperCase() + orbState.slice(1)}
                </div>
                {backendRuntimeData.activeAgent && (
                  <div style={{ fontSize: 10, color: '#ec4899', marginTop: 2, fontWeight: 600 }}>
                    via {backendRuntimeData.activeAgent}
                  </div>
                )}
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <JarvisConversationPanel backendOffline={backendOffline} />
            </div>
          </div>
        </section>

        {/* ── PROJECT-AWARE MISSION CONTROL: tasks for the active project ── */}
        {displayProject && (
          <section
            className="rounded-md border border-slate-800 bg-slate-950/40 p-4"
            data-testid="mission-project-tasks"
          >
            <div className="mb-3 flex items-center gap-2">
              <FolderOpen size={13} style={{ color: '#0891b2' }} />
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: '#67e8f9' }}>
                {displayProject.name.toUpperCase()} — ACTIVE WORK
              </span>
              {backendRuntimeData.pendingTaskCount > 0 && (
                <span style={{
                  marginLeft: 4, fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 8,
                  background: 'rgba(0,212,255,0.15)', color: '#67e8f9',
                }}>
                  {backendRuntimeData.pendingTaskCount} ACTIVE
                </span>
              )}
            </div>
            {projectTasks.length === 0 ? (
              <div style={{ fontSize: 11, color: '#475569' }}>No tasks for this project yet. Ask Jarvis to start work.</div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {projectTasks.map((t: any) => (
                  <div
                    key={t.taskId}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 8,
                      padding: '6px 8px', borderRadius: 5,
                      background: 'rgba(15,23,42,0.7)',
                      border: `1px solid ${TASK_STATUS_COLOR[t.status] || '#1e293b'}22`,
                    }}
                  >
                    <TaskStatusIcon status={t.status} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t.title}
                      </div>
                      <div style={{ fontSize: 10, color: '#64748b', marginTop: 1, display: 'flex', gap: 8 }}>
                        <span style={{ color: TASK_STATUS_COLOR[t.status] || '#64748b', fontWeight: 600 }}>
                          {t.status}
                        </span>
                        <span>{t.worker}</span>
                        {t.progressMessage && (
                          <span style={{ color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
                            {t.progressMessage}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ── GLOBAL OPERATIONS: cross-project visibility ── */}
        <section
          className="rounded-md border border-slate-800 bg-slate-950/40 p-4"
          data-testid="mission-global-operations"
        >
          <div className="mb-3 flex items-center gap-2">
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: '#67e8f9' }}>
              GLOBAL OPERATIONS
            </span>
            <span style={{ fontSize: 10, color: '#475569' }}>across all projects</span>
            {globalLoading && <span style={{ fontSize: 10, color: '#475569' }}>loading…</span>}
          </div>

          {!globalLoading && (
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
              {/* Active projects */}
              <div style={{ border: '1px solid #1e293b', borderRadius: 8, padding: '10px 12px', background: 'rgba(15,23,42,0.6)' }} data-testid="mission-active-projects">
                <div style={{ fontSize: 10, fontWeight: 700, color: '#0891b2', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                  Active Projects ({activeProjects.length})
                </div>
                {activeProjects.length === 0 && <div style={{ fontSize: 11, color: '#334155' }}>No project has active work.</div>}
                {activeProjects.map((p) => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', fontSize: 11 }}>
                    <FolderOpen size={11} style={{ color: '#0891b2', flex: '0 0 auto' }} />
                    <span style={{ color: '#cbd5e1', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                    <button type="button" data-testid={`mission-open-project-${p.id}`} onClick={() => openProject(p.id)} title="Open project workspace" style={linkBtn('#67e8f9')}>
                      OPEN <ExternalLink size={9} />
                    </button>
                  </div>
                ))}
              </div>

              {/* Delegated agents */}
              <div style={{ border: '1px solid #1e293b', borderRadius: 8, padding: '10px 12px', background: 'rgba(15,23,42,0.6)' }} data-testid="mission-delegated-agents">
                <div style={{ fontSize: 10, fontWeight: 700, color: '#ec4899', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                  Delegated Agents ({delegatedAgents.length})
                </div>
                {delegatedAgents.length === 0 && <div style={{ fontSize: 11, color: '#334155' }}>No agents currently delegated.</div>}
                {delegatedAgents.map((w) => {
                  const t = activeTasks.find((x) => x.worker === w);
                  return (
                    <div key={w} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', fontSize: 11 }}>
                      <Play size={10} style={{ color: '#ec4899', flex: '0 0 auto' }} />
                      <span style={{ color: '#e2e8f0', fontWeight: 600, flex: '0 0 auto' }}>{w}</span>
                      {t && <span style={{ color: '#64748b', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>· {t.title?.slice(0, 32)}</span>}
                      {t && t.projectId && <button type="button" data-testid={`mission-agent-open-${w}`} onClick={() => openTask(t)} title="Open task" style={linkBtn('#67e8f9')}>OPEN</button>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Task-state rows */}
          {!globalLoading && (
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', marginTop: 10 }}>
              {[
                { key: 'running', label: 'Running Work', color: '#00d4ff', rows: runningWork },
                { key: 'blocked', label: 'Blocked / Approval', color: '#f59e0b', rows: [...blockedWork, ...approvalTasks] },
                { key: 'approvals', label: 'Approval Required', color: '#f59e0b', rows: approvalTasks, approvalsMode: true },
                { key: 'failures', label: 'Failures', color: '#ef4444', rows: failures },
                { key: 'queued', label: 'Queued Work', color: '#64748b', rows: queuedWork },
              ].map((group) => (
                <div key={group.key} style={{ border: '1px solid #1e293b', borderRadius: 8, padding: '10px 12px', background: 'rgba(15,23,42,0.6)' }} data-testid={`mission-group-${group.key}`}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: group.color, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                    {group.label} ({group.rows.length})
                  </div>
                  {group.rows.length === 0 && <div style={{ fontSize: 11, color: '#334155' }}>None.</div>}
                  {group.rows.slice(0, 6).map((t: any) => {
                    const proj = projectName(t.projectId);
                    return (
                      <div key={`${group.key}-${t.taskId}`} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: '4px 0', fontSize: 11, borderBottom: '1px solid rgba(30,58,95,0.25)' }}>
                        <TaskStatusIcon status={t.status} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ color: '#cbd5e1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title || t.taskId}</div>
                          <div style={{ fontSize: 10, color: '#64748b' }}>
                            <span style={{ color: group.color, fontWeight: 600 }}>{t.status}</span>
                            {proj ? <span> · {proj}</span> : null}
                            {t.worker ? <span> · {t.worker}</span> : null}
                            {t.lastError ? <span style={{ color: '#f87171' }}> · {String(t.lastError).slice(0, 40)}</span> : null}
                          </div>
                        </div>
                        {group.approvalsMode ? (
                          <div style={{ display: 'flex', gap: 4, flex: '0 0 auto' }}>
                            <button type="button" data-testid={`mission-approve-${t.taskId}`} onClick={() => void resolveApproval(t.taskId, 'allow').then(() => void pollGlobal())} style={{ background: '#14532d', color: '#86efac', border: '1px solid #166534', borderRadius: 5, padding: '2px 7px', fontSize: 9, fontWeight: 700, cursor: 'pointer' }}>ALLOW</button>
                            <button type="button" data-testid={`mission-deny-${t.taskId}`} onClick={() => void resolveApproval(t.taskId, 'deny').then(() => void pollGlobal())} style={{ background: '#450a0a', color: '#fca5a5', border: '1px solid #7f1d1d', borderRadius: 5, padding: '2px 7px', fontSize: 9, fontWeight: 700, cursor: 'pointer' }}>DENY</button>
                          </div>
                        ) : (
                          t.projectId && (
                            <button type="button" data-testid={`mission-open-task-${t.taskId}`} onClick={() => openTask(t)} title="Open in project workspace" style={linkBtn('#67e8f9')}>
                              OPEN <ExternalLink size={9} />
                            </button>
                          )
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

const linkBtn = (color: string): React.CSSProperties => ({
  display: 'flex', alignItems: 'center', gap: 3, flex: '0 0 auto',
  background: 'transparent', color, border: `1px solid ${color}44`, borderRadius: 5,
  padding: '1px 6px', fontSize: 9, fontWeight: 700, cursor: 'pointer',
});

export default MissionControlPage;
