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

export type VoiceState = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking' | 'error';

interface UseVoiceIOOptions {
  agentId: string;
  onTranscript?: (text: string) => void;
  onResponse?: (text: string) => void;
  onStateChange?: (state: VoiceState) => void;
  /** Conversation mode: called exactly once per valid end-of-speech transcript. */
  onAutoSubmit?: (text: string) => void;
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
}

import { API_BASE as BACKEND, apiFetch } from '../api/client';

// Per-agent TTS voice mapping (Deepgram Aura voices)
const AGENT_VOICE: Record<string, string> = {
  'agent-jarvis': 'aura-helios-en',   // Deep British male
  'agent-hermes': 'aura-orion-en',    // Natural male — distinct from Jarvis
};

export function useVoiceIO(options: UseVoiceIOOptions) {
  const {
    agentId,
    onTranscript,
    onResponse,
    onStateChange,
    onAutoSubmit,
    silenceTimeout = 1500, // Faster, snappier conversation
    endSpeechSilenceMs = 900,
    speechThreshold = 0.02,
    minSpeechMs = 120,
    maxSegmentMs = 20000,
    bargeInGraceMs = 250,
    continuationWindowMs = 2500,
  } = options;

  const [voiceState, setVoiceStateInternal] = useState<VoiceState>('idle');
  const [lastTranscript, setLastTranscript] = useState('');
  const [lastResponse, setLastResponse] = useState('');
  const [conversationActive, setConversationActive] = useState(false);

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
  // Playback-amplitude analysis (real output level for the orb).
  const playbackContextRef = useRef<AudioContext | null>(null);
  const playbackSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const playbackAnalyserRef = useRef<AnalyserNode | null>(null);
  const playbackLevelRafRef = useRef<number | null>(null);

  // ── Conversation-mode machinery ──
  const convCtxRef = useRef<AudioContext | null>(null);
  const convAnalyserRef = useRef<AnalyserNode | null>(null);
  const vadRafRef = useRef<number | null>(null);
  const convRecorderRef = useRef<MediaRecorder | null>(null);
  const convChunksRef = useRef<Blob[]>([]);
  const turnActiveRef = useRef(false);
  const speechStartedAtRef = useRef<number | null>(null);
  const silenceSinceRef = useRef<number | null>(null);
  const turnSubmittedRef = useRef(false);
  const playbackStartedAtRef = useRef<number | null>(null);
  const playbackActiveRef = useRef(false);
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
  const voiceOverrideRef = useRef<string | null>(null);
  const [selectedVoice, setSelectedVoiceState] = useState<string | null>(null);
  const setVoiceOverride = useCallback((voice: string | null) => {
    voiceOverrideRef.current = voice;
    setSelectedVoiceState(voice);
  }, []);

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

  /** Stop playback WITHOUT dispatching playbackEnded. Internal primitive;
   *  callers decide whether the orb/consumers must be notified. */
  const haltPlayback = useCallback(() => {
    ttsAbortControllerRef.current?.abort();
    ttsAbortControllerRef.current = null;
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
  }, [stopPlaybackLevelMonitor]);

  /** Public stop: halt + notify listeners (orb, drawer resume handler). */
  const stopAudio = useCallback(() => {
    haltPlayback();
    window.dispatchEvent(new CustomEvent(JARVIS_ORB_EVENTS.playbackEnded, {
      detail: { agentId },
    }));
  }, [agentId, haltPlayback]);

  /** Conversation mode: silence Jarvis (barge-in / stop-speaking control).
   *  The already-visible response text is never touched — playback only. */
  const stopSpeaking = useCallback(() => {
    if (!playbackActiveRef.current && !speakingRef.current) return;
    haltPlayback();
    window.dispatchEvent(new CustomEvent(JARVIS_ORB_EVENTS.playbackEnded, {
      detail: { agentId },
    }));
  }, [agentId, haltPlayback]);

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

  /** Play base64-encoded MP3 audio, strictly confirming playback start.
   *
   *  §5 playback state machine contract:
   *    - NEVER call play() unless a non-empty audio payload exists AND has
   *      been assigned as a valid data-URL src.
   *    - Stale media events from a previous session (generation) are ignored.
   *    - A successful playback clears any earlier FAILED banner (§6). */
  const playAudio = useCallback((base64Audio: string | null): Promise<void> => {
    const gen = ++playbackGenRef.current;
    return new Promise((resolve, reject) => {
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
        setPlaybackError(err);
        setVoiceState('error');
        reject(new Error(err));
        return;
      }

      if (!audioElementRef.current) {
        audioElementRef.current = new Audio();
      }
      const audio = audioElementRef.current;
      const src = `data:audio/mp3;base64,${base64Audio}`;
      audio.src = src;

      audio.onplay = () => {
        if (playbackGenRef.current !== gen) return; // stale session event
        // Playback ACTUALLY started — only now do we enter the speaking
        // state. Real output amplitude is monitored for the orb.
        voiceTracePush('playback_started', 'ok', `Audio playback started (${Math.round((audio.duration || 0) * 10) / 10}s)`);
        playbackActiveRef.current = true;
        speakingRef.current = true;
        playbackStartedAtRef.current = Date.now();
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
        resolve();
      };

      audio.onended = () => {
        if (playbackGenRef.current !== gen) return; // stale session event
        stopPlaybackLevelMonitor();
        playbackActiveRef.current = false;
        speakingRef.current = false;
        window.dispatchEvent(new CustomEvent(JARVIS_ORB_EVENTS.playbackEnded, {
          detail: { agentId },
        }));
        afterPlaybackEnd();
      };

      audio.onerror = () => {
        if (playbackGenRef.current !== gen) return; // §6: stale error — NEVER banner
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
        setPlaybackError(err);
        setVoiceState('error');
        reject(new Error(err));
        return;
      }
      audio.play().catch((err) => {
        if (playbackGenRef.current !== gen) return; // stale rejection
        const errMsg = err.message || 'Autoplay blocked or playback failed';
        setPlaybackError(errMsg);
        setVoiceState('error');
        reject(new Error(errMsg));
      });
    });
  }, [agentId, setVoiceState, ensurePlaybackAnalyser, startPlaybackLevelMonitor, stopPlaybackLevelMonitor, afterPlaybackEnd]);

  /**
   * Start silence detection using Web Audio API.
   * After `silenceTimeout` ms of audio below a volume threshold, stop recording.
   */
  const startSilenceDetection = useCallback((stream: MediaStream) => {
    try {
      const ctx = new AudioContext();
      audioContextRef.current = ctx;
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
    const last = lastAutoSubmitRef.current;
    const dup = !!(last && last.text === text && now - last.at < 4000);
    if (dup) {
      console.log('[ConvTrace] DEDUPE hit — not resubmitting identical text');
      return false;
    }
    lastAutoSubmitRef.current = { text, at: now };
    console.log('[ConvTrace] onAutoSubmit firing', { hasCallback: typeof onAutoSubmit === 'function' });
    voiceTracePush('auto_submit', 'ok', `Auto-submitted: "${text.slice(0, 60)}${text.length > 60 ? '…' : ''}"`);
    onAutoSubmit?.(text);
    return true;
  }, [onAutoSubmit]);

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
      const fd = new FormData();
      fd.append('audio', audioBlob, 'audio.webm');
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
        if (fromConversation || conversationActiveRef.current) {
          setVoiceState('listening');
          startConversationListeningInternal();
        } else {
          setVoiceState('idle');
        }
        return;
      }
      if (!transcribeRes.ok) throw new Error('Transcription failed');
      const transcriptText: string = transcribeData?.text;

      if (!transcriptText || transcriptText.trim() === '') {
        if (fromConversation || conversationActiveRef.current) {
          setVoiceState('listening');
          startConversationListeningInternal();
        } else {
          setVoiceState('idle');
        }
        return;
      }

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
    if (streamRef.current) return streamRef.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      if (!convCtxRef.current || convCtxRef.current.state === 'closed') {
        convCtxRef.current = new AudioContext();
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
  }, [discardConversationTurn]);

  const startTurnRecording = useCallback((stream: MediaStream) => {
    if (turnActiveRef.current) return;
    turnActiveRef.current = true;
    turnSubmittedRef.current = false;
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
        const blob = new Blob(convChunksRef.current, { type: 'audio/webm' });
        convChunksRef.current = [];
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

      // Real playback amplitude broadcast (orb) while a turn is recording.
      if (turnActiveRef.current) {
        window.dispatchEvent(new CustomEvent(JARVIS_ORB_EVENTS.inputLevel, {
          detail: { level: Math.min(1, rms / 0.3) },
        }));
      }

      const isSpeech = rms > speechThreshold;

      // ── Barge-in: real user speech while Jarvis is speaking ──
      if (!turnActiveRef.current && speakingRef.current) {
        const started = playbackStartedAtRef.current ?? now;
        if (now - started >= bargeInGraceMs && isSpeech) {
          // Stop current audio + cancel remaining TTS; visible text stays.
          stopSpeaking();
          // Transition to listening and open the new user turn immediately.
          setVoiceState('listening');
          speechStartedAtRef.current = now;
          silenceSinceRef.current = null;
          if (streamRef.current) startTurnRecording(streamRef.current);
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
  }, [speechThreshold, minSpeechMs, endSpeechSilenceMs, maxSegmentMs, bargeInGraceMs, startTurnRecording, stopTurnRecording, stopSpeaking, setVoiceState]);

  /** Re-arm the mic inside the continuation window. */
  const rearmListening = useCallback(() => {
    if (!conversationActiveRef.current) return;
    setVoiceState('listening');
    startConversationListeningInternal();
  }, [setVoiceState, startConversationListeningInternal]);

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
    const submitted = submitConversationTurn(decision.text, firstValidity, { skipTurnIdCheck: isCombined });
    if (submitted) setVoiceState('thinking');
    else rearmListening();
  }, [continuationWindowMs, rearmListening, setVoiceState, submitConversationTurn]);

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
    setVoiceState('listening');
    startConversationListeningInternal();
    // TEMP DIAGNOSTIC — conversation session confirmed live (remove after confirmation)
    console.log('[ConvTrace] startConversation OK — VAD armed');
    return true;
  }, [openConversationMic, setVoiceState, startConversationListeningInternal, unlockAudioElement]);

  /** End conversation mode: stop mic capture, VAD loop, timers, recorder. */
  const endConversation = useCallback(() => {
    // TEMP DIAGNOSTIC — who ended conversation mode? (remove after confirmation)
    console.log('[ConvTrace] endConversation called', { stack: new Error().stack?.split('\n').slice(1, 4).join(' | ') });
    conversationActiveRef.current = false;
    // Invalidate every unfinished turn by identity.
    conversationSessionIdRef.current = null;
    setConversationSessionId(null);
    setConversationActive(false);
    closeConversationMic();
    if (!playbackActiveRef.current && !speakingRef.current) {
      setVoiceState('idle');
    }
  }, [closeConversationMic, setVoiceState]);

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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
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
    if (!enabled) haltPlayback();
  }, [haltPlayback, unlockAudio]);

  const fallbackSpeak = useCallback((text: string) => {
    window.speechSynthesis?.cancel();
    if (audioElementRef.current) {
      audioElementRef.current.pause();
      audioElementRef.current.src = '';
    }
    const utterance = new SpeechSynthesisUtterance(text);
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
    };
    window.speechSynthesis?.speak(utterance);
  }, [agentId, setVoiceState, afterPlaybackEnd, startConversationListeningInternal]);

  /** Speak a text string directly using pure TTS.
   *  NOTE: the 'speaking' voice state is NOT set here — it is set only when
   *  audio playback actually starts (onplay confirmation), or on
   *  SpeechSynthesis onstart for the fallback path.
   *
   *  Failure classification:
   *  - SYNTHESIS failure (network/HTTP/no audioData) → SpeechSynthesis
   *    fallback, so voice output is still heard.
   *  - PLAYBACK failure (audio element play() rejected, e.g. autoplay
   *    policy) → surface ONE understandable playback error. We must NOT fall
   *    back to speechSynthesis here: the audio was already synthesised, and
   *    speaking it again would produce a DUPLICATE of the response. */
  const speak = useCallback(async (text: string): Promise<void> => {
    // TEMP DIAGNOSTIC (remove once root cause confirmed)
    console.log('[VoiceDiag] speak() entered', { agentId, textLen: text.length });

    // Voice output disabled → skip TTS entirely, signal completion so the
    // conversation loop can resume listening. No duplicate, no error.
    if (!voiceEnabledRef.current) {
      window.dispatchEvent(new CustomEvent(JARVIS_ORB_EVENTS.playbackEnded, {
        detail: { agentId },
      }));
      return;
    }

    stopAudio();

    const controller = new AbortController();
    ttsAbortControllerRef.current = controller;

    let audioData: string | null = null;
    let synthesisFailed = false;
    try {
      // Visible voice selection wins over the per-agent default; the backend
      // validates/falls back to its configured default when unsupported.
      const voiceModel = voiceOverrideRef.current || AGENT_VOICE[agentId] || 'aura-helios-en';
      const res = await apiFetch(`${BACKEND}/voice/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, agentId, voice: voiceModel }),
        signal: controller.signal
      });
      if (res.ok) {
        const data = await res.json();
        if (data.audioData) {
          audioData = data.audioData;
        } else {
          synthesisFailed = true;
        }
      } else {
        synthesisFailed = true;
      }
    } catch (e: any) {
      if (e.name === 'AbortError') {
        if (!conversationActiveRef.current) setVoiceState('idle');
        return;
      }
      synthesisFailed = true;
    } finally {
      if (ttsAbortControllerRef.current === controller) {
        ttsAbortControllerRef.current = null;
      }
    }

    if (synthesisFailed) {
      // Synthesis failed — fall back to the browser voice (best effort).
      // TEMP DIAGNOSTIC (remove once root cause confirmed)
      console.log('[VoiceDiag] synthesis failed → speechSynthesis fallback', { agentId });
      fallbackSpeak(text);
      return;
    }

    // TEMP DIAGNOSTIC (remove once root cause confirmed)
    console.log('[VoiceDiag] synthesis OK → playAudio', { agentId, audioBytes: audioData ? audioData.length : 0 });
    try {
      // Play the synthesised audio. playAudio sets 'speaking' ONLY after the
      // browser confirms playback actually started (onplay), and resolves
      // only then; a rejection means playback failed (autoplay/policy/decode).
      voiceTracePush('tts_request', 'ok', `TTS synthesis OK (${audioData ? Math.round(audioData.length * 0.75 / 1024) : 0} KB audio)`);
      await playAudio(audioData);
    } catch {
      // Playback failure: playbackError already carries one understandable
      // message; the text response remains untouched. No duplicate speech.
    }
  }, [agentId, playAudio, fallbackSpeak, stopAudio, setVoiceState]);

  // ── Progressive sequential speech queue (one audio at a time) ──
  // Chunks are synthesised + played strictly in order; the next chunk is
  // only fetched AFTER the previous chunk's playback ended (speak resolves
  // on playback end). The kill switch clears the queue, aborts in-flight
  // synthesis and suppresses further speech for the CURRENT run — visible
  // text streaming is never touched.
  const speechQueueRef = useRef<string[]>([]);
  const speechPumpActiveRef = useRef(false);
  const speechRunSuppressedRef = useRef(false);

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
          await speak(chunk); // resolves only after playback ENDED
        } catch {
          // A failed chunk never blocks the rest of the queue.
        }
      }
    } finally {
      speechPumpActiveRef.current = false;
    }
  }, [speak]);

  // Task-completion announcement (task-completion milestone): speak the
  // summary once; defer while the user is speaking / mic is capturing.
  // `speakProgressiveRef` is assigned AFTER speakProgressive is declared
  // (below) to avoid the TDZ (Cannot access before initialization).
  const pendingCompletionRef = useRef<string | null>(null);
  const speakProgressiveRef = useRef<((t: string) => void) | null>(null);

  const speakCompletion = useCallback((text: string) => {
    if (!text) return;
    const trySpeak = () => {
      if (!voiceEnabledRef.current) {
        pendingCompletionRef.current = null;
        return;
      }
      if (voiceStateRef.current === 'listening') {
        // User is speaking / mic actively capturing — defer, never talk over.
        pendingCompletionRef.current = text;
        return;
      }
      pendingCompletionRef.current = null;
      speakProgressiveRef.current?.(text);
    };
    trySpeak();
  }, []);

  // When the user stops speaking, flush any deferred completion announcement.
  useEffect(() => {
    if (voiceState === 'listening') return;
    if (pendingCompletionRef.current) {
      const pending = pendingCompletionRef.current;
      pendingCompletionRef.current = null;
      speakCompletion(pending);
    }
  }, [voiceState, speakCompletion]);

  /** Enqueue one short phrase/sentence chunk for sequential TTS playback. */
  const speakProgressive = useCallback((chunk: string) => {
    const text = (chunk || '').trim();
    if (!text || speechRunSuppressedRef.current) return;
    speechQueueRef.current.push(text);
    void pumpSpeechQueue();
  }, [pumpSpeechQueue]);
  speakProgressiveRef.current = speakProgressive;

  /** VOICE KILL SWITCH: stop current playback, abort in-flight TTS
   *  synthesis, clear queued speech, suppress all further speech for the
   *  current run. Visible text is preserved by design (never touched). */
  const killSpeech = useCallback(() => {
    speechQueueRef.current = [];
    speechRunSuppressedRef.current = true;
    if (ttsAbortControllerRef.current) {
      ttsAbortControllerRef.current.abort();
      ttsAbortControllerRef.current = null;
    }
    haltPlayback();
    window.dispatchEvent(new CustomEvent(JARVIS_ORB_EVENTS.playbackEnded, {
      detail: { agentId },
    }));
  }, [agentId, haltPlayback]);

  /** Re-arm speech for a NEW run/turn (after a kill). */
  const armSpeech = useCallback(() => {
    speechRunSuppressedRef.current = false;
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
    // Progressive sequential TTS + kill switch (never overlaps audio).
        speakProgressive,
        killSpeech,
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
        setVoiceOverride,
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
      };
    }
