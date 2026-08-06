import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { JarvisChat } from '../components/jarvis/JarvisChat';
import type { JarvisChatHandle, JarvisRuntimeStatus } from '../components/jarvis/JarvisChat';
import { JarvisWorkspaceBar } from '../components/jarvis/JarvisWorkspaceBar';
import { JARVIS_ORB_LABELS } from '../components/jarvis/JarvisOrb';
import { JarvisCore } from '../components/jarvis/JarvisCore';
import type { JarvisCoreState } from '../components/jarvis/JarvisCore';
import { deriveJarvisOrbState, JARVIS_ORB_EVENTS } from '../components/jarvis/jarvisOrbState';
import type { MicState } from '../components/jarvis/JarvisComposer';
import { AgentRuntimeSelector } from '../components/agents/AgentRuntimeSelector';
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
  const chatRef = useRef<JarvisChatHandle | null>(null);

  // ── Orb inputs: REAL signals only ──
  const [micState, setMicState] = useState<MicState>('idle');
  const [backendOffline, setBackendOffline] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState<JarvisRuntimeStatus>({
    state: 'idle', elapsedMs: 0, firstTokenMs: null, provider: null, model: null, error: null,
  });

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
   *  Only VOICE-originated direct replies are spoken; typed chat, routing
   *  events, tool events and diagnostics are never spoken. */
  const handleStreamDelta = useCallback((delta: string, channel: 'typed' | 'voice') => {
    if (channel !== 'voice') return;
    speechBufferRef.current += delta;
    flushSpeechBuffer(false);
  }, [flushSpeechBuffer]);

  const handleAssistantDone = useCallback((_text: string, channel: 'typed' | 'voice') => {
    if (channel !== 'voice') return;
    flushSpeechBuffer(true);
  }, [flushSpeechBuffer]);

  const voice = useVoiceIO({
    agentId: 'agent-jarvis',
    endSpeechSilenceMs: 900,
    onAutoSubmit: (text) => {
      // Conversation auto-submit — the exact streaming pipeline, no Send.
      chatRef.current?.sendMessage(text, 'voice');
    },
    onTranscript: (text) => setComposerText(text), // Manual: editable input
    onStateChange: () => { /* voiceState below is the single orb source */ },
  });
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  useEffect(() => { voiceRef.current?.setVoiceOverride?.(readPersistedVoice()); }, []);

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
      const res = await fetch('/api/jarvis/conversations', {
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
        const res = await fetch('/api/jarvis/conversations');
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

  // ── Backend connectivity (truthful health probe, 30 s cadence) ──
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch('/api/health/gateway');
        if (!res.ok) { if (!cancelled) setBackendOffline(true); return; }
        const data = await res.json();
        if (!cancelled) setBackendOffline(data?.status === 'offline');
      } catch { if (!cancelled) setBackendOffline(true); }
    };
    check();
    const id = window.setInterval(check, 30_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  /** RECONNECT (primary control while offline): probe immediately. */
  const handleReconnect = useCallback(() => {
    void (async () => {
      try {
        const res = await fetch('/api/health/gateway');
        if (!res.ok) { setBackendOffline(true); return; }
        const data = await res.json();
        setBackendOffline(data?.status === 'offline');
      } catch { setBackendOffline(true); }
    })();
  }, []);

  // ── Hermes live-run status + current run (real events, no fakes) ──
  const [hermesStatus, setHermesStatus] = useState<HermesStatus | null>(null);
  const [hermesRuns, setHermesRuns] = useState<HermesRun[]>([]);
  const [activeRun, setActiveRun] = useState<HermesRun | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch('/api/hermes-api/status');
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
        const res = await fetch('/api/hermes-api/runs');
        if (!res.ok) return;
        const runs: HermesRun[] = await res.json();
        if (cancelled) return;
        setHermesRuns(runs);
        const live = runs.find(r => ['waiting_for_approval', 'running', 'queued', 'stopping'].includes(r.status));
        if (live && live.id !== activeRun?.id) {
          const detail = await fetch(`/api/hermes-api/runs/${live.id}`);
          if (detail.ok && !cancelled) setActiveRun(await detail.json());
        } else if (!live) {
          setActiveRun(runs[0] || null); // most recent finished run for summary
        }
      } catch { /* panel stays on last good state */ }
    };
    poll();
    const id = window.setInterval(poll, 3000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [activeRun?.id]);

  const [approvalChoiceBusy, setApprovalChoiceBusy] = useState(false);
  const handleApproval = useCallback(async (choice: 'allow' | 'deny') => {
    if (!activeRun || approvalChoiceBusy) return;
    setApprovalChoiceBusy(true);
    try {
      await fetch(`/api/hermes-api/runs/${activeRun.id}/approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ choice }),
      });
    } catch { /* modal stays until the run state changes */ }
    setApprovalChoiceBusy(false);
  }, [activeRun, approvalChoiceBusy]);

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
    runtimeState: runtimeStatus.state,
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
        const res = await fetch('/api/health/system');
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
    <div className={cc.root} data-testid="jarvis-studio" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div className={styles.mainColumn} data-testid="jarvis-active-layout" style={{ position: 'relative', flex: 1, minHeight: 0 }}>

        {/* ── Glowing wordmark ── */}
        <motion.div
          className={cc.wordmark}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8 }}
        >
          JARVIS
        </motion.div>

        {/* ── Activity line (top-right, latest REAL event) ── */}
        <div className={cc.activityLine} data-testid="jarvis-activity-line">
          <span className={cc.activityDot} />
          <span data-testid="jarvis-activity-text">{latestActivity ? latestActivity.text : 'READY'}</span>
        </div>

        {/* ── Compact workspace strip (real repo detection) ── */}
        <div style={{ position: 'absolute', top: 10, left: 14, zIndex: 6, opacity: 0.9 }}>
          <JarvisWorkspaceBar />
        </div>

        {/* ── Compact status strip (real values) ── */}
        <div data-testid="jarvis-status-strip" style={{ position: 'absolute', top: 62, left: '50%', transform: 'translateX(-50%)', display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 14, zIndex: 5 }}>
          {statusChip('', backendOffline ? 'BACKEND OFFLINE' : 'CONNECTED', !backendOffline)}
          {statusChip('PROVIDER', runtimeStatus.provider || '—')}
          {statusChip('MODEL', runtimeStatus.model || '—')}
          {statusChip('HERMES', hermesStatus?.gateway?.reachable ? 'ONLINE' : 'OFFLINE', !!hermesStatus?.gateway?.reachable)}
          {statusChip('STT', hermesStatus?.stt?.configured ? hermesStatus.stt.provider : 'none', !!hermesStatus?.stt?.configured)}
          {statusChip('TTS', hermesStatus?.tts?.configured ? hermesStatus.tts.provider : 'none', !!hermesStatus?.tts?.configured)}
          {statusChip('MIC', mode === 'conversation' ? voice.voiceState.toUpperCase() : micState === 'idle' ? 'manual' : micState, mode === 'conversation')}
          {statusChip('VOICE', voiceOutEnabled ? selectedVoice.replace('aura-', '') : 'off', voiceOutEnabled)}
        </div>

        {/* ── CENTRAL CORE ── */}
        <div className={cc.centerColumn}>
          <div data-testid="jarvis-dashboard" className={cc.coreWrap}>
            <div data-testid="jarvis-orb-wrapper" style={{ position: 'relative' }}>
              <div data-testid="jarvis-orb-core" style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <JarvisCore
                  state={orbState as JarvisCoreState}
                  inputLevel={orbState === 'listening' ? inputLevel : 0}
                  outputLevel={orbState === 'speaking' ? outputLevel : 0}
                  size={340}
                  testIdPrefix="jarvis-orb"
                />
              </div>
              {/* Primary control — centered ON the core (inside the wrapper,
                  outside jarvis-orb-core so state words never sit in the core) */}
              <button
                data-testid="jarvis-primary-control"
                className={cc.primaryControl}
                onClick={primary.onClick}
                disabled={primary.disabled}
              >
                {primary.label}
              </button>
            </div>
            <div data-testid="jarvis-orb-status-label" className={cc.stateLabel}>{JARVIS_ORB_LABELS[orbState]}</div>
            <span data-testid="jarvis-orb-label" aria-hidden="true" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{JARVIS_ORB_LABELS[orbState]}</span>

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
              <div data-testid="jarvis-playback-error" style={{ fontSize: 11, color: '#fca5a5', border: '1px solid #7f1d1d', borderRadius: 6, padding: '6px 8px', marginTop: 6 }}>
                Voice playback error: {voice.playbackError}
              </div>
            )}
          </div>
        </div>

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
          <div className={cc.kv}><span className={cc.kvLabel}>PROVIDER</span><span className={cc.kvValue}>{runtimeStatus.provider || '—'}</span></div>
          <div className={cc.kv}><span className={cc.kvLabel}>MODEL</span><span className={cc.kvValue} style={{ maxWidth: 150 }}>{runtimeStatus.model || '—'}</span></div>
        </motion.div>

        {/* ── ACTIVE RUN (bottom-right, real Hermes events) ── */}
        <motion.div
          className={`${cc.panel} ${cc.activeRun}`}
          data-testid="jarvis-current-run"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.25 }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
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
          {activeRun ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div className={cc.kv}><span className={cc.kvLabel}>AGENT</span><span className={cc.kvValue}>Hermes</span></div>
              <div className={cc.kv}><span className={cc.kvLabel}>TASK</span><span className={cc.kvValue} style={{ maxWidth: 190 }}>{activeRun.prompt.slice(0, 60)}</span></div>
              <div className={cc.kv}><span className={cc.kvLabel}>STAGE</span><span className={cc.kvValue}>{activeRun.status.replace(/_/g, ' ').toUpperCase()}</span></div>
              <div className={cc.kv}><span className={cc.kvLabel}>FILES</span><span className={cc.kvValue}>{filesChanged > 0 ? `${filesChanged} changed` : '—'}</span></div>
              <div className={cc.kv}><span className={cc.kvLabel}>BUILD</span><span className={cc.kvValue}>{activeRun.status === 'completed' ? 'PASSED' : activeRun.status === 'failed' ? 'FAILED' : '—'}</span></div>
              <div className={cc.kv}><span className={cc.kvLabel}>CARD</span><span className={cc.kvValue}>{activeRun.cardId || '—'}</span></div>
              <div className={cc.kv}><span className={cc.kvLabel}>RUN ID</span><span className={cc.kvValue}>{activeRun.hermesRunId.slice(0, 16)}…</span></div>
              {activeRun.status === 'completed' && activeRun.finalText && (
                <div style={{ fontSize: 10.5, color: '#86efac', marginTop: 4 }}>✓ {activeRun.finalText.slice(0, 110)}</div>
              )}
              {activeRun.status === 'failed' && (
                <div style={{ fontSize: 10.5, color: '#fca5a5', marginTop: 4 }}>✗ run failed — see activity</div>
              )}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: '#64748b' }}>No active run</div>
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
        </motion.div>

        {/* ── Command transcript dock (collapsible, labeled lines) ── */}
        <div className={`${cc.panel} ${cc.transcriptDock}`} data-testid="jarvis-chat-workspace">
          <button
            data-testid="jarvis-transcript-toggle"
            className={cc.transcriptToggle}
            onClick={() => setTranscriptOpen((v) => !v)}
          >
            <span>TRANSCRIPT</span>
            <span>{transcriptOpen ? '▾ HIDE' : '▴ SHOW'}</span>
          </button>
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }} className={transcriptOpen ? undefined : cc.collapsed}>
            <div style={{ flex: 1, minHeight: 120, maxHeight: '32vh', overflowY: 'auto', padding: '0 14px' }}>
              <JarvisChat
                ref={chatRef}
                conversationId={activeConversationId}
                onConversationCreated={(id) => setActiveConversationId(id)}
                onStatusChange={setRuntimeStatus}
                composerText={composerText}
                onComposerTextChange={setComposerText}
                onMicStateChange={setMicState}
                onStreamDelta={handleStreamDelta}
                onAssistantResponse={handleAssistantDone}
                hideComposerMic
                transcriptVariant="command"
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── APPROVAL MODAL — real Hermes approval.request, never auto-approved ── */}
      {activeRun?.pendingApproval && (
        <div data-testid="jarvis-approval-modal" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 520, maxWidth: '92vw', background: '#0f172a', border: '1px solid #f59e0b', borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#fbbf24', letterSpacing: 1 }}>HERMES APPROVAL REQUIRED</div>
            <div style={{ marginTop: 10, fontSize: 13, color: '#e2e8f0' }}>
              <b>Action:</b> {activeRun.pendingApproval.action || 'Unknown action'}
            </div>
            {activeRun.pendingApproval.reason && (
              <div style={{ marginTop: 6, fontSize: 12, color: '#94a3b8' }}>
                <b>Reason:</b> {activeRun.pendingApproval.reason}
              </div>
            )}
            {activeRun.pendingApproval.command && (
              <pre style={{ marginTop: 8, fontSize: 11, color: '#cbd5e1', background: '#020617', border: '1px solid #1e293b', borderRadius: 6, padding: 8, overflowX: 'auto', whiteSpace: 'pre-wrap' }}>
                {activeRun.pendingApproval.command}
              </pre>
            )}
            {Array.isArray(activeRun.pendingApproval.files) && activeRun.pendingApproval.files.length > 0 && (
              <div style={{ marginTop: 6, fontSize: 11, color: '#94a3b8' }}>
                <b>Files:</b> {activeRun.pendingApproval.files.join(', ')}
              </div>
            )}
            <div style={{ marginTop: 16, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                data-testid="jarvis-approval-deny"
                onClick={() => void handleApproval('deny')}
                disabled={approvalChoiceBusy}
                style={{ padding: '7px 18px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: '1px solid #7f1d1d', background: 'transparent', color: '#fca5a5', cursor: 'pointer' }}
              >
                Deny
              </button>
              <button
                data-testid="jarvis-approval-allow"
                onClick={() => void handleApproval('allow')}
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
