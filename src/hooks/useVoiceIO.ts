import { sanitizeMarkdownForSpeech } from '../utils/speechSanitizer';
// @ts-nocheck
/**
 * useVoiceIO — Shared voice input/output hook for Jarvis and Hermes.
 *
 * Two modes:
 *
 *  1. MANUAL (default, unchanged contract):
 *     - startListening() records ONE segment; sustained silence below
 *       threshold stops it; the transcript is surfaced via onTranscript and
 *       the UI decides whether/when to send. Nothing auto-submits.
 *
 *  2. CONVERSATION (startConversation()):
 *     - One persistent microphone stream stays open for the whole session
 *       (echoCancellation + noiseSuppression + autoGainControl where
 *       supported, so Jarvis' own output is not re-transcribed).
 *     - A VAD ticker measures REAL microphone RMS amplitude:
 *         listening  → speech start (rms > speechThreshold, minSpeechMs)
 *                      → transcribing → thinking → speaking → listening
 *     - End-of-speech = measured silence >= endSpeechSilenceMs (~900ms
 *       default, configurable 700–1200). NOT a fixed fake timer.
 *     - Valid transcript auto-submits EXACTLY ONCE via onAutoSubmit
 *       (duplicate-text dedupe window + per-blob submit flag).
 *     - Barge-in: while Jarvis is speaking, real user speech stops the
 *       playback, cancels remaining TTS, keeps the visible text, and opens
 *       a new user turn.
 *     - Any error recovers to listening (conversation) or idle (manual).
 *
 * Playback contract (both modes): the 'speaking' voice state is set ONLY
 * after the browser confirms real playback start (onplay / utterance start).
 * Synthesis failure → speechSynthesis fallback. Playback failure → ONE
 * understandable error, never a duplicate speechSynthesis fallback.
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import { JARVIS_ORB_EVENTS } from '../components/jarvis/jarvisOrbState';
import { decideContinuation } from '../utils/utteranceCompleteness';
import { voiceTracePush } from '../diagnostics/voiceTrace';
import { voiceTimelineBegin, voiceTimelinePush, installVoiceTimelineProbe } from '../diagnostics/voiceTimeline';

export type VoiceState = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking' | 'ducked' | 'error';

interface UseVoiceIOOptions {
  agentId: string;
  onTranscript?: (text: string) => void;
  onResponse?: (text: string) => void;
  onStateChange?: (state: VoiceState) => void;
  /** Conversation mode: called exactly once per valid end-of-speech transcript. */
  onAutoSubmit?: (text: string, turnId?: number) => void;
  /** Silence duration in ms before auto-stopping recording (default 3500ms) */
  silenceTimeout?: number;
  /** Conversation mode: measured silence (ms) that ends a speech turn. */
  endSpeechSilenceMs?: number;
  /** Conversation mode: RMS amplitude that counts as speech onset (0..1). */
  speechThreshold?: number;
  /** Conversation mode: min sustained speech (ms) before a turn is real. */
  minSpeechMs?: number;
  /** Conversation mode: safety cap for one recorded turn (ms). */
  maxSegmentMs?: number;
  /** Conversation mode: ignore mic input this long after playback starts
   *  (echo-cancellation settle window for barge-in detection). */
  bargeInGraceMs?: number;
  /** Conversation mode: hold an incomplete utterance this long (ms) while
   *  waiting for a continuation segment before submitting it as-is. */
  continuationWindowMs?: number;
  /** VAD liveness watchdog: if the analysis loop claims Listening but
   *  produces no tick for this many ms, cancel the stale rAF id and re-arm
   *  (background/occlusion recovery). Default 3000ms. */
  vadWatchdogMs?: number;
  /** How often the VAD liveness watchdog checks (ms). Default 1000ms. */
  vadWatchdogIntervalMs?: number;
  /** Conversation mode: fired the instant real user speech barges in while
   *  Jarvis is speaking. The hook has ALREADY halted playback, cleared the
   *  progressive speech queue and suppressed further chunks; the consumer
   *  MUST cancel the in-flight model stream here so no late tokens re-enter
   *  the voice path. */
  onBargeIn?: () => void;
  /** Fired when a LOCAL control command (stop/terminate) is detected from a
   *  finalized transcript. Consumers must cancel the model/SSE generation and
   *  clear the active turn — the hook has already stopped audio + cleared the
   *  speech queue. Fires INSTEAD OF onAutoSubmit (never routed to an LLM). */
  onControlCommand?: (cmd: ControlCommand) => void;
  /** Initial selected voice override (e.g. from localStorage/profile) */
  voiceOverride?: string | null;
  /** Active conversation ID for language & session continuity */
  conversationId?: string | null;
  /** Explicit language selection ('de' | 'ro' | 'en' | 'auto') */
  language?: string | null;
}


import { API_BASE as BACKEND, apiFetch } from '../api/client';
import { detectControlIntent, isStandaloneWake, type ControlCommand } from '../lib/controlIntent';
import { classifyTranscript, recordSpokenSegment, clearSpokenSegments } from '../lib/echoTracker';
import { classifyInterruption } from '../lib/adaptiveBargeIn';
import { resolveVoiceSessionConfig, isVoiceCompatibleWithLanguage, recordVoiceSynthesis, type VoiceSessionConfig } from '../lib/voiceSessionConfig';

// Per-agent TTS voice mapping (Deepgram Aura voices)
const AGENT_VOICE: Record<string, string> = {
  'agent-jarvis': 'aura-helios-en',   // Deep British male
  'agent-hermes': 'aura-stella-en',   // Professional female
  'agent-codex': 'aura-orpheus-en',   // Technical male
};

function isSelfEcho(transcript: string, spokenText: string): boolean {
  if (!transcript || !spokenText) return false;
  const tNorm = transcript.toLowerCase().replace(/[^\w\s]/g, '').trim();
  const sNorm = spokenText.toLowerCase().replace(/[^\w\s]/g, '').trim();
  if (!tNorm || !sNorm) return false;
  if (sNorm.includes(tNorm) || tNorm.includes(sNorm)) return true;
  const tWords = tNorm.split(/\s+/).filter(w => w.length > 2);
  const sWords = new Set(sNorm.split(/\s+/).filter(w => w.length > 2));
  if (tWords.length === 0) return false;
  const matches = tWords.filter(w => sWords.has(w)).length;
  return (matches / tWords.length) >= 0.7;
}

