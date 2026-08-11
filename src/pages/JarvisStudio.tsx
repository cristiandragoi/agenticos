import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { JarvisChat } from '../components/jarvis/JarvisChat';
import type { JarvisChatHandle, JarvisRuntimeStatus, JarvisRuntimeState } from '../components/jarvis/JarvisChat';
import { JarvisWorkspaceBar } from '../components/jarvis/JarvisWorkspaceBar';
import { JARVIS_ORB_LABELS } from '../components/jarvis/JarvisOrb';
import { JarvisCore } from '../components/jarvis/JarvisCore';
import type { JarvisCoreState } from '../components/jarvis/JarvisCore';
import { deriveJarvisOrbState, JARVIS_ORB_EVENTS } from '../components/jarvis/jarvisOrbState';
import type { MicState } from '../components/jarvis/JarvisComposer';
import { JarvisComposer } from '../components/jarvis/JarvisComposer';
import { ExecutionBar } from '../components/jarvis/ExecutionBar';
import { pickActiveTask, TASK_TERMINAL_STATUS } from '../utils/taskSelection';
import { apiUrl, apiFetch, API_BASE } from '../api/client';

import { uiDiagnostics } from '../diagnostics/uiSnapshot';
import { useBackendLifecycle } from '../diagnostics/useBackendLifecycle';
import { backendLifecycleStore } from '../diagnostics/backendLifecycleStore';
import { executionStore, startExecutionStream, completionNotifiedAt } from '../diagnostics/executionStore';
import type { ExecutionRecord, CompletionEvent } from '../diagnostics/executionStore';
import { CompletionCard } from '../components/jarvis/CompletionCard';
import { AgentRuntimeSelector } from '../components/agents/AgentRuntimeSelector';
import VoiceTracePanel from '../components/jarvis/VoiceTracePanel';
import { useVoiceIO } from '../hooks/useVoiceIO';
import styles from './JarvisStudio.module.css';
import cc from './JarvisCommandCenter.module.css';

/* ── Canonical /jarvis page — J.A.R.V.I.S COMMAND CENTER ─────────────────
 * Visual replacement cycle: full-viewport command-center presentation.
 * The CONTROLLER is unchanged — one useVoiceIO instance remains the single
 * microphone owner, VAD engine, transcription path, conversation state,
 * auto-submit path, TTS owner, playback lifecycle and orb-state source.
 *   - JarvisChat renders the transcript (command-line variant) and owns the
 *     response stream; voice turns auto-submit via its imperative handle
 *   - progressive sequential TTS (chunked, never overlapping) + kill switch
 *   - Hermes live-run panel + approval modal driven by real adapter events
 * No second voice pipeline, no second backend, no new route.
 */

const MODE_KEY = 'jarvis-canonical-mode';

