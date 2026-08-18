// @ts-nocheck
/**
 * JarvisConversationPanel — the Jarvis conversation surface for the MAIN
 * Mission Control cockpit (the user-facing product surface).
 *
 * Milestone 1: this panel IS the conversational experience:
 *   - live streaming transcript (SSE chunks render as they arrive)
 *   - Manual / Conversation modes (no Ctrl+J needed)
 *   - one compact status strip: provider, model, connection, mic, voice out
 *   - visible voice selector (British + American Deepgram voices)
 *   - compact command menu (replaces the old Command Matrix grid)
 *   - collapsible diagnostics drawer (technical telemetry lives here)
 *   - compact delegated-task strip (never dominates the page)
 *
 * Reuse contract — NO new engine code:
 *   - VAD / mic / auto-submit / barge-in / playback lifecycle: useVoiceIO
 *   - Jarvis request path: POST /api/jarvis/conversations + message/stream
 *     (the SAME SSE path JarvisChat uses — parseSseFrames copied from it)
 *   - TTS: useVoiceIO.speak → /api/voice/tts (voice override supported)
 *   - transcript history: shared useJarvis store + JarvisDrawer localStorage
 *   - delegated tasks: live runs from useData (no new backend calls)
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Send, Square, Volume2, VolumeX, PhoneOff, Terminal, ChevronDown, ChevronUp, Activity, Zap } from 'lucide-react';
import { useJarvis } from '../../store/appStore';
import { useData } from '../../store/dataStore';
import { useVoiceIO } from '../../hooks/useVoiceIO';
import { JARVIS_ORB_EVENTS } from './jarvisOrbState';
import { apiFetch, apiUrl } from '../../api/client';

/* ── Session persistence keys ─────────────────────────────────────────────── */
const CONV_MODE_KEY = 'agenticos:jarvis:conversationMode';
const VOICE_KEY = 'agenticos:jarvis:voice';
/** Shared transcript persistence — SAME key as JarvisDrawer. */
const TRANSCRIPT_KEY = 'agenticos:jarvis:transcript';

/* ── Visible voice selection (Deepgram Aura voices supported by the TTS
      provider configured on the backend). British + American choices. ── */
export const JARVIS_VOICES = [
  { id: 'aura-helios-en', label: 'Helios · British English', accent: 'British' },
  { id: 'aura-zeus-en', label: 'Zeus · American English', accent: 'American' },
  { id: 'aura-athena-en', label: 'Athena · American English', accent: 'American' },
  { id: 'aura-orion-en', label: 'Orion · American English (natural)', accent: 'American' },
];

/* ── Compact command menu — same instruction set as the Command Matrix,
      rendered as a popover instead of a permanent grid. ── */
const COMMAND_PRESETS = [
  { cmd: '/new', desc: 'Fresh thread' },
  { cmd: '/goal', desc: 'Standing objective' },
  { cmd: '/profile', desc: 'Profile info' },
  { cmd: '/background', desc: 'Async mission' },
  { cmd: '/personality', desc: 'Set persona' },
  { cmd: '/kanban', desc: 'Work queue' },
];

function parseSseFrames(buffer: string) {
  const frames = buffer.split('\n\n');
  const rest = frames.pop() || '';
  return {
    rest,
    events: frames.map((frame) => {
      let event = 'message';
      let data = '';
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      return { event, data };
    }),
  };
}