export function useVoiceIO(options: UseVoiceIOOptions) {
  const {
    agentId,
    conversationId = null,
    language = null,
    onTranscript,
    onResponse,
    onStateChange,
    onAutoSubmit,
    silenceTimeout = 2000,
    endSpeechSilenceMs = 1800, // Natural conversation turn timing (~2s pause window)
    speechThreshold = 0.02,
    minSpeechMs = 120,
    maxSegmentMs = 20000,
    bargeInGraceMs = 250,
    continuationWindowMs = 2500,
    vadWatchdogMs = 3000,
    vadWatchdogIntervalMs = 1000,
    onBargeIn,
    onControlCommand,
    voiceOverride: initialVoiceOverride = null,
  } = options;

  const conversationIdRef = useRef<string | null>(conversationId);
  useEffect(() => { conversationIdRef.current = conversationId; }, [conversationId]);

  const languageRef = useRef<string | null>(language);
  useEffect(() => {
    if (language !== languageRef.current) {
      languageRef.current = language;
      voiceSessionConfigRef.current = null;
      if (language) {
        const cfg = resolveVoiceSessionConfig(agentId, voiceOverrideRef.current, undefined, language);
        voiceSessionConfigRef.current = cfg;
        voiceTracePush('voice_config', 'ok', `Language updated: ${language} -> ${cfg.model}`);
      }
    }
  }, [agentId, language]);


  // VAD liveness thresholds (multi-turn voice hardening): if the analysis
  // loop claims to be Listening but produces no tick for this long, the
  // rAF loop has been frozen (background/occlusion) and must be re-armed.
  const VAD_WATCHDOG_MS = vadWatchdogMs;
  const VAD_WATCHDOG_INTERVAL_MS = vadWatchdogIntervalMs;
  // 5s continuous user speech takeover: hard-stops the current response automatically
  const BARGE_TAKEOVER_MS = 5000;

  const [voiceState, setVoiceStateInternal] = useState<VoiceState>('idle');
  const [lastTranscript, setLastTranscript] = useState('');
  const [lastResponse, setLastResponse] = useState('');
  const [conversationActive, setConversationActive] = useState(false);

  // Expose the measured timeline to CDP gate scripts (read-only).
  useEffect(() => { installVoiceTimelineProbe(); }, []);

  // Ref mirrors — event handlers and rAF loops run in stale closures, so all
  // mode decisions read refs, never the render-time values.
  const conversationActiveRef = useRef(false);
  const voiceEnabledRef = useRef(true);
  const voiceStateRef = useRef<VoiceState>('idle');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  /** Playback generation counter (§stabilization): every playAudio() bumps
   *  this, and stale onerror/onended/onplay handlers from a PREVIOUS session
   *  must ignore their events — a late async media error (e.g. from an
   *  earlier autoplay-unlock on an empty src) can never surface as today's
   *  VOICE PLAYBACK ERROR banner. */
  const playbackGenRef = useRef(0);
  const ttsAbortControllerRef = useRef<AbortController | null>(null);
  /** Pending playAudio() reject — haltPlayback settles it so a cancelled
   *  playback can never strand the progressive speech pump on an `await`
   *  that has no onended/onerror left to fire (barge-in mid-playback). */
  const playbackSettleRef = useRef<{ reject: (e: Error) => void } | null>(null);
  // Playback-amplitude analysis (real output level for the orb).
  const playbackContextRef = useRef<AudioContext | null>(null);
  const playbackSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const playbackAnalyserRef = useRef<AnalyserNode | null>(null);
  const playbackLevelRafRef = useRef<number | null>(null);

  // ── Conversation-mode machinery ──
  const convCtxRef = useRef<AudioContext | null>(null);
  const convAnalyserRef = useRef<AnalyserNode | null>(null);
  const vadRafRef = useRef<number | null>(null);
  // ── VAD liveness (multi-turn voice hardening) ──
  // The analysis loop is the ONLY thing that turns microphone audio into a
  // user turn. Chromium may pause rAF (background/occlusion/suspension), so
  // we track the last real tick and let a watchdog recover a stalled loop.
  const lastVadTickAtRef = useRef(0);
  const vadWatchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const vadErrorShownRef = useRef(false);
  const lastVadWarnAtRef = useRef(0);
  const convRecorderRef = useRef<MediaRecorder | null>(null);
  const convChunksRef = useRef<Blob[]>([]);
  const turnActiveRef = useRef(false);
  const speechStartedAtRef = useRef<number | null>(null);
  const silenceSinceRef = useRef<number | null>(null);
  const turnSubmittedRef = useRef(false);
  const playbackStartedAtRef = useRef<number | null>(null);
  const playbackActiveRef = useRef(false);
  /** Barge-in must survive `minSpeechMs` of REAL sustained speech (not a
   *  single transient frame / keyboard click / echo spike) before it fires. */
  const bargeInSpeechSinceRef = useRef<number | null>(null);
  // ── PHASE 15 (Failure E) adaptive barge-in: duck-then-classify ──
  // While Jarvis speaks, real user speech DUCKS the playback (gain ramp,
  // not mute) and opens a recording turn. When the transcript arrives it is
  // CLASSIFIED: acknowledgement → resume (no new LLM turn), hard control →
  // full kill, sustained takeover → full kill + new turn, noise → resume.
  const duckedRef = useRef(false);
  const duckSpeechStartedAtRef = useRef<number | null>(null);
  const duckEscalatedRef = useRef(false);
  // A takeover escalation fires while the user is STILL speaking; the VAD
  // escalation path performs the full kill (which resets the duck flags via
  // haltPlayback). The pending transcript must still be force-submitted as a
  // NEW turn when it resolves — this marker survives the kill.
  const pendingTakeoverRef = useRef(false);
  // ── Progressive sequential speech queue (one audio at a time) ──
  // Declared here (before haltPlayback/performBargeIn) so the barge-in kill
  // path can clear them. The pump itself is defined later.
  const speechQueueRef = useRef<string[]>([]);
  const speechPumpActiveRef = useRef(false);
  const speechRunSuppressedRef = useRef(false);
  const speechGenerationIdRef = useRef(0);
  const activeTurnIdRef = useRef<number | null>(null);
  const currentTurnSeqRef = useRef(0);
  const killSpeechNowRef = useRef<() => void>(() => {});
  // ── Input ownership (§9 input-ownership milestone) ──
  // The composer has TWO owners: manual keyboard input and voice/STT. They
  // must never race-write the same value. Manual ownership is modeled as a
  // MONOTONIC GENERATION: every manual edit bumps it; any voice event that
  // started under an older generation is stale and must not mutate the
  // composer or auto-submit. Mic-off also bumps a separate generation so a
  // late STT callback after the user turned the mic OFF is ignored by
  // identity, not by boolean drift.
  const manualEditGenRef = useRef(0);
  const micOffGenRef = useRef(0);
  // Bounded continuation window for incomplete utterances ("It is…"): the
  // text is held, the mic re-arms, and a later segment appends to it so ONE
  // combined turn is submitted. `validity` is captured from the FIRST segment.
  const continuationRef = useRef<{ text: string; validity?: { sessionId: string | null; turnId: number }; at: number } | null>(null);
  const continuationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Indirection so the (earlier-defined) transcription path can reach the
  // (later-defined) continuation handler without TDZ/stale-closure hazards.
  const handleConversationTranscriptRef = useRef<(text: string, validity?: { sessionId: string | null; turnId: number }) => void>(() => {});
  const speakingRef = useRef(false);
  const recoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAutoSubmitRef = useRef<{ text: string; at: number } | null>(null);
  // Live barge-in callback (rAF loop reads the ref, never a stale closure).
  const onBargeInRef = useRef<(() => void) | null>(null);
  onBargeInRef.current = onBargeIn ?? null;
  // Live control-command callback (submit path reads the ref).
  const onControlCommandRef = useRef<((cmd: ControlCommand) => void) | null>(null);
  onControlCommandRef.current = onControlCommand ?? null;
  // Dedupe for control commands: a partial stop + final stop must not
  // execute the cancel path twice.
  const lastControlRef = useRef<{ normalized: string; at: number } | null>(null);

  // ── Turn validity: conversationSessionId + turnId (never mutable booleans
  //    alone). A recorded blob is submittable ONLY while the session that
  //    recorded it is still live AND no newer turn has started. Ending the
  //    conversation clears the sessionId → every unfinished turn is
  //    invalidated, even if its transcription is still in flight. ──
  const conversationSessionIdRef = useRef<string | null>(null);
  const turnSeqRef = useRef(0);
  const [conversationSessionId, setConversationSessionId] = useState<string | null>(null);

  // ── Visible voice selection (product milestone: British/American choices) ──
  // `voiceOverrideRef` wins over the per-agent default in speak(); the state
  // mirror exists so the voice selector UI can render the active choice.
  const voiceOverrideRef = useRef<string | null>(initialVoiceOverride);
  const [selectedVoice, setSelectedVoiceState] = useState<string | null>(initialVoiceOverride);
  const [activeVoiceName, setActiveVoiceName] = useState<string>('David');
  const lastSpokenTextRef = useRef<{ text: string; at: number }>({ text: '', at: 0 });

  // Initial local speech synthesis voice resolution (prioritize deep male voice)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const resolveVoice = () => {
      try {
        const voices = window.speechSynthesis.getVoices?.() ?? [];
        if (voices.length > 0) {
          const maleVoice = voices.find(v => (
            /\b(david|george|mark|james|guy|richard|stefan|male|mann|mannlich|homme)\b/i.test(v.name)
          )) || voices.find(v => (
            !/\b(hedda|katja|zira|hazel|susan|catherine|female|eva|victoria|frau|weiblich|femme)\b/i.test(v.name)
          )) || voices[0];
          if (maleVoice) {
            const cleanName = maleVoice.name.replace(/^microsoft\s+/i, '').split('-')[0].trim();
            setActiveVoiceName(cleanName);
          }
        }
      } catch { /* ignore */ }
    };
    resolveVoice();
    window.speechSynthesis.onvoiceschanged = resolveVoice;
  }, []);

  // PHASE 15 (Failure B — voice identity pinning): ONE authoritative voice
  // configuration per active voice session. Resolved when the conversation
  // starts (or the voice override changes) and NEVER re-resolved per chunk or
  // per turn — a retry/fallback/interruption must not silently swap voices.
  const voiceSessionConfigRef = useRef<VoiceSessionConfig | null>(null);
  const setVoiceOverride = useCallback((voice: string | null) => {
    voiceOverrideRef.current = voice;
    setSelectedVoiceState(voice);
    // Re-resolve the session configuration ONCE on an explicit override
    // change (the user asked for a new voice) — the ONLY legal voice change.
    voiceSessionConfigRef.current = resolveVoiceSessionConfig(agentId, voice, undefined, languageRef.current || undefined);
    voiceTracePush('voice_config', 'ok', `Voice pinned: ${voiceSessionConfigRef.current.model}`);
  }, [agentId]);

  const setLanguage = useCallback((lang: string | null) => {
    languageRef.current = lang;
    voiceSessionConfigRef.current = null;
    const cfg = resolveVoiceSessionConfig(agentId, voiceOverrideRef.current, undefined, lang || undefined);
    voiceSessionConfigRef.current = cfg;
    voiceTracePush('voice_config', 'ok', `Voice language set: ${lang} -> ${cfg.model}`);
  }, [agentId]);

  /** Resolve (or lazily create) the authoritative voice session config. */
  const ensureVoiceSessionConfig = useCallback((langHint?: string | null): VoiceSessionConfig => {
    const rawLang = langHint || languageRef.current || 'en';
    const langKey = rawLang === 'auto' ? 'en' : rawLang.slice(0, 2).toLowerCase();
    if (voiceSessionConfigRef.current && voiceSessionConfigRef.current.language === langKey) {
      return voiceSessionConfigRef.current;
    }
    const cfg = resolveVoiceSessionConfig(agentId, voiceOverrideRef.current, undefined, langKey);
    voiceSessionConfigRef.current = cfg;
    voiceTracePush('voice_config', 'ok', `Voice session resolved: ${cfg.model} (lang=${cfg.language})`);
    return cfg;
  }, [agentId]);


  const setVoiceState = useCallback((s: VoiceState) => {
    voiceStateRef.current = s;
    setVoiceStateInternal(s);
    onStateChange?.(s);
  }, [onStateChange]);

  /** Stop all tracks and clean up AudioContext */
  const cleanupStream = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    analyserRef.current = null;
  }, []);

  const [playbackError, setPlaybackError] = useState<string | null>(null);

  /** Autoplay-unlock that can NEVER fire "Empty src attribute" (§4/§5).
   *  Calling play() on an element without a src raises a MEDIA_ELEMENT
   *  error event — the root cause of the phantom VOICE PLAYBACK ERROR.
   *  When the element has no source yet, assign a minimal silent WAV
   *  data-URL first so the unlock plays valid (silent) content. */
  const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
  const unlockAudioElement = useCallback(() => {
    if (!audioElementRef.current) audioElementRef.current = new Audio();
    const el = audioElementRef.current;
    if (!el.src) el.src = SILENT_WAV;
    el.play().catch(() => { /* unlock is best-effort; real errors surface via playAudio */ });
    el.pause();
  }, []);

  const stopPlaybackLevelMonitor = useCallback(() => {
    if (playbackLevelRafRef.current !== null) {
      cancelAnimationFrame(playbackLevelRafRef.current);
      playbackLevelRafRef.current = null;
    }
  }, []);

  /** Mute/unmute the live conversation mic.
   *
   *  ROOT-CAUSE FIX (multi-turn voice): while Jarvis is speaking (TTS
   *  playback), the mic MUST NOT interpret Jarvis's own voice. Without this,
   *  the VAD treats the speaker output picked up by the mic as user speech:
   *  echo recordings get transcribed and auto-submitted as fake user turns
   *  ("Jarvis hears itself" loop) or rejected by Deepgram as noSpeech while
   *  the user's real turn is silently dropped. Mute on playback start,
   *  unmute on playback end, then re-arm listening. */
  const setConversationMicEnabled = useCallback((enabled: boolean) => {
    const stream = streamRef.current;
    if (!stream) return;
    // getAudioTracks is standard, but defensive fallback keeps the helper
    // safe for any stream shape (incl. test mocks with getTracks only).
    const tracks = typeof stream.getAudioTracks === 'function'
      ? stream.getAudioTracks()
      : stream.getTracks();
    tracks.forEach((t) => {
      try { t.enabled = enabled; } catch { /* track may already be ended */ }
    });
  }, []);

  /** Stop playback WITHOUT dispatching playbackEnded. Internal primitive;
   *  callers decide whether the orb/consumers must be notified. */
  const haltPlayback = useCallback(() => {
    ttsAbortControllerRef.current?.abort();
    ttsAbortControllerRef.current = null;
    // Settle any in-flight playAudio() promise so the progressive pump can
    // never hang on an `await` whose onended/onerror we are about to detach.
    if (playbackSettleRef.current) {
      const settle = playbackSettleRef.current;
      playbackSettleRef.current = null;
      settle.reject(new Error('Playback halted'));
    }
    window.speechSynthesis?.cancel();
    if (audioElementRef.current) {
      const el = audioElementRef.current;
      // Jarvis voice fix: detach ALL handlers and invalidate the playback
      // generation BEFORE clearing the src. Assigning an empty src fires an
      // async MEDIA_ELEMENT error ("Empty src attribute"); a still-attached
      // stale onerror would surface it as a phantom VOICE PLAYBACK ERROR on
      // the very next speak (the observable bug). playAudio already follows
      // this discipline; haltPlayback must too.
      playbackGenRef.current += 1;
      el.onplay = null;
      el.onended = null;
      el.onerror = null;
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    stopPlaybackLevelMonitor();
    playbackActiveRef.current = false;
    speakingRef.current = false;
    voiceTracePush('playback_stopped', 'ok', `audio halted at ${Date.now()}`);
    // ROOT-CAUSE FIX (multi-turn voice): any halt (stop button, abort, voice
    // disable) must never leave the conversation mic muted.
    setConversationMicEnabled(true);
    // PHASE 15 (Failure E): any full halt also exits the ducked state and
    // restores normal gain — a killed turn must not leave playback ducked.
    duckedRef.current = false;
    duckEscalatedRef.current = false;
    if (audioElementRef.current) audioElementRef.current.volume = 1;
  }, [stopPlaybackLevelMonitor, setConversationMicEnabled]);

  // ── PHASE 15 (Failure E) ADAPTIVE BARGE-IN: duck-then-classify ──
  // Stage A: user starts talking while Jarvis speaks → DUCK (gain ramp to
  // ~20%), do NOT destroy the turn yet. The response keeps playing softly;
  // classification decides whether to resume or kill.
  const duckPlayback = useCallback(() => {
    if (duckedRef.current) return;
    duckedRef.current = true;
    duckEscalatedRef.current = false;
    duckSpeechStartedAtRef.current = Date.now();
    const el = audioElementRef.current;
    if (el) {
      // Smooth gain ramp 1.0 → 0.2 (~80ms, 4 steps). The element volume is
      // the single playback gain control (no overlapping players).
      const steps = [0.8, 0.6, 0.35, 0.2];
      steps.forEach((v, i) => {
        window.setTimeout(() => { if (duckedRef.current && audioElementRef.current) audioElementRef.current.volume = v; }, i * 25);
      });
    }
    setVoiceState('ducked');
    voiceTracePush('duck_started', 'ok', `Playback ducked to ~20% at ${Date.now()}`);
  }, [setVoiceState]);

  /** Restore playback gain 0.2 → 1.0 after an ack/noise (resume the turn). */
  const restorePlayback = useCallback(() => {
    if (!duckedRef.current) return;
    duckedRef.current = false;
    duckEscalatedRef.current = false;
    const el = audioElementRef.current;
    if (el) {
      const steps = [0.4, 0.65, 0.85, 1.0];
      steps.forEach((v, i) => {
        window.setTimeout(() => { if (!duckedRef.current && audioElementRef.current) audioElementRef.current.volume = v; }, i * 25);
      });
    }
    voiceTracePush('duck_restored', 'ok', `Playback restored to 100% at ${Date.now()}`);
  }, []);

  /** Public stop: halt + notify listeners (orb, drawer resume handler). */
  const stopAudio = useCallback(() => {
    haltPlayback();
    window.dispatchEvent(new CustomEvent(JARVIS_ORB_EVENTS.playbackEnded, {
      detail: { agentId },
    }));
  }, [agentId, haltPlayback]);

  /** Barge-in kill (conversation mode): the user began speaking while Jarvis
   *  was speaking. This is the FULL interruption, not a mute:
   *    1. clear queued progressive speech chunks for the cancelled turn
   *    2. suppress any further chunks (a late token must never re-enter TTS)
   *    3. abort in-flight TTS synthesis + halt current audio
   *    4. notify the consumer so it aborts the in-flight MODEL stream
   *  The visible text is never touched. The caller (VAD loop) then transitions
   *  to listening and opens the new user turn. */
  const performBargeIn = useCallback(() => {
    speechQueueRef.current = [];
    speechRunSuppressedRef.current = true;
    if (ttsAbortControllerRef.current) {
      ttsAbortControllerRef.current.abort();
      ttsAbortControllerRef.current = null;
    }
    haltPlayback();
    voiceTracePush('barge_in', 'ok', 'User speech detected while speaking — interrupting current turn');
    onBargeInRef.current?.();
  }, [haltPlayback]);

  /** Escalate a ducked interruption to a FULL kill (takeover / hard control).
   *  The turn is invalidated; the caller decides whether to submit new text.
   *  (Declared AFTER performBargeIn — the useCallback deps reference it.) */
  const escalateFromDuck = useCallback(() => {
    duckedRef.current = false;
    duckEscalatedRef.current = false;
    performBargeIn();
  }, [performBargeIn]);

  /** Conversation mode: silence Jarvis (barge-in / stop-speaking control).
   *  The already-visible response text is never touched — playback only. */
  const stopSpeaking = useCallback(() => {
    killSpeechNowRef.current();
  }, []);

  /** Lazily attach an AnalyserNode to the real playback audio element.
   *  createMediaElementSource may only be called once per element, so the
   *  graph is created on first confirmation and reused afterwards. */
  const ensurePlaybackAnalyser = useCallback(() => {
    const audio = audioElementRef.current;
    if (!audio || typeof AudioContext === 'undefined') return null;
    try {
      if (!playbackSourceRef.current) {
        const ctx = new AudioContext();
        playbackContextRef.current = ctx;
        const source = ctx.createMediaElementSource(audio);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analyser.connect(ctx.destination);
        playbackSourceRef.current = source;
        playbackAnalyserRef.current = analyser;
      }
      return playbackAnalyserRef.current;
    } catch {
      return null; // analysis is best-effort; playback still works without it
    }
  }, []);

  /** Broadcast REAL playback amplitude (normalised 0..1) while audio plays. */
  const startPlaybackLevelMonitor = useCallback(() => {
    const analyser = playbackAnalyserRef.current;
    if (!analyser) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      const a = playbackAnalyserRef.current;
      if (!a) return;
      a.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      window.dispatchEvent(new CustomEvent(JARVIS_ORB_EVENTS.outputLevel, {
        detail: { level: Math.min(1, rms / 0.3), agentId },
      }));
      playbackLevelRafRef.current = requestAnimationFrame(tick);
    };
    playbackLevelRafRef.current = requestAnimationFrame(tick);
  }, [agentId]);

  /** After a playback end/failure: conversation mode re-arms the mic turn
   *  loop; manual mode returns to idle. Never invents state — callers invoke
   *  this only from REAL playback lifecycle events. */
  const afterPlaybackEnd = useCallback(() => {
    if (conversationActiveRef.current) {
      if (recoverTimerRef.current) { clearTimeout(recoverTimerRef.current); recoverTimerRef.current = null; }
      setVoiceState('listening');
      startConversationListeningInternal();
    } else {
      setVoiceState('idle');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Play base64-encoded audio, strictly confirming playback start.
   *
   *  §5 playback state machine contract:
   *    - NEVER call play() unless a non-empty audio payload exists AND has
   *      been assigned as a valid data-URL src.
   *    - Stale media events from a previous session (generation) are ignored.
   *    - A successful playback clears any earlier FAILED banner (§6). */
  const playAudio = useCallback((base64Audio: string | null, expectedGeneration?: number, audioFormat?: string): Promise<void> => {
    const gen = ++playbackGenRef.current;
    return new Promise((resolve, reject) => {
      // Register the reject so haltPlayback (barge-in) can settle this
      // promise even after the media handlers are detached.
      playbackSettleRef.current = { reject };

      if (typeof expectedGeneration === 'number' && (speechGenerationIdRef.current !== expectedGeneration || speechRunSuppressedRef.current)) {
        voiceTracePush('VOICE_RESPONSE_REJECTED_STALE', 'warn', 'playAudio rejected: generation mismatch or speech suppressed');
        playbackSettleRef.current = null;
        resolve();
        return;
      }

      // Audio playback should not call stopAudio, since speak orchestrates it.
      // Just pause existing audioElementRef without aborting the controller.
      window.speechSynthesis?.cancel();
      if (audioElementRef.current) {
        // Detach ALL handlers BEFORE clearing the src: assigning an empty
        // src fires an async MEDIA_ELEMENT error ("Empty src attribute")
        // which a still-attached stale handler would surface as a phantom
        // VOICE PLAYBACK ERROR for the NEXT session.
        const old = audioElementRef.current;
        old.onplay = null;
        old.onended = null;
        old.onerror = null;
        old.pause();
        old.removeAttribute('src');
        old.load();
      }
      setPlaybackError(null);

      // §5: SYNTHESIZING→READY gate — reject before play() when the payload
      // is missing/empty (never produce a media-element error from nothing).
      if (!base64Audio || typeof base64Audio !== 'string' || base64Audio.trim().length === 0) {
        const err = 'No audio data returned from backend';
        playbackSettleRef.current = null;
        setPlaybackError(err);
        setVoiceState('error');
        reject(new Error(err));
        return;
      }

      if (typeof expectedGeneration === 'number' && (speechGenerationIdRef.current !== expectedGeneration || speechRunSuppressedRef.current)) {
        playbackSettleRef.current = null;
        resolve();
        return;
      }

      if (!audioElementRef.current) {
        audioElementRef.current = new Audio();
      }
      const audio = audioElementRef.current;
      // Use the backend-supplied format (piper returns audio/wav; edge-tts returns audio/mpeg)
      const mimeType = (audioFormat === 'audio/wav') ? 'audio/wav' : 'audio/mp3';
      const src = `data:${mimeType};base64,${base64Audio}`;
      audio.src = src;

      audio.onplay = () => {
        if (playbackGenRef.current !== gen) return; // stale session event
        if (typeof expectedGeneration === 'number' && (speechGenerationIdRef.current !== expectedGeneration || speechRunSuppressedRef.current)) {
          try { audio.pause(); audio.currentTime = 0; audio.removeAttribute('src'); audio.load(); } catch {}
          return;
        }
        // Playback ACTUALLY started — only now do we enter the speaking
        // state. Real output amplitude is monitored for the orb.
        voiceTimelinePush('audioPlaybackStartAt');
        voiceTracePush('playback_started', 'ok', `Audio playback started (${Math.round((audio.duration || 0) * 10) / 10}s)`);
        playbackActiveRef.current = true;
        speakingRef.current = true;
        playbackStartedAtRef.current = Date.now();
        // BARGE-IN FIX (full-duplex): the mic MUST stay live while Jarvis is
        // speaking so the VAD can hear a real user voice and interrupt. The
        // hard mute previously used here silenced the analyser, making
        // barge-in impossible — Jarvis talked over the user. Self-echo is
        // instead handled by echoCancellation/noiseSuppression on the stream
        // itself (see openConversationMic) plus the barge-in grace window.
        // §6: playback recovered — clear any leftover FAILED banner.
        setPlaybackError(null);
        ensurePlaybackAnalyser();
        startPlaybackLevelMonitor();
        setVoiceState('speaking');
        window.dispatchEvent(new CustomEvent(JARVIS_ORB_EVENTS.playbackStarted, {
          detail: { agentId },
        }));
        // Conversation mode: keep the VAD loop armed DURING playback so a
        // real user voice can barge in (stop audio, open a new turn).
        if (conversationActiveRef.current) startConversationListeningInternal();
      };

      audio.onended = () => {
        if (playbackGenRef.current !== gen) return; // stale session event
        if (playbackSettleRef.current) playbackSettleRef.current = null;
        stopPlaybackLevelMonitor();
        playbackActiveRef.current = false;
        speakingRef.current = false;
        window.dispatchEvent(new CustomEvent(JARVIS_ORB_EVENTS.playbackEnded, {
          detail: { agentId },
        }));
        afterPlaybackEnd();
        resolve();
      };

      audio.onerror = () => {
        if (playbackGenRef.current !== gen) return; // §6: stale error — NEVER banner
        if (playbackSettleRef.current) playbackSettleRef.current = null;
        stopPlaybackLevelMonitor();
        playbackActiveRef.current = false;
        speakingRef.current = false;
        const err = audio.error?.message || 'Audio element playback error';
        setPlaybackError(err);
        setVoiceState('error');
        window.dispatchEvent(new CustomEvent(JARVIS_ORB_EVENTS.playbackEnded, {
          detail: { agentId },
        }));
        if (conversationActiveRef.current) {
          // Error path: recover to listening, never duplicate the speech.
          if (recoverTimerRef.current) clearTimeout(recoverTimerRef.current);
          recoverTimerRef.current = setTimeout(() => {
            recoverTimerRef.current = null;
            if (conversationActiveRef.current) {
              setVoiceState('listening');
              startConversationListeningInternal();
            }
          }, 1500);
        }
        reject(new Error(err));
      };

      // §5 final guard: only play with a real, non-empty src.
      if (!audio.src) {
        const err = 'Audio source missing after assignment (URL creation failed)';
        playbackSettleRef.current = null;
        setPlaybackError(err);
        setVoiceState('error');
        reject(new Error(err));
        return;
      }
      audio.play().catch((err) => {
        if (playbackGenRef.current !== gen) return; // stale rejection
        const errMsg = err.message || 'Autoplay blocked or playback failed';
        playbackSettleRef.current = null;
        setPlaybackError(errMsg);
        setVoiceState('error');
        reject(new Error(errMsg));
      });
    });
  }, [agentId, setVoiceState, ensurePlaybackAnalyser, startPlaybackLevelMonitor, stopPlaybackLevelMonitor, afterPlaybackEnd, setConversationMicEnabled]);

  /**
   * Start silence detection using Web Audio API.
   * After `silenceTimeout` ms of audio below a volume threshold, stop recording.
   */
  const startSilenceDetection = useCallback((stream: MediaStream) => {
    try {
      const Ctor = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new Ctor();
      audioContextRef.current = ctx;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      analyserRef.current = analyser;

      const data = new Uint8Array(analyser.frequencyBinCount);
      let silentSince: number | null = null;

      const check = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteTimeDomainData(data);

        // Compute RMS amplitude
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        const isSilent = rms < 0.015;

        if (isSilent) {
          if (!silentSince) silentSince = Date.now();
          else if (Date.now() - silentSince > silenceTimeout) {
            // Sustained silence — stop recording
            if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
              mediaRecorderRef.current.stop();
            }
            return;
          }
        } else {
          silentSince = null;
        }

        requestAnimationFrame(check);
      };

      requestAnimationFrame(check);
    } catch {
      // If AudioContext fails, fall back to a flat 8-second timeout
      silenceTimerRef.current = setTimeout(() => {
        if (mediaRecorderRef.current?.state === 'recording') {
          mediaRecorderRef.current.stop();
        }
      }, 8000);
    }
  }, [silenceTimeout]);

  /** Submit a validated conversation transcript exactly once. Returns true
   *  when submitted; false when the turn is stale/invalid or deduplicated.
   *  Validity = conversationSessionId + turnId captured at record time,
   *  checked against the live session (never mutable booleans alone). */
  const submitConversationTurn = useCallback((
    text: string,
    validity?: { sessionId: string | null; turnId: number },
    opts?: { skipTurnIdCheck?: boolean },
  ): boolean => {
    // Session/turn validity first: a turn recorded by a dead session (user
    // ended Conversation mid-transcription) or superseded by a newer turn
    // never submits — no boolean can drift into accepting a stale turn.
    if (validity) {
      if (!validity.sessionId || validity.sessionId !== conversationSessionIdRef.current) {
        // TEMP DIAGNOSTIC — live auto-submit trace (remove after confirmation).
        console.log('[ConvTrace] submit REJECTED: session invalidated', { recorded: validity.sessionId, live: conversationSessionIdRef.current });
        return false;
      }
      if (!opts?.skipTurnIdCheck && validity.turnId !== turnSeqRef.current) {
        // TEMP DIAGNOSTIC — live auto-submit trace (remove after confirmation).
        console.log('[ConvTrace] submit REJECTED: stale turnId', { recorded: validity.turnId, current: turnSeqRef.current });
        return false;
      }
    }
    // TEMP DIAGNOSTIC — live auto-submit trace (remove after confirmation).
    console.log('[ConvTrace] submitConversationTurn entered', {
      text: text.slice(0, 60),
      turnSubmitted: turnSubmittedRef.current,
    });
    if (turnSubmittedRef.current) return false;
    turnSubmittedRef.current = true;
    const now = Date.now();

    const turnId = ++currentTurnSeqRef.current;
    activeTurnIdRef.current = turnId;
    voiceTracePush('VOICE_TURN_CREATED', 'ok', `Voice turn #${turnId} created for "${text}"`);
    voiceTracePush('VOICE_TRANSCRIPT_ACCEPTED', 'ok', `Voice turn #${turnId} transcript accepted: "${text}"`);

    // ── LOCAL CONTROL-INTENT LAYER (Phase 1 / Part 3) ───────────────────────
    // Runs BEFORE any model routing. "Jarvis, stop" must stop — it must
    // NEVER become an LLM prompt. Detection is local + deterministic.
    const control = detectControlIntent(text);
    if (control) {
      const lastCtl = lastControlRef.current;
      const ctlDup = !!(lastCtl && lastCtl.normalized === control.matched && now - lastCtl.at < 4000);
      lastControlRef.current = { normalized: control.matched, at: now };

      voiceTracePush('VOICE_BARGE_IN_DETECTED', 'ok', `Barge-in command detected: "${control.matched}"`);
      voiceTracePush('VOICE_STOP_DETECTED', 'ok', `Local voice stop command: "${control.matched}"`);

      // Single authoritative killSpeechNow
      killSpeechNowRef.current();

      if (!ctlDup) {
        voiceTracePush('control_command', 'ok', `Control ${control.kind}: "${control.matched}"`);
        onControlCommandRef.current?.(control);
      }
      return false;
    }
    // Standalone wake ("Jarvis") is a PRESENCE CHECK, not a substantive query.
    // Voice-reliability closure: route it through the same local fast path so
    // the server answers "Yes, I'm here." — never silence, never the LLM.
    if (isStandaloneWake(text)) {
      console.log('[ConvTrace] standalone wake → presence fast path');
      speechRunSuppressedRef.current = false;
      voiceTimelinePush('routingStartAt', `"${text.slice(0, 40)}" (wake)`);
      onAutoSubmit?.(text);
      return true;
    }
    const last = lastAutoSubmitRef.current;
    const dup = !!(last && last.text === text && now - last.at < 4000);
    if (dup) {
      console.log('[ConvTrace] DEDUPE hit — not resubmitting identical text');
      return false;
    }
    lastAutoSubmitRef.current = { text, at: now };
    console.log('[ConvTrace] onAutoSubmit firing', { hasCallback: typeof onAutoSubmit === 'function', turnId });
    voiceTracePush('auto_submit', 'ok', `Auto-submitted (turn #${turnId}): "${text.slice(0, 60)}${text.length > 60 ? '…' : ''}"`);
    // A NEW user turn re-arms speech: any barge-in suppression from the
    // PREVIOUS turn must not silence this turn's reply.
    speechRunSuppressedRef.current = false;
    voiceTimelinePush('routingStartAt', `"${text.slice(0, 40)}"`);
    onAutoSubmit?.(text);
    return true;
  }, [onAutoSubmit, performBargeIn, setVoiceState, killSpeechNowRef]);

  /** Process the recorded audio blob → transcribe ONLY.
   *  Conversation mode: valid transcript auto-submits once, then the turn
   *  loop re-arms. Manual mode: transcript is surfaced, UI decides.
   *
   *  ROOT-CAUSE FIX (live auto-submit failure): the auto-submit decision
   *  previously required BOTH the recorded origin (fromConversation) AND the
   *  live conversationActiveRef to still be true when the transcription
   *  resolved. Any mid-turn state change (re-render teardown, mode ref reset,
   *  barge-in race) flipped the ref and silently demoted the turn to the
   *  MANUAL branch — the transcript landed in the input field and the user
   *  had to click Send. The blob's origin is authoritative: it was recorded
   *  by the conversation turn recorder or it wasn't. We trust it. */
  const processAudioBlob = useCallback(async (
    audioBlob: Blob,
    fromConversation = false,
    validity?: { sessionId: string | null; turnId: number },
  ) => {
    // Input-ownership snapshot (§9 input-ownership milestone): capture the
    // manual-edit + mic-off generations when this capture STARTED. If the user
    // typed/edited the composer or turned the mic off while the STT request was
    // in flight, this transcript is STALE and must not surface into the
    // composer or auto-submit — it is dropped by identity, never by guess.
    const manualGenAtCapture = manualEditGenRef.current;
    const micOffGenAtCapture = micOffGenRef.current;
    const isStale = () =>
      manualEditGenRef.current !== manualGenAtCapture ||
      micOffGenRef.current !== micOffGenAtCapture;
    setVoiceState('transcribing');
    voiceTracePush('audio_captured', 'ok', `${(audioBlob.size / 1024).toFixed(1)} KB audio blob received (fromConversation=${fromConversation})`);

    try {
      // 1. Transcribe
      voiceTimelinePush('sttRequestStartAt');
      const fd = new FormData();
      fd.append('audio', audioBlob, 'audio.webm');
      if (conversationIdRef.current) fd.append('conversationId', conversationIdRef.current);
      if (languageRef.current) fd.append('language', languageRef.current);
      const transcribeRes = await apiFetch(`${BACKEND}/voice/transcribe`, {
        method: 'POST',
        body: fd,
      });

      let transcribeData: any = {};
      try {
        transcribeData = await transcribeRes.json();
      } catch {
        // non-JSON response body — fall through to error handling
      }
      // Benign "no speech" outcome: valid audio, nothing to transcribe.
      // Not an error — conversation re-arms; manual returns to idle.
      if (!transcribeRes.ok && transcribeData?.noSpeech === true) {
        voiceTracePush('no_speech', 'warn', `No speech detected in ${(audioBlob.size / 1024).toFixed(1)} KB audio — re-arming`);
        if (fromConversation || conversationActiveRef.current) {
          setVoiceState('listening');
          startConversationListeningInternal();
        } else {
          setVoiceState('idle');
        }
        return;
      }
      const transcriptText: string = transcribeData?.text;

      if (transcribeData?.language) {
        const detected = String(transcribeData.language).toLowerCase().trim().slice(0, 2);
        if (detected === 'de' || detected === 'ro' || detected === 'en') {
          languageRef.current = detected;
          voiceSessionConfigRef.current = resolveVoiceSessionConfig(agentId, voiceOverrideRef.current, undefined, detected);
          voiceTracePush('voice_config', 'ok', `Auto-detected STT language: ${detected} -> ${voiceSessionConfigRef.current.model}`);
        }
      }

      if (!transcriptText || transcriptText.trim() === '') {
        if (fromConversation || conversationActiveRef.current) {
          setVoiceState('listening');
          startConversationListeningInternal();
        } else {
          setVoiceState('idle');
        }
        return;
      }
      voiceTimelinePush('sttResultAt', `"${transcriptText.slice(0, 40)}"`);

      // ── Input-ownership gate (§9 input-ownership milestone) ──
      // The user typed/edited the composer or turned the mic OFF while this
      // capture was in flight → the transcript is stale and must NOT surface
      // into the composer, auto-submit, or mutate any state. This is the
      // deterministic rule: MANUAL INPUT OWNS THE COMPOSER.
      if (isStale()) {
        voiceTracePush('input_ownership', 'skipped', 'Stale STT dropped — manual edit or mic-off while transcribing');
        console.log('[InputOwnership] dropped stale STT transcript', { text: transcriptText.slice(0, 60) });
        if (fromConversation || conversationActiveRef.current) {
          setVoiceState('listening');
          startConversationListeningInternal();
        } else {
          setVoiceState('idle');
        }
        return;
      }

      // ── Self-echo suppression (Requirement 5) ──
      // If the transcribed text matches what Jarvis just spoke through TTS and
      // is not a control command (like 'stop'), discard it to prevent feedback loops.
      const lastSpoken = lastSpokenTextRef.current;
      const isControl = detectControlIntent(transcriptText);
      if (!isControl && lastSpoken && lastSpoken.text && (Date.now() - lastSpoken.at < 12000)) {
        if (isSelfEcho(transcriptText, lastSpoken.text)) {
          voiceTracePush('SELF_ECHO_SUPPRESSED', 'info', `Suppressed TTS self-echo: "${transcriptText.slice(0, 40)}"`);
          console.log('[VoiceDiag] Suppressed TTS self-echo:', transcriptText);
          if (fromConversation || conversationActiveRef.current) {
            setVoiceState('listening');
            startConversationListeningInternal();
          } else {
            setVoiceState('idle');
          }
          return;
        }
      }

      setLastTranscript(transcriptText);
      voiceTracePush('transcript', 'ok', `Transcript: "${transcriptText.slice(0, 90)}${transcriptText.length > 90 ? '…' : ''}"`);
      // TEMP DIAGNOSTIC — which branch decided auto-submit vs manual input.
      console.log('[ConvTrace] transcript arrived', {
        text: transcriptText.slice(0, 60),
        fromConversation,
        conversationActive: conversationActiveRef.current,
        branch: (fromConversation || conversationActiveRef.current) ? 'AUTO-SUBMIT' : 'MANUAL-INPUT',
      });
      if (fromConversation || conversationActiveRef.current) {
        voiceTimelinePush('transcriptAcceptedAt');
        // End-of-turn gating (see handleConversationTranscript): incomplete
        // utterances are held for a bounded continuation window; complete
        // ones (including short commands) submit immediately.
        handleConversationTranscriptRef.current(transcriptText, validity);
        return;
      }
      // Manual mode: surface transcript, wait for explicit user Send.
      onTranscript?.(transcriptText);
      setVoiceState('idle');
    } catch (err) {
      console.error(`[useVoiceIO:${agentId}] Pipeline error:`, err);
      setVoiceState('error');
      if (conversationActiveRef.current) {
        // Error recovery: back to listening, never a duplicate submission.
        if (recoverTimerRef.current) clearTimeout(recoverTimerRef.current);
        recoverTimerRef.current = setTimeout(() => {
          recoverTimerRef.current = null;
          if (conversationActiveRef.current) {
            setVoiceState('listening');
            startConversationListeningInternal();
          }
        }, 1500);
      } else {
        setTimeout(() => setVoiceState('idle'), 3000);
      }
    }
  }, [agentId, onTranscript, setVoiceState, submitConversationTurn]);

  // ── Conversation-mode turn engine ──

  /** Open (or reuse) the persistent conversation mic with echo cancellation,
   *  noise suppression and auto gain where supported — so Jarvis' own audio
   *  output is attenuated and not re-transcribed as user input. */
  const openConversationMic = useCallback(async (): Promise<MediaStream | null> => {
    if (streamRef.current) {
      const activeTracks = typeof streamRef.current.getAudioTracks === 'function'
        ? streamRef.current.getAudioTracks()
        : (typeof streamRef.current.getTracks === 'function' ? streamRef.current.getTracks() : []);
      if (activeTracks.length > 0 && activeTracks.some((t) => t.readyState !== 'ended')) {
        return streamRef.current;
      }
      streamRef.current = null;
    }
    try {
      let stream: MediaStream | null = null;
      if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          });
        } catch (constraintErr: any) {
          console.warn(`[useVoiceIO:${agentId}] Detailed audio constraints failed, retrying with basic audio: true`, constraintErr);
          try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          } catch (basicErr: any) {
            console.warn(`[useVoiceIO:${agentId}] Basic mic access failed:`, basicErr);
            throw basicErr;
          }
        }
      } else if (typeof navigator !== 'undefined' && (navigator as any).getUserMedia) {
        stream = await new Promise((resolve, reject) => {
          (navigator as any).getUserMedia({ audio: true }, resolve, reject);
        });
      } else {
        throw new Error('getUserMedia not supported in this environment');
      }

      if (!stream) {
        console.warn(`[useVoiceIO:${agentId}] No stream returned from getUserMedia`);
        return null;
      }

      const tracks = typeof stream.getAudioTracks === 'function' ? stream.getAudioTracks() : stream.getTracks();
      if (!tracks || tracks.length === 0) {
        console.warn(`[useVoiceIO:${agentId}] Acquired stream has no audio tracks`);
        return null;
      }
      tracks.forEach((t) => {
        try { t.enabled = true; } catch {}
      });

      streamRef.current = stream;
      if (!convCtxRef.current || convCtxRef.current.state === 'closed') {
        const Ctor = window.AudioContext || (window as any).webkitAudioContext;
        convCtxRef.current = new Ctor();
      }
      if (convCtxRef.current.state === 'suspended') {
        await convCtxRef.current.resume().catch(() => {});
      }
      const source = convCtxRef.current.createMediaStreamSource(stream);
      const analyser = convCtxRef.current.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      convAnalyserRef.current = analyser;
      return stream;
    } catch (err) {
      console.warn(`[useVoiceIO:${agentId}] Conversation mic denied:`, err);
      return null;
    }
  }, [agentId]);

  /** Stop the current conversation turn recording (if any) without any
   *  transcription — used when conversation mode ends mid-turn. */
  const discardConversationTurn = useCallback(() => {
    if (vadRafRef.current !== null) {
      cancelAnimationFrame(vadRafRef.current);
      vadRafRef.current = null;
    }
    turnActiveRef.current = false;
    speechStartedAtRef.current = null;
    silenceSinceRef.current = null;
    // Drop any held continuation buffer — it belongs to the dead turn.
    continuationRef.current = null;
    if (continuationTimerRef.current) {
      clearTimeout(continuationTimerRef.current);
      continuationTimerRef.current = null;
    }
    const rec = convRecorderRef.current;
    convRecorderRef.current = null;
    convChunksRef.current = [];
    if (rec && rec.state === 'recording') {
      try { rec.stop(); } catch { /* already stopped */ }
    }
  }, []);

  /** Tear down the whole conversation session: VAD loop, recorder, stream
   *  tracks, analyser context, pending recovery timers. */
  const closeConversationMic = useCallback(() => {
    discardConversationTurn();
    if (recoverTimerRef.current) { clearTimeout(recoverTimerRef.current); recoverTimerRef.current = null; }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    const ctx = convCtxRef.current;
    if (ctx && ctx.state !== 'closed') ctx.close().catch(() => {});
    convCtxRef.current = null;
    convAnalyserRef.current = null;
    clearSpokenSegments();
  }, [discardConversationTurn]);

  const startTurnRecording = useCallback((stream: MediaStream) => {
    if (turnActiveRef.current) return;
    turnActiveRef.current = true;
    turnSubmittedRef.current = false;
    // New measured runtime turn — reset the latency timeline.
    voiceTimelineBegin();
    voiceTimelinePush('speechStartAt');
    // Capture turn validity NOW (session + sequence at record time). The
    // async transcription may resolve after the session ended or a newer
    // turn started — submitConversationTurn re-checks both before firing.
    const validity = { sessionId: conversationSessionIdRef.current, turnId: turnSeqRef.current };
    convChunksRef.current = [];
    try {
      const rec = new MediaRecorder(stream);
      convRecorderRef.current = rec;
      rec.ondataavailable = (e: BlobEvent) => {
        if (e.data && e.data.size > 0) convChunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        turnActiveRef.current = false;
        const blob = new Blob(convChunksRef.current, { type: (rec as any).mimeType || 'audio/webm' });
        convChunksRef.current = [];
        voiceTimelinePush('mediaRecorderFinalizedAt', `${blob.size}B`);
        // TEMP DIAGNOSTIC — live chain trace (remove after confirmation).
        window.dispatchEvent(new CustomEvent('jarvis:conv-trace', { detail: { stage: 'recorderStop', value: `blob ${blob.size}B turn ${validity.turnId}` } }));
        // Recordings with no meaningful payload never reach transcription.
        if (blob.size < 400) {
          if (conversationActiveRef.current) {
            setVoiceState('listening');
            startConversationListeningInternal();
          }
          return;
        }
        processAudioBlob(blob, true, validity);
      };
      rec.start();
    } catch (err) {
      console.warn(`[useVoiceIO:${agentId}] Turn recorder failed:`, err);
      turnActiveRef.current = false;
    }
  }, [agentId, processAudioBlob, setVoiceState]);

  const stopTurnRecording = useCallback(() => {
    const rec = convRecorderRef.current;
    convRecorderRef.current = null;
    if (rec && rec.state === 'recording') {
      voiceTimelinePush('recordingStopAt');
      try { rec.stop(); } catch { /* already stopped */ }
    }
    speechStartedAtRef.current = null;
    silenceSinceRef.current = null;
  }, []);

  /** Re-arm the VAD ticker (idempotent). Called whenever the conversation
   *  loop must listen for the next user turn. */
  const startConversationListeningInternal = useCallback(() => {
    if (!conversationActiveRef.current) return;
    if (vadRafRef.current !== null) return; // already ticking
    const analyserForSize = convAnalyserRef.current;
    if (!analyserForSize) return;
    if (convCtxRef.current?.state === 'suspended') {
      convCtxRef.current.resume().catch(() => {});
    }
    // Buffer MUST match frequencyBinCount: a larger buffer leaves zero-filled
    // samples, which read as full-scale negative amplitude and would make
    // every frame look like speech.
    const data = new Uint8Array(analyserForSize.frequencyBinCount);
    const tick = () => {
      if (!conversationActiveRef.current) { vadRafRef.current = null; return; }
      const analyser = convAnalyserRef.current;
      if (!analyser) { vadRafRef.current = null; return; }
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      const now = Date.now();
      // Liveness heartbeat: the watchdog uses this to detect a stalled
      // rAF loop (background/occlusion throttling) and recover it.
      lastVadTickAtRef.current = now;

      // Real playback amplitude broadcast (orb) while a turn is recording.
      if (turnActiveRef.current) {
        window.dispatchEvent(new CustomEvent(JARVIS_ORB_EVENTS.inputLevel, {
          detail: { level: Math.min(1, rms / 0.3) },
        }));
      }

      const isSpeech = rms > speechThreshold;

      // ── PHASE 15 (Failure E) ADAPTIVE BARGE-IN ──
      // While Jarvis is speaking, sustained real user speech DUCKS the
      // playback (gain ramp, turn preserved) instead of the old binary
      // full-kill. Classification happens when the interruption transcript
      // arrives (ack → resume, control → kill, takeover → kill + new turn,
      // noise → resume). Only a LONG sustained utterance (beyond the takeover
      // threshold) escalates immediately to a full kill so a genuine new
      // question is not held at duck volume for its whole duration.
      if (speakingRef.current) {
        const started = playbackStartedAtRef.current ?? now;
        if (now - started >= bargeInGraceMs) {
          if (isSpeech) {
            if (bargeInSpeechSinceRef.current === null) bargeInSpeechSinceRef.current = now;
            const sustainedMs = now - bargeInSpeechSinceRef.current;
            if (sustainedMs >= minSpeechMs) {
              if (!duckedRef.current) {
                bargeInSpeechSinceRef.current = null;
                voiceTracePush('barge_in_speech', 'ok', `sustained speech accepted at ${now}`);
                // Stage A: duck immediately (target speech→duck <100ms).
                duckPlayback();
                // A turn must be recording to capture the user's utterance. If
                // one already started during a gap, keep it — never double-open.
                if (!turnActiveRef.current) {
                  setVoiceState('ducked');
                  speechStartedAtRef.current = now;
                  silenceSinceRef.current = null;
                  if (streamRef.current) startTurnRecording(streamRef.current);
                }
              } else if (sustainedMs >= BARGE_TAKEOVER_MS) {
                // Long sustained speech = real takeover — stop waiting for a
                // transcript, kill the old turn NOW, keep the recording turn.
                voiceTracePush('barge_in_escalated', 'ok', `sustained ${Math.round(sustainedMs)}ms — takeover escalation`);
                duckEscalatedRef.current = true;
                pendingTakeoverRef.current = true; // transcript must force-submit
                duckedRef.current = false;
                performBargeIn();
                if (!turnActiveRef.current) {
                  setVoiceState('listening');
                  speechStartedAtRef.current = now;
                  silenceSinceRef.current = null;
                  if (streamRef.current) startTurnRecording(streamRef.current);
                }
              }
            }
          } else {
            bargeInSpeechSinceRef.current = null;
          }
        }
      } else if (!turnActiveRef.current && isSpeech && voiceStateRef.current === 'listening') {
        // ── Speech start (only while actually listening — never while a
        // transcription/agent turn is in flight) ──
        if (speechStartedAtRef.current === null) speechStartedAtRef.current = now;
        if (now - speechStartedAtRef.current >= minSpeechMs) {
          silenceSinceRef.current = null;
          // TEMP DIAGNOSTIC — live chain trace (remove after confirmation).
          window.dispatchEvent(new CustomEvent('jarvis:conv-trace', { detail: { stage: 'vadStart', value: `speech-start rms>${speechThreshold}` } }));
          voiceTracePush('vad_triggered', 'ok', `VAD speech start (rms > ${speechThreshold}, sustained ${minSpeechMs}ms)`);
          if (streamRef.current) startTurnRecording(streamRef.current);
        }
      } else if (!turnActiveRef.current && !isSpeech) {
        // Reset partial speech detection — not sustained enough.
        speechStartedAtRef.current = null;
      }

      // ── Speech end: measured silence >= endSpeechSilenceMs ──
      if (turnActiveRef.current) {
        if (isSpeech) {
          silenceSinceRef.current = null;
        } else if (silenceSinceRef.current === null) {
          silenceSinceRef.current = now;
        } else if (now - silenceSinceRef.current >= endSpeechSilenceMs) {
          vadRafRef.current = null; // loop pauses until transcription re-arms
          voiceTimelinePush('speechEndDetectedAt', `silence≥${endSpeechSilenceMs}ms`);
          // TEMP DIAGNOSTIC — live chain trace (remove after confirmation).
          window.dispatchEvent(new CustomEvent('jarvis:conv-trace', { detail: { stage: 'vadEnd', value: `silence≥${endSpeechSilenceMs}ms` } }));
          stopTurnRecording();
          return; // onstop → transcription → next state; no more ticking here
        }
        // Safety cap: never record one turn forever.
        if (speechStartedAtRef.current && now - speechStartedAtRef.current > maxSegmentMs) {
          vadRafRef.current = null;
          stopTurnRecording();
          return;
        }
      }

      vadRafRef.current = requestAnimationFrame(tick);
    };
    vadRafRef.current = requestAnimationFrame(tick);
  }, [speechThreshold, minSpeechMs, endSpeechSilenceMs, maxSegmentMs, bargeInGraceMs, startTurnRecording, stopTurnRecording, performBargeIn, setVoiceState]);

  /** Watchdog for the conversation VAD loop (multi-turn voice hardening).
   *
   *  The VAD loop is driven by requestAnimationFrame, which Chromium pauses
   *  while the window is hidden/occluded even with backgroundThrottling off
   *  (OS suspension, devtools, platform quirks). If the UI believes it is
   *  Listening but no analysis tick has happened for a while, the loop is
   *  dead — cancel any stale rAF id and re-arm. Idempotent by construction:
   *  startConversationListeningInternal refuses to start while a rAF id is
   *  live, so this can never create a second analysis loop. At most one
   *  watchdog interval runs per hook instance. */
  const startVadWatchdog = useCallback(() => {
    if (vadWatchdogRef.current !== null) return; // at most one watchdog
    vadWatchdogRef.current = setInterval(() => {
      if (!conversationActiveRef.current) return;
      if (voiceStateRef.current !== 'listening') return;
      const deadMs = Date.now() - lastVadTickAtRef.current;
      if (deadMs < VAD_WATCHDOG_MS) return;
      // Stalled while claiming to listen. Recover deterministically.
      if (vadRafRef.current !== null) {
        try { cancelAnimationFrame(vadRafRef.current); } catch { /* stale id */ }
        vadRafRef.current = null;
      }
      if (!convAnalyserRef.current || !streamRef.current) {
        // The mic/analyser are gone — the loop cannot run. Surface a truthful
        // state instead of a permanent fake "Listening"; keep retrying on
        // later watchdog ticks so recovery is automatic when the mic returns.
        if (!vadErrorShownRef.current) {
          vadErrorShownRef.current = true;
          voiceTracePush('mic_unavailable', 'fail', 'Microphone analysis unavailable — reconnecting');
          setVoiceState('error');
        }
        return;
      }
      // Throttle the warn so a genuinely frozen window doesn't spam the trace.
      if (Date.now() - lastVadWarnAtRef.current > 10000) {
        lastVadWarnAtRef.current = Date.now();
        voiceTracePush('vad_watchdog', 'warn', `VAD loop stalled ${Math.round(deadMs / 1000)}s — re-arming`);
      }
      if (vadErrorShownRef.current) {
        vadErrorShownRef.current = false;
        setVoiceState('listening');
      }
      startConversationListeningInternal();
    }, VAD_WATCHDOG_INTERVAL_MS);
  }, [setVoiceState, startConversationListeningInternal]);

  const stopVadWatchdog = useCallback(() => {
    if (vadWatchdogRef.current !== null) {
      clearInterval(vadWatchdogRef.current);
      vadWatchdogRef.current = null;
    }
  }, []);

  // Visibility/focus recovery: when the window regains visibility or focus,
  // deterministically re-arm the analysis loop if it stalled while hidden.
  // Never duplicates: re-arm is idempotent (vadRafRef guard).
  useEffect(() => {
    const ensureVadAlive = () => {
      if (!conversationActiveRef.current) return;
      if (voiceStateRef.current !== 'listening') return;
      if (vadRafRef.current === null) {
        startConversationListeningInternal();
        return;
      }
      if (Date.now() - lastVadTickAtRef.current > VAD_WATCHDOG_MS) {
        // The rAF id may be stale (loop suspended mid-flight).
        try { cancelAnimationFrame(vadRafRef.current); } catch { /* stale id */ }
        vadRafRef.current = null;
        startConversationListeningInternal();
      }
    };
    const onVisibility = () => { if (document.visibilityState === 'visible') ensureVadAlive(); };
    const onFocus = () => { ensureVadAlive(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
    };
  }, [startConversationListeningInternal]);

  /** Re-arm the mic inside the continuation window. */
  const rearmListening = useCallback(() => {
    if (!conversationActiveRef.current) return;
    setVoiceState('listening');
    startConversationListeningInternal();
  }, [setVoiceState, startConversationListeningInternal]);

  /** PHASE 15 — RESPONSE-SETTLE RE-ARM (multi-turn reliability, Failure A).
   *
   * The VAD loop re-arms ONLY from afterPlaybackEnd today. When a submitted
   * turn's reply produces NO playback — voice output disabled, delegated
   * route (codex/hermes), empty reply, provider error, or TTS failure that
   * skipped speech — the loop never re-arms and the mic silently dies after
   * that turn ("eventually stopped reacting"). The response OWNER (JarvisChat
   * / the streaming consumer) knows when the turn's response cycle is truly
   * over; it calls notifyResponseSettled() at done/error for voice-channel
   * turns. Deterministic, ownership-based recovery: the turn that owned the
   * response signals its end, then the engine re-arms listening.
   */
  const notifyResponseSettled = useCallback(() => {
    if (!conversationActiveRef.current) return;
    // Re-arm from ANY non-speaking state when the response cycle is over:
    // thinking/transcribing (normal), idle (post-cancel/killSpeech), error.
    // The ONLY case that must NOT re-arm here is active playback — the mic is
    // intentionally suppressed while Jarvis speaks (speaking/ducked).
    if (voiceStateRef.current === 'speaking' || voiceStateRef.current === 'ducked') return;
    if (playbackActiveRef.current) return;
    voiceTracePush('response_settled', 'ok', `Response cycle ended (state ${voiceStateRef.current}) — re-arming listening`);
    rearmListening();
  }, [rearmListening]);

  // PHASE 15 — stuck-state watchdog extension: the VAD watchdog only ever
  // recovered 'listening'. If a turn's response never produced playback and
  // the consumer signal was missed (crash/edge), the engine could sit in
  // 'thinking' forever with the mic dead. This is a LAST-RESORT backstop:
  // after a generous 30s in a non-listening, non-speaking state with no
  // playback, force the deterministic recovery path.
  useEffect(() => {
    if (!conversationActiveRef.current) return;
    const id = window.setInterval(() => {
      if (!conversationActiveRef.current) return;
      const s = voiceStateRef.current;
      if (s === 'listening' || s === 'speaking') return;
      if (playbackActiveRef.current) return;
      if (Date.now() - lastAutoSubmitRef.current?.at! > 30000) {
        voiceTracePush('stuck_state_recovered', 'warn', `Voice state ${s} with no playback — forced recovery`);
        rearmListening();
      }
    }, 10000);
    return () => window.clearInterval(id);
  }, [rearmListening]);

  /**
   * End-of-turn gating for conversation-mode transcripts.
   *
   * - COMPLETE utterance (terminal punctuation, or final word not a
   *   continuation marker) → submit immediately (fast short commands).
   * - INCOMPLETE first segment ("It is…") → buffer it, re-arm the mic, and
   *   start a bounded continuation window (continuationWindowMs). A later
   *   segment APPENDS to the buffer; when the combined text is complete the
   *   WHOLE utterance submits ONCE. If the window expires, the buffer
   *   submits as-is (never held forever).
   */
  const handleConversationTranscript = useCallback((text: string, validity?: { sessionId: string | null; turnId: number }) => {
    // ── CONTROL INTENTS BYPASS THE CONTINUATION HEURISTIC (Phase 2) ──
    // A stop/terminate ("stop now", "Jarvis stop", "cancel that") must NEVER
    // be held by the incomplete-utterance window: "stop now" ends with the
    // discourse filler "now" and would otherwise wait up to
    // continuationWindowMs before the user hears silence. Control is
    // authoritative and immediate — it submits NOW, no LLM, no tools.
    const ctl = detectControlIntent(text);
    if (ctl) {
      const submitted = submitConversationTurn(text, validity);
      if (submitted) setVoiceState('listening');
      else rearmListening();
      return;
    }
    // ── PHASE 15 (Failure E): ADAPTIVE BARGE-IN CLASSIFICATION ──
    // This transcript arrived while playback was ducked (user started talking
    // while Jarvis was speaking). Decide: acknowledgement → resume the SAME
    // response (no new LLM turn), noise → resume, hard_control → kill,
    // takeover → kill old turn + submit as a new turn. The old response is
    // only DESTROYED for a genuine interruption, never for "yes"/"okay".
    let forceSubmitTakeover = false;
    if (pendingTakeoverRef.current) {
      // Escalated takeover: the old turn was killed while the user was still
      // speaking; this transcript is the new turn — submit immediately.
      pendingTakeoverRef.current = false;
      forceSubmitTakeover = true;
      voiceTracePush('takeover_submit', 'ok', `Escalated takeover transcript force-submitted: "${text.slice(0, 50)}"`);
    } else if (duckedRef.current || duckEscalatedRef.current) {
      const speechMs = duckEscalatedRef.current
        ? BARGE_TAKEOVER_MS // escalated while still speaking — real takeover
        : (duckSpeechStartedAtRef.current ? Date.now() - duckSpeechStartedAtRef.current : 0);
      const cls = classifyInterruption(text, speechMs, BARGE_TAKEOVER_MS);
      voiceTracePush('interruption_class', 'ok', `${cls}: "${text.slice(0, 50)}" (${speechMs}ms)`);
      if (cls === 'acknowledgement' || cls === 'noise') {
        // Resume the current response — do NOT submit a new turn, do NOT
        // restart, do NOT create a second LLM request.
        restorePlayback();
        rearmListening();
        return;
      }
      if (cls === 'hard_control') {
        // Full kill (queue clear + suppress + abort TTS + halt audio) and
        // route through the control path below (no LLM).
        escalateFromDuck();
        const submitted = submitConversationTurn(text, validity);
        if (submitted) setVoiceState('listening');
        else rearmListening();
        return;
      }
      // takeover: kill the old turn, then submit this transcript as the new
      // turn. Capture the intent BEFORE escalateFromDuck (which halts audio
      // and clears the duck flags) so the submit path below bypasses the
      // continuation heuristic — the user clearly wants a NEW turn now.
      forceSubmitTakeover = true;
      escalateFromDuck();
    }
    // ── TAKEOVER FORCE-SUBMIT ──
    // A takeover is a NEW user turn — it must submit immediately, never be
    // held by the incomplete-utterance continuation window (a real
    // interruption is not a mid-sentence pause).
    if (forceSubmitTakeover) {
      const submitted = submitConversationTurn(text, validity, { skipTurnIdCheck: true });
      if (submitted) setVoiceState('thinking');
      else rearmListening();
      return;
    }
    const decision = decideContinuation(continuationRef.current?.text ?? null, text);
    if (decision.action === 'hold') {
      continuationRef.current = { text, validity, at: Date.now() };
      if (continuationTimerRef.current) clearTimeout(continuationTimerRef.current);
      continuationTimerRef.current = setTimeout(() => {
        continuationTimerRef.current = null;
        const buf = continuationRef.current;
        continuationRef.current = null;
        if (!buf) return;
        // Window expired — submit the buffered fragment as-is (bounded hold).
        const submitted = submitConversationTurn(buf.text, buf.validity, { skipTurnIdCheck: true });
        if (submitted) setVoiceState('thinking');
        else rearmListening();
      }, continuationWindowMs);
      rearmListening();
      return;
    }
    if (decision.action === 'buffer') {
      const buf = continuationRef.current;
      if (buf) {
        buf.text = decision.combined;
        buf.at = Date.now();
      }
      if (continuationTimerRef.current) clearTimeout(continuationTimerRef.current);
      continuationTimerRef.current = setTimeout(() => {
        continuationTimerRef.current = null;
        const b = continuationRef.current;
        continuationRef.current = null;
        if (!b) return;
        const submitted = submitConversationTurn(b.text, b.validity, { skipTurnIdCheck: true });
        if (submitted) setVoiceState('thinking');
        else rearmListening();
      }, continuationWindowMs);
      rearmListening();
      return;
    }
    // submit — combined when a continuation was buffered, else this segment.
    const firstValidity = continuationRef.current?.validity || validity;
    const isCombined = Boolean(continuationRef.current);
    continuationRef.current = null;
    if (continuationTimerRef.current) { clearTimeout(continuationTimerRef.current); continuationTimerRef.current = null; }
    let submitText = decision.text;
    // ── Echo classification (Phase 5/6) — runs AFTER control-intent so a
    // genuine stop/terminate is NEVER discarded as echo (Phase 7 priority). ──
    const control = detectControlIntent(submitText);
    if (!control) {
      const echo = classifyTranscript(submitText);
      if (echo.kind === 'echo') {
        // Pure speaker echo — do not create a new user turn.
        voiceTracePush('echo_rejected', 'ok', `Echo rejected (${echo.confidence.toFixed(2)})`);
        rearmListening();
        return;
      }
      if (echo.kind === 'mixed') {
        // Salvage the human suffix, drop the echo prefix.
        voiceTracePush('echo_salvaged', 'ok', `Removed echo prefix "${echo.removedPrefix}"`);
        submitText = echo.text;
      }
    }
    const submitted = submitConversationTurn(submitText, firstValidity, { skipTurnIdCheck: isCombined });
    if (submitted) setVoiceState('thinking');
    else rearmListening();
  }, [continuationWindowMs, rearmListening, setVoiceState, submitConversationTurn, duckedRef, duckEscalatedRef, duckSpeechStartedAtRef, restorePlayback, escalateFromDuck, BARGE_TAKEOVER_MS]);

  handleConversationTranscriptRef.current = handleConversationTranscript;

  /** Activate conversation mode. Returns true when the mic opened. */
  const startConversation = useCallback(async (): Promise<boolean> => {
    conversationActiveRef.current = true;
    setConversationActive(true);
    // New session identity: every turn recorded under this session carries
    // the sessionId; ending Conversation clears it → in-flight transcripts
    // become invalid by identity, not by boolean drift.
    const sessionId = `conv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    conversationSessionIdRef.current = sessionId;
    turnSeqRef.current += 1;
    setConversationSessionId(sessionId);
    // A leftover manual capture (if any) lacks the conversation constraints
    // (echoCancellation/noiseSuppression) and runs its own silence detector —
    // drop it completely (recorder, stream tracks, analyser context, timers)
    // and open a dedicated conversation stream instead.
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.onstop = null; // suppress manual-blob pipeline
      if (mediaRecorderRef.current.state === 'recording') {
        try { mediaRecorderRef.current.stop(); } catch { /* ignore */ }
      }
      mediaRecorderRef.current = null;
    }
    cleanupStream(); // stops manual stream tracks + closes its AudioContext
    const stream = await openConversationMic();
    if (!stream) {
      conversationActiveRef.current = false;
      setConversationActive(false);
      setVoiceState('error');
      setTimeout(() => { if (!conversationActiveRef.current) setVoiceState('idle'); }, 2000);
      return false;
    }
    // Unlock the audio element for later playback (user-gesture context).
    unlockAudioElement();
    // ROOT-CAUSE FIX (silent speech suppression): a previous session's kill-switch
    // (killSpeech / STOP SPEAKING button) leaves speechRunSuppressedRef.current = true.
    // A new conversation MUST reset this flag — without the reset every spoken reply
    // in the new session is silently discarded by the early-exit guard in speakProgressive/
    // pumpSpeechQueue, producing the "Jarvis transcribes but never speaks" symptom.
    speechRunSuppressedRef.current = false;
    // Also clear any stale queued speech from the previous run so it cannot
    // bleed into the new session.
    speechQueueRef.current = [];
    setVoiceState('listening');
    startConversationListeningInternal();
    startVadWatchdog();
    // TEMP DIAGNOSTIC — conversation session confirmed live (remove after confirmation)
    console.log('[ConvTrace] startConversation OK — VAD armed, speechSuppressed=false');
    return true;
  }, [openConversationMic, setVoiceState, startConversationListeningInternal, startVadWatchdog, unlockAudioElement]);

  /** End conversation mode: stop mic capture, VAD loop, timers, recorder, and halt all audio immediately. */
  const endConversation = useCallback(() => {
    console.log('[ConvTrace] endConversation called');
    conversationActiveRef.current = false;
    // Invalidate every unfinished turn by identity.
    conversationSessionIdRef.current = null;
    setConversationSessionId(null);
    setConversationActive(false);
    stopVadWatchdog();
    closeConversationMic();
    // Synchronously kill all audio and voice output immediately
    killSpeechNowRef.current?.();
    setVoiceState('idle');
  }, [closeConversationMic, setVoiceState, stopVadWatchdog]);

  /** Start listening (manual single-segment capture; in conversation mode it
   *  simply re-arms the continuous loop). */
  const startListening = useCallback(async () => {
    if (conversationActiveRef.current) {
      if (!streamRef.current) {
        const stream = await openConversationMic();
        if (!stream) return;
      }
      setVoiceState('listening');
      startConversationListeningInternal();
      startVadWatchdog();
      return;
    }
    if (voiceState === 'listening') return;

    // Unlock AudioContext on user gesture (Chrome requirement)
    if (!audioElementRef.current) {
      audioElementRef.current = new Audio();
    }
    // Unlock the audio element for later playback (user-gesture context).
    unlockAudioElement();

    try {
      let stream: MediaStream | null = null;
      if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (err: any) {
          throw err;
        }
      } else if (typeof navigator !== 'undefined' && (navigator as any).getUserMedia) {
        stream = await new Promise((resolve, reject) => {
          (navigator as any).getUserMedia({ audio: true }, resolve, reject);
        });
      } else {
        throw new Error('getUserMedia not supported in this environment');
      }

      if (!stream) throw new Error('No stream returned');
      const tracks = typeof stream.getAudioTracks === 'function' ? stream.getAudioTracks() : stream.getTracks();
      if (!tracks || tracks.length === 0) throw new Error('No audio tracks in stream');
      tracks.forEach((t) => {
        try { t.enabled = true; } catch {}
      });

      streamRef.current = stream;
      setVoiceState('listening');

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        cleanupStream();
        const blob = new Blob(audioChunksRef.current, { type: (recorder as any).mimeType || 'audio/webm' });
        processAudioBlob(blob);
      };

      recorder.start();
      startSilenceDetection(stream);
    } catch (err) {
      console.warn(`[useVoiceIO:${agentId}] Mic access denied:`, err);
      setVoiceState('error');
      setTimeout(() => setVoiceState('idle'), 2000);
    }
  }, [agentId, voiceState, cleanupStream, processAudioBlob, startSilenceDetection, setVoiceState, openConversationMic, startConversationListeningInternal, unlockAudioElement]);

  /** Stop listening manually (manual mode stops the segment; conversation
   *  mode just pauses the VAD loop without closing the mic). */
  const stopListening = useCallback(() => {
    if (conversationActiveRef.current) {
      discardConversationTurn();
      setVoiceState('idle');
      return;
    }
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    } else {
      cleanupStream();
      setVoiceState('idle');
    }
  }, [cleanupStream, setVoiceState, discardConversationTurn]);

  /** Toggle listen/stop */
  const toggleListening = useCallback(() => {
    if (voiceState === 'listening') {
      stopListening();
    } else if (voiceState === 'idle' || voiceState === 'error' || voiceState === 'speaking') {
      startListening();
    }
  }, [voiceState, startListening, stopListening]);

  /** Audio-unlock on a user gesture (VOICE ON / recovery click).
   *  Establishes the playback permission with a silent AudioContext + a
   *  short audio-element touch. Not a silent infinite retry: called once per
   *  enable and on the explicit recovery action. The recovery action also
   *  clears any phantom playback-error banner (Jarvis voice fix): an unlock
   *  that succeeds must not leave a stale "Empty src attribute" error
   *  visible — that error was a stale-handler artifact, not a real policy
   *  block. */
  const unlockAudio = useCallback(() => {
    setPlaybackError(null);
    try {
      const Ctor = window.AudioContext || (window as any).webkitAudioContext;
      if (Ctor) {
        const ctx = new Ctor();
        const buf = ctx.createBuffer(1, 1, 22050);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        src.start(0);
        void ctx.resume().catch(() => {});
        setTimeout(() => ctx.close().catch(() => {}), 1500);
      }
    } catch { /* noop */ }
    try {
      const audio = audioElementRef.current;
      if (audio && audio.paused) {
        // Only touch play() when the element actually has a source — calling
        // play() on a sourceless element raises MEDIA_ELEMENT_ERROR again.
        if (audio.src) {
          const p = audio.play();
          if (p && typeof p.then === 'function') p.then(() => audio.pause()).catch(() => {});
        }
      }
    } catch { /* noop */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Voice output enable/disable. Disabling halts any current playback. */
  const setVoiceEnabled = useCallback((enabled: boolean) => {
    voiceEnabledRef.current = enabled;
    if (enabled) unlockAudio();
    if (!enabled) {
      haltPlayback();
      // EMERGENCY FIX: the orb and speaking UI must leave SPEAKING when
      // voice output is disabled mid-playback — haltPlayback alone only
      // clears internal refs, not the playbackActive event state.
      setVoiceState('idle');
      window.dispatchEvent(new CustomEvent(JARVIS_ORB_EVENTS.playbackEnded, {
        detail: { agentId },
      }));
    }
  }, [agentId, haltPlayback, setVoiceState, unlockAudio]);

  const fallbackSpeak = useCallback((text: string): Promise<void> => {
    return new Promise((resolve) => {
      if (typeof window === 'undefined' || !window.speechSynthesis) {
        // No speech synthesis API — re-arm conversation without audio.
        voiceTracePush('fallback_speak', 'warn', 'speechSynthesis unavailable — re-arming without audio');
        afterPlaybackEnd();
        resolve();
        return;
      }
      // Electron guard: speechSynthesis exists but may have no voices loaded
      // (common in Electron on Windows). In this case speak() queues an utterance
      // that NEVER fires onstart/onend/onerror — the conversation loop stalls
      // indefinitely and Jarvis never responds again. Detect and bypass.
      // NOTE: getVoices() may be undefined in some test environments / partial
      // mocks — guard defensively so the real runtime path is not disrupted.
      let voices: SpeechSynthesisVoice[] = [];
      try { voices = window.speechSynthesis.getVoices?.() ?? []; } catch { /* getVoices not available */ }
      if (voices.length === 0) {
        voiceTracePush('fallback_speak', 'warn', 'speechSynthesis has no voices (Electron?) — re-arming without audio');
        console.warn('[VoiceDiag] fallbackSpeak: no voices available — skipping synthesis, re-arming conversation');
        afterPlaybackEnd();
        resolve();
        return;
      }
      window.speechSynthesis?.cancel();
      const utterance = new SpeechSynthesisUtterance(text);

      const maleVoice = voices.find(v => (
        v.lang.startsWith('en') &&
        (v.name.toLowerCase().includes('david') ||
         v.name.toLowerCase().includes('george') ||
         v.name.toLowerCase().includes('james') ||
         v.name.toLowerCase().includes('male'))
      )) || voices[0];

      if (maleVoice) {
        utterance.voice = maleVoice;
        const cleanName = maleVoice.name.replace(/^microsoft\s+/i, '').split('-')[0].trim();
        setActiveVoiceName(cleanName);
      }
      utterance.pitch = 0.88; // Deep masculine resonance
      utterance.rate = 1.02;

      // Speaking is confirmed by the real utterance start event, not eagerly.
      (utterance as any).onstart = () => {
        speakingRef.current = true;
        playbackActiveRef.current = true;
        playbackStartedAtRef.current = Date.now();
        setVoiceState('speaking');
        window.dispatchEvent(new CustomEvent(JARVIS_ORB_EVENTS.playbackStarted, {
          detail: { agentId },
        }));
      };
      utterance.onend = () => {
        speakingRef.current = false;
        playbackActiveRef.current = false;
        window.dispatchEvent(new CustomEvent(JARVIS_ORB_EVENTS.playbackEnded, {
          detail: { agentId },
        }));
        afterPlaybackEnd();
        resolve();
      };
      utterance.onerror = () => {
        speakingRef.current = false;
        playbackActiveRef.current = false;
        setVoiceState('error');
        window.dispatchEvent(new CustomEvent(JARVIS_ORB_EVENTS.playbackEnded, {
          detail: { agentId },
        }));
        if (conversationActiveRef.current) {
          if (recoverTimerRef.current) clearTimeout(recoverTimerRef.current);
          recoverTimerRef.current = setTimeout(() => {
            recoverTimerRef.current = null;
            if (conversationActiveRef.current) {
              setVoiceState('listening');
              startConversationListeningInternal();
            }
          }, 1500);
        }
        resolve();
      };
      window.speechSynthesis?.speak(utterance);
    });
  }, [agentId, setVoiceState, afterPlaybackEnd, startConversationListeningInternal, ensureVoiceSessionConfig]);

  /** Speak a text string directly using pure TTS.
   *  NOTE: the 'speaking' voice state is NOT set here — it is set only when
   *  audio playback actually starts (onplay confirmation), or on
   *  SpeechSynthesis onstart for the fallback path.
   *
   *  Failure classification:
   *  - SYNTHESIS failure (network/HTTP/no audioData) → SpeechSynthesis
   *    fallback (speak is pure TTS; fallback speaks the text via Web Speech API)
   *  - PLAYBACK failure (HTMLAudioElement error/decode) → mark error, return to idle
   */
  const speak = useCallback(async (text: string, channel: string = 'CONVERSATION', turnId?: number): Promise<void> => {
    if (!text || text.trim() === '') return;

    // Channel validation: ONLY conversation channels may auto-speak
    const isAllowedChannel = channel === 'CONVERSATION' || channel === 'typed' || channel === 'voice';
    if (!isAllowedChannel) {
      voiceTracePush('VOICE_RESPONSE_REJECTED_NON_CONVERSATION', 'warn', `Rejected speech for non-conversation channel: "${channel}"`);
      return;
    }

    // Turn ownership validation: drop stale responses from older turns
    if (typeof turnId === 'number' && activeTurnIdRef.current !== null && turnId !== activeTurnIdRef.current) {
      voiceTracePush('VOICE_RESPONSE_REJECTED_STALE', 'warn', `Rejected stale speech: turn #${turnId} !== activeTurn #${activeTurnIdRef.current}`);
      return;
    }

    // Hard turn suppression: if stop/killSpeech was triggered, do NOT speak.
    if (speechRunSuppressedRef.current) {
      voiceTracePush('VOICE_RESPONSE_REJECTED_SUPPRESSED', 'ok', 'Spoken reply suppressed by kill-switch');
      return;
    }

    // Voice output disabled → skip TTS entirely, signal completion so the
    // conversation loop can resume listening. No duplicate, no error.
    if (!voiceEnabledRef.current) {
      window.dispatchEvent(new CustomEvent(JARVIS_ORB_EVENTS.playbackEnded, {
        detail: { agentId },
      }));
      afterPlaybackEnd();
      return;
    }

    const cleanText = sanitizeMarkdownForSpeech(text);
    if (!cleanText) return;

    const capturedGen = speechGenerationIdRef.current;
    const activeLang = languageRef.current || 'en';
    const cfg = ensureVoiceSessionConfig(activeLang);
    const voiceModel = (voiceOverrideRef.current && isVoiceCompatibleWithLanguage(voiceOverrideRef.current, cfg.language))
      ? voiceOverrideRef.current
      : cfg.voiceId;

    let audioData: string | null = null;
    let audioFormat: string = 'audio/mpeg';
    let synthesisFailed = false;
    let fallbackReason: string | null = null;
    const controller = new AbortController();
    ttsAbortControllerRef.current = controller;

    try {
      const synthRec = {
        voiceSessionId: conversationSessionIdRef.current,
        turnId: turnSeqRef.current,
        ttsProvider: cfg.provider,
        ttsModel: cfg.model,
        voiceId: cfg.voiceId,
        fallbackReason: null as string | null,
        at: Date.now(),
      };
      recordVoiceSynthesis(synthRec);
      voiceTimelinePush('ttsRequestStartAt', `${text.slice(0, 40)} (${voiceModel})`);
      const res = await apiFetch(`${BACKEND}/voice/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: cleanText,
          agentId,
          voice: voiceModel,
          language: cfg.language,
          conversationId: conversationIdRef.current || undefined,
        }),
        signal: controller.signal
      });

      if (res.ok) {
        const data = await res.json();
        if (data.audioData) {
          audioData = data.audioData;
          // Capture backend-supplied format for WAV (Piper) vs MP3 (edge-tts/deepgram)
          audioFormat = data.format || 'audio/mpeg';
          voiceTimelinePush('ttsAudioReadyAt', `${Math.round(data.audioData.length * 0.75 / 1024)}KB (${audioFormat}, provider=${data.provider || 'unknown'})`);
        } else {
          synthesisFailed = true;
          fallbackReason = 'Empty audioData from backend';
        }
      } else {
        synthesisFailed = true;
        fallbackReason = `TTS HTTP ${res.status}`;
      }
    } catch (e: any) {
      if (e.name === 'AbortError') {
        if (!conversationActiveRef.current) setVoiceState('idle');
        return;
      }
      synthesisFailed = true;
      fallbackReason = String(e?.message || e).slice(0, 120);
    } finally {
      if (ttsAbortControllerRef.current === controller) {
        ttsAbortControllerRef.current = null;
      }
    }

    // Monotonic generation gate: if stop or barge-in occurred during async synthesis, drop!
    if (speechGenerationIdRef.current !== capturedGen || speechRunSuppressedRef.current) {
      voiceTracePush('VOICE_RESPONSE_REJECTED_STALE', 'warn', 'Dropped late TTS response after cancellation');
      return;
    }

    if (synthesisFailed) {
      voiceTracePush('voice_synthesis_error', 'warn', `TTS synthesis failed (${fallbackReason ?? 'unknown'}) — returning to listening without robotic fallback`);
      setPlaybackError(`TTS synthesis unavailable: ${fallbackReason || 'Speech synthesis error'}`);

      // Browser speech synthesis is permitted ONLY if explicitly configured by the user as manual accessibility provider outside conversation mode:
      if (!conversationActiveRef.current && (cfg.provider as string) === 'browser-speechsynthesis') {
        recordVoiceSynthesis({
          voiceSessionId: conversationSessionIdRef.current,
          turnId: turnSeqRef.current,
          ttsProvider: 'browser-speechsynthesis',
          ttsModel: 'browser',
          voiceId: ensureVoiceSessionConfig().voiceId,
          fallbackReason,
          at: Date.now(),
        });
        await fallbackSpeak(text);
        return;
      }

      // Under all other conditions (conversation mode, Edge TTS, default neural, backend down):
      afterPlaybackEnd();
      return;
    }

    // HARD TURN INVALIDATION (voice-reliability closure, R3): a TTS response
    // that resolved just as STOP/barge-in landed must NEVER reach playback.
    if (speechRunSuppressedRef.current || speechGenerationIdRef.current !== capturedGen) {
      voiceTracePush('VOICE_RESPONSE_REJECTED_STALE', 'ok', 'TTS response discarded — turn cancelled');
      return;
    }

    console.log('[VoiceDiag] synthesis OK → playAudio', { agentId, audioBytes: audioData ? audioData.length : 0, audioFormat });
    try {
      voiceTracePush('tts_request', 'ok', `TTS synthesis OK (${audioData ? Math.round(audioData.length * 0.75 / 1024) : 0} KB ${audioFormat})`);
      await playAudio(audioData, capturedGen, audioFormat);
    } catch {
      // Playback failure
    }
  }, [agentId, playAudio, fallbackSpeak, setVoiceState, ensureVoiceSessionConfig, afterPlaybackEnd]);

  // ── Progressive sequential speech queue (one audio at a time) ──
  const pumpSpeechQueue = useCallback(async () => {
    if (speechPumpActiveRef.current) return;
    speechPumpActiveRef.current = true;
    try {
      while (speechQueueRef.current.length > 0) {
        if (speechRunSuppressedRef.current) {
          speechQueueRef.current = [];
          break;
        }
        const chunk = speechQueueRef.current.shift();
        if (!chunk) break;
        try {
          await speak(chunk, 'CONVERSATION', activeTurnIdRef.current ?? undefined);
        } catch {
          // A failed chunk never blocks the rest of the queue.
        }
      }
    } finally {
      speechPumpActiveRef.current = false;
    }
  }, [speak]);

  // Task-completion announcement: explicit channel separation — background completions do NOT auto-speak by default
  const pendingCompletionRef = useRef<string | null>(null);
  const speakProgressiveRef = useRef<((t: string, channel?: string, turnId?: number) => void) | null>(null);

  const speakCompletion = useCallback((text: string) => {
    // Isolated: background completions are silenced by default to prevent voice pollution
    console.log('[VoiceController] Background completion silenced (channel isolation):', text.slice(0, 50));
    voiceTracePush('VOICE_RESPONSE_REJECTED_NON_CONVERSATION', 'ok', `Background completion silenced: "${text.slice(0, 40)}"`);
  }, []);

  /** Enqueue one short phrase/sentence chunk for sequential TTS playback. */
  const speakProgressive = useCallback((chunk: string, channel: string = 'CONVERSATION', turnId?: number) => {
    const text = (chunk || '').trim();
    if (!text) return;
    const isAllowedChannel = channel === 'CONVERSATION' || channel === 'typed' || channel === 'voice';
    if (!isAllowedChannel) {
      voiceTracePush('VOICE_RESPONSE_REJECTED_NON_CONVERSATION', 'warn', `Rejected progressive speech for channel "${channel}"`);
      return;
    }
    if (typeof turnId === 'number' && activeTurnIdRef.current !== null && turnId !== activeTurnIdRef.current) {
      voiceTracePush('VOICE_RESPONSE_REJECTED_STALE', 'warn', `Rejected stale progressive chunk: ${turnId} !== ${activeTurnIdRef.current}`);
      return;
    }
    if (speechRunSuppressedRef.current) {
      voiceTracePush('VOICE_RESPONSE_REJECTED_STALE', 'warn', 'Dropped progressive speech chunk: speech is suppressed');
      return;
    }
    speechQueueRef.current.push(text);
    void pumpSpeechQueue();
  }, [pumpSpeechQueue]);
  speakProgressiveRef.current = speakProgressive;

  /**
   * AUTHORITATIVE VOICE KILL SWITCH: Single killSpeechNow primitive.
   * Cancels playback, aborts synthesis, clears queues, invalidates turns,
   * resets speech generation, un-mutes microphone, and forces absolute silence.
   */
  const killSpeechNow = useCallback(() => {
    speechGenerationIdRef.current += 1;
    activeTurnIdRef.current = null;
    speechRunSuppressedRef.current = true;
    speechQueueRef.current = [];

    if (ttsAbortControllerRef.current) {
      try { ttsAbortControllerRef.current.abort(); } catch {}
      ttsAbortControllerRef.current = null;
    }

    try {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    } catch {}

    if (playbackSettleRef.current) {
      const settle = playbackSettleRef.current;
      playbackSettleRef.current = null;
      try { settle.reject(new Error('Playback killed')); } catch {}
    }

    if (audioElementRef.current) {
      const el = audioElementRef.current;
      playbackGenRef.current += 1;
      el.onplay = null;
      el.onended = null;
      el.onerror = null;
      try { el.pause(); } catch {}
      el.removeAttribute('src');
      try { el.load(); } catch {}
    }

    stopPlaybackLevelMonitor();
    playbackActiveRef.current = false;
    speakingRef.current = false;
    duckedRef.current = false;
    duckEscalatedRef.current = false;

    setConversationMicEnabled(true);
    try { onBargeInRef.current?.(); } catch {}

    if (conversationActiveRef.current) {
      setVoiceState('listening');
      startConversationListeningInternal();
    } else {
      setVoiceState('idle');
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(JARVIS_ORB_EVENTS.playbackEnded, {
        detail: { agentId },
      }));
    }

    voiceTracePush('TTS_CANCELLED', 'ok', 'killSpeechNow executed — immediate local silence');
    voiceTracePush('VOICE_STATE_LISTENING', 'ok', 'Returned to listening via killSpeechNow');
  }, [agentId, stopPlaybackLevelMonitor, setConversationMicEnabled, setVoiceState, startConversationListeningInternal]);
  killSpeechNowRef.current = killSpeechNow;

  /** Global ESC emergency speech stop (PART 2 / PART 3) */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        console.log('[VoiceController] ESC emergency stop triggered');
        voiceTracePush('VOICE_BARGE_IN_DETECTED', 'ok', 'ESC key emergency stop triggered');
        killSpeechNow();
      }
    };
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [killSpeechNow]);

  /** Re-arm speech for a NEW run/turn (after a kill). */
  const armSpeech = useCallback((turnId?: number) => {
    speechRunSuppressedRef.current = false;
    if (typeof turnId === 'number') {
      activeTurnIdRef.current = turnId;
    }
    speechQueueRef.current = [];
  }, []);

  // Release playback audio resources on unmount.
  useEffect(() => {
    return () => {
      if (playbackLevelRafRef.current !== null) {
        cancelAnimationFrame(playbackLevelRafRef.current);
        playbackLevelRafRef.current = null;
      }
      const ctx = playbackContextRef.current;
      if (ctx && ctx.state !== 'closed') ctx.close().catch(() => {});
      playbackSourceRef.current = null;
      playbackAnalyserRef.current = null;
      // Conversation session teardown (stream tracks, VAD loop, contexts).
      // TEMP DIAGNOSTIC — unmount teardown flips conversationActive (remove after confirmation)
      if (conversationActiveRef.current) {
        console.log('[ConvTrace] useVoiceIO UNMOUNT while conversation ACTIVE — flag forced false', { stack: new Error().stack?.split('\n').slice(1, 4).join(' | ') });
      }
      conversationActiveRef.current = false;
      conversationSessionIdRef.current = null;
      stopVadWatchdog();
      closeConversationMic();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    voiceState,
    lastTranscript,
    lastResponse,
    startListening,
    stopListening,
    toggleListening,
    stopAudio,
    stopSpeaking,
    speak,
    speakProgressive,
    killSpeech: killSpeechNow,
    killSpeechNow,
    armSpeech,
        setVoiceEnabled,
        unlockAudio,
        conversationActive,
        // Session/turn validity identity (never mutable booleans alone).
        conversationSessionId,
        startConversation,
        endConversation,
        isListening: voiceState === 'listening',
        isSpeaking: voiceState === 'speaking',
        isProcessing: voiceState === 'transcribing' || voiceState === 'thinking',
        playbackError,
        // Visible voice selection (product milestone) — override wins in speak().
        selectedVoice,
        activeVoiceName,
        setVoiceOverride,
        setLanguage,
        ensureVoiceSessionConfig,
        // Task-completion announcement (task-completion milestone): speaks the
        // completion summary once; defers while the user is speaking/mic active.
        speakCompletion,
        // ── Input ownership (§9 input-ownership milestone) ──
        // Manual composer edits take ownership: voice/STT events that began
        // before the edit are stale and must not mutate the composer or
        // auto-submit. Mic-off invalidates every in-flight voice event.
        notifyManualEdit: () => { manualEditGenRef.current += 1; },
        notifyMicOff: () => { micOffGenRef.current += 1; },
        // Testable transcription entry (recorder.onstop drives it internally):
        // exposed so the input-ownership race can be exercised deterministically.
        processAudioBlob,
        // PHASE 15 (Failure A): the response OWNER (JarvisChat/stream consumer)
        // signals when a voice-channel turn's response cycle is truly over
        // (done/error), even when no audio was played. Deterministic re-arm.
        notifyResponseSettled,
      };
    }
