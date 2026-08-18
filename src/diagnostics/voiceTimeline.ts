/**
 * voiceTimeline — per-turn REAL runtime latency instrumentation for the
 * physical voice loop. Every key is a measured timestamp on the actual
 * production path (no simulated values). Consumers (VoiceTracePanel /
 * CDP gate scripts / the human test) read the exact breakdown:
 *
 *   speechStartAt         VAD accepted sustained speech (turn opens)
 *   speechEndDetectedAt   measured silence >= endSpeechSilenceMs
 *   recordingStopAt       MediaRecorder.stop() called
 *   mediaRecorderFinalizedAt  recorder.onstop → blob assembled
 *   sttRequestStartAt     POST /voice/transcribe dispatched
 *   sttResultAt           STT response parsed (transcript text)
 *   transcriptAcceptedAt  transcript passed ownership/echo gates
 *   routingStartAt        submitConversationTurn → onAutoSubmit fires
 *   modelRequestStartAt   POST /conversations/:id/message/stream dispatched
 *   firstModelTokenAt     first SSE chunk received
 *   ttsRequestStartAt     POST /voice/tts dispatched (first spoken chunk)
 *   ttsAudioReadyAt       TTS audio base64 received
 *   audioPlaybackStartAt  browser onplay confirmed (speaking state)
 */
export type VoiceTimelineKey =
  | 'speechStartAt'
  | 'speechEndDetectedAt'
  | 'recordingStopAt'
  | 'mediaRecorderFinalizedAt'
  | 'sttRequestStartAt'
  | 'sttResultAt'
  | 'transcriptAcceptedAt'
  | 'routingStartAt'
  | 'modelRequestStartAt'
  | 'firstModelTokenAt'
  | 'ttsRequestStartAt'
  | 'ttsAudioReadyAt'
  | 'audioPlaybackStartAt';

export interface VoiceTimelineEntry {
  key: VoiceTimelineKey | string;
  at: number;
  detail?: string;
}

let entries: VoiceTimelineEntry[] = [];
let turnSeq = 0;

/** Start a new logical turn (clears the previous timeline). */
export function voiceTimelineBegin(): number {
  turnSeq += 1;
  entries = [];
  emit();
  return turnSeq;
}

/** Record a measured timestamp for this turn (idempotent per key). */
export function voiceTimelinePush(key: VoiceTimelineKey | string, detail?: string) {
  // First occurrence wins — later duplicate pushes for the same key (e.g. a
  // progressive TTS second chunk) must not overwrite the turn's true first.
  if (entries.some((e) => e.key === key)) return;
  const entry: VoiceTimelineEntry = { key, at: Date.now(), detail };
  entries.push(entry);
  // CDP-visible console marker (console.debug reaches the app console).
  console.debug(`[VTimeline] ${key} ${entry.at}${detail ? ` ${detail}` : ''}`);
  emit();
  window.dispatchEvent(new CustomEvent('jarvis:voice-timeline', { detail: { key, at: entry.at, detail } }));
}

export function voiceTimelineGet(): VoiceTimelineEntry[] {
  return [...entries];
}

export function voiceTimelineGetAll(): { turn: number; entries: VoiceTimelineEntry[] } {
  return { turn: turnSeq, entries: [...entries] };
}

/** Convenience breakdown for a completed turn (ms between ordered keys). */
export function voiceTimelineBreakdown(): Record<string, number> {
  const map = new Map(entries.map((e) => [e.key, e.at]));
  const get = (k: string) => map.get(k);
  const delta = (a: string, b: string) => (get(a) && get(b) ? (get(b)! - get(a)!) : -1);
  return {
    speechEndToSttResult: delta('speechEndDetectedAt', 'sttResultAt'),
    sttResultToModelRequest: delta('sttResultAt', 'modelRequestStartAt'),
    modelRequestToFirstToken: delta('modelRequestStartAt', 'firstModelTokenAt'),
    firstTokenToTtsReady: delta('firstModelTokenAt', 'ttsAudioReadyAt'),
    ttsReadyToPlayback: delta('ttsAudioReadyAt', 'audioPlaybackStartAt'),
    totalSpeechEndToPlayback: delta('speechEndDetectedAt', 'audioPlaybackStartAt'),
  };
}

type Listener = (entries: VoiceTimelineEntry[]) => void;
const listeners = new Set<Listener>();
function emit() {
  for (const l of listeners) l(entries);
}
export function voiceTimelineSubscribe(fn: Listener): () => void {
  listeners.add(fn);
  fn(entries);
  return () => listeners.delete(fn);
}

// Expose a read-only snapshot on window so CDP gate scripts can read the
// live timeline without instrumenting the page.
export function installVoiceTimelineProbe() {
  if (typeof window === 'undefined') return;
  try {
    (window as any).__voiceTimelineGet = () => voiceTimelineGetAll();
    (window as any).__voiceTimelineBreakdown = () => voiceTimelineBreakdown();
  } catch { /* best effort */ }
}
