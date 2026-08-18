/**
 * VoiceTrace — a per-request stage log for the physical microphone
 * acceptance test. Every stage records {stage, status, detail, at}.
 * The panel renders the stages in order and highlights the FIRST failure,
 * so a human tester can see exactly where the spoken loop broke.
 *
 * Stages (in order):
 *  vad_triggered → audio_captured → transcript → auto_submit →
 *  conversation → intent_route → provider_model → response_started →
 *  response_done → tts_request → playback_started
 */
export type TraceStage =
  | 'vad_triggered'
  | 'audio_captured'
  | 'transcript'
  | 'auto_submit'
  | 'conversation'
  | 'intent_route'
  | 'provider_model'
  | 'response_started'
  | 'response_done'
  | 'tts_request'
  | 'playback_started';

export interface TraceEntry {
  stage: TraceStage | string;
  status: 'ok' | 'fail' | 'info';
  detail: string;
  at: number;
}

type Listener = (entries: TraceEntry[]) => void;

const STAGE_ORDER: string[] = [
  'vad_triggered', 'audio_captured', 'transcript', 'auto_submit',
  'conversation', 'intent_route', 'provider_model', 'response_started',
  'response_done', 'tts_request', 'playback_started',
];

let entries: TraceEntry[] = [];
const listeners = new Set<Listener>();
let runId = 0;

function emit() {
  for (const l of listeners) l(entries);
}

/** Start a new logical run (per user turn). */
export function voiceTraceBegin() {
  runId += 1;
  entries = [];
  emit();
  return runId;
}

export function voiceTracePush(stage: TraceStage | string, status: 'ok' | 'fail' | 'info', detail: string) {
  entries.push({ stage, status, detail, at: Date.now() });
  // keep the log bounded
  if (entries.length > 40) entries = entries.slice(-40);
  emit();
}

export function voiceTraceGet(): TraceEntry[] {
  return [...entries];
}

export function voiceTraceSubscribe(fn: Listener): () => void {
  listeners.add(fn);
  fn(entries);
  return () => listeners.delete(fn);
}

export function voiceTraceFirstFailure(): TraceEntry | null {
  const ordered = [...entries].sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage));
  return ordered.find((e) => e.status === 'fail') || null;
}

export function voiceTraceSummary(): { ok: number; fail: number; total: number; firstFailStage: string | null } {
  const fail = entries.filter((e) => e.status === 'fail').length;
  const ok = entries.filter((e) => e.status === 'ok').length;
  const first = voiceTraceFirstFailure();
  return { ok, fail, total: entries.length, firstFailStage: first ? first.stage : null };
}
