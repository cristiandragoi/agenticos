import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Mic, MicOff, Loader2, Square, AlertCircle } from 'lucide-react';
import styles from '../../pages/JarvisStudio.module.css';
import { JARVIS_ORB_EVENTS } from './jarvisOrbState';
import { apiFetch, apiUrl } from '../../api/client';

// Microphone state visible to the user
export type MicState = 'idle' | 'requesting-permission' | 'listening' | 'transcribing' | 'error';

interface JarvisComposerProps {
  onSendMessage: (msg: string, inputChannel?: 'typed' | 'voice') => void;
  isProcessing: boolean;
  workspaceReady?: boolean;
  workspaceBlockReason?: string;
  onCancelResponse?: () => void;
  /** Lifted state: if provided, overrides the internal textarea value */
  composerText?: string;
  /** Lifted state: called whenever the textarea changes */
  onComposerTextChange?: (text: string) => void;
  /** Called whenever the real microphone capture state changes. */
  onMicStateChange?: (state: MicState) => void;
  /**
   * Canonical voice mode: when true the composer's own microphone button
   * and status label are hidden — the page-level useVoiceIO engine is the
   * single microphone owner (one mic, one transcription path). The input
   * field and Send button remain fully functional (Manual mode contract).
   */
  hideMic?: boolean;
  /**
   * Backend lifecycle gate (backend lifecycle milestone): when set, the
   * backend is definitively unavailable (offline/failed) — the input and
   * Send are disabled and the reason is shown. Jarvis must never pretend to
   * process requests while the backend APIs are down.
   */
  disabledReason?: string | null;
}

const SILENCE_TIMEOUT_MS = 1800; // ms of silence before auto-stopping
const MAX_RECORD_MS = 30_000;     // hard cap: 30 s

