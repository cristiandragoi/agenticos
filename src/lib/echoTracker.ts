/**
 * echoTracker.ts — transcript-level echo detection + mixed-transcript salvage.
 *
 * While Jarvis is speaking, the live microphone may pick up the speaker
 * output and STT may return a transcript that is (a) pure echo of Jarvis's
 * own words, or (b) MIXED — an echo prefix followed by genuine user speech,
 * e.g. "engineering inspection agent Jarvis stop tell me about memory".
 *
 * We cannot compare the incoming transcript against the ENTIRE assistant
 * response (the microphone only hears the portion currently coming from the
 * speakers). So we track RECENT spoken segments with timestamps and compare
 * the incoming transcript against the likely CURRENT segment.
 *
 * Design rules (Phase 7 — STOP MUST WIN OVER ECHO):
 *   - Control detection (stop/terminate) runs BEFORE echo rejection. A
 *     credible "stop"/"cancel" is never discarded as echo.
 *   - When a salvage cannot be high-confidence, we RETAIN the speech
 *     rather than silently delete a genuine command.
 *
 * All matching is transcript-level, not per audio frame — cheap enough to
 * run once per STT result.
 */

export interface SpokenSegment {
  text: string;
  at: number;
  /** The conversational turn that produced this segment. */
  turnId: string;
}

export interface EchoDecision {
  /** 'echo' = entire transcript is speaker echo → discard. */
  kind: 'echo' | 'mixed' | 'fresh';
  /** The text that should be used (echo → empty; mixed → salvaged suffix; fresh → original). */
  text: string;
  /** Echo prefix that was removed (diagnostics). */
  removedPrefix: string;
  /** Confidence that the removed prefix really is echo (0..1). */
  confidence: number;
}

/** How far back a spoken segment is considered "recent" for echo matching. */
const RECENT_MS = 8000;

/** Segments are retained briefly so a late STT result can still be compared. */
const RETAIN_MS = 30000;

/** Minimum transcript length (normalized words) before echo matching applies.
 *  Ultra-short utterances ("stop", "ok") are never echo-rejected here. */
const MIN_WORDS_FOR_ECHO = 2;

let segments: SpokenSegment[] = [];

function normalize(text: string): string {
  return (text || '')
    .toLowerCase()
    .replace(/['"“”‘’]+/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function words(text: string): string[] {
  return normalize(text).split(' ').filter(Boolean);
}

/** Clean expired segments (called on each interaction — no timers). */
function prune(now: number): void {
  segments = segments.filter((s) => now - s.at <= RETAIN_MS);
}

/** Record a segment of text that Jarvis just spoke. */
export function recordSpokenSegment(text: string, turnId: string, at: number = Date.now()): void {
  const t = normalize(text);
  if (!t) return;
  prune(at);
  segments.push({ text: t, at, turnId });
}

/** Clear all tracked segments (e.g. on session end). */
export function clearSpokenSegments(): void {
  segments = [];
}

/** Get the currently spoken segment (the one most likely to be coming from
 *  the speakers right now). */
function currentSegment(now: number): SpokenSegment | null {
  prune(now);
  const recent = segments.filter((s) => now - s.at <= RECENT_MS);
  if (!recent.length) return null;
  return recent[recent.length - 1];
}

/** Fuzzy similarity 0..1 between two normalized strings. */
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const wa = words(a);
  const wb = words(b);
  if (!wa.length || !wb.length) return 0;
  const setA = new Set(wa);
  let hits = 0;
  for (const w of wb) if (setA.has(w)) hits += 1;
  return hits / Math.max(wa.length, wb.length);
}

/**
 * Decide whether an incoming STT transcript is echo, mixed (echo prefix +
 * user suffix), or fresh user speech.
 *
 * This is deliberately conservative: when confidence is low we retain the
 * speech. The caller (control-intent layer) has ALREADY handled stop/terminate
 * before this runs, so a genuine command is never lost here.
 */
export function classifyTranscript(transcript: string, now: number = Date.now()): EchoDecision {
  const t = normalize(transcript);
  const fresh: EchoDecision = { kind: 'fresh', text: transcript, removedPrefix: '', confidence: 0 };
  if (!t) return fresh;

  // Too short to be a meaningful echo match — retain it.
  if (words(t).length < MIN_WORDS_FOR_ECHO) return fresh;

  const seg = currentSegment(now);
  if (!seg) return fresh;

  const sw = words(seg.text);
  const tw = words(t);
  if (!sw.length || !tw.length) return fresh;

  // 1) PURE echo: the transcript is (nearly) a substring of the current spoken
  //    segment. E.g. speaker says "...it runs repository inspections...",
  //    mic hears "runs repository inspections".
  const joined = t;
  const segJoined = seg.text;
  const overlap = similarity(segJoined, joined);
  if (overlap >= 0.7 || (tw.length <= sw.length && segJoined.includes(joined))) {
    return { kind: 'echo', text: '', removedPrefix: transcript, confidence: overlap };
  }

  // 2) MIXED: the transcript starts with a run of words matching the current
  //    segment, then diverges into distinct user speech.
  //    Find the longest echo prefix: the first k transcript words that appear
  //    in-order within the spoken segment.
  const segWordSet = new Set(sw);
  let prefixLen = 0;
  for (let i = 0; i < tw.length; i++) {
    if (segWordSet.has(tw[i])) prefixLen = i + 1;
    else break;
  }
  if (prefixLen === 0) return fresh;

  const suffixWords = tw.slice(prefixLen);
  // Require the echo prefix to be a solid chunk AND the suffix to be non-trivial.
  if (prefixLen >= 2 && suffixWords.length >= 1) {
    const removedPrefix = tw.slice(0, prefixLen).join(' ');
    const salvaged = suffixWords.join(' ');
    return {
      kind: 'mixed',
      text: salvaged,
      removedPrefix,
      confidence: prefixLen / tw.length,
    };
  }

  // 3) Not confident enough — retain the original speech rather than risk
  //    deleting a genuine command.
  return fresh;
}

/** Testing hook: reset internal state. */
export function _resetEchoTracker(): void {
  segments = [];
}
