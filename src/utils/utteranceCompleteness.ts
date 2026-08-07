/**
 * End-of-turn detection for CONVERSATION-mode voice input.
 *
 * A single STT chunk can end mid-utterance ("It is", "I want", "Can you",
 * "The thing is", "So basically") when a speaker pauses longer than the VAD
 * silence threshold. Submitting those fragments as complete turns produces
 * spurious clarification. This module decides whether an utterance is
 * COMPLETE using:
 *   - terminal punctuation (. ! ?)          → complete
 *   - a final word in a CLOSED-CLASS set of continuation markers (function
 *     words + discourse fillers that signal "more is coming") → incomplete
 *
 * This is NOT a list of example phrases — it is the standard linguistic
 * "finality" signal. Genuine short commands ("Open CodeX", "Stop task",
 * "Yes", "No") end with content words and stay complete (submitted fast).
 */
export const CONTINUATION_TAIL_WORDS: ReadonlySet<string> = new Set([
  // copulas / auxiliaries / semi-modals
  'is', 'are', 'was', 'were', 'am', 'be', 'been', 'being',
  'do', 'does', 'did', 'can', 'could', 'will', 'would', 'should', 'shall',
  'may', 'might', 'must', 'have', 'has', 'had', 'need', 'needs', 'want',
  'wants', 'gonna', 'going', 'not',
  // negation-contraction stems ("isn't", "can't", "won't", "don't" → hold)
  'isn', 'aren', 'wasn', 'weren', 'don', 'doesn', 'didn', 'won', 'couldn',
  'wouldn', 'shouldn', 'hasn', 'haven', 'hadn', 'mustn', 'needn', 'mightn',
  // prepositions / determiners
  'to', 'the', 'a', 'an', 'of', 'for', 'with', 'in', 'on', 'at', 'by',
  'from', 'about', 'into', 'onto', 'up', 'down', 'over', 'under', 'through',
  'between', 'among', 'after', 'before', 'during', 'without', 'against',
  // conjunctions / subordinators
  'and', 'but', 'or', 'so', 'if', 'because', 'though', 'although', 'while',
  'when', 'where', 'that', 'than', 'then', 'as',
  // pronouns that rarely end a complete command/statement on a pause
  'i', 'you', 'we', 'they', 'he', 'she', 'it', 'me', 'us', 'them', 'him',
  'her', 'my', 'your', 'our', 'their', 'its', 'this', 'these', 'those',
  // discourse fillers
  'basically', 'actually', 'like', 'just', 'really', 'now', 'here', 'there',
  'also', 'kind', 'kinda', 'sort', 'sorta', 'pretty', 'quite', 'very',
  'anyway', 'honestly', 'literally', 'then',
]);

/** True when the transcript reads like a finished utterance. */
export function isUtteranceComplete(text: string): boolean {
  const t = (text || '').trim();
  if (!t) return false;
  if (/[.!?…]$/.test(t)) return true;
  const words = t.toLowerCase().split(/[^a-zäöüß0-9']+/i).filter(Boolean);
  if (!words.length) return true;
  // Contractions keep their stem for the finality check ("isn't" → "isn").
  const last = words[words.length - 1].replace(/'t$/, '');
  return !CONTINUATION_TAIL_WORDS.has(last);
}

export type ContinuationDecision =
  | { action: 'submit'; text: string }
  | { action: 'hold' }          // incomplete first segment: buffer + wait
  | { action: 'buffer'; combined: string }; // appended segment, still incomplete

/**
 * Decide what to do with a new transcript segment.
 * - no buffer + complete            → submit immediately (fast short commands)
 * - no buffer + incomplete          → hold (start continuation window)
 * - buffer + combined complete      → submit the COMBINED utterance (one turn)
 * - buffer + combined incomplete    → keep buffering, extend the window
 */
export function decideContinuation(bufferText: string | null, incoming: string): ContinuationDecision {
  if (!bufferText) {
    if (isUtteranceComplete(incoming)) return { action: 'submit', text: incoming };
    return { action: 'hold' };
  }
  const combined = `${bufferText} ${incoming}`.trim();
  if (isUtteranceComplete(combined)) return { action: 'submit', text: combined };
  return { action: 'buffer', combined };
}