/* ── Background-task panel helpers ── */
function statusColor(status: string): string {
  switch (status) {
    case 'running': case 'planning': return '#38bdf8';
    case 'queued': return '#94a3b8';
    case 'waiting_approval': return '#fbbf24';
    case 'paused': return '#a78bfa';
    case 'review': return '#facc15';
    case 'completed': return '#86efac';
    case 'blocked': case 'failed': return '#fca5a5';
    case 'cancelled': return '#64748b';
    default: return '#94a3b8';
  }
}
function elapsedLabel(task: { startedAt: string | null; completedAt: string | null }): string {
  if (!task.startedAt) return '—';
  const start = new Date(task.startedAt).getTime();
  const end = task.completedAt ? new Date(task.completedAt).getTime() : Date.now();
  const s = Math.max(0, Math.floor((end - start) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
const VOICE_KEY = 'jarvis-canonical-voice';
const ACTIVE_CONV_KEY = 'jarvis-active-conversation';

export const JARVIS_VOICES = [
  { id: 'aura-helios-en', label: 'Helios · British English' },
  { id: 'aura-zeus-en', label: 'Zeus · American English' },
  { id: 'aura-athena-en', label: 'Athena · American English' },
  { id: 'aura-orion-en', label: 'Orion · American English (natural)' },
];

function readPersistedMode(): 'manual' | 'conversation' {
  try {
    return sessionStorage.getItem(MODE_KEY) === 'conversation' ? 'conversation' : 'manual';
  } catch { return 'manual'; }
}
function readPersistedVoice(): string {
  try {
    const v = sessionStorage.getItem(VOICE_KEY);
    return v && JARVIS_VOICES.some((x) => x.id === v) ? v : JARVIS_VOICES[0].id;
  } catch { return JARVIS_VOICES[0].id; }
}

/* ── Hermes live-run types (adapter contract: /api/hermes-api) ── */
interface HermesEvent { id: string; kind: string; summary: string; ts: number; }
interface HermesRun {
  id: string; hermesRunId: string; cardId: string | null; prompt: string;
  status: string; provider: string; model: string;
  events: HermesEvent[]; finalText: string;
  pendingApproval: { action?: string; reason?: string; command?: string; files?: string[]; choices?: string[] } | null;
  updatedAt: number;
}
interface HermesStatus {
  profile: string; url: string;
  gateway: { reachable: boolean; detail: string };
  stt: { configured: boolean; provider: string };
  tts: { configured: boolean; provider: string };
}
/* ── Background Task contract (mirrors server/src/services/backgroundTasks/types.ts) ── */
interface BackgroundTask {
  taskId: string; title: string; objective: string;
  route: string; selectedAgent: string; status: string;
  worker: string; priority: string;
  createdAt: string; startedAt: string | null; updatedAt: string; completedAt: string | null;
  linkedRunId: string | null; linkedBoardCardId: string | null;
  currentStage: string; progressMessage: string;
  filesChanged: string[]; buildState: string; testState: string;
  verificationState: string; approvalState: string;
  blocker: string | null; lastError: string | null; resumable: boolean;
}
interface BackgroundTaskSummary {
  active: number; queued: number; waitingApproval: number; failedOrBlocked: number;
  tasks: BackgroundTask[];
}
interface BackgroundTaskEvent {
  id: string; taskId: string; ts: string; kind: string; summary: string; sequence: number;
}
/* Real host telemetry (GET /api/health/system) — null = unreadable → "—". */
interface SystemStats {
  host: string | null; cpuLoadPct: number | null;
  ramUsedMb: number | null; ramTotalMb: number | null; gpu: string | null;
}

const chip: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap',
};
const dot = (on: boolean) => (
  <span style={{ width: 7, height: 7, borderRadius: '50%', background: on ? '#4ade80' : '#64748b', display: 'inline-block' }} />
);

export default function JarvisStudio() {
  const navigate = useNavigate();
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [composerText, setComposerText] = useState('');
  // Separate voice-interim transcript state (§9): STT that cannot enter the
  // composer (manual ownership) is surfaced as a preview — never a mutable
  // shared string with typed input.
  const [voiceInterimTranscript, setVoiceInterimTranscript] = useState('');
  const chatRef = useRef<JarvisChatHandle | null>(null);

  // ── Input ownership (§9 input-ownership milestone) ──
  // Manual keyboard input OWNS the composer. When the user types/pastes/edits,
  // the voice engine is told (notifyManualEdit) so any in-flight STT event is
  // dropped by generation identity. A transcript may only write the composer
  // when the user has NOT edited since the voice capture began. The mic-off
  // state is also pushed to the engine so a late STT event after the user
  // turned the mic off is ignored at the source.
  const manualEditSinceVoiceRef = useRef(false);
  const handleComposerTextChange = useCallback((text: string) => {
    setComposerText(text);
    // A user edit takes ownership — notify the voice engine so stale STT is
    // dropped. Emptying the field via the clear action is ALSO an edit (the
    // user actively took ownership), but programmatic voice writes must not
    // mark manual ownership (they are voice-owned writes).
    manualEditSinceVoiceRef.current = true;
    voiceRef.current?.notifyManualEdit?.();
  }, []);
  const handleVoiceTranscript = useCallback((text: string) => {
    // Only voice-owned writes may enter the composer, and only when the user
    // has NOT taken manual ownership since the capture began. Otherwise the
    // transcript is shown as a separate interim preview (voiceInterim) and the
    // typed text is preserved.
    if (manualEditSinceVoiceRef.current) {
      // Manual ownership wins — never overwrite typed text. Surface as preview.
      setVoiceInterimTranscript(text);
      return;
    }
    setComposerText(text);
    setVoiceInterimTranscript('');
  }, []);

  // ── Orb inputs: REAL signals only ──
  const [micState, setMicState] = useState<MicState>('idle');
  const [runtimeStatus, setRuntimeStatus] = useState<JarvisRuntimeStatus>({
    state: 'idle', elapsedMs: 0, firstTokenMs: null, provider: null, model: null, error: null,
  });

  // ── Backend runtime-state (holographic Jarvis): the stream state above only
  //     covers an ACTIVE turn. A delegated background task (Hermes/CodeX/
  //     research) continues after the turn ends — the orb must reflect that
  //     with the semantic 'delegated' (pink) state. Poll the same canonical
  //     endpoint Mission Control uses so both pages agree on real state. ──
  const [backendRuntime, setBackendRuntime] = useState<{
    state: string; activeAgent: string | null; activeProject: { id: string; name: string } | null;
    activeTask: { id: string; action: string | null; status: string } | null;
    provider: string | null; model: string | null; pendingTaskCount: number;
    projectTasks: any[];
  }>({ state: 'idle', activeAgent: null, activeProject: null, activeTask: null, provider: null, model: null, pendingTaskCount: 0, projectTasks: [] });
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await apiFetch('/api/jarvis/runtime-state');
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) setBackendRuntime(data);
      } catch { /* best effort — keep last known state */ }
    };
    poll();
    const id = window.setInterval(poll, 3000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);
  // Map the backend semantic state to the stream vocabulary the orb consumes.
  // 'delegated' is the only state the stream can NOT produce itself (it only
  // sees the active turn); the backend derives it from live background tasks.
  const orbRuntimeState: JarvisRuntimeState =
    backendRuntime.state === 'delegated' ? 'delegating'
    : backendRuntime.state === 'executing' && runtimeStatus.state === 'idle' ? 'executing'
    : backendRuntime.state === 'completed' && runtimeStatus.state === 'idle' ? 'completed'
    : backendRuntime.state === 'error' && runtimeStatus.state === 'idle' ? 'error'
    : runtimeStatus.state;

  // ── Live Work events (Jarvis page): real structured operational events
  //     from background_task_events, filtered server-side to exclude raw
  //     token-stream noise. Shown in the workspace band above the transcript
  //     so the user sees what Jarvis is actually doing. ──
  const [liveWorkEvents, setLiveWorkEvents] = useState<any[]>([]);
  const [liveWorkOpen, setLiveWorkOpen] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const pollEvents = async () => {
      try {
        const res = await apiFetch('/api/jarvis/live-events?limit=12');
        if (!res.ok || cancelled) return;
        const events = await res.json();
        if (!cancelled && Array.isArray(events)) setLiveWorkEvents(events);
      } catch { /* best effort */ }
    };
    pollEvents();
    const id = window.setInterval(pollEvents, 3000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  // ── THE single voice engine — one mic, one VAD, one STT, one TTS ──
  const [mode, setMode] = useState<'manual' | 'conversation'>(readPersistedMode);
  const [voiceOutEnabled, setVoiceOutEnabled] = useState(true);
  const [selectedVoice, setSelectedVoice] = useState<string>(readPersistedVoice);
  const [voiceBusy, setVoiceBusy] = useState(false);

  // ── Progressive TTS buffer (sentence chunks, sequential, no overlap) ──
  const speechBufferRef = useRef('');
  const flushSpeechBuffer = useCallback((force: boolean) => {
    const buf = speechBufferRef.current;
    if (!buf) return;
    let cut = -1;
    for (let i = buf.length - 1; i >= 0; i--) {
      if (/[.!?…]\s/.test(buf.slice(i, i + 2)) || /[.!?…]$/.test(buf.slice(i, i + 1))) { cut = i + 1; break; }
    }
    if (cut < 0 && (buf.includes('\n') || buf.length > 200)) {
      cut = buf.lastIndexOf('\n') >= 0 ? buf.lastIndexOf('\n') + 1 : buf.length;
    }
    if (cut <= 0 && !force) return;
    const chunk = (cut > 0 ? buf.slice(0, cut) : buf).trim();
    speechBufferRef.current = cut > 0 ? buf.slice(cut) : '';
    if (chunk) voiceRef.current?.speakProgressive?.(chunk);
  }, []);

  /** Streamed assistant deltas → sentence chunks → sequential TTS queue.
   *  Direct-chat replies are spoken whenever voice output is enabled,
   *  regardless of input channel (typed OR voice) — the user must never get
   *  "text in chat but no spoken response" for a reply they expect to hear.
   *  Routing events, tool events and diagnostics never reach this point with
   *  streamed text (only direct-reply deltas do). */
  const handleStreamDelta = useCallback((delta: string, channel: 'typed' | 'voice') => {
    void channel;
    speechBufferRef.current += delta;
    flushSpeechBuffer(false);
  }, [flushSpeechBuffer]);

  const handleAssistantDone = useCallback((_text: string, channel: 'typed' | 'voice') => {
    void channel;
    flushSpeechBuffer(true);
  }, [flushSpeechBuffer]);

  const voice = useVoiceIO({
    agentId: 'agent-jarvis',
    endSpeechSilenceMs: 900,
    onAutoSubmit: (text) => {
      // Conversation auto-submit — the exact streaming pipeline, no Send.
      // §9 input ownership: a manual edit since the capture began means the
      // voice turn is stale; the engine already dropped it at the source, but
      // this guard is the final deterministic barrier.
      if (manualEditSinceVoiceRef.current) return;
      chatRef.current?.sendMessage(text, 'voice');
    },
    onTranscript: handleVoiceTranscript, // Manual mode: ownership-guarded
    onStateChange: () => { /* voiceState below is the single orb source */ },
  });
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  // §9 input ownership: mic turning OFF invalidates every in-flight voice
  // event in the engine (late STT after the user disabled the mic is dropped
  // by identity). Mic returning to idle/listening/error does NOT clear manual
  // ownership — only a successful send or explicit clear does.
  useEffect(() => {
    if (micState !== 'listening') {
      voiceRef.current?.notifyMicOff?.();
    }
  }, [micState]);

  useEffect(() => { voiceRef.current?.setVoiceOverride?.(readPersistedVoice()); }, []);

  // ── Task-completion UX (task-completion milestone) ──
  // One chime + one desktop notification + one voice announcement per
  // operation; never replayed on rerender/restart (acknowledgement persisted).
  const [completions, setCompletions] = useState<CompletionEvent[]>([]);
  const announcedOpsRef = useRef<Set<string>>(new Set());

  // "View related memories" (memory milestone): focus terms from the active
  // execution's action text (e.g. "…roofing in Berlin…") fall back to the
  // operation id so the Memory graph opens on the relevant neighborhood.
  const relatedMemoryFocus = useCallback((): string => {
    const exec = executionStore.get().current;
    const action = exec?.currentAction || '';
    const terms = action.replace(/[^a-z0-9 ]/gi, ' ').split(/\s+/).filter((t) => t.length > 3).slice(0, 4).join(' ');
    return terms || exec?.operationId || '';
  }, []);

  useEffect(() => {
    const refresh = () => setCompletions(executionStore.getCompletions().filter((e) => completionNotifiedAt(e.operationId) == null));
    refresh();
    return executionStore.subscribe(refresh);
  }, []);

  useEffect(() => {
    for (const evt of completions) {
      if (announcedOpsRef.current.has(evt.operationId)) continue;
      announcedOpsRef.current.add(evt.operationId);
      playCompletionChime();
      if (!document.hasFocus() && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
          const n = new Notification('Jarvis', { body: `${evt.taskType} — ${evt.summary}` });
          n.onclick = () => window.focus();
        } catch { /* notifications unavailable */ }
      }
      if (evt.spokenSummary) voiceRef.current?.speakCompletion?.(evt.spokenSummary);
    }
  }, [completions]);

  function playCompletionChime() {
    try {
      const Ctor = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new Ctor();
      const tone = (freq: number, delay: number, dur: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + delay);
        gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + delay + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + dur);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(ctx.currentTime + delay); osc.stop(ctx.currentTime + delay + dur + 0.05);
      };
      tone(660, 0, 0.18);
      tone(880, 0.15, 0.24);
      setTimeout(() => { ctx.close().catch(() => {}); }, 1400);
    } catch { /* audio unavailable */ }
  }

  // ── Mode switching ──
  const handleModeChange = useCallback(async (next: 'manual' | 'conversation') => {
    setMode(next);
    try { sessionStorage.setItem(MODE_KEY, next); } catch { /* ignore */ }
    if (next === 'conversation') {
      setVoiceBusy(true);
      voiceRef.current?.armSpeech?.();
      const ok = await voiceRef.current?.startConversation();
      setVoiceBusy(false);
      if (!ok) {
        setMode('manual');
        try { sessionStorage.setItem(MODE_KEY, 'manual'); } catch { /* ignore */ }
      }
    } else {
      voiceRef.current?.endConversation();
    }
  }, []);

  // Conversation requested at mount (persisted) — arm once the page is live.
  useEffect(() => {
    if (readPersistedMode() === 'conversation') void handleModeChange('conversation');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleVoiceSelect = useCallback((id: string) => {
    setSelectedVoice(id);
    voiceRef.current?.setVoiceOverride?.(id);
    try { sessionStorage.setItem(VOICE_KEY, id); } catch { /* ignore */ }
  }, []);

  const toggleVoiceOut = useCallback(() => {
    setVoiceOutEnabled((prev) => {
      const next = !prev;
      voiceRef.current?.setVoiceEnabled(next);
      return next;
    });
  }, []);

  const handleStopSpeaking = useCallback(() => {
    // KILL SWITCH: stop playback, abort synthesis, clear queue, suppress
    // further speech for this run. Visible text streaming is untouched.
    voiceRef.current?.killSpeech?.();
  }, []);

  const handleNewConversation = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/jarvis/conversations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New Conversation' }),
      });
      const data = await res.json();
      if (data?.id) setActiveConversationId(data.id);
    } catch { /* surface stays usable */ }
  }, []);

  // Restore the most recent conversation on mount so /jarvis always shows
  // the live transcript (canonical surface — one conversation context).
  // Session persistence: remember the active conversation across route
  // changes (returning to /jarvis restores the SAME session).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/jarvis/conversations`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || !Array.isArray(data) || data.length === 0) return;
        let remembered: string | null = null;
        try { remembered = sessionStorage.getItem(ACTIVE_CONV_KEY); } catch { /* ignore */ }
        const rememberedExists = remembered && data.some((c: { id: string }) => c.id === remembered);
        // Most-recently-updated first from the server; remembered wins when
        // it still exists, otherwise fall back to the newest conversation.
        setActiveConversationId(rememberedExists ? remembered : data[0].id);
      } catch { /* clean-slate fallback */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Persist the active conversation id for session restore on return.
  useEffect(() => {
    if (!activeConversationId) return;
    try { sessionStorage.setItem(ACTIVE_CONV_KEY, activeConversationId); } catch { /* ignore */ }
  }, [activeConversationId]);

  // ── Backend connectivity: ONE lifecycle store feeds everything (backend
  // lifecycle milestone). Electron pushes authoritative AUTO_MANAGED/EXTERNAL
  // state via IPC; browser mode falls back to /api/health polling. Jarvis
  // never derives connectivity from its own fetch failures. ──
  const backendLifecycle = useBackendLifecycle();
  // Definitive-down only: 'starting'/'reconnecting' are transient (the
  // lifecycle manager may be mid-restart — the UI stays usable and the
  // very next action can succeed). This mirrors the legacy default-offline
  // contract the orb tests encode.
  const backendOffline = backendLifecycle.status === 'offline' || backendLifecycle.status === 'failed';

  /** RECONNECT (primary control while offline): re-run the lifecycle retry. */
  const handleReconnect = useCallback(() => {
    void backendLifecycleStore.retry();
  }, []);

  // ── Hermes live-run status + current run (real events, no fakes) ──
  const [hermesStatus, setHermesStatus] = useState<HermesStatus | null>(null);
  const [hermesRuns, setHermesRuns] = useState<HermesRun[]>([]);
  const [activeRun, setActiveRun] = useState<HermesRun | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);

  // ── Lower workspace dock (voice-first / work mode). VIEW STATE ONLY:
  //     collapsing hides the interaction surfaces (controls, diagnostics,
  //     transcript, composer) to give the holographic head more room, but
  //     NEVER unmounts them — transcript, draft, conversation, mic state
  //     and running work all survive. Persisted like the transcript toggle. ──
  const DOCK_KEY = 'jarvis.workspaceDockOpen';
  const [workspaceDockOpen, setWorkspaceDockOpen] = useState<boolean>(() => {
    try {
      const saved = sessionStorage.getItem(DOCK_KEY);
      if (saved !== null) return saved === '1';
    } catch { /* storage unavailable */ }
    return true; // default: work mode (expanded)
  });
  const toggleWorkspaceDock = useCallback(() => {
    setWorkspaceDockOpen((v) => {
      const next = !v;
      try { sessionStorage.setItem(DOCK_KEY, next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  }, []);

  // ── Jarvis runtime-display truth: the ASSIGNED provider/model (from the
  //     settings API) is distinct from the ACTIVE provider/model (reported by
  //     the stream for the current turn). Both are shown explicitly so the UI
  //     never contradicts itself when a fallback serves a turn. ──
  const [jarvisAssignment, setJarvisAssignment] = useState<{ providerId: string | null; modelId: string | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}/settings/agent-provider-assignments/agent-jarvis`, { signal: AbortSignal.timeout(4000) });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setJarvisAssignment({ providerId: data?.providerId ?? null, modelId: data?.modelId ?? null });
      } catch { /* backend offline — leave assignment null, UI shows '—' */ }
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  // ── Final layout correction (§1, §3, §10): true 3-column shell ──
  // LEFT NAV (LeftRail) | CENTER JARVIS (mainColumn) | RIGHT ACTIVITY
  // (activityColumn). Activity is a dedicated grid column with its own
  // width, scrollbar and collapse control — it can NEVER overlap the
  // center column. Auto-collapses at narrow viewports so the Jarvis stage
  // never gets squeezed into unusability.
  const [activityColumnOpen, setActivityColumnOpen] = useState(true);
  const [viewportWidth, setViewportWidth] = useState<number>(typeof window !== 'undefined' ? window.innerWidth : 1600);
  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    // Safety net: some platforms/embedded contexts do not fire resize for
    // every window transition; keep the auto-collapse truthful either way.
    const id = window.setInterval(onResize, 1500);
    return () => { window.removeEventListener('resize', onResize); window.clearInterval(id); };
  }, []);
  useEffect(() => {
    if (viewportWidth < 1000) setActivityColumnOpen(false);
    else if (viewportWidth >= 1400) setActivityColumnOpen(true);
  }, [viewportWidth]);

  // §8 sticky composer: processing is derived from the SAME runtime-status
  // stream JarvisChat already reports (onStatusChange) — no separate state,
  // so the sticky composer's cancel button is always truthful.

  // §11: System Status is docked compactly in the center flow (collapsible)
  // — it never floats over the orb.
  const [sysStatusOpen, setSysStatusOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch(`${API_BASE}/hermes-api/status`);
        if (res.ok && !cancelled) setHermesStatus(await res.json());
      } catch { /* status chip shows offline */ }
    };
    check();
    const id = window.setInterval(check, 30_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/hermes-api/runs`);
        if (!res.ok) return;
        const runs: HermesRun[] = await res.json();
        if (cancelled) return;
        setHermesRuns(runs);
        const live = runs.find(r => ['waiting_for_approval', 'running', 'queued', 'stopping'].includes(r.status));
        if (live && live.id !== activeRun?.id) {
          const detail = await fetch(`${API_BASE}/hermes-api/runs/${live.id}`);
          if (detail.ok && !cancelled) setActiveRun(await detail.json());
        } else if (!live) {
          // §4: ACTIVE RUN shows ONLY current work. A finished run is
          // history — the panel renders it under HISTORY, never as the
          // active run (the old runs[0] fallback was the contradiction).
          setActiveRun(null);
        }
      } catch { /* panel stays on last good state */ }
    };
    poll();
    const id = window.setInterval(poll, 3000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [activeRun?.id]);

  const [approvalChoiceBusy, setApprovalChoiceBusy] = useState(false);

  // ── Background Tasks (persistent task manager — real events via SSE) ──
  const [taskSummary, setTaskSummary] = useState<BackgroundTaskSummary | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [taskEvents, setTaskEvents] = useState<BackgroundTaskEvent[]>([]);
  const [tasksOpen, setTasksOpen] = useState(true);

  // Current-turn ownership: when the /jarvis stream creates a task it fires
  // 'jarvis:task-created' with {taskId, operationId}. That task is THE current
  // task regardless of any historical selection. A manual row click pins a
  // task until the next task-created event (so the user can inspect history
  // without the poller stealing the selection).
  const currentTaskOpIdRef = useRef<string | null>(null);
  const manualSelectionRef = useRef(false);

  const pollTasks = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/background-tasks/summary`);
      if (res.ok) setTaskSummary(await res.json());
    } catch { /* panel keeps last good state */ }
  }, []);

  useEffect(() => {
    pollTasks();
    const id = window.setInterval(pollTasks, 3000);
    return () => window.clearInterval(id);
  }, [pollTasks]);

  // Task-selection policy, re-evaluated on every summary refresh:
  //   1. task created by the current operationId
  //   2. active non-terminal task (blocked/completed/failed/cancelled are
  //      TERMINAL — a historical blocked task can never claim 'current')
  //   3. most recent task by createdAt
  useEffect(() => {
    const tasks = taskSummary?.tasks || [];
    if (!tasks.length) { setSelectedTaskId(null); return; }
    if (manualSelectionRef.current) return; // user is inspecting a task; only a new task-created event overrides
    const next = pickActiveTask(tasks, currentTaskOpIdRef.current, selectedTaskId);
    if (next && next !== selectedTaskId) setSelectedTaskId(next);
  }, [taskSummary]);

  // Live execution state (coherence milestone): the backend is the single
  // author — start the SSE stream; the ExecutionBar and activity panel read
  // the same canonical record. No component feeds the store independently.
  useEffect(() => {
    startExecutionStream();
    return () => { /* the stream is module-scoped (shared across remounts) */ };
  }, []);

  // Canonical current execution for the ACTIVE RUN panel.
  const [currentExec, setCurrentExec] = useState<ExecutionRecord | null>(executionStore.get().current);
  useEffect(() => {
    const unsub = executionStore.subscribe(() => setCurrentExec(executionStore.get().current));
    return unsub;
  }, []);

  // Current-turn ownership: a task created by the running operation becomes
  // the selected task immediately (even over a manually pinned historical one).
  useEffect(() => {
    const onTaskCreated = (e: Event) => {
      const detail = (e as CustomEvent<{ taskId: string; operationId?: string }>).detail;
      if (!detail?.taskId) return;
      currentTaskOpIdRef.current = detail.operationId || null;
      manualSelectionRef.current = false;
      setSelectedTaskId(detail.taskId);
    };
    window.addEventListener('jarvis:task-created', onTaskCreated);
    return () => window.removeEventListener('jarvis:task-created', onTaskCreated);
  }, []);

  // SSE subscription for the selected task (real events, catch-up included).
  useEffect(() => {
    if (!selectedTaskId) return;
    let cancelled = false;
    const es = new EventSource(apiUrl(`/api/background-tasks/${encodeURIComponent(selectedTaskId)}/events`));
    const handler = (ev: MessageEvent) => {
      if (cancelled) return;
      try {
        const evt = JSON.parse(ev.data) as BackgroundTaskEvent;
        setTaskEvents(prev => {
          if (prev.some(e => e.id === evt.id)) return prev;
          return [...prev.slice(-199), evt];
        });
        // Task may have transitioned — refresh the summary promptly.
        pollTasks();
      } catch { /* ignore malformed frames */ }
    };
    // All task event kinds arrive as named events; subscribe broadly.
    const kinds = ['task.created', 'task.queued', 'task.started', 'task.stage_changed', 'task.progress',
      'task.agent_selected', 'task.run_linked', 'task.board_linked', 'task.file_changed',
      'task.build_started', 'task.build_completed', 'task.test_started', 'task.test_completed',
      'task.approval_requested', 'task.approval_resolved', 'task.paused', 'task.resumed',
      'task.stop_requested', 'task.cancelled', 'task.review_started', 'task.verified',
      'task.completed', 'task.blocked', 'task.failed'];
    kinds.forEach(k => es.addEventListener(k, handler as EventListener));
    es.onerror = () => { /* EventSource auto-reconnects */ };
    setTaskEvents([]);
    return () => { cancelled = true; es.close(); };
  }, [selectedTaskId, pollTasks]);

  const selectedTask = (taskSummary?.tasks || []).find(t => t.taskId === selectedTaskId) || null;
  const [taskControlBusy, setTaskControlBusy] = useState(false);
  const handleTaskControl = useCallback(async (action: 'pause' | 'resume' | 'stop' | 'cancel') => {
    if (!selectedTaskId || taskControlBusy) return;
    setTaskControlBusy(true);
    try {
      await fetch(`${API_BASE}/background-tasks/${encodeURIComponent(selectedTaskId)}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      await pollTasks();
    } catch { /* button re-enables; state poll corrects the panel */ }
    setTaskControlBusy(false);
  }, [selectedTaskId, taskControlBusy, pollTasks]);

  const handleApproval = useCallback(async (choice: 'allow' | 'deny') => {
    if (!activeRun || approvalChoiceBusy) return;
    setApprovalChoiceBusy(true);
    try {
      await fetch(`${API_BASE}/hermes-api/runs/${activeRun.id}/approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ choice }),
      });
    } catch { /* modal stays until the run state changes */ }
    setApprovalChoiceBusy(false);
  }, [activeRun, approvalChoiceBusy]);

  // ── Task-owned approvals (belong to the background task, not the chat turn) ──
  const [taskApprovals, setTaskApprovals] = useState<Array<{ taskId: string; action: string; reason: string; command?: string; files?: string[]; choices?: string[] }>>([]);
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/background-tasks/approvals`);
        if (res.ok && !cancelled) setTaskApprovals(await res.json());
      } catch { /* keep last known list */ }
    };
    poll();
    const id = window.setInterval(poll, 2500);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);
  const pendingTaskApproval = taskApprovals[0] || null;
  const handleTaskApproval = useCallback(async (choice: 'allow' | 'deny') => {
    if (!pendingTaskApproval || approvalChoiceBusy) return;
    setApprovalChoiceBusy(true);
    try {
      await fetch(`${API_BASE}/background-tasks/${encodeURIComponent(pendingTaskApproval.taskId)}/approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ choice }),
      });
      // Refresh immediately so the modal clears when resolved.
      const res = await fetch(`${API_BASE}/background-tasks/approvals`);
      if (res.ok) setTaskApprovals(await res.json());
    } catch { /* modal stays until the approval state changes */ }
    setApprovalChoiceBusy(false);
  }, [pendingTaskApproval, approvalChoiceBusy]);

  // ── Orb state: canonical event-driven contract (real signals only) ──
  const [playbackActive, setPlaybackActive] = useState(false);
  const [inputLevel, setInputLevel] = useState(0);
  const [outputLevel, setOutputLevel] = useState(0);

  useEffect(() => {
    const onPlaybackStarted = () => setPlaybackActive(true);
    const onPlaybackEnded = () => { setPlaybackActive(false); setOutputLevel(0); };
    const onInput = (e: Event) => setInputLevel(((e as CustomEvent).detail?.level ?? 0) as number);
    const onOutput = (e: Event) => setOutputLevel(((e as CustomEvent).detail?.level ?? 0) as number);
    window.addEventListener(JARVIS_ORB_EVENTS.playbackStarted, onPlaybackStarted);
    window.addEventListener(JARVIS_ORB_EVENTS.playbackEnded, onPlaybackEnded);
    window.addEventListener(JARVIS_ORB_EVENTS.inputLevel, onInput);
    window.addEventListener(JARVIS_ORB_EVENTS.outputLevel, onOutput);
    return () => {
      window.removeEventListener(JARVIS_ORB_EVENTS.playbackStarted, onPlaybackStarted);
      window.removeEventListener(JARVIS_ORB_EVENTS.playbackEnded, onPlaybackEnded);
      window.removeEventListener(JARVIS_ORB_EVENTS.inputLevel, onInput);
      window.removeEventListener(JARVIS_ORB_EVENTS.outputLevel, onOutput);
    };
  }, []);

  // Engine mic state → composer MicState vocabulary for the orb derivation.
  const orbMicState: MicState = (() => {
    switch (voice.voiceState) {
      case 'listening': return 'listening';
      case 'transcribing': return 'transcribing';
      case 'error': return 'error';
      default: return 'idle';
    }
  })();

  const orbState = deriveJarvisOrbState({
    micState: orbMicState,
    playbackActive,
    runtimeState: orbRuntimeState,
    backendOffline,
  });

  // ── Activity line: REAL events only (voice transitions + Hermes events) ──
  const [activityLog, setActivityLog] = useState<{ t: number; text: string }[]>([]);
  const pushActivity = useCallback((text: string) => {
    setActivityLog((prev) => [...prev.slice(-11), { t: Date.now(), text }]);
  }, []);
  const prevVoiceState = useRef(voice.voiceState);
  useEffect(() => {
    const prev = prevVoiceState.current;
    prevVoiceState.current = voice.voiceState;
    if (prev === voice.voiceState) return;
    if (prev === 'transcribing' && voice.voiceState !== 'error') {
      pushActivity('TRANSCRIPTION COMPLETE');
      return;
    }
    const text = ({
      listening: 'LISTENING', transcribing: 'TRANSCRIBING',
      thinking: 'THINKING', speaking: 'SPEAKING', error: 'ERROR',
    } as Record<string, string>)[voice.voiceState];
    if (text) pushActivity(text);
  }, [voice.voiceState, pushActivity]);

  const lastHermesEventId = useRef<string | null>(null);
  useEffect(() => {
    const evs = activeRun?.events || [];
    if (evs.length === 0) return;
    const last = evs[evs.length - 1];
    if (last.id === lastHermesEventId.current) return;
    lastHermesEventId.current = last.id;
    const map: Record<string, string> = {
      'run.created': 'TASK SUBMITTED TO HERMES',
      'approval.request': 'APPROVAL REQUIRED',
      'error': 'ERROR',
      'tool.failed': 'ERROR',
      'run.completed': 'RUN COMPLETE',
      'terminal.command': 'TERMINAL COMMAND',
      'file.changed': 'FILE CHANGED',
    };
    pushActivity(map[last.kind] || (last.summary || '').toUpperCase().slice(0, 42));
  }, [activeRun?.events, pushActivity]);

  const latestActivity = activityLog.length > 0 ? activityLog[activityLog.length - 1] : null;

  // ── Real host telemetry (never faked; null → "—") ──
  const [sys, setSys] = useState<SystemStats | null>(null);
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/health/system`);
        if (!res.ok) { if (!cancelled) setSys(null); return; }
        const data = await res.json();
        if (!cancelled) setSys(data);
      } catch { if (!cancelled) setSys(null); }
    };
    poll();
    const id = window.setInterval(poll, 10_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  const [transcriptOpen, setTranscriptOpen] = useState(true);

  // ── Responsive orb sizing (§12, §15): the orb always FITS the reserved
  // stage — it scales down gracefully on short viewports but never overflows
  // or gets clipped. Measured from the stage element with three triggers:
  // ResizeObserver, window resize, and a low-cost interval safety net
  // (synthetic viewport changes — e.g. CDP device-metrics emulation — do not
  // fire ResizeObserver reliably in every Electron build). ──
  const stageRef = useRef<HTMLDivElement>(null);
  const orbRegionRef = useRef<HTMLDivElement>(null);
  const [orbSize, setOrbSize] = useState(340);
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    let raf = 0;
    const measure = () => {
      raf = 0;
      // Size from the ORB REGION (centerColumn), not the whole stage: the
      // region is the space left after wordmark + status strip, so the orb
      // always fits and centers within it — never clipped, never pushing.
      const region = orbRegionRef.current;
      if (!region) return;
      const rect = region.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      // Reserve ~70px inside the region for the state label + primary control.
      const next = Math.max(180, Math.min(340, Math.round(Math.min(rect.height - 70, rect.width) - 16)));
      setOrbSize((prev) => (prev === next ? prev : next));
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(measure); };
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    ro?.observe(el);
    window.addEventListener('resize', schedule);
    measure();
    // Safety net calls measure() DIRECTLY — never through rAF: an occluded
    // Electron window throttles rAF to a stop, which stranded the orb one
    // size behind after resolution changes (caught in live verification).
    const interval = window.setInterval(measure, 1000);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', schedule);
      if (raf) cancelAnimationFrame(raf);
      window.clearInterval(interval);
    };
  }, []);

  // ── Transcript height (layout-stability milestone §6) ──
  // User-bounded resize: min 160px / default 280px / max 420px. The bounded
  // body contains the scroll surface AND the fixed composer/routing rows, so
  // the minimum keeps a usable scroll viewport. The dock can never consume
  // the center viewport — the workspace band itself is capped at 54vh in
  // CSS, and the stage keeps flex:1 above it.
  const TRANSCRIPT_MIN = 160;
  const TRANSCRIPT_MAX = 420;
  const [transcriptHeight, setTranscriptHeight] = useState(() => {
    try {
      const saved = Number(sessionStorage.getItem('jarvis.transcriptHeight'));
      if (Number.isFinite(saved) && saved >= TRANSCRIPT_MIN && saved <= TRANSCRIPT_MAX) return saved;
    } catch { /* storage unavailable */ }
    return 280;
  });
  const handleTranscriptResizeStart = (e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = transcriptHeight;
    const onMove = (ev: PointerEvent) => {
      // Dragging the handle DOWN shrinks the dock; UP grows it.
      const next = Math.min(TRANSCRIPT_MAX, Math.max(TRANSCRIPT_MIN, startHeight + (ev.clientY - startY)));
      setTranscriptHeight(next);
    };
    const onUp = (ev: PointerEvent) => {
      const next = Math.min(TRANSCRIPT_MAX, Math.max(TRANSCRIPT_MIN, startHeight + (ev.clientY - startY)));
      try { sessionStorage.setItem('jarvis.transcriptHeight', String(next)); } catch { /* ignore */ }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const recentActivity = (activeRun?.events || [])
    .filter(e => e.kind !== 'assistant.delta')
    .slice(-10)
    .reverse();

  const filesChanged = (activeRun?.events || []).filter(e => e.kind === 'file.changed').length;

  const statusChip = (label: string, value: string, ok?: boolean) => (
    <span style={chip}>
      {ok !== undefined && dot(ok)}
      {label} <b style={{ color: '#cbd5e1' }}>{value}</b>
    </span>
  );

  // ── PRIMARY CENTER CONTROL — one obvious action, real-state driven ──
  const primary = (() => {
    if (backendOffline) return { label: 'RECONNECT', onClick: handleReconnect, disabled: false };
    if (voice.isSpeaking) return { label: 'STOP SPEAKING', onClick: handleStopSpeaking, disabled: false };
    if (voice.voiceState === 'listening') return { label: 'LISTENING…', onClick: undefined as (() => void) | undefined, disabled: true };
    if (mode === 'conversation') return { label: 'END CONVERSATION', onClick: () => void handleModeChange('manual'), disabled: voiceBusy };
    return { label: 'START CONVERSATION', onClick: () => void handleModeChange('conversation'), disabled: voiceBusy };
  })();

  return (
    <div className={cc.root} data-testid="jarvis-studio" style={{ display: 'flex', flexDirection: 'row', height: '100%', overflow: 'hidden' }}>
      <div className={styles.mainColumn} data-testid="jarvis-active-layout" style={{ position: 'relative', flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {/* ── CENTER COLUMN (fixed-stage milestone): flex column, overflow
            hidden — the Jarvis workspace is NOT one scrolling document.
            The hero stage is a reserved fixed band (flex:1, overflow
            hidden); the lower workspace is a bounded band (max-height
            54vh) whose tall children (Voice Trace, transcript) scroll
            inside themselves. Corner panels sit in the Activity column,
            OUTSIDE this container, so they never scroll with it. ── */}
        <div className={cc.centerScroll} data-testid="jarvis-center-scroll">
        {/* ── JARVIS HERO (fixed-stage milestone): a RESERVED band at the top
            of the center column — flex:1, overflow hidden, orb centered
            inside. It is NEVER part of a scrolling document: transcript
            growth, Voice Trace expansion, or activity history can never
            push it upward or clip it. Real flow stack — wordmark → orb →
            state text → primary control — nothing absolutely stacked on
            the orb. ── */}
        <div ref={stageRef} className={cc.jarvisStage} data-testid="jarvis-stage" style={{ overflow: 'hidden' }}>

        {/* ── Glowing wordmark ── */}
        <motion.div
          className={cc.wordmark}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8 }}
        >
          JARVIS
        </motion.div>

        {/* ── Compact status strip (real values) — flow row of the hero
            stack between wordmark and orb (scroll-correction §3): never
            absolutely pinned, so it can never collide with the wordmark. ── */}
        <div data-testid="jarvis-status-strip" style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 14, zIndex: 5, margin: '16px 0 10px' }}>
          {statusChip('', backendOffline ? 'BACKEND OFFLINE' : 'CONNECTED', !backendOffline)}
          {/* Runtime-display truth: ASSIGNED (settings) vs ACTIVE (stream).
              They differ only when a fallback serves the turn — the UI says
              so instead of silently showing one or the other. */}
          {statusChip('ASSIGNED', jarvisAssignment?.providerId ? `${jarvisAssignment.providerId.replace('prov-', '')}/${jarvisAssignment.modelId ?? '—'}` : '—')}
          {statusChip('ACTIVE', runtimeStatus.provider ? `${runtimeStatus.provider}/${runtimeStatus.model ?? '—'}` : '—', !!runtimeStatus.provider)}
          {statusChip('HERMES', hermesStatus?.gateway?.reachable ? 'ONLINE' : 'OFFLINE', !!hermesStatus?.gateway?.reachable)}
          {statusChip('STT', hermesStatus?.stt?.configured ? hermesStatus.stt.provider : 'none', !!hermesStatus?.stt?.configured)}
          {statusChip('TTS', hermesStatus?.tts?.configured ? hermesStatus.tts.provider : 'none', !!hermesStatus?.tts?.configured)}
          {statusChip('MIC', mode === 'conversation' ? voice.voiceState.toUpperCase() : micState === 'idle' ? 'manual' : micState, mode === 'conversation')}
          {statusChip('VOICE', voiceOutEnabled ? selectedVoice.replace('aura-', '') : 'off', voiceOutEnabled)}
        </div>

        {/* ── CENTRAL CORE ── */}
        <div ref={orbRegionRef} className={cc.centerColumn} data-testid="jarvis-orb-region">
          <div data-testid="jarvis-dashboard" className={cc.coreWrap}>
            <div data-testid="jarvis-orb-wrapper" style={{ position: 'relative' }}>
              <div data-testid="jarvis-orb-core" style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <JarvisCore
                  state={orbState as JarvisCoreState}
                  inputLevel={orbState === 'listening' ? inputLevel : 0}
                  outputLevel={orbState === 'speaking' ? outputLevel : 0}
                  activeAgent={backendRuntime.activeAgent}
                  size={orbSize}
                  testIdPrefix="jarvis-orb"
                />
              </div>
            </div>
            <div data-testid="jarvis-orb-status-label" className={cc.stateLabel}>{JARVIS_ORB_LABELS[orbState]}</div>
            <span data-testid="jarvis-orb-label" aria-hidden="true" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{JARVIS_ORB_LABELS[orbState]}</span>
            {/* Primary control — its own flow row BELOW the orb (overlap fix):
                wordmark → orb → state text → control, with real spacing.
                Never absolutely positioned on top of the visualization. */}
            <button
              data-testid="jarvis-primary-control"
              className={cc.primaryControl}
              onClick={primary.onClick}
              disabled={primary.disabled}
            >
              {primary.label}
            </button>
          </div>
        </div>

        </div>

        {/* ── LOWER WORKSPACE (fixed-stage milestone §3/§16): the TOP STATUS
            LANE (workspace/approval strip + activity line) lives HERE, at
            the top of the bounded band — never inside the stage. Backend /
            workspace status must not push the Jarvis visualization.
            The band is COLLAPSIBLE (voice-first mode): hiding the interaction
            surfaces gives the head more room. View-state only — children
            stay mounted so transcript/draft/conversation/mic survive. ── */}
        <div className={`${cc.workspace} ${workspaceDockOpen ? '' : cc.workspaceCollapsed}`} data-testid="jarvis-workspace" style={{ overflow: 'hidden' }}>

          {/* ── TOP STATUS LANE (stabilization §1): a reserved flow row at
              the top of the workspace band. The workspace/approval strip
              (left) and the transcription/speaking/listening activity badge
              (right) share this lane — NEVER absolutely positioned, so they
              can wrap at narrow widths instead of colliding. Being BELOW the
              stage means they can never push the orb upward. ── */}
          <div className={cc.topStatusLane} data-testid="jarvis-top-status-lane">
            <div data-testid="jarvis-workspace-anchor" style={{ flex: '1 1 auto', minWidth: 220 }}>
              <JarvisWorkspaceBar />
            </div>
            <button
              data-testid="jarvis-workspace-dock-toggle"
              onClick={toggleWorkspaceDock}
              title={workspaceDockOpen ? 'Collapse the lower workspace (voice-first focus)' : 'Expand the lower workspace (work mode)'}
              className={cc.dockToggle}
            >
              {workspaceDockOpen ? '▾ HIDE DOCK' : '▴ SHOW DOCK'}
            </button>
            <div className={cc.activityLine} data-testid="jarvis-activity-line">
              <span className={cc.activityDot} />
              <span data-testid="jarvis-activity-text">{latestActivity ? latestActivity.text : 'READY'}</span>
            </div>
          </div>

          <div className={cc.workspaceControls}>

            {/* ── Command bar: mode selector + voice controls (always visible) ── */}
            <div className={cc.commandBar} role="radiogroup" aria-label="Jarvis voice mode">
              <div style={{ display: 'flex', overflow: 'hidden', borderRadius: 6, border: '1px solid #27436b' }}>
                {(['manual', 'conversation'] as const).map((m) => (
                  <button
                    key={m}
                    data-testid={`jarvis-mode-${m}`}
                    onClick={() => void handleModeChange(m)}
                    disabled={voiceBusy}
                    aria-pressed={mode === m}
                    style={{
                      padding: '5px 12px', fontSize: 10.5, fontWeight: 600, cursor: 'pointer',
                      border: 'none', letterSpacing: 1, textTransform: 'uppercase',
                      background: mode === m ? '#0e7490' : 'rgba(8,20,40,0.6)',
                      color: mode === m ? '#ecfeff' : '#94a3b8',
                    }}
                  >
                    {m}
                  </button>
                ))}
              </div>
              <button
                data-testid="jarvis-mic-button"
                onClick={() => { if (mode === 'manual') void voice.toggleListening(); }}
                disabled={mode === 'conversation'}
                aria-pressed={voice.voiceState === 'listening'}
                title={mode === 'conversation' ? 'Microphone armed (conversation mode)' : 'Record a manual turn'}
                className={cc.ctl}
                style={voice.voiceState === 'listening' ? { borderColor: '#3b82f6', color: '#93c5fd', background: 'rgba(59,130,246,0.15)' } : undefined}
              >
                {voice.voiceState === 'listening' ? 'LISTENING' : 'MIC'}
              </button>
              <button
                data-testid="jarvis-voice-toggle"
                onClick={toggleVoiceOut}
                className={cc.ctl}
                title="Voice output on/off"
                style={voiceOutEnabled ? { borderColor: '#166534', color: '#4ade80' } : undefined}
              >
                VOICE {voiceOutEnabled ? 'ON' : 'OFF'}
              </button>
              <select
                data-testid="jarvis-voice-select"
                value={selectedVoice}
                onChange={(e) => handleVoiceSelect(e.target.value)}
                className={cc.ctl}
                style={{ background: 'rgba(8,20,40,0.9)' }}
              >
                {JARVIS_VOICES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
              </select>
              <button
                data-testid="jarvis-stop-speaking"
                onClick={handleStopSpeaking}
                disabled={!voice.isSpeaking}
                className={cc.ctl}
                title="Stop speaking (kill switch)"
                style={voice.isSpeaking ? { borderColor: '#7f1d1d', color: '#fca5a5', cursor: 'pointer' } : undefined}
              >
                STOP SPEAKING
              </button>

              {/* Compact command drawer — working actions only */}
              <div style={{ position: 'relative' }}>
                <button
                  data-testid="jarvis-actions-menu"
                  onClick={() => setActionsOpen((v) => !v)}
                  className={cc.ctl}
                >
                  ACTIONS ▾
                </button>
                {actionsOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.18 }}
                    style={{ position: 'absolute', bottom: 34, left: '50%', transform: 'translateX(-50%)', zIndex: 40, background: 'rgba(4,12,28,0.97)', border: '1px solid #27436b', borderRadius: 8, minWidth: 230, boxShadow: '0 8px 24px rgba(0,0,0,0.6)', padding: 8 }}
                  >
                    {[
                      { label: 'New conversation', run: () => { void handleNewConversation(); } },
                      { label: 'Open board', run: () => navigate('/kanban/b-hermes') },
                      { label: 'Open Mission Control', run: () => navigate('/mission-control') },
                      { label: 'Open Hermes', run: () => navigate('/hermes-studio?view=kanban') },
                      { label: 'Open CodeX', run: () => navigate('/codex') },
                      { label: 'Settings', run: () => navigate('/settings') },
                    ].map((a) => (
                      <button
                        key={a.label}
                        onClick={() => { setActionsOpen(false); a.run(); }}
                        style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 10px', fontSize: 12, background: 'transparent', border: 'none', color: '#cbd5e1', cursor: 'pointer' }}
                      >
                        {a.label}
                      </button>
                    ))}
                    <div style={{ borderTop: '1px solid #1e293b', margin: '6px 0', padding: '6px 10px 2px' }}>
                      <div style={{ fontSize: 9, letterSpacing: 1.5, color: '#64748b', marginBottom: 4 }}>PROVIDER / MODEL</div>
                      <AgentRuntimeSelector agentId="agent-jarvis" />
                    </div>
                  </motion.div>
                )}
              </div>
            </div>

            {voice.playbackError && (
              <div data-testid="jarvis-playback-error" style={{ fontSize: 11, color: '#fca5a5', border: '1px solid #7f1d1d', borderRadius: 6, padding: '6px 8px', marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>Voice playback error: {voice.playbackError}</span>
                <button
                  data-testid="jarvis-audio-recover"
                  onClick={() => voiceRef.current?.unlockAudio?.()}
                  style={{ background: '#7f1d1d', color: '#fecaca', border: 'none', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontSize: 11 }}
                >
                  Enable audio
                </button>
              </div>
            )}
          </div>
          <div className={cc.workspaceDiagnostics} data-testid="jarvis-workspace-diagnostics">
            {/* Voice trace + manual acceptance (physical-mic stabilization) */}
            <VoiceTracePanel />
          </div>

          {/* ── LIVE WORK (Jarvis page): real operational events. Shows what
              Jarvis is actually doing — PROJECT/TASK/AGENT/ACTION/STATUS —
              from background_task_events, never raw LLM tokens. Collapsible. ── */}
          <div className={cc.liveWorkPanel} data-testid="jarvis-live-work">
            <button
              data-testid="jarvis-live-work-toggle"
              onClick={() => setLiveWorkOpen((v) => !v)}
              className={cc.liveWorkHeader}
            >
              <span className={cc.liveWorkTitle}>
                <span className={cc.liveWorkDot} />
                LIVE WORK
                {backendRuntime.state !== 'idle' && (
                  <span className={cc.liveWorkStateBadge}>{backendRuntime.state.toUpperCase()}</span>
                )}
              </span>
              <span>{liveWorkOpen ? '▾ HIDE' : '▴ SHOW'}</span>
            </button>
            {liveWorkOpen && (
              <div className={cc.liveWorkBody} data-testid="jarvis-live-work-body">
                {backendRuntime.activeProject && (
                  <div className={cc.liveWorkKv}>
                    <span className={cc.liveWorkKvLabel}>PROJECT</span>
                    <span className={cc.liveWorkKvValue}>{backendRuntime.activeProject.name}</span>
                    <button
                      data-testid="jarvis-live-work-open-project"
                      onClick={() => navigate(`/projects?project=${encodeURIComponent(backendRuntime.activeProject!.id)}`)}
                      title="Open this project's workspace"
                      style={{ marginLeft: 'auto', fontSize: 10, background: '#134e4a', color: '#5eead4', border: '1px solid #115e59', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontWeight: 700 }}
                    >
                      OPEN PROJECT
                    </button>
                  </div>
                )}
                {backendRuntime.activeAgent && (
                  <div className={cc.liveWorkKv}>
                    <span className={cc.liveWorkKvLabel}>AGENT</span>
                    <span className={cc.liveWorkKvValue}>{backendRuntime.activeAgent}</span>
                  </div>
                )}
                {backendRuntime.activeTask?.action && (
                  <div className={cc.liveWorkKv}>
                    <span className={cc.liveWorkKvLabel}>ACTION</span>
                    <span className={cc.liveWorkKvValue}>{backendRuntime.activeTask.action}</span>
                  </div>
                )}
                {backendRuntime.pendingTaskCount > 0 && (
                  <div className={cc.liveWorkKv}>
                    <span className={cc.liveWorkKvLabel}>STATUS</span>
                    <span className={cc.liveWorkKvValue}>{backendRuntime.pendingTaskCount} active task(s)</span>
                  </div>
                )}
                {/* Project tasks (from /api/jarvis/runtime-state, scoped to the active
                    project) — each row can jump straight into the Project Board. */}
                {backendRuntime.activeProject && Array.isArray(backendRuntime.projectTasks) && backendRuntime.projectTasks.length > 0 && (
                  <div data-testid="jarvis-live-work-tasks" style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 2 }}>
                    {backendRuntime.projectTasks.slice(0, 5).map((pt: any) => (
                      <div key={pt.taskId} className={cc.liveWorkKv} style={{ borderLeft: '2px solid rgba(0,212,255,0.35)' }}>
                        <span className={cc.liveWorkKvLabel}>{String(pt.status || '').toUpperCase()}</span>
                        <span className={cc.liveWorkKvValue} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {(pt.title || pt.taskId).slice(0, 44)}
                        </span>
                        <button
                          data-testid={`jarvis-live-work-open-task-${pt.taskId}`}
                          onClick={() => navigate(`/projects?project=${encodeURIComponent(backendRuntime.activeProject!.id)}&task=${encodeURIComponent(pt.taskId)}`)}
                          title="Open this task on the Project Board"
                          style={{ marginLeft: 'auto', fontSize: 9, background: '#0e7490', color: '#cffafe', border: '1px solid #155e75', borderRadius: 6, padding: '2px 7px', cursor: 'pointer', fontWeight: 700, flex: '0 0 auto' }}
                        >
                          OPEN TASK
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className={cc.liveWorkEvents} data-testid="jarvis-live-work-events">
                  {liveWorkEvents.length === 0 ? (
                    <div className={cc.liveWorkEmpty}>No operational events yet.</div>
                  ) : (
                    liveWorkEvents.slice(0, 8).map((evt: any) => (
                      <div key={evt.id || evt.ts + evt.kind} className={cc.liveWorkEvent}>
                        <span className={cc.liveWorkEventKind}>{String(evt.kind).replace('task.', '')}</span>
                        <span className={cc.liveWorkEventSummary}>{evt.summary || evt.detail?.message || ''}</span>
                        {evt.taskTitle && <span className={cc.liveWorkEventTask}>{evt.taskTitle.slice(0, 40)}</span>}
                        {(evt.taskId && (evt.taskProjectId || backendRuntime.activeProject)) && (
                          <button
                            data-testid={`jarvis-live-work-open-task-${evt.taskId}`}
                            onClick={() => navigate(`/projects?project=${encodeURIComponent(evt.taskProjectId || backendRuntime.activeProject!.id)}&task=${encodeURIComponent(evt.taskId)}`)}
                            title="Open this task on the Project Board"
                            style={{ marginLeft: 'auto', fontSize: 9, background: 'transparent', color: '#67e8f9', border: '1px solid #155e75', borderRadius: 6, padding: '1px 6px', cursor: 'pointer', fontWeight: 700, flex: '0 0 auto' }}
                          >
                            OPEN TASK
                          </button>
                        )}
                        {evt.taskLinkedRunId && (
                          <button
                            data-testid={`jarvis-live-work-open-run-${evt.taskLinkedRunId}`}
                            onClick={() => navigate(`/projects?project=${encodeURIComponent(evt.taskProjectId || backendRuntime.activeProject!.id)}&run=${encodeURIComponent(evt.taskLinkedRunId)}`)}
                            title="Open this run on the Project Runs tab"
                            style={{ marginLeft: 'auto', fontSize: 9, background: 'transparent', color: '#bfdbfe', border: '1px solid #1e3a8a', borderRadius: 6, padding: '1px 6px', cursor: 'pointer', fontWeight: 700, flex: '0 0 auto' }}
                          >
                            OPEN RUN
                          </button>
                        )}
                        {(evt.detail?.artifactId || evt.detail?.artifact_id) && (
                          <button
                            data-testid={`jarvis-live-work-open-artifact-${evt.detail?.artifactId || evt.detail?.artifact_id}`}
                            onClick={() => navigate(`/projects?project=${encodeURIComponent(evt.taskProjectId || backendRuntime.activeProject!.id)}&artifact=${encodeURIComponent(evt.detail?.artifactId || evt.detail?.artifact_id)}`)}
                            title="Open this artifact on the Project Artifacts tab"
                            style={{ marginLeft: 'auto', fontSize: 9, background: 'transparent', color: '#a7f3d0', border: '1px solid #064e3b', borderRadius: 6, padding: '1px 6px', cursor: 'pointer', fontWeight: 700, flex: '0 0 auto' }}
                          >
                            OPEN ARTIFACT
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ── Command transcript dock (§4–6): bounded height, resizable,
              own scrollbar. A thousand messages can never push the stage. ── */}
          <div className={`${cc.panel} ${cc.transcriptDock}`} data-testid="jarvis-chat-workspace">
            <div
              className={cc.resizeHandle}
              data-testid="jarvis-transcript-resize"
              onPointerDown={handleTranscriptResizeStart}
              title="Drag to resize the transcript"
            >
              ···
            </div>
            <button
              data-testid="jarvis-transcript-toggle"
              className={cc.transcriptToggle}
              onClick={() => setTranscriptOpen((v) => !v)}
            >
              <span>TRANSCRIPT</span>
              <span>{transcriptOpen ? '▾ HIDE' : '▴ SHOW'}</span>
            </button>
            <div
              className={transcriptOpen ? cc.transcriptBody : `${cc.transcriptBody} ${cc.collapsed}`}
              style={transcriptOpen ? { maxHeight: transcriptHeight } : undefined}
              data-testid="jarvis-transcript-body"
            >
              <JarvisChat
                ref={chatRef}
                conversationId={activeConversationId}
                onConversationCreated={(id) => setActiveConversationId(id)}
                onStatusChange={setRuntimeStatus}
                composerText={composerText}
                onComposerTextChange={handleComposerTextChange}
                onMicStateChange={setMicState}
                onStreamDelta={handleStreamDelta}
                onAssistantResponse={handleAssistantDone}
                onNavigate={(target) => {
                  // Navigation is a pure UI action — the conversation and
                  // background tasks are session-owned and survive the route
                  // change (JarvisStudio unmount/remount restores them).
                  navigate(target);
                }}
                hideComposerMic
                hideComposer
                transcriptVariant="command"
              />
            </div>
          </div>
        </div>
        </div>


        {/* ── STICKY COMPOSER (§8): always reachable at the bottom of the
            center column. Never inside the scrolling document, never covered
            by the Activity column — "Ask Jarvis anything…" stays on screen.
            In voice-first (dock collapsed) mode the composer hides too —
            VIEW STATE ONLY: composerText/draft survive because the component
            stays mounted. ── */}
        <div className={`${cc.stickyComposer} ${workspaceDockOpen ? '' : cc.composerCollapsed}`} data-testid="jarvis-sticky-composer" style={workspaceDockOpen ? undefined : { display: 'none' }}>
          {voiceInterimTranscript && (
            <div className={cc.voiceInterimPreview} data-testid="jarvis-voice-interim" aria-live="polite">
              <span className={cc.voiceInterimLabel}>Voice preview</span>
              <span className={cc.voiceInterimText}>{voiceInterimTranscript}</span>
            </div>
          )}
          <JarvisComposer
            onSendMessage={(text, channel) => {
              // §9 input ownership: a successful send ends manual ownership —
              // the next voice turn may write the composer again. Voice-owned
              // sends do NOT reset it (they are the same ownership).
              if (channel !== 'voice') {
                manualEditSinceVoiceRef.current = false;
                setVoiceInterimTranscript('');
              }
              chatRef.current?.sendMessage(text, channel ?? 'typed');
            }}
            isProcessing={['thinking', 'understanding', 'planning', 'delegating', 'executing', 'reviewing', 'streaming'].includes(runtimeStatus.state)}
            onCancelResponse={() => chatRef.current?.cancelResponse()}
            composerText={composerText}
            onComposerTextChange={handleComposerTextChange}
            onMicStateChange={setMicState}
            hideMic
            disabledReason={backendLifecycle.source === 'electron' && backendOffline ? 'AgenticOS backend is offline.' : undefined}
          />
        </div>
        </div>


      {/* ── RIGHT ACTIVITY COLUMN (§1, §3): a dedicated grid column with its
          own width and scrollbar. It can NEVER overlap the center column —
          no absolute positioning. Collapsible (§12C); auto-collapses at
          narrow viewports (§10). ── */}
      <div
        className={cc.activityColumn}
        data-testid="jarvis-activity-column"
        style={{ width: activityColumnOpen ? 320 : 38 }}
      >
        <button
          data-testid="jarvis-activity-column-toggle"
          className={cc.activityColumnToggle}
          onClick={() => setActivityColumnOpen((v) => !v)}
          title={activityColumnOpen ? 'Collapse Activity' : 'Expand Activity'}
        >
          {activityColumnOpen ? '»' : '«'}
        </button>
        {activityColumnOpen && (
        <>
        {/* ── SYSTEM STATUS (bottom-left, real values only) ── */}
        <motion.div
          className={`${cc.panel} ${cc.systemStatus}`}
          data-testid="jarvis-system-status"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15 }}
        >
          <div className={cc.panelTitle} style={{ marginBottom: 8 }}>SYSTEM STATUS</div>
          <div className={cc.kv}><span className={cc.kvLabel}>HOST</span><span className={cc.kvValue}>{sys?.host || '—'}</span></div>
          <div className={cc.kv}><span className={cc.kvLabel}>CPU</span><span className={cc.kvValue}>{sys?.cpuLoadPct != null ? `${sys.cpuLoadPct}%` : '—'}</span></div>
          <div className={cc.kv}><span className={cc.kvLabel}>RAM</span><span className={cc.kvValue}>{sys?.ramUsedMb != null && sys?.ramTotalMb != null ? `${(sys.ramUsedMb / 1024).toFixed(1)} / ${(sys.ramTotalMb / 1024).toFixed(1)} GB` : '—'}</span></div>
          <div className={cc.kv}><span className={cc.kvLabel}>GPU</span><span className={cc.kvValue} style={{ maxWidth: 150 }}>{sys?.gpu || '—'}</span></div>
          <div className={cc.kv}><span className={cc.kvLabel}>BACKEND</span><span className={cc.kvValue} style={{ color: backendOffline ? '#fca5a5' : '#4ade80' }}>{backendOffline ? 'OFFLINE' : 'ONLINE'}</span></div>
          <div className={cc.kv}><span className={cc.kvLabel}>ASSIGNED</span><span className={cc.kvValue} style={{ maxWidth: 150 }}>{jarvisAssignment?.providerId ? `${jarvisAssignment.providerId.replace('prov-', '')}/${jarvisAssignment.modelId ?? '—'}` : '—'}</span></div>
          <div className={cc.kv}><span className={cc.kvLabel}>ACTIVE</span><span className={cc.kvValue} style={{ maxWidth: 150 }}>{runtimeStatus.provider ? `${runtimeStatus.provider}/${runtimeStatus.model ?? '—'}` : '—'}</span></div>
        </motion.div>

        {/* ── ACTIVE RUN (bottom-right, real Hermes events) ── */}
        <motion.div
          className={`${cc.panel} ${cc.activeRun}`}
          data-testid="jarvis-current-run"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.25 }}
        >
          <div className={cc.activeRunHeader} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span className={cc.panelTitle}>ACTIVE RUN</span>
            <button
              data-testid="jarvis-open-board"
              onClick={() => navigate('/kanban/b-hermes')}
              className={cc.ctl}
              style={{ padding: '3px 8px', fontSize: 9.5 }}
            >
              OPEN BOARD
            </button>
          </div>
          
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <button
              data-testid="view-related-memories"
              onClick={() => { window.location.hash = `#/memory?focus=${encodeURIComponent(relatedMemoryFocus())}`; }}
              style={{ background: '#0f172a', border: '1px solid #164e63', color: '#67e8f9', borderRadius: 8, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}
              title="Open the Memory area focused on this conversation">
              🧠 View related memories
            </button>
          </div>
          {currentExec ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }} data-testid="jarvis-current-execution">
              {currentExec.status === 'WAITING_FOR_USER' ? (
                <>
                  <div className={cc.kv}><span className={cc.kvLabel}>STATE</span><span className={cc.kvValue} style={{ color: '#fbbf24' }}>WAITING FOR CLARIFICATION</span></div>
                  <div className={cc.kv}><span className={cc.kvLabel}>ACTION</span><span className={cc.kvValue} style={{ maxWidth: 190 }}>{currentExec.currentAction || 'Clarification required — waiting for your reply'}</span></div>
                  <div className={cc.kv}><span className={cc.kvLabel}>WAITING</span><span className={cc.kvValue}>{Math.max(0, Math.round((Date.now() - currentExec.startedAt) / 1000))}s</span></div>
                  <div className={cc.kv}><span className={cc.kvLabel}>OPERATION</span><span className={cc.kvValue} style={{ fontVariantNumeric: 'tabular-nums' }}>{currentExec.operationId.slice(-16)}</span></div>
                </>
              ) : (
                <>
              <div className={cc.kv}><span className={cc.kvLabel}>AGENT</span><span className={cc.kvValue}>{currentExec.worker === 'jarvis' ? 'Jarvis' : currentExec.worker === 'codex' ? 'CodeX' : currentExec.worker === 'hermes' ? 'Hermes' : currentExec.worker === 'revenue' ? 'Revenue' : currentExec.worker}</span></div>
              <div className={cc.kv}><span className={cc.kvLabel}>STATUS</span><span className={cc.kvValue} style={{ color: currentExec.status === 'CANCELLED' || currentExec.status === 'FAILED' ? '#f87171' : currentExec.status === 'COMPLETED' ? '#4ade80' : '#7dd3fc' }}>{currentExec.status.replace(/_/g, ' ')}</span></div>
              {(currentExec.resolvedProvider || currentExec.requestedProvider) && (
                <div className={cc.kv}><span className={cc.kvLabel}>LLM</span><span className={cc.kvValue}>{(currentExec.resolvedProvider || currentExec.requestedProvider) || ''}{(currentExec.resolvedModel || currentExec.requestedModel) ? ` / ${currentExec.resolvedModel || currentExec.requestedModel}` : ''}{currentExec.fallbackUsed ? ` (fallback: ${currentExec.fallbackReason || 'yes'})` : ''}</span></div>
              )}
              {currentExec.currentAction && (
                <div className={cc.kv}><span className={cc.kvLabel}>ACTION</span><span className={cc.kvValue} style={{ maxWidth: 190 }}>{currentExec.currentAction}</span></div>
              )}
              {currentExec.status === 'QUEUED' && currentExec.limit != null && (
                <div className={cc.kv}><span className={cc.kvLabel}>QUEUE</span><span className={cc.kvValue}>Active {currentExec.activeCount ?? 0}/{currentExec.limit}{currentExec.queuePosition != null ? ` · Position ${currentExec.queuePosition}` : ''}</span></div>
              )}
              <div className={cc.kv}><span className={cc.kvLabel}>ELAPSED</span><span className={cc.kvValue}>{Math.max(0, Math.round((Date.now() - currentExec.startedAt) / 1000))}s</span></div>
              <div className={cc.kv}><span className={cc.kvLabel}>OPERATION</span><span className={cc.kvValue} style={{ fontVariantNumeric: 'tabular-nums' }}>{currentExec.operationId.slice(-16)}</span></div>
                </>
              )}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: '#64748b' }}>No active run</div>
          )}
          {activeRun && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(30,41,59,0.6)' }}>
              <div style={{ fontSize: 9, letterSpacing: 1, color: '#64748b' }}>HERMES RUN (board detail)</div>
              <div className={cc.kv}><span className={cc.kvLabel}>TASK</span><span className={cc.kvValue} style={{ maxWidth: 190 }}>{activeRun.prompt.slice(0, 60)}</span></div>
              <div className={cc.kv}><span className={cc.kvLabel}>FILES</span><span className={cc.kvValue}>{filesChanged > 0 ? `${filesChanged} changed` : '—'}</span></div>
              <div className={cc.kv}><span className={cc.kvLabel}>CARD</span><span className={cc.kvValue}>{activeRun.cardId || '—'}</span></div>
              {activeRun.status === 'completed' && activeRun.finalText && (
                <div style={{ fontSize: 10.5, color: '#86efac', marginTop: 4 }}>✓ {activeRun.finalText.slice(0, 110)}</div>
              )}
              {activeRun.status === 'failed' && (
                <div style={{ fontSize: 10.5, color: '#fca5a5', marginTop: 4 }}>✗ run failed — see activity</div>
              )}
            </div>
          )}
          {/* Collapsible activity stream (real run events) */}
          <button
            data-testid="jarvis-activity-toggle"
            onClick={() => setActivityOpen((v) => !v)}
            style={{ width: '100%', display: 'flex', justifyContent: 'space-between', padding: '6px 0 0', fontSize: 9.5, letterSpacing: 1.5, color: '#64748b', background: 'transparent', border: 'none', cursor: 'pointer' }}
          >
            ACTIVITY {activityOpen ? '▴' : '▾'}
          </button>
          {activityOpen && (
            <div data-testid="jarvis-activity-stream" style={{ maxHeight: 160, overflowY: 'auto', marginTop: 4 }}>
              {recentActivity.length === 0 && (
                <div style={{ fontSize: 10.5, color: '#475569', padding: '2px 0' }}>No activity yet.</div>
              )}
              {recentActivity.map((e) => (
                <div key={e.id} style={{ display: 'flex', gap: 6, padding: '2px 0', fontSize: 10.5, borderBottom: '1px solid rgba(30,41,59,0.5)' }}>
                  <span style={{ color: '#475569', flexShrink: 0 }}>{new Date(e.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                  <span style={{ color: e.kind === 'error' || e.kind === 'tool.failed' ? '#fca5a5' : '#94a3b8', overflowWrap: 'anywhere' }}>{e.summary}</span>
                </div>
              ))}
            </div>
          )}

          
          {/* ── HISTORY (§4–5): finished work lives here — NEVER under
              ACTIVE RUN. Its own bounded, independently scrollable list so
              a long historical result cannot grow the panel unbounded. ── */}
          <div className={cc.panelTitle} style={{ marginTop: 10, marginBottom: 4 }} data-testid="jarvis-history-title">HISTORY</div>
          <div className={cc.historyScroll} data-testid="jarvis-history-scroll">
            {/* Past Hermes runs (§4): finished work rendered compactly here —
                a failed/completed run NEVER appears as the current ACTIVE RUN. */}
            {hermesRuns.length > 0 && (
              <div data-testid="jarvis-history-runs" style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
                {hermesRuns.slice(0, 20).map((run) => (
                  <div key={run.id} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '3px 6px', fontSize: 10, background: 'rgba(15,23,42,0.4)', border: '1px solid rgba(30,41,59,0.6)', borderRadius: 4 }}>
                    <span style={{ color: run.status === 'failed' ? '#f87171' : run.status === 'completed' ? '#4ade80' : '#94a3b8', fontWeight: 600, flexShrink: 0, minWidth: 62 }}>{run.status.toUpperCase()}</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#94a3b8' }}>{run.prompt.slice(0, 60)}</span>
                    <span style={{ marginLeft: 'auto', color: '#475569', flexShrink: 0 }}>{new Date(run.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                ))}
              </div>
            )}
            {completions.length > 0 && (
            <div data-testid="completion-cards" style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
              {[...completions].reverse().map((evt) => <CompletionCard key={evt.operationId} event={evt} />)}
            </div>
          )}
{/* ── BACKGROUND TASKS (persistent task manager — real SSE events) ── */}
          <button
            data-testid="jarvis-tasks-toggle"
            onClick={() => setTasksOpen((v) => !v)}
            style={{ width: '100%', display: 'flex', justifyContent: 'space-between', padding: '6px 0 0', fontSize: 9.5, letterSpacing: 1.5, color: '#64748b', background: 'transparent', border: 'none', cursor: 'pointer' }}
          >
            <span>
              TASKS {tasksOpen ? '▴' : '▾'}
              {taskSummary ? ` · ${taskSummary.active} RUN · ${taskSummary.queued} QUEUE · ${taskSummary.waitingApproval} APPR · ${taskSummary.failedOrBlocked} BLOCK` : ''}
            </span>
          </button>
          {tasksOpen && (
            <div data-testid="jarvis-tasks-panel" style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {/* Task switcher — click to select a different task */}
              {(taskSummary?.tasks?.length ? taskSummary.tasks.slice(0, 6) : []).map((t) => (
                <button
                  key={t.taskId}
                  data-testid={`jarvis-task-row-${t.taskId}`}
                  onClick={() => { manualSelectionRef.current = true; setSelectedTaskId(t.taskId); }}
                  style={{
                    display: 'flex', gap: 6, alignItems: 'center', padding: '3px 6px', fontSize: 10,
                    background: t.taskId === selectedTaskId ? 'rgba(56,189,248,0.10)' : 'rgba(15,23,42,0.4)',
                    border: `1px solid ${t.taskId === selectedTaskId ? 'rgba(56,189,248,0.35)' : 'rgba(30,41,59,0.6)'}`,
                    borderRadius: 4, cursor: 'pointer', textAlign: 'left', color: '#94a3b8', width: '100%',
                  }}
                >
                  <span style={{ color: statusColor(t.status), fontWeight: 600, flexShrink: 0, minWidth: 54 }}>{t.status.replace(/_/g, ' ').toUpperCase()}</span>
                  {TASK_TERMINAL_STATUS.has(t.status) && (
                    <span style={{ color: '#f59e0b', fontSize: 9, flexShrink: 0, letterSpacing: 0.5 }}>HISTORICAL</span>
                  )}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                  <span style={{ marginLeft: 'auto', color: '#475569', flexShrink: 0 }}>{t.worker}</span>
                </button>
              ))}
              {!taskSummary?.tasks?.length && (
                <div style={{ fontSize: 10.5, color: '#475569' }}>No background tasks.</div>
              )}
              {/* Selected task detail */}
              {selectedTask && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 0' }}>
                  {TASK_TERMINAL_STATUS.has(selectedTask.status) && (
                    <div style={{ fontSize: 10, color: '#f59e0b', letterSpacing: 1, fontWeight: 600 }} data-testid="jarvis-task-historical-label">
                      ⚠ HISTORICAL TASK — {selectedTask.status.toUpperCase()} (not current)
                    </div>
                  )}
                  <div className={cc.kv}><span className={cc.kvLabel}>AGENT</span><span className={cc.kvValue}>{selectedTask.selectedAgent || selectedTask.worker}</span></div>
                  {/* Terminal normalization (coherence milestone): a cancelled/
                      completed/failed task NEVER shows its stale currentStage or
                      progressMessage as though it were still running. */}
                  {TASK_TERMINAL_STATUS.has(selectedTask.status) ? (
                    <>
                      <div className={cc.kv}><span className={cc.kvLabel}>STAGE</span><span className={cc.kvValue} style={{ color: selectedTask.status === 'cancelled' ? '#f87171' : selectedTask.status === 'failed' ? '#f87171' : '#4ade80' }}>{selectedTask.status.replace(/_/g, ' ').toUpperCase()}</span></div>
                      <div className={cc.kv}><span className={cc.kvLabel}>PROGRESS</span><span className={cc.kvValue} style={{ maxWidth: 200 }}>{selectedTask.status === 'completed' ? (((selectedTask as any).resultText) ? `Result: ${String((selectedTask as any).resultText).slice(0, 140)}` : 'Task completed.') : `Final action before ${selectedTask.status}: ${selectedTask.progressMessage || '—'}`}</span></div>
                      <div className={cc.kv}><span className={cc.kvLabel}>ENDED</span><span className={cc.kvValue}>{selectedTask.completedAt ? new Date(selectedTask.completedAt).toLocaleTimeString() : '—'}</span></div>
                    </>
                  ) : (
                    <>
                      <div className={cc.kv}><span className={cc.kvLabel}>STAGE</span><span className={cc.kvValue}>{(selectedTask.currentStage || selectedTask.status).replace(/_/g, ' ').toUpperCase()}</span></div>
                      <div className={cc.kv}><span className={cc.kvLabel}>PROGRESS</span><span className={cc.kvValue} style={{ maxWidth: 200 }}>{selectedTask.progressMessage || '—'}</span></div>
                      <div className={cc.kv}><span className={cc.kvLabel}>ELAPSED</span><span className={cc.kvValue}>{elapsedLabel(selectedTask)}</span></div>
                    </>
                  )}
                  <div className={cc.kv}><span className={cc.kvLabel}>FILES</span><span className={cc.kvValue}>{selectedTask.filesChanged.length ? `${selectedTask.filesChanged.length} changed` : '—'}</span></div>
                  <div className={cc.kv}><span className={cc.kvLabel}>BUILD/TEST</span><span className={cc.kvValue}>{selectedTask.buildState.toUpperCase()} / {selectedTask.testState.toUpperCase()}</span></div>
                  <div className={cc.kv}><span className={cc.kvLabel}>CARD</span><span className={cc.kvValue}>{selectedTask.linkedBoardCardId || '—'}</span></div>
                  {selectedTask.blocker && (
                    <div style={{ fontSize: 10.5, color: '#fca5a5', marginTop: 2 }}>⚠ {selectedTask.blocker}</div>
                  )}
                  {/* Task events (real SSE stream) */}
                  {taskEvents.length > 0 && (
                    <div data-testid="jarvis-task-events" style={{ maxHeight: 90, overflowY: 'auto', marginTop: 2 }}>
                      {taskEvents.slice(-12).map((e) => (
                        <div key={e.id} style={{ display: 'flex', gap: 6, padding: '1px 0', fontSize: 10, borderBottom: '1px solid rgba(30,41,59,0.4)' }}>
                          <span style={{ color: '#475569', flexShrink: 0 }}>{new Date(e.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                          <span style={{ color: e.kind.includes('failed') || e.kind.includes('blocked') ? '#fca5a5' : e.kind.includes('completed') || e.kind.includes('verified') ? '#86efac' : '#94a3b8', overflowWrap: 'anywhere' }}>{e.summary}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Controls — pause/resume only when the worker supports it */}
                  <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                    {selectedTask.linkedBoardCardId && (
                      <button data-testid="jarvis-task-open-board" className={cc.ctl} onClick={() => navigate('/kanban/b-hermes')} style={{ padding: '3px 8px', fontSize: 9.5 }}>OPEN BOARD</button>
                    )}
                    {selectedTask.resumable && selectedTask.status === 'running' && (
                      <button data-testid="jarvis-task-pause" className={cc.ctl} disabled={taskControlBusy} onClick={() => handleTaskControl('pause')} style={{ padding: '3px 8px', fontSize: 9.5 }}>PAUSE</button>
                    )}
                    {selectedTask.resumable && (selectedTask.status === 'paused' || selectedTask.status === 'blocked') && (
                      <button data-testid="jarvis-task-resume" className={cc.ctl} disabled={taskControlBusy} onClick={() => handleTaskControl('resume')} style={{ padding: '3px 8px', fontSize: 9.5 }}>RESUME</button>
                    )}
                    {!['completed', 'failed', 'cancelled'].includes(selectedTask.status) && (
                      <button data-testid="jarvis-task-stop" className={cc.ctl} disabled={taskControlBusy} onClick={() => handleTaskControl('stop')} style={{ padding: '3px 8px', fontSize: 9.5, color: '#fca5a5' }}>STOP</button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        
          </div>
</motion.div>


        </>
        )}
      </div>


      {/* ── APPROVAL MODAL — real Hermes approval.request OR task-owned approval, never auto-approved ── */}
      {(activeRun?.pendingApproval || pendingTaskApproval) && (
        <div data-testid="jarvis-approval-modal" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 520, maxWidth: '92vw', background: '#0f172a', border: '1px solid #f59e0b', borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#fbbf24', letterSpacing: 1 }}>
              {pendingTaskApproval ? 'BACKGROUND TASK APPROVAL REQUIRED' : 'HERMES APPROVAL REQUIRED'}
            </div>
            {pendingTaskApproval && (
              <div style={{ marginTop: 4, fontSize: 10.5, color: '#64748b' }} data-testid="jarvis-approval-task-id">
                Task {pendingTaskApproval.taskId} — this approval belongs to the background task and stays pending while you talk.
              </div>
            )}
            <div style={{ marginTop: 10, fontSize: 13, color: '#e2e8f0' }}>
              <b>Action:</b> {(pendingTaskApproval || activeRun?.pendingApproval)?.action || 'Unknown action'}
            </div>
            {(pendingTaskApproval || activeRun?.pendingApproval)?.reason && (
              <div style={{ marginTop: 6, fontSize: 12, color: '#94a3b8' }}>
                <b>Reason:</b> {(pendingTaskApproval || activeRun?.pendingApproval)?.reason}
              </div>
            )}
            {(pendingTaskApproval || activeRun?.pendingApproval)?.command && (
              <pre style={{ marginTop: 8, fontSize: 11, color: '#cbd5e1', background: '#020617', border: '1px solid #1e293b', borderRadius: 6, padding: 8, overflowX: 'auto', whiteSpace: 'pre-wrap' }}>
                {(pendingTaskApproval || activeRun?.pendingApproval)?.command}
              </pre>
            )}
            {Array.isArray((pendingTaskApproval || activeRun?.pendingApproval)?.files) && (((pendingTaskApproval || activeRun?.pendingApproval)?.files) as string[]).length > 0 && (
              <div style={{ marginTop: 6, fontSize: 11, color: '#94a3b8' }}>
                <b>Files:</b> {((pendingTaskApproval || activeRun?.pendingApproval)?.files as string[]).join(', ')}
              </div>
            )}
            <div style={{ marginTop: 16, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                data-testid="jarvis-approval-deny"
                onClick={() => void (pendingTaskApproval ? handleTaskApproval('deny') : handleApproval('deny'))}
                disabled={approvalChoiceBusy}
                style={{ padding: '7px 18px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: '1px solid #7f1d1d', background: 'transparent', color: '#fca5a5', cursor: 'pointer' }}
              >
                Deny
              </button>
              <button
                data-testid="jarvis-approval-allow"
                onClick={() => void (pendingTaskApproval ? handleTaskApproval('allow') : handleApproval('allow'))}
                disabled={approvalChoiceBusy}
                style={{ padding: '7px 18px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: '1px solid #166534', background: '#14532d', color: '#dcfce7', cursor: 'pointer' }}
              >
                Allow
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
