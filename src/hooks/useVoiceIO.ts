// @ts-nocheck
/**
 * useVoiceIO — Shared voice input/output hook for Jarvis and Hermes.
 *
 * Features:
 *  - MediaRecorder-based mic capture
 *  - Silence/pause detection: auto-stops after ~3.5s of audio below threshold
 *  - Sends audio to /api/voice/transcribe (Groq Whisper) → returns text
 *  - Plays TTS audio from /api/voice/execute (Deepgram aura-helios-en for Jarvis,
 *    aura-orion-en for Hermes — both natural male voices)
 *  - Falls back to browser SpeechSynthesis if no audioData returned
 *  - Exposes transcript line so UI can show what was heard before sending
 */

import { useRef, useState, useCallback } from 'react';

export type VoiceState = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking' | 'error';

interface UseVoiceIOOptions {
  agentId: string;
  onTranscript?: (text: string) => void;
  onResponse?: (text: string) => void;
  onStateChange?: (state: VoiceState) => void;
  /** Silence duration in ms before auto-stopping recording (default 3500ms) */
  silenceTimeout?: number;
}

const BACKEND = '/api';

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
    silenceTimeout = 1500, // Faster, snappier conversation
  } = options;

  const [voiceState, setVoiceStateInternal] = useState<VoiceState>('idle');
  const [lastTranscript, setLastTranscript] = useState('');
  const [lastResponse, setLastResponse] = useState('');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);

  const setVoiceState = useCallback((s: VoiceState) => {
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

  /** Play base64-encoded MP3 audio, strictly confirming playback start */
  const playAudio = useCallback((base64Audio: string | null, fallbackText: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      // Stop any currently playing TTS
      window.speechSynthesis?.cancel();
      if (audioElementRef.current) {
        audioElementRef.current.pause();
        audioElementRef.current.src = '';
      }
      setPlaybackError(null);

      if (base64Audio) {
        if (!audioElementRef.current) {
          audioElementRef.current = new Audio();
        }
        const audio = audioElementRef.current;
        audio.src = `data:audio/mp3;base64,${base64Audio}`;
        
        audio.onplay = () => {
          resolve();
        };

        audio.onended = () => {
          setVoiceState('idle');
        };

        audio.onerror = () => {
          const err = audio.error?.message || 'Audio element playback error';
          setPlaybackError(err);
          setVoiceState('error');
          reject(new Error(err));
        };

        audio.play().catch((err) => {
          const errMsg = err.message || 'Autoplay blocked or playback failed';
          setPlaybackError(errMsg);
          setVoiceState('error');
          reject(new Error(errMsg));
        });
      } else {
        const err = 'No audio data returned from backend';
        setPlaybackError(err);
        setVoiceState('error');
        reject(new Error(err));
      }
    });
  }, [agentId, setVoiceState]);

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

  /** Process the recorded audio blob → transcribe ONLY */
  const processAudioBlob = useCallback(async (audioBlob: Blob) => {
    setVoiceState('transcribing');

    try {
      // 1. Transcribe
      const fd = new FormData();
      fd.append('audio', audioBlob, 'audio.webm');
      const transcribeRes = await fetch(`${BACKEND}/voice/transcribe`, {
        method: 'POST',
        body: fd,
      });
      if (!transcribeRes.ok) throw new Error('Transcription failed');
      const { text: transcriptText } = await transcribeRes.json();

      if (!transcriptText || transcriptText.trim() === '') {
        setVoiceState('idle');
        return;
      }

      setLastTranscript(transcriptText);
      // Wait to set idle until transcription is fully dispatched
      onTranscript?.(transcriptText);
      setVoiceState('idle');
    } catch (err) {
      console.error(`[useVoiceIO:${agentId}] Pipeline error:`, err);
      setVoiceState('error');
      setTimeout(() => setVoiceState('idle'), 3000);
    }
  }, [agentId, onTranscript, setVoiceState]);

  /** Start listening */
  const startListening = useCallback(async () => {
    if (voiceState === 'listening') return;

    // Unlock AudioContext on user gesture (Chrome requirement)
    if (!audioElementRef.current) {
      audioElementRef.current = new Audio();
    }
    audioElementRef.current.play().catch(() => {});
    audioElementRef.current.pause();

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
  }, [agentId, voiceState, cleanupStream, processAudioBlob, startSilenceDetection, setVoiceState]);

  /** Stop listening manually */
  const stopListening = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    } else {
      cleanupStream();
      setVoiceState('idle');
    }
  }, [cleanupStream, setVoiceState]);

  /** Toggle listen/stop */
  const toggleListening = useCallback(() => {
    if (voiceState === 'listening') {
      stopListening();
    } else if (voiceState === 'idle' || voiceState === 'error' || voiceState === 'speaking') {
      startListening();
    }
  }, [voiceState, startListening, stopListening]);

  /** Speak a text string directly using pure TTS */
  const speak = useCallback(async (text: string): Promise<void> => {
    setVoiceState('speaking');
    try {
      const voiceModel = AGENT_VOICE[agentId] || 'aura-helios-en';
      const res = await fetch(`${BACKEND}/voice/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, agentId, voice: voiceModel }),
      });
      if (res.ok) {
        const { audioData } = await res.json();
        await playAudio(audioData, text);
      } else {
        await playAudio(null, text);
      }
    } catch (e: any) {
      await playAudio(null, text);
    }
  }, [agentId, playAudio, setVoiceState]);

  return {
    voiceState,
    lastTranscript,
    lastResponse,
    startListening,
    stopListening,
    toggleListening,
    speak,
    isListening: voiceState === 'listening',
    isSpeaking: voiceState === 'speaking',
    isProcessing: voiceState === 'transcribing' || voiceState === 'thinking',
    playbackError,
  };
}

