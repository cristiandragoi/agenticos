import { useState, useRef, useCallback, useEffect } from 'react';
import { apiFetch } from '../api/client';

export type VoiceV2State = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking' | 'error';

export interface UseJarvisVoiceV2Options {
  conversationId?: string | null;
  agentId?: string;
  voiceOverride?: string | null;
  onSubmit: (text: string, turnId: number) => void;
  onCancelResponse?: () => void;
  silenceTimeoutMs?: number;
  maxRecordingMs?: number;
}

export interface UseJarvisVoiceV2Return {
  voiceState: VoiceV2State;
  isSpeaking: boolean;
  isListening: boolean;
  isBusy: boolean;
  lastTranscript: string;
  playbackError: string | null;
  currentTurnId: number;

  // Actions
  startTurn: () => Promise<boolean>;
  stopListening: () => void;
  cancelTurn: () => void;
  stopSpeaking: () => void;
  killSpeech: () => void;

  // Handlers for assistant completion
  handleAssistantResponse: (text: string, turnId?: number) => Promise<void>;
  setVoiceOverride: (voice: string | null) => void;
}

/** Sanitize markdown before TTS synthesis so asterisks, headers, code fences are not read aloud */
function sanitizeForSpeech(text: string): string {
  if (!text) return '';
  return text
    .replace(/```[\s\S]*?```/g, '') // code blocks
    .replace(/`([^`]+)`/g, '$1')     // inline code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
    .replace(/[*_~#>]/g, ' ')        // formatting marks
    .replace(/\s+/g, ' ')            // duplicate spaces
    .trim();
}

/**
 * useJarvisVoiceV2 — Clean, isolated, deterministic voice runtime for Jarvis.
 *
 * Hard Invariant:
 * 1 START (click)
 * → 1 STT request
 * → 1 user submission
 * → 1 assistant completion
 * → 1 TTS request
 * → 1 audio playback
 * → IDLE
 *
 * NO wake word. NO continuous loop. NO progressive TTS chunking. NO self-listening.
 */
export function useJarvisVoiceV2(options: UseJarvisVoiceV2Options): UseJarvisVoiceV2Return {
  const {
    conversationId = null,
    agentId = 'agent-jarvis',
    voiceOverride: initialVoiceOverride = 'en-GB-RyanNeural',
    onSubmit,
    onCancelResponse,
    silenceTimeoutMs = 1200,
    maxRecordingMs = 20000,
  } = options;

  const [voiceState, setVoiceState] = useState<VoiceV2State>('idle');
  const [lastTranscript, setLastTranscript] = useState<string>('');
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [selectedVoice, setSelectedVoice] = useState<string | null>(initialVoiceOverride || 'en-GB-RyanNeural');

  // Turn management & race condition barriers
  const turnSeqRef = useRef<number>(0);
  const activeTurnIdRef = useRef<number | null>(null);
  const voiceStateRef = useRef<VoiceV2State>('idle');
  voiceStateRef.current = voiceState;

  // Media recording resources
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const silenceRafRef = useRef<number | null>(null);
  const maxRecordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Playback & TTS resources
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const ttsAbortControllerRef = useRef<AbortController | null>(null);
  const playbackSettleRef = useRef<{ resolve: () => void; reject: (err: any) => void } | null>(null);
  const generationIdRef = useRef<number>(0);
  const spokenTurnsRef = useRef<Set<number>>(new Set());

  // Keep callbacks stable in refs
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;
  const onCancelResponseRef = useRef(onCancelResponse);
  onCancelResponseRef.current = onCancelResponse;

  /**
   * Cleanup all recording resources safely (mics, audio contexts, timers).
   */
  const cleanupRecording = useCallback(() => {
    if (silenceRafRef.current !== null) {
      cancelAnimationFrame(silenceRafRef.current);
      silenceRafRef.current = null;
    }
    if (maxRecordTimerRef.current !== null) {
      clearTimeout(maxRecordTimerRef.current);
      maxRecordTimerRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      try { audioContextRef.current.close().catch(() => {}); } catch {}
      audioContextRef.current = null;
    }
    if (mediaStreamRef.current) {
      try {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      } catch {}
      mediaStreamRef.current = null;
    }
    mediaRecorderRef.current = null;
  }, []);

  /**
   * Stop speaking & abort active response immediately.
   */
  const stopSpeaking = useCallback(() => {
    generationIdRef.current += 1; // Invalidate any in-flight TTS
    if (ttsAbortControllerRef.current) {
      try { ttsAbortControllerRef.current.abort(); } catch {}
      ttsAbortControllerRef.current = null;
    }
    if (playbackSettleRef.current) {
      playbackSettleRef.current.resolve();
      playbackSettleRef.current = null;
    }
    if (audioElementRef.current) {
      const audio = audioElementRef.current;
      audio.onended = null;
      audio.onerror = null;
      audio.onplay = null;
      try { audio.pause(); } catch {}
      audio.removeAttribute('src');
      try { audio.load(); } catch {}
      audioElementRef.current = null;
    }
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      try { window.speechSynthesis.cancel(); } catch {}
    }
    onCancelResponseRef.current?.();
    setVoiceState('idle');
  }, []);

  /**
   * Kill speech primitive (alias of stopSpeaking).
   */
  const killSpeech = useCallback(() => {
    stopSpeaking();
  }, [stopSpeaking]);

  /**
   * Cancel entire turn (recording, transcribing, thinking, or speaking).
   */
  const cancelTurn = useCallback(() => {
    if (voiceStateRef.current === 'idle') return;
    cleanupRecording();
    stopSpeaking();
    activeTurnIdRef.current = null;
    setVoiceState('idle');
  }, [cleanupRecording, stopSpeaking]);

  /**
   * Finish the recording step and send audio to STT.
   */
  const finishRecordingAndTranscribe = useCallback(async (blob: Blob, turnId: number) => {
    cleanupRecording();

    // Verify this is still the active turn
    if (activeTurnIdRef.current !== turnId) {
      console.log('[VoiceV2] Recording finished for cancelled/stale turn', { turnId, active: activeTurnIdRef.current });
      return;
    }

    if (!blob || blob.size === 0) {
      console.warn('[VoiceV2] Empty audio blob recorded');
      setVoiceState('idle');
      activeTurnIdRef.current = null;
      return;
    }

    setVoiceState('transcribing');
    console.log('[VoiceV2] Transcribing audio blob', { size: blob.size, turnId });

    try {
      const fd = new FormData();
      fd.append('audio', blob, 'audio.webm');
      if (conversationId) fd.append('conversationId', conversationId);

      const res = await apiFetch('/voice/transcribe', {
        method: 'POST',
        body: fd,
      });

      if (!res.ok) {
        throw new Error(`Transcribe HTTP ${res.status}`);
      }

      const data = await res.json();
      const text = (data?.text || '').trim();

      if (activeTurnIdRef.current !== turnId) {
        console.log('[VoiceV2] STT resolved for cancelled turn', turnId);
        return;
      }

      if (!text) {
        console.log('[VoiceV2] No speech detected in audio');
        setVoiceState('idle');
        activeTurnIdRef.current = null;
        return;
      }

      console.log('[VoiceV2] STT transcript received:', text);
      setLastTranscript(text);
      setVoiceState('thinking');

      // 1 User submission delivered to Jarvis
      onSubmitRef.current?.(text, turnId);
    } catch (err: any) {
      console.error('[VoiceV2] Transcription error:', err);
      setPlaybackError(err?.message || 'Speech transcription failed');
      setVoiceState('error');
      setTimeout(() => {
        if (voiceStateRef.current === 'error') setVoiceState('idle');
      }, 3000);
      activeTurnIdRef.current = null;
    }
  }, [cleanupRecording, conversationId]);

  /**
   * Start a new voice turn (records exactly one utterance).
   */
  const startTurn = useCallback(async (): Promise<boolean> => {
    // Clear any previous state
    cancelTurn();

    const turnId = ++turnSeqRef.current;
    activeTurnIdRef.current = turnId;
    setPlaybackError(null);

    console.log('[VoiceV2] Starting single-turn recording', { turnId });

    try {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        throw new Error('Microphone access is not supported in this environment.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      mediaStreamRef.current = stream;

      const chunks: Blob[] = [];
      const mimeType = (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/webm;codecs=opus'))
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunks.push(e.data);
        }
      };

      recorder.onstop = () => {
        const finalBlob = new Blob(chunks, { type: mimeType });
        void finishRecordingAndTranscribe(finalBlob, turnId);
      };

      recorder.start(100);
      setVoiceState('listening');

      // Set up simple silence detection using Web Audio API
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          audioContextRef.current = ctx;
          const source = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);

          const pcmData = new Uint8Array(analyser.frequencyBinCount);
          let speechDetected = false;
          let lastSpeechTimestamp = Date.now();

          const checkSilence = () => {
            if (activeTurnIdRef.current !== turnId || mediaRecorderRef.current?.state !== 'recording') {
              return;
            }

            analyser.getByteTimeDomainData(pcmData);
            let sum = 0;
            for (let i = 0; i < pcmData.length; i++) {
              const val = (pcmData[i] - 128) / 128;
              sum += val * val;
            }
            const rms = Math.sqrt(sum / pcmData.length);

            const now = Date.now();
            if (rms > 0.02) {
              speechDetected = true;
              lastSpeechTimestamp = now;
            } else if (speechDetected && (now - lastSpeechTimestamp >= silenceTimeoutMs)) {
              console.log('[VoiceV2] Silence detected after speech — stopping recording', { turnId, rms });
              if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
                mediaRecorderRef.current.stop();
              }
              return;
            }

            silenceRafRef.current = requestAnimationFrame(checkSilence);
          };

          silenceRafRef.current = requestAnimationFrame(checkSilence);
        }
      } catch (audioCtxErr) {
        console.warn('[VoiceV2] Web Audio silence detector unavailable, falling back to manual stop:', audioCtxErr);
      }

      // Max recording safety timer
      maxRecordTimerRef.current = setTimeout(() => {
        if (activeTurnIdRef.current === turnId && mediaRecorderRef.current?.state === 'recording') {
          console.log('[VoiceV2] Max recording duration reached');
          mediaRecorderRef.current.stop();
        }
      }, maxRecordingMs);

      return true;
    } catch (err: any) {
      console.error('[VoiceV2] Failed to acquire microphone:', err);
      cleanupRecording();
      setPlaybackError(err?.message || 'Could not access microphone');
      setVoiceState('error');
      activeTurnIdRef.current = null;
      return false;
    }
  }, [cancelTurn, finishRecordingAndTranscribe, cleanupRecording, silenceTimeoutMs, maxRecordingMs]);

  /**
   * Stop listening manually (e.g. user clicks Stop Recording button).
   */
  const stopListening = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  /**
   * Handle assistant final response: synthesize once via TTS and play once.
   */
  const handleAssistantResponse = useCallback(async (rawText: string, turnId?: number) => {
    const text = sanitizeForSpeech(rawText);
    if (!text) {
      console.log('[VoiceV2] Empty assistant response, returning to idle');
      setVoiceState('idle');
      activeTurnIdRef.current = null;
      return;
    }

    const effectiveTurnId = turnId ?? activeTurnIdRef.current ?? ++turnSeqRef.current;

    // Hard deduplication: exactly 1 TTS per turn
    if (spokenTurnsRef.current.has(effectiveTurnId)) {
      console.log('[VoiceV2] Dropping duplicate TTS call for turn', effectiveTurnId);
      return;
    }
    spokenTurnsRef.current.add(effectiveTurnId);

    console.log('[VoiceV2] Synthesizing TTS for response:', text.slice(0, 60));
    setVoiceState('speaking');

    const gen = ++generationIdRef.current;
    const controller = new AbortController();
    ttsAbortControllerRef.current = controller;

    try {
      const res = await apiFetch('/voice/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          text,
          voice: selectedVoice || 'en-GB-RyanNeural',
          agentId,
          conversationId,
        }),
      });

      if (!res.ok) {
        throw new Error(`TTS HTTP ${res.status}`);
      }

      const data = await res.json();
      const base64Audio = data?.audioData;
      const audioFormat = data?.format || data?.audioFormat || 'audio/mpeg';

      // Check generation guard
      if (generationIdRef.current !== gen) {
        console.log('[VoiceV2] Discarding late TTS response after cancellation');
        return;
      }

      if (!base64Audio) {
        throw new Error('No audio data returned from TTS');
      }

      const mimeType = audioFormat === 'audio/wav' ? 'audio/wav' : 'audio/mp3';
      const audio = new Audio(`data:${mimeType};base64,${base64Audio}`);
      audioElementRef.current = audio;

      await new Promise<void>((resolve, reject) => {
        playbackSettleRef.current = { resolve, reject };
        audio.onended = () => {
          if (playbackSettleRef.current) playbackSettleRef.current = null;
          console.log('[VoiceV2] Audio playback finished naturally — returning to IDLE');
          audioElementRef.current = null;
          setVoiceState('idle');
          activeTurnIdRef.current = null;
          resolve();
        };

        audio.onerror = (e) => {
          if (playbackSettleRef.current) playbackSettleRef.current = null;
          console.error('[VoiceV2] Audio playback error:', e);
          audioElementRef.current = null;
          setPlaybackError('Audio playback failed');
          setVoiceState('idle');
          activeTurnIdRef.current = null;
          reject(new Error('Audio playback failed'));
        };

        audio.play().catch((playErr) => {
          if (playbackSettleRef.current) playbackSettleRef.current = null;
          console.error('[VoiceV2] audio.play() rejected:', playErr);
          audioElementRef.current = null;
          setPlaybackError('Playback auto-start failed');
          setVoiceState('idle');
          activeTurnIdRef.current = null;
          reject(playErr);
        });
      });
    } catch (err: any) {
      if (err?.name === 'AbortError' || generationIdRef.current !== gen) {
        console.log('[VoiceV2] TTS synthesis aborted');
        return;
      }
      console.error('[VoiceV2] TTS error:', err);
      setPlaybackError(err?.message || 'TTS synthesis failed');
      setVoiceState('idle');
      activeTurnIdRef.current = null;
    }
  }, [agentId, conversationId, selectedVoice]);

  // Teardown on unmount
  useEffect(() => {
    return () => {
      cleanupRecording();
      stopSpeaking();
    };
  }, [cleanupRecording, stopSpeaking]);

  return {
    voiceState,
    isSpeaking: voiceState === 'speaking',
    isListening: voiceState === 'listening',
    isBusy: voiceState !== 'idle',
    lastTranscript,
    playbackError,
    currentTurnId: turnSeqRef.current,

    startTurn,
    stopListening,
    cancelTurn,
    stopSpeaking,
    killSpeech,

    handleAssistantResponse,
    setVoiceOverride: setSelectedVoice,
  };
}