function loadPersistedTranscript(): any[] {
  try {
    const raw = localStorage.getItem(TRANSCRIPT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function savePersistedTranscript(entries: any[]) {
  try {
    localStorage.setItem(TRANSCRIPT_KEY, JSON.stringify(entries));
  } catch {
    /* storage unavailable — transcript stays in memory */
  }
}

function readConversationMode(): 'manual' | 'conversation' {
  try {
    return sessionStorage.getItem(CONV_MODE_KEY) === 'conversation' ? 'conversation' : 'manual';
  } catch {
    return 'manual';
  }
}

function writeConversationMode(mode: 'manual' | 'conversation') {
  try {
    sessionStorage.setItem(CONV_MODE_KEY, mode);
  } catch {
    /* private mode — degrade gracefully */
  }
}

function readPersistedVoice(): string {
  try {
    const v = sessionStorage.getItem(VOICE_KEY);
    return v && JARVIS_VOICES.some((x) => x.id === v) ? v : JARVIS_VOICES[0].id;
  } catch {
    return JARVIS_VOICES[0].id;
  }
}

export const JarvisConversationPanel: React.FC<{ backendOffline?: boolean }> = ({ backendOffline = false }) => {
  const jarvis = useJarvis();
  const data = useData();

  const [mode, setMode] = useState<'manual' | 'conversation'>(readConversationMode);
  const [micEnabled, setMicEnabled] = useState(true);
  const [voiceOutEnabled, setVoiceOutEnabled] = useState(true);
  const [textInput, setTextInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState<string>(readPersistedVoice);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [liveWorkOpen, setLiveWorkOpen] = useState(false);
  const [runtimeState, setRuntimeState] = useState<any>({ state: 'idle', activeAgent: null, activeProject: null, activeTask: null, activeTool: null, pendingTaskCount: 0 });
  const [liveEvents, setLiveEvents] = useState<any[]>([]);
  const [commandMenuOpen, setCommandMenuOpen] = useState(false);
  const [streamMeta, setStreamMeta] = useState<{ provider?: string; model?: string; route?: string }>({});
  const [liveStreaming, setLiveStreaming] = useState<{ id: string; text: string } | null>(null);
  // TEMP DIAGNOSTIC — visible live-chain trace (remove after confirmation).
  const [convTrace, setConvTrace] = useState({ vad: '—', transcript: '—', autosubmit: '—', request: '—' });

  // Refs — handlers and engine callbacks must never act on stale state.
  const modeRef = useRef(mode);
  const micEnabledRef = useRef(true);
  const voiceOutEnabledRef = useRef(true);
  const voiceRef = useRef<any>(null);
  // §9 input ownership (Jarvis repair): manual composer edits / typed
  // submissions take ownership of the input. In-flight STT transcripts are
  // stale once the user has typed, so conversation-mode auto-submit must
  // never fire a voice turn over typed text.
  const manualEditSinceVoiceRef = useRef(false);
  const processingRef = useRef(false);
  const submitSeqRef = useRef(0);
  const streamAbortRef = useRef<AbortController | null>(null);
  const lastSubmitRef = useRef<{ text: string; at: number } | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const liveTextRef = useRef('');
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  /** Lazily create/reuse the Jarvis conversation for the streaming path. */
  const ensureConversationId = useCallback(async (): Promise<string> => {
    if (conversationIdRef.current) return conversationIdRef.current;
    const res = await apiFetch('/api/jarvis/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Mission Control Cockpit' }),
    });
    if (!res.ok) throw new Error(`conversation create HTTP ${res.status}`);
    const body = await res.json();
    conversationIdRef.current = body.id;
    return body.id;
  }, []);

  /** Execute ONE Jarvis turn via the EXISTING streaming request path.
   *  Text streams visibly; TTS speaks once after the reply completes. */
  const executeStreamingTurn = useCallback(async (text: string, channel: 'typed' | 'voice') => {
    const now = Date.now();
    const last = lastSubmitRef.current;
    if (last && last.text === text && now - last.at < 4000) {
      // TEMP DIAGNOSTIC — visible chain trace (remove after confirmation).
      setConvTrace((t) => ({ ...t, autosubmit: 'DEDUPED (identical text <4s)' }));
      return; // duplicate guard
    }
    if (processingRef.current) {
      // TEMP DIAGNOSTIC — visible chain trace (remove after confirmation).
      setConvTrace((t) => ({ ...t, autosubmit: 'GUARD: turn in flight' }));
      return;
    }
    lastSubmitRef.current = { text, at: now };
    processingRef.current = true;
    const turnId = ++submitSeqRef.current;
    const controller = new AbortController();
    streamAbortRef.current = controller;

    // Orb: thinking while the reply streams (real state, event-driven).
    window.dispatchEvent(new CustomEvent(JARVIS_ORB_EVENTS.voiceState, { detail: 'thinking' }));

    const entryId = `mc-jrv-${turnId}-${Date.now()}`;
    liveTextRef.current = '';
    setLiveStreaming({ id: entryId, text: '' });

    try {
      const conversationId = await ensureConversationId();
      const streamUrl = apiUrl(`/api/jarvis/conversations/${conversationId}/message/stream`);
      // TEMP DIAGNOSTIC — visible chain trace (remove after confirmation).
      setConvTrace((t) => ({ ...t, request: `POST ${streamUrl}` }));
      const res = await fetch(streamUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: text,
          inputChannel: channel,
          operationId: `mc-op-${turnId}`,
        }),
        signal: controller.signal,
      });
      // TEMP DIAGNOSTIC — visible chain trace (remove after confirmation).
      setConvTrace((t) => ({ ...t, request: `HTTP ${res.status} ${res.ok ? 'OK' : 'FAILED'}` }));
      if (!res.ok || !res.body) throw new Error(`stream HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let route = 'direct';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { rest, events } = parseSseFrames(buffer);
        buffer = rest;
        for (const ev of events) {
          let payload: any = {};
          try { payload = ev.data ? JSON.parse(ev.data) : {}; } catch { /* keep defaults */ }
          if (ev.event === 'status' || ev.event === 'chunk') {
            if (payload.provider || payload.model) {
              setStreamMeta((m) => ({ ...m, provider: payload.provider || m.provider, model: payload.model || m.model }));
            }
          }
          if (ev.event === 'chunk' && typeof payload.delta === 'string') {
            liveTextRef.current += payload.delta;
            setLiveStreaming({ id: entryId, text: liveTextRef.current });
          }
          if (ev.event === 'done') {
            route = payload.route || 'direct';
            setStreamMeta((m) => ({ ...m, route }));
          }
          if (ev.event === 'error') {
            throw new Error(payload.error || 'Jarvis stream error');
          }
        }
      }

      if (turnId !== submitSeqRef.current) return; // stale turn

      const finalText = liveTextRef.current.trim();
      setLiveStreaming(null);
      liveTextRef.current = '';

      if (finalText) {
        jarvis.addTranscript({
          id: entryId,
          role: 'jarvis',
          text: route === 'direct' ? finalText : `${finalText}\n(Delegated · ${route})`,
          timestamp: new Date().toISOString(),
        });
      }

      // Speak DIRECT Jarvis replies exactly once. Delegated outcomes are
      // tracked in the delegated strip — not spoken over the conversation.
      // Orb state during/after playback is driven by the REAL playback events
      // the engine dispatches (playbackStarted/playbackEnded) — no fake states.
      if (voiceOutEnabledRef.current && route === 'direct' && finalText) {
        await voiceRef.current?.speak(finalText);
      }

      if (modeRef.current === 'conversation' && !voiceOutEnabledRef.current) {
        // With voice output disabled there is no playback-ended event, so
        // resume listening explicitly. With audio on, the hook re-arms on
        // real playback end.
        voiceRef.current?.startListening();
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.error('[JarvisCockpit] Turn failed:', err);
      setLiveStreaming(null);
      liveTextRef.current = '';
      if (turnId === submitSeqRef.current) {
        jarvis.addTranscript({
          id: `mc-err-${turnId}-${Date.now()}`,
          role: 'jarvis',
          text: `I could not complete that request (${err?.message || 'stream error'}). Please try again.`,
          timestamp: new Date().toISOString(),
        });
        window.dispatchEvent(new CustomEvent(JARVIS_ORB_EVENTS.voiceState, { detail: 'error' }));
        setTimeout(() => {
          if (turnId === submitSeqRef.current) {
            window.dispatchEvent(new CustomEvent(JARVIS_ORB_EVENTS.voiceState, {
              detail: modeRef.current === 'conversation' ? 'listening' : 'idle',
            }));
            if (modeRef.current === 'conversation') voiceRef.current?.startListening();
          }
        }, 1200);
      }
    } finally {
      if (streamAbortRef.current === controller) streamAbortRef.current = null;
      if (turnId === submitSeqRef.current) processingRef.current = false;
    }
  }, [jarvis, ensureConversationId]);

  /** Conversation auto-submit — fires exactly once per valid end-of-speech
   *  transcript (the hook dedupes identical text and flags each blob). */
  const handleAutoSubmit = useCallback((text: string) => {
    // §9 input ownership (Jarvis repair): a manual composer edit or a typed
    // submission since the voice capture began makes this transcript stale —
    // the engine drops it by generation identity, but this guard is the final
    // deterministic barrier so a stale STT can never fire a voice turn over
    // typed text in conversation mode.
    if (manualEditSinceVoiceRef.current) {
      setConvTrace((t) => ({ ...t, autosubmit: 'STALE-STT DROPPED (manual ownership)' }));
      return;
    }
    // TEMP DIAGNOSTIC — visible chain trace (remove after confirmation).
    setConvTrace((t) => ({ ...t, transcript: text.slice(0, 40), autosubmit: 'FIRED' }));
    jarvis.addTranscript({
      id: `mc-usr-${submitSeqRef.current + 1}-${Date.now()}`,
      role: 'user',
      text,
      timestamp: new Date().toISOString(),
    });
    executeStreamingTurn(text, 'voice');
  }, [jarvis, executeStreamingTurn]);

  // ── The EXISTING conversation engine — no new VAD/mic/TTS code. ──
  const voice = useVoiceIO({
    agentId: 'agent-jarvis',
    endSpeechSilenceMs: 750, // Voice-reliability closure: 900 → 750ms (spec window 700–1200 ms)
    onAutoSubmit: handleAutoSubmit,
    onBargeIn: () => {
      // User barged in while Jarvis was speaking: abort the in-flight model
      // stream AND invalidate the current turn so its late `speak()` never
      // re-enters the voice path (the hook already halted audio + cleared TTS).
      streamAbortRef.current?.abort();
      submitSeqRef.current++;
      processingRef.current = false;
      voiceRef.current?.killSpeech?.();
    },
    onControlCommand: (cmd) => {
      // Local control command — abort the in-flight model stream and
      // invalidate the current turn so its late output can never re-enter.
      streamAbortRef.current?.abort();
      submitSeqRef.current++;
      processingRef.current = false;
      voiceRef.current?.killSpeech?.();
      if (cmd.kind === 'terminate') {
        // Clear pending conversational-turn state; return to ready.
        jarvis.clearTranscript();
      }
    },
    // Manual mode: transcript lands in the EDITABLE input — user presses Send.
    onTranscript: (text) => {
      // TEMP DIAGNOSTIC — visible chain trace (remove after confirmation).
      setConvTrace((t) => ({ ...t, transcript: text.slice(0, 40), autosubmit: 'MANUAL-INPUT branch (NOT submitted)' }));
      setTextInput(text);
    },
    onStateChange: (s) => {
      jarvis.setStatus(s);
      // Feed the EXISTING orb pipeline (MissionControlPage listens for this).
      window.dispatchEvent(new CustomEvent(JARVIS_ORB_EVENTS.voiceState, { detail: s }));
    },
  });
  voiceRef.current = voice;

  // TEMP DIAGNOSTIC — visible live-chain trace listener (remove after confirmation).
  useEffect(() => {
    const onTrace = (e: any) => {
      const d = e.detail || {};
      setConvTrace((t) => ({ ...t, vad: `${d.stage}: ${d.value || ''}` }));
    };
    window.addEventListener('jarvis:conv-trace', onTrace);
    return () => window.removeEventListener('jarvis:conv-trace', onTrace);
  }, []);

  // Apply the persisted voice selection to the engine on mount.
  useEffect(() => {
    voiceRef.current?.setVoiceOverride?.(readPersistedVoice());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Shared transcript persistence (same store as JarvisDrawer) ──
  useEffect(() => {
    if (jarvis.transcript.length === 0) {
      loadPersistedTranscript().forEach((e) => jarvis.addTranscript(e));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (jarvis.transcript.length > 0) savePersistedTranscript(jarvis.transcript);
  }, [jarvis.transcript]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [jarvis.transcript, liveStreaming]);

  // ── Session persistence: resume conversation mode across navigation ──
  const mountedRef = useRef(false);
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    if (readConversationMode() === 'conversation') {
      modeRef.current = 'conversation';
      setMode('conversation');
      voiceRef.current?.startConversation();
    }
  }, []);

  useEffect(() => {
    return () => {
      if (modeRef.current === 'conversation') voiceRef.current?.endConversation();
      streamAbortRef.current?.abort();
    };
  }, []);

  // ── Live Work: poll runtime-state + live-events every 3s ──
  // runtime-state gives the coarse Jarvis execution state.
  // live-events gives real structured operational events from background_task_events.
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const [stateRes, eventsRes] = await Promise.all([
          apiFetch('/api/jarvis/runtime-state'),
          apiFetch('/api/jarvis/live-events?limit=20'),
        ]);
        if (cancelled) return;
        if (stateRes.ok) {
          const data = await stateRes.json();
          if (!cancelled) setRuntimeState(data);
        }
        if (eventsRes.ok) {
          const events = await eventsRes.json();
          if (!cancelled && Array.isArray(events)) setLiveEvents(events);
        }
      } catch { /* best effort */ }
    };
    poll();
    const id = window.setInterval(poll, 3000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  // ── Controls ──
  const handleModeToggle = useCallback(async (next: 'manual' | 'conversation') => {
    if (next === modeRef.current) return;
    if (next === 'conversation') {
      if (!micEnabledRef.current) return;
      modeRef.current = 'conversation';
      setMode('conversation');
      writeConversationMode('conversation');
      const ok = await voiceRef.current?.startConversation();
      if (!ok) {
        modeRef.current = 'manual';
        setMode('manual');
        writeConversationMode('manual');
      }
    } else {
      modeRef.current = 'manual';
      setMode('manual');
      writeConversationMode('manual');
      submitSeqRef.current++;
      streamAbortRef.current?.abort();
      processingRef.current = false;
      voiceRef.current?.endConversation();
      jarvis.setStatus('idle');
      window.dispatchEvent(new CustomEvent(JARVIS_ORB_EVENTS.voiceState, { detail: 'idle' }));
    }
  }, [jarvis]);

  const handleMicToggle = useCallback(() => {
    const next = !micEnabledRef.current;
    micEnabledRef.current = next;
    setMicEnabled(next);
    if (!next && modeRef.current === 'conversation') handleModeToggle('manual');
  }, [handleModeToggle]);

  const handleVoiceOutToggle = useCallback(() => {
    const next = !voiceOutEnabledRef.current;
    voiceOutEnabledRef.current = next;
    setVoiceOutEnabled(next);
    voiceRef.current?.setVoiceEnabled(next);
  }, []);

  const handleVoiceSelect = useCallback((voiceId: string) => {
    setSelectedVoice(voiceId);
    try { sessionStorage.setItem(VOICE_KEY, voiceId); } catch { /* ignore */ }
    voiceRef.current?.setVoiceOverride?.(voiceId);
  }, []);

  const handleTextSend = useCallback(async () => {
    const text = textInput.trim();
    if (!text || isSending) return;
    // §9 input ownership (Jarvis repair): a typed submission is authoritative.
    // Invalidate every in-flight voice event (the engine drops stale STT by
    // generation identity) and take manual ownership so no late auto-submit
    // can fire a competing voice turn.
    manualEditSinceVoiceRef.current = true;
    voiceRef.current?.notifyManualEdit?.();
    setIsSending(true);
    jarvis.addTranscript({
      id: `mc-usr-t-${Date.now()}`,
      role: 'user',
      text,
      timestamp: new Date().toISOString(),
    });
    setTextInput('');
    await executeStreamingTurn(text, 'typed');
    setIsSending(false);
    // The typed turn has completed; clear manual ownership so the NEXT voice
    // capture (a genuinely new capture) can auto-submit again.
    manualEditSinceVoiceRef.current = false;
  }, [textInput, isSending, jarvis, executeStreamingTurn]);

  const handleManualMic = useCallback(() => {
    if (!micEnabledRef.current) return;
    if (modeRef.current === 'conversation') return; // conversation owns the mic
    voiceRef.current?.toggleListening();
  }, []);

  const handleCommandSelect = useCallback((cmd: string) => {
    setTextInput((prev) => (prev ? `${prev} ${cmd}` : cmd));
    setCommandMenuOpen(false);
    inputRef.current?.focus();
  }, []);

  // ── Derived live data (existing registry — no new backend calls) ──
  const delegatedRuns = (data.runs || []).filter((r: any) =>
    ['running', 'queued', 'executing', 'waiting', 'waiting_for_approval', 'approval_required'].includes(r.status));
  const failedRuns = (data.runs || []).filter((r: any) => r.status === 'failed').slice(0, 4);
  const connectedProviders = (data.providers || []).filter((p: any) => ['connected', 'healthy', 'active'].includes(p.status));
  const activeAgents = (data.agents || []).filter((a: any) => a.status === 'active');
  const voiceLabel = JARVIS_VOICES.find((v) => v.id === selectedVoice)?.label || selectedVoice;

  const chip: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    fontSize: 10, fontWeight: 600, color: '#94a3b8', whiteSpace: 'nowrap',
  };
  const dot = (ok: boolean) => (
    <span style={{ width: 7, height: 7, borderRadius: '50%', background: ok ? '#34d399' : '#f87171', display: 'inline-block' }} />
  );

  return (
    <div data-testid="mission-jarvis-panel" className="flex flex-col gap-3" style={{ minWidth: 0, flex: 1 }}>
      {/* ── 1. Compact status strip: provider · model · connection · mic · voice ── */}
      <div
        data-testid="mission-status-strip"
        className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded border border-slate-800 bg-slate-950/70 px-3 py-1.5"
      >
        <span style={chip}>
          MODE
          <b style={{ color: mode === 'conversation' ? '#67e8f9' : '#cbd5e1' }}>
            {mode === 'conversation' ? 'CONVERSATION' : 'MANUAL'}
          </b>
        </span>
        <span data-testid="mission-conv-state" style={chip}>
          STATE <b style={{ color: '#cbd5e1' }}>{mode === 'conversation' ? (voice.voiceState ? voice.voiceState.toUpperCase() : '—') : 'MANUAL'}</b>
        </span>
        <span style={chip}>
          {dot(!backendOffline)} {backendOffline ? 'BACKEND OFFLINE' : 'CONNECTED'}
        </span>
        <span style={chip}>
          PROVIDER <b style={{ color: '#cbd5e1' }}>{streamMeta.provider || '—'}</b>
        </span>
        <span style={chip}>
          MODEL <b style={{ color: '#cbd5e1' }}>{streamMeta.model || '—'}</b>
        </span>
        <span style={chip}>{dot(micEnabled)} MIC {micEnabled ? 'ON' : 'OFF'}</span>
        <span style={chip}>{dot(voiceOutEnabled)} VOICE {voiceOutEnabled ? 'ON' : 'OFF'}</span>

        {/* Visible voice selector (British + American choices) */}
        <select
          data-testid="mission-voice-select"
          value={selectedVoice}
          onChange={(e) => handleVoiceSelect(e.target.value)}
          title={`Jarvis voice: ${voiceLabel}`}
          className="rounded border border-slate-700 bg-slate-950/60 px-2 text-[10px] text-slate-200 outline-none"
          style={{ height: 22, cursor: 'pointer' }}
        >
          {JARVIS_VOICES.map((v) => (
            <option key={v.id} value={v.id}>{v.label}</option>
          ))}
        </select>
      </div>

      {/* TEMP DIAGNOSTIC — visible live-chain trace. Remove after the physical-mic
          acceptance test passes: MODE | VAD | TRANSCRIPT | AUTOSUBMIT | REQUEST */}
      <div
        data-testid="mission-conv-trace"
        className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded border border-amber-500/30 bg-amber-500/5 px-3 py-1 text-[10px]"
        style={{ color: '#fbbf24' }}
      >
        <span className="font-bold">TRACE</span>
        <span>MODE: <b>{mode}</b></span>
        <span>VAD: <b>{convTrace.vad}</b></span>
        <span>TRANSCRIPT: <b>{convTrace.transcript}</b></span>
        <span>AUTOSUBMIT: <b>{convTrace.autosubmit}</b></span>
        <span>REQUEST: <b>{convTrace.request}</b></span>
      </div>

      {/* ── 2. Mode selector + conversation controls ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded border border-slate-700" role="radiogroup" aria-label="Jarvis voice mode">
          <button
            type="button"
            data-testid="mission-mode-manual"
            aria-pressed={mode === 'manual'}
            onClick={() => handleModeToggle('manual')}
            className="px-3 py-1.5 text-xs font-semibold"
            style={{
              background: mode === 'manual' ? '#164e63' : 'transparent',
              color: mode === 'manual' ? '#67e8f9' : '#94a3b8',
              border: 'none', cursor: 'pointer',
            }}
          >
            Manual
          </button>
          <button
            type="button"
            data-testid="mission-mode-conversation"
            aria-pressed={mode === 'conversation'}
            onClick={() => handleModeToggle('conversation')}
            className="px-3 py-1.5 text-xs font-semibold"
            style={{
              background: mode === 'conversation' ? '#164e63' : 'transparent',
              color: mode === 'conversation' ? '#67e8f9' : '#94a3b8',
              border: 'none', borderLeft: '1px solid #334155', cursor: 'pointer',
            }}
          >
            Conversation
          </button>
        </div>

        {/* Compact command menu (replaces the permanent Command Matrix grid) */}
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            data-testid="mission-command-menu"
            onClick={() => setCommandMenuOpen((o) => !o)}
            className="flex items-center gap-1 rounded border border-slate-700 bg-slate-950/60 px-2.5 py-1.5 text-[10px] font-semibold text-slate-300"
            style={{ cursor: 'pointer' }}
          >
            <Terminal size={11} /> COMMANDS {commandMenuOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
          {commandMenuOpen && (
            <div
              data-testid="mission-command-menu-list"
              className="absolute z-20 mt-1 w-52 rounded border border-slate-700 bg-slate-950 py-1 shadow-xl"
            >
              {COMMAND_PRESETS.map((c) => (
                <button
                  key={c.cmd}
                  type="button"
                  onClick={() => handleCommandSelect(c.cmd)}
                  className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[11px] text-slate-300 hover:bg-slate-800"
                  style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}
                >
                  <span className="font-mono font-semibold text-cyan-300">{c.cmd}</span>
                  <span className="text-slate-500">{c.desc}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ flex: 1 }} />

        <button
          type="button"
          data-testid="mission-conv-mic-toggle"
          onClick={handleMicToggle}
          title={micEnabled ? 'Disable microphone' : 'Enable microphone'}
          className="flex items-center justify-center rounded"
          style={{ width: 28, height: 28, border: '1px solid #334155', background: '#0f172a', color: micEnabled ? '#94a3b8' : '#f87171', cursor: 'pointer' }}
        >
          {micEnabled ? <Mic size={14} /> : <MicOff size={14} />}
        </button>

        <button
          type="button"
          data-testid="mission-conv-voiceout-toggle"
          onClick={handleVoiceOutToggle}
          title={voiceOutEnabled ? 'Disable voice output' : 'Enable voice output'}
          className="flex items-center justify-center rounded"
          style={{ width: 28, height: 28, border: '1px solid #334155', background: '#0f172a', color: voiceOutEnabled ? '#94a3b8' : '#f87171', cursor: 'pointer' }}
        >
          {voiceOutEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
        </button>

        {voice.isSpeaking && (
          <button
            type="button"
            data-testid="mission-conv-stop-speaking"
            onClick={() => voiceRef.current?.stopSpeaking()}
            className="flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-semibold"
            style={{ border: '1px solid rgba(248,113,113,0.4)', background: 'rgba(248,113,113,0.1)', color: '#f87171', cursor: 'pointer' }}
          >
            <Square size={11} /> Stop
          </button>
        )}

        {mode === 'conversation' && (
          <button
            type="button"
            data-testid="mission-conv-end"
            onClick={() => handleModeToggle('manual')}
            className="flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-semibold"
            style={{ border: '1px solid #334155', background: '#0f172a', color: '#cbd5e1', cursor: 'pointer' }}
          >
            <PhoneOff size={11} /> End
          </button>
        )}
      </div>

      {/* ── 3. Live conversation transcript ── */}
      <div
        data-testid="mission-jarvis-transcript"
        className="flex flex-col gap-2 overflow-y-auto rounded border border-slate-800 bg-slate-950/50 p-3"
        style={{ height: 200 }}
      >
        {jarvis.transcript.length === 0 && !liveStreaming && (
          <div className="text-xs text-slate-600">
            {mode === 'conversation'
              ? 'Conversation mode armed — speak naturally; Jarvis answers aloud.'
              : 'Manual mode — record or type, then press Send.'}
          </div>
        )}
        {jarvis.transcript.slice(-40).map((entry: any) => (
          <div
            key={entry.id}
            data-testid="mission-jarvis-transcript-entry"
            className="text-xs leading-relaxed"
            style={{ color: entry.role === 'user' ? '#67e8f9' : '#e2e8f0', whiteSpace: 'pre-wrap' }}
          >
            <span className="mr-2 font-bold uppercase tracking-wider" style={{ fontSize: 9, opacity: 0.6 }}>
              {entry.role === 'user' ? 'You' : 'Jarvis'}
            </span>
            {entry.text}
          </div>
        ))}
        {/* Streaming reply — renders live as SSE chunks arrive */}
        {liveStreaming && (
          <div data-testid="mission-jarvis-streaming" className="text-xs leading-relaxed" style={{ color: '#e2e8f0' }}>
            <span className="mr-2 font-bold uppercase tracking-wider" style={{ fontSize: 9, opacity: 0.6 }}>Jarvis</span>
            {liveStreaming.text}
            <span className="animate-pulse" style={{ color: '#67e8f9' }}> ▌</span>
          </div>
        )}
        <div ref={transcriptEndRef} />
      </div>

      {/* ── 4. Input row: mic (manual) + editable text + Send ── */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="mission-jarvis-mic"
          onClick={handleManualMic}
          disabled={!micEnabled || mode === 'conversation'}
          title={mode === 'conversation' ? 'Microphone is managed by conversation mode' : 'Record a voice message'}
          className="flex items-center justify-center"
          style={{
            width: 34, height: 34, borderRadius: '50%',
            border: `1px solid ${voice.isListening ? '#f87171' : '#334155'}`,
            background: voice.isListening ? 'rgba(248,113,113,0.15)' : '#0f172a',
            color: voice.isListening ? '#f87171' : '#94a3b8',
            opacity: (!micEnabled || mode === 'conversation') ? 0.4 : 1,
            cursor: (!micEnabled || mode === 'conversation') ? 'not-allowed' : 'pointer',
          }}
        >
          {voice.isListening ? <Mic size={15} /> : <MicOff size={15} />}
        </button>

        <input
          ref={inputRef}
          type="text"
          data-testid="mission-jarvis-input"
          value={textInput}
          onChange={(e) => {
            // §9 input ownership (Jarvis repair): any user edit takes manual
            // ownership — in-flight STT is stale. notifyManualEdit bumps the
            // engine generation so a late transcript is dropped by identity.
            manualEditSinceVoiceRef.current = true;
            voiceRef.current?.notifyManualEdit?.();
            setTextInput(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleTextSend();
            }
          }}
          placeholder={mode === 'conversation' ? 'Conversation mode listens automatically…' : 'Ask Jarvis anything…'}
          className="flex-1 rounded border border-slate-700 bg-slate-950/60 px-3 text-sm text-slate-100 outline-none"
          style={{ height: 34 }}
        />

        <button
          type="button"
          data-testid="mission-jarvis-send"
          onClick={handleTextSend}
          disabled={!textInput.trim() || isSending}
          title="Send"
          className="flex items-center justify-center"
          style={{
            width: 34, height: 34, borderRadius: '50%', border: 'none',
            background: textInput.trim() ? '#0891b2' : '#1e293b',
            color: textInput.trim() ? '#fff' : '#475569',
            cursor: !textInput.trim() || isSending ? 'not-allowed' : 'pointer',
            opacity: !textInput.trim() || isSending ? 0.6 : 1,
          }}
        >
          <Send size={15} />
        </button>
      </div>

      {/* ── 5. Compact delegated-task strip (never dominates the page) ── */}
      <div
        data-testid="mission-delegated-strip"
        className="flex items-center gap-3 overflow-hidden rounded border border-slate-800 bg-slate-950/40 px-3 py-1.5"
        style={{ fontSize: 10, color: '#94a3b8' }}
      >
        <span className="font-bold uppercase tracking-widest" style={{ color: '#64748b' }}>Delegated</span>
        <span style={{ color: delegatedRuns.length ? '#f5b50a' : '#475569' }}>
          {delegatedRuns.length} active
        </span>
        {delegatedRuns.slice(0, 3).map((run: any) => (
          <span key={run.id} className="truncate" style={{ maxWidth: 160 }}>
            · {run.input || `Run ${String(run.id).slice(0, 6)}`}
          </span>
        ))}
        {delegatedRuns.length === 0 && <span style={{ color: '#475569' }}>No delegated work in flight</span>}
      </div>

      {/* ── 5b. Live Work — collapsible panel with real structured events ── */}
      <div data-testid="mission-live-work" className="rounded border border-slate-800 bg-slate-950/40">
        <button
          type="button"
          data-testid="mission-live-work-toggle"
          onClick={() => setLiveWorkOpen((o) => !o)}
          className="flex w-full items-center justify-between px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500"
          style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}
        >
          <span className="flex items-center gap-1.5">
            <Zap size={11} />
            Live Work
            {runtimeState.state && runtimeState.state !== 'idle' && (
              <span style={{
                marginLeft: 4, fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 8,
                background: runtimeState.state === 'error' ? 'rgba(239,68,68,0.2)' : 'rgba(0,229,255,0.1)',
                color: runtimeState.state === 'error' ? '#f87171' : '#67e8f9',
              }}>
                {runtimeState.state.toUpperCase()}
              </span>
            )}
            {runtimeState.pendingTaskCount > 0 && (
              <span style={{
                marginLeft: 2, fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 8,
                background: 'rgba(245,180,10,0.15)', color: '#f5b50a',
              }}>
                {runtimeState.pendingTaskCount} PENDING
              </span>
            )}
          </span>
          {liveWorkOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
        {liveWorkOpen && (
          <div data-testid="mission-live-work-content" className="border-t border-slate-800" style={{ fontSize: 11, color: '#94a3b8' }}>
            {/* Current execution state summary */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 px-3 py-2" style={{ fontSize: 10, borderBottom: '1px solid #1e293b' }}>
              <span>State: <b style={{ color: runtimeState.state === 'idle' ? '#475569' : runtimeState.state === 'error' ? '#f87171' : '#67e8f9' }}>{runtimeState.state}</b></span>
              <span>Agent: <b style={{ color: '#e2e8f0' }}>{runtimeState.activeAgent || '—'}</b></span>
              {runtimeState.activeProject && (
                <span style={{ gridColumn: '1 / -1' }}>Project: <b style={{ color: '#67e8f9' }}>{runtimeState.activeProject.name}</b></span>
              )}
              {runtimeState.activeTool && (
                <span style={{ gridColumn: '1 / -1' }}>Action: <b style={{ color: '#a78bfa' }}>{runtimeState.activeTool}</b></span>
              )}
              {runtimeState.provider && (
                <span>Provider: <b style={{ color: '#e2e8f0' }}>{runtimeState.provider}</b></span>
              )}
              {runtimeState.model && (
                <span>Model: <b style={{ color: '#e2e8f0' }}>{runtimeState.model}</b></span>
              )}
            </div>
            {/* Real structured events from background_task_events */}
            <div style={{ maxHeight: 200, overflowY: 'auto', padding: '6px 0' }}>
              {liveEvents.length === 0 ? (
                <div style={{ padding: '4px 12px', color: '#334155', fontSize: 10 }}>No operational events yet. Start a task from Jarvis.</div>
              ) : (
                liveEvents.map((evt: any) => {
                  const kindColor: Record<string, string> = {
                    'task.started': '#00d4ff', 'task.created': '#0891b2',
                    'task.completed': '#22c55e', 'task.failed': '#ef4444',
                    'task.blocked': '#f59e0b', 'task.file_changed': '#a855f7',
                    'task.build_started': '#f5b50a', 'task.build_completed': '#22c55e',
                    'task.test_started': '#f5b50a', 'task.test_completed': '#22c55e',
                    'task.approval_requested': '#f59e0b', 'task.cancelled': '#64748b',
                    'task.progress': '#94a3b8', 'task.stage_changed': '#67e8f9',
                    'task.agent_selected': '#ec4899',
                  };
                  const color = kindColor[evt.kind] || '#475569';
                  const label = evt.summary || evt.kind.replace('task.', '').replace(/_/g, ' ');
                  return (
                    <div key={evt.id} style={{
                      display: 'flex', alignItems: 'flex-start', gap: 6,
                      padding: '3px 12px', borderLeft: `2px solid ${color}`,
                      marginLeft: 6, marginBottom: 1,
                    }}>
                      <span style={{ fontSize: 9, fontWeight: 700, color, textTransform: 'uppercase', whiteSpace: 'nowrap', marginTop: 1, minWidth: 80 }}>
                        {evt.kind.replace('task.', '')}
                      </span>
                      <span style={{ color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                        {label}
                        {evt.taskTitle && evt.taskTitle !== label && (
                          <span style={{ color: '#475569', marginLeft: 4 }}>({evt.taskTitle.slice(0, 40)})</span>
                        )}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── 6. Collapsible diagnostics drawer (technical telemetry lives here,
             NOT in the main view) ── */}
      <div data-testid="mission-diagnostics" className="rounded border border-slate-800 bg-slate-950/40">
        <button
          type="button"
          data-testid="mission-diagnostics-toggle"
          onClick={() => setDiagnosticsOpen((o) => !o)}
          className="flex w-full items-center justify-between px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500"
          style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}
        >
          <span className="flex items-center gap-1.5"><Activity size={11} /> Diagnostics</span>
          {diagnosticsOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
        {diagnosticsOpen && (
          <div data-testid="mission-diagnostics-content" className="flex flex-col gap-2 border-t border-slate-800 p-3" style={{ fontSize: 11, color: '#94a3b8' }}>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <span>Backend: <b style={{ color: backendOffline ? '#f87171' : '#34d399' }}>{backendOffline ? 'Offline' : 'Available'}</b></span>
              <span>Runtimes: <b style={{ color: '#e2e8f0' }}>{(data.runtimes || []).length}</b></span>
              <span>Providers: <b style={{ color: '#e2e8f0' }}>{connectedProviders.length}/{(data.providers || []).length}</b></span>
              <span>Agents online: <b style={{ color: '#e2e8f0' }}>{activeAgents.length}/{(data.agents || []).length}</b></span>
              <span>Active executions: <b style={{ color: '#e2e8f0' }}>{delegatedRuns.length}</b></span>
              <span>Schedules: <b style={{ color: '#e2e8f0' }}>{(data.schedules || []).length}</b></span>
            </div>
            {(data.providers || []).slice(0, 6).length > 0 && (
              <div className="border-t border-slate-800 pt-2">
                <div className="mb-1 font-bold uppercase tracking-widest" style={{ fontSize: 9, color: '#64748b' }}>Providers & models</div>
                {(data.providers || []).slice(0, 6).map((p: any) => (
                  <div key={p.id} className="flex justify-between">
                    <span>{p.name || p.id}</span>
                    <span style={{ color: ['connected', 'healthy', 'active'].includes(p.status) ? '#34d399' : '#f5b50a' }}>{p.status}</span>
                  </div>
                ))}
              </div>
            )}
            {(data.agents || []).slice(0, 8).length > 0 && (
              <div className="border-t border-slate-800 pt-2">
                <div className="mb-1 font-bold uppercase tracking-widest" style={{ fontSize: 9, color: '#64748b' }}>Registered agents</div>
                {(data.agents || []).slice(0, 8).map((a: any) => (
                  <div key={a.id} className="flex justify-between">
                    <span>{a.name || a.id}</span>
                    <span style={{ color: a.status === 'active' ? '#34d399' : '#94a3b8' }}>{a.status}</span>
                  </div>
                ))}
              </div>
            )}
            {failedRuns.length > 0 && (
              <div className="border-t border-slate-800 pt-2">
                <div className="mb-1 font-bold uppercase tracking-widest" style={{ fontSize: 9, color: '#64748b' }}>Failed runs</div>
                {failedRuns.map((run: any) => (
                  <div key={run.id} className="truncate" style={{ color: '#f87171' }}>
                    {run.input || `Run ${String(run.id).slice(0, 8)}`} — {run.status}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default JarvisConversationPanel;