export const JarvisComposer: React.FC<JarvisComposerProps> = ({
  onSendMessage,
  isProcessing,
  onCancelResponse,
  composerText,
  onComposerTextChange,
  onMicStateChange,
  hideMic,
  disabledReason,
}) => {
  const [internalText, setInternalText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Tracks whether the most recent text update came from voice transcription.
  // Reset to 'typed' on manual textarea edits or after each send.
  const lastInputChannelRef = useRef<'typed' | 'voice'>('typed');

  // Microphone state
  const [micState, setMicState] = useState<MicState>('idle');
  const [micError, setMicError] = useState<string | null>(null);
  // Benign one-shot notice (e.g. "no speech detected"). Shown in the neutral
  // status label instead of the red error banner; cleared on the next attempt.
  const [micNotice, setMicNotice] = useState<string | null>(null);

  // Notify the parent (and any orb wiring) of real mic-state transitions.
  useEffect(() => {
    onMicStateChange?.(micState);
  }, [micState, onMicStateChange]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxRecordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);

  // Support both lifted state (composerText) and internal state
  const text = composerText !== undefined ? composerText : internalText;
  const setText = useCallback((value: string) => {
    if (composerText !== undefined) {
      onComposerTextChange?.(value);
    } else {
      setInternalText(value);
    }
  }, [composerText, onComposerTextChange]);

  const canSend = !!text.trim() && !isProcessing && !disabledReason;

  const adjustTextareaHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      // Bound the auto-grow to ~4 lines (96px) so the sticky composer can
      // never grow content-driven beyond its intended UI height. Without
      // this, a long draft pushes the composer to ~293px and starves the
      // workspace band at short viewports (1366×768 live investigation).
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 96)}px`;
    }
  };

  useEffect(() => {
    adjustTextareaHeight();
  }, [text]);

  // Sync textarea cursor when composerText is set externally (e.g. from Command Matrix)
  useEffect(() => {
    if (composerText !== undefined && textareaRef.current) {
      textareaRef.current.focus();
      const len = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(len, len);
    }
  }, [composerText]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (canSend) {
        const channel = lastInputChannelRef.current;
        lastInputChannelRef.current = 'typed';
        onSendMessage(text, channel);
        setText('');
      }
    }
  };

  const handleSend = () => {
    if (canSend) {
      const channel = lastInputChannelRef.current;
      lastInputChannelRef.current = 'typed';
      onSendMessage(text, channel);
      setText('');
    }
  };

  // ─── Microphone Logic ──────────────────────────────────────────────────────

  const cleanupMic = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (silenceTimerRef.current !== null) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (maxRecordTimerRef.current !== null) {
      clearTimeout(maxRecordTimerRef.current);
      maxRecordTimerRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  }, []);

  /** Send recorded audio to backend Whisper transcription endpoint */
  const transcribeBlob = useCallback(async (blob: Blob) => {
    setMicState('transcribing');
    try {
      const fd = new FormData();
      fd.append('audio', blob, 'audio.webm');
      const res = await apiFetch('/api/voice/transcribe', { method: 'POST', body: fd });
      
      let data: any = {};
      try {
        data = await res.json();
      } catch (e) {
        // ignore if response is not JSON
      }

      // Benign "no speech" outcome: the request itself succeeded but the audio
      // contained nothing to transcribe. This is NOT an error — surface one
      // clear neutral notice and return the mic to idle, ready for retry.
      if (!res.ok && (data?.noSpeech === true)) {
        setMicNotice('No speech detected — please try again.');
        setMicState('idle');
        setMicError(null);
        return;
      }

      if (!res.ok) {
        const errMsg = data?.error ? `Transcription HTTP ${res.status}: ${data.error}` : `Transcription HTTP ${res.status}`;
        throw new Error(errMsg);
      }

      const transcript = data?.text;
      if (!transcript || !transcript.trim()) {
        throw new Error('Transcription returned empty text');
      }

      // Append to existing composer text without auto-sending.
      // We read the current value via the ref to avoid stale closure issues.
      const currentVal = textareaRef.current?.value ?? '';
      const trimmed = currentVal.trim();
      // Mark that the next send originated from voice input
      lastInputChannelRef.current = 'voice';
      setText(trimmed ? `${trimmed} ${transcript.trim()}` : transcript.trim());
      setMicState('idle');
      setMicError(null);
      setMicNotice(null);
    } catch (err: any) {
      console.warn('[JarvisComposer] Transcription error:', err);
      setMicError(`Transcription failed: ${err.message || err}`);
      setMicState('error');
    }
  }, [setText]);

  /** Start silence detection using Web Audio API analyser */
  const startSilenceDetection = useCallback((stream: MediaStream, stopFn: () => void) => {
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
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        const isSilent = rms < 0.015;

        // Broadcast REAL microphone amplitude (normalised 0..1) so the orb can
        // react to live input. This is measured audio, never synthesised.
        const normalized = Math.min(1, rms / 0.2);
        window.dispatchEvent(new CustomEvent(JARVIS_ORB_EVENTS.inputLevel, {
          detail: { level: normalized },
        }));

        if (isSilent) {
          if (!silentSince) silentSince = Date.now();
          else if (Date.now() - silentSince > SILENCE_TIMEOUT_MS) {
            stopFn();
            return;
          }
        } else {
          silentSince = null;
        }
        rafRef.current = requestAnimationFrame(check);
      };

      rafRef.current = requestAnimationFrame(check);
    } catch {
      // AudioContext unavailable — fall back to hard timeout
    }
  }, []);

  const stopListening = useCallback(() => {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state === 'recording'
    ) {
      mediaRecorderRef.current.stop();
    } else {
      cleanupMic();
      setMicState('idle');
    }
  }, [cleanupMic]);

  const startListening = useCallback(async () => {
    setMicError(null);
    setMicNotice(null);
    setMicState('requesting-permission');

    // Check basic API availability
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicError('Microphone API not available in this browser/environment');
      setMicState('error');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      setMicState('listening');

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        cleanupMic();
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        if (blob.size > 100) {
          transcribeBlob(blob);
        } else {
          setMicState('idle');
        }
      };

      recorder.start();
      startSilenceDetection(stream, stopListening);

      // Hard cap
      maxRecordTimerRef.current = setTimeout(() => {
        stopListening();
      }, MAX_RECORD_MS);

    } catch (err: any) {
      cleanupMic();
      const isDenied =
        err.name === 'NotAllowedError' ||
        err.name === 'PermissionDeniedError' ||
        err.message?.includes('Permission denied');
      const isUnavailable =
        err.name === 'NotFoundError' ||
        err.name === 'DevicesNotFoundError';

      if (isDenied) {
        setMicError('Microphone permission denied. Please allow access and try again.');
      } else if (isUnavailable) {
        setMicError('No microphone device found.');
      } else {
        setMicError(`Microphone error: ${err.message || err}`);
      }
      setMicState('error');
    }
  }, [cleanupMic, startSilenceDetection, stopListening, transcribeBlob]);

  const handleMicClick = useCallback(() => {
    if (micState === 'listening') {
      stopListening();
    } else if (micState === 'idle' || micState === 'error') {
      startListening();
    }
    // Ignore clicks while requesting-permission or transcribing
  }, [micState, startListening, stopListening]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupMic();
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
    };
  }, [cleanupMic]);

  // ─── Mic button appearance ─────────────────────────────────────────────────
  const micLabel = (() => {
    switch (micState) {
      case 'requesting-permission': return 'Requesting permission…';
      case 'listening': return 'Listening… (click to stop)';
      case 'transcribing': return 'Transcribing…';
      case 'error': return micError ?? 'Microphone error';
      default: return 'Click to speak';
    }
  })();

  const micActive = micState === 'listening';
  const micBusy = micState === 'requesting-permission' || micState === 'transcribing';
  const micDisabled = micBusy || isProcessing;

  return (
    <div className={styles.composerContainer} data-testid="jarvis-composer">
      <div className={styles.composerBox}>

        {/* Microphone button + label hidden in canonical voice mode — the
            page engine is the single mic owner. */}
        {!hideMic && (
        <>
        <button
          className={styles.actionBtn}
          onClick={handleMicClick}
          disabled={micDisabled}
          title={micLabel}
          aria-label={micActive ? 'Stop recording' : 'Start voice input'}
          data-testid="jarvis-mic-button"
          data-mic-state={micState}
          style={{
            color: micActive
              ? 'var(--color-jarvis, #00d4ff)'
              : micState === 'error'
                ? 'var(--color-error, #ff4444)'
                : undefined,
            animation: micActive ? 'pulse 1.2s ease-in-out infinite' : undefined,
          }}
        >
          {micBusy
            ? <Loader2 size={18} className="animate-spin" aria-hidden />
            : micActive
              ? <MicOff size={18} aria-hidden />
              : <Mic size={18} aria-hidden />
          }
        </button>

        {/* ── Mic status label ── */}
        <span
          data-testid="jarvis-mic-status"
          title={micLabel}
          style={{
            fontSize: 10,
            color: micActive
              ? 'var(--color-jarvis, #00d4ff)'
              : micState === 'error'
                ? 'var(--color-error, #ff4444)'
                : 'var(--text-tertiary)',
            whiteSpace: 'nowrap',
            alignSelf: 'center',
            maxWidth: 160,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {micState === 'idle' ? 'Voice input' : micLabel}
        </span>
        </>
        )}

        {/* ── Inline error banner ── */}
        {micState === 'error' && micError && (
          <span
            data-testid="jarvis-mic-error"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11,
              color: 'var(--color-error, #ff4444)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: 220,
            }}
          >
            <AlertCircle size={12} aria-hidden />
            {micError}
          </span>
        )}

        {/* ── Benign notice banner (e.g. "no speech detected") — one clear
            neutral message, never the red error state ── */}
        {micState === 'idle' && micNotice && (
          <span
            data-testid="jarvis-mic-notice"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11,
              color: 'var(--text-secondary, #8a94a6)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: 260,
            }}
          >
            {micNotice}
          </span>
        )}

        <textarea
          ref={textareaRef}
          className={styles.composerInput}
          placeholder={disabledReason ? 'Backend offline — Jarvis cannot process requests' : 'Ask Jarvis anything...'}
          value={text}
          onChange={(e) => {
            // Any manual keystroke resets the channel to 'typed'
            lastInputChannelRef.current = 'typed';
            setText(e.target.value);
          }}
          onKeyDown={handleKeyDown}
          disabled={isProcessing || !!disabledReason}
          rows={1}
          aria-label="Message Input"
        />

        {/* ── Backend lifecycle gate banner (offline/failed backend) ── */}
        {disabledReason && (
          <span
            data-testid="jarvis-offline-gate"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11,
              color: 'var(--color-error, #ff6b6b)',
              fontWeight: 600,
            }}
          >
            <AlertCircle size={12} aria-hidden />
            {disabledReason}
          </span>
        )}

        <div className={styles.composerActions}>
          {isProcessing && onCancelResponse && (
            <button
              className={styles.actionBtn}
              onClick={onCancelResponse}
              aria-label="Cancel Response"
              title="Cancel response"
            >
              <Square size={16} />
              <span>Cancel</span>
            </button>
          )}
          <button
            className={`${styles.actionBtn} ${styles.primary}`}
            onClick={handleSend}
            disabled={!canSend}
            aria-label="Send Message"
            title="Send message"
            style={{ padding: '6px 14px', gap: '6px', fontWeight: 600 }}
          >
            {isProcessing ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            <span>Send</span>
          </button>
        </div>
      </div>
    </div>
  );
};
