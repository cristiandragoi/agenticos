/**
 * adaptiveBargeIn — ChatGPT-style interruption classification (Phase 15,
 * Failure E). Replaces binary "user sound → STOP" with a proper lifecycle:
 *
 *   SPEAKING → DUCKED_LISTENING (audio ducked, not destroyed)
 *     → ACKNOWLEDGEMENT  (short "yes/okay/right" → resume, no new LLM turn)
 *     → HARD_CONTROL     ("stop/cancel" → full kill, no LLM)
 *     → TAKEOVER         (sustained new question → full kill + new turn)
 *     → NOISE            (no meaningful speech → resume)
 *
 * Classification is DETERMINISTIC and local (no model in the real-time path):
 * - ack: very short utterance of acknowledgement words
 * - control: the same control-intent tiers as stop/cancel
 * - takeover: anything else with real content
 * - noise: empty/no-speech transcripts
 */

export type InterruptionClass =
  | 'acknowledgement'
  | 'hard_control'
  | 'takeover'
  | 'noise';

/** Short acknowledgement words (lowercase, trimmed). */
const ACK_WORDS = new Set([
  'yes', 'yeah', 'yep', 'yup', 'okay', 'ok', 'right', 'sure', 'mhm', 'uh-huh',
  'mm-hmm', 'no', 'nope', 'got it', 'gotcha', 'fine', 'alright', 'k', 'kk',
  'thanks', 'thank you', 'cool', 'great', 'good', 'nice',
]);

const CONTROL_RE = /\b(stop|cancel|abort|quiet|shut up|silence|terminate)\b/i;

/**
 * Classify an interruption transcript.
 *
 * @param transcript  STT text of the barge-in segment (may be empty).
 * @param speechMs    measured duration of the user's speech (approx).
 * @param thresholdMs how long speech must be to be a real takeover (default 1800ms).
 */
export function classifyInterruption(
  transcript: string,
  speechMs: number,
  thresholdMs = 1800,
): InterruptionClass {
  const t = (transcript || '').trim().toLowerCase().replace(/[.!?,]+$/g, '');
  if (!t) return 'noise';

  // HARD CONTROL WINS OVER EVERYTHING (same rule as echo/STOP priority):
  // "stop", "Jarvis stop", "cancel that" is never treated as an ack/noise.
  if (CONTROL_RE.test(t)) return 'hard_control';

  // A short acknowledgement should NOT destroy the response.
  if (ACK_WORDS.has(t)) return 'acknowledgement';
  // "okay Jarvis" / "yeah go on" — still ack-ish when very short.
  if (ACK_WORDS.has(t.replace(/^(hey\s+|ok(?:ay)?\s+)?jarvis\s*/i, '').trim())) {
    if (speechMs < thresholdMs) return 'acknowledgement';
  }

  // Sustained real speech with content → the user is taking over.
  if (speechMs >= thresholdMs) return 'takeover';

  // Short but not an ack word — ambiguous. Prefer NOT destroying the current
  // answer for a half-second noise fragment; treat as noise (resume).
  if (speechMs < 700) return 'noise';

  // Short real content (e.g. "actually" alone) — lean takeover only if it
  // looks like the start of a question/command.
  return 'takeover';
}
