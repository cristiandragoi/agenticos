/**
 * controlIntent.ts — local, deterministic control-intent detection.
 *
 * This runs BEFORE any assistant/model routing. It is the authoritative
 * barrier that makes "Jarvis, stop" mean STOP — never an LLM prompt.
 *
 * Detection is local (regex over normalized text), so it never depends on
 * the model deciding what "stop" means.
 */

export type ControlKind = 'stop' | 'terminate';

export interface ControlCommand {
  kind: ControlKind;
  /** The raw user utterance that triggered the control command. */
  raw: string;
  /** The matched phrase (for diagnostics only). */
  matched: string;
}

/** Wake/address prefixes the user may attach to a control command. */
const WAKE_PATTERNS = [
  /\b(?:hey\s+|ok(?:ay)?\s+)?(?:jarvis|jarvus|jarvas|jervis|jarvis'|jarvis's)\b[,\s.:!]*/i,
  /\b(?:agentic os|agenticos|argentic os|agentic)\b[,\s.:!]*/i,
  /\b(?:hey\s+|ok(?:ay)?\s+)?computer\b[,\s.:!]*/i,
];

/** Stop phrases — exact-ish matches after normalization. */
const STOP_PATTERNS: RegExp[] = [
  /^stop\s*$/,
  /^stop\s+talking\s*$/,
  /^stop\s+speaking\s*$/,
  /^stop\s+please\s*$/,
  /^please\s+stop\s*$/,
  /^be\s+quiet\s*$/,
  /^quiet\s*$/,
  /^cancel\s*$/,
  /^cancel\s+that\s*$/,
  /^cancel\s+please\s*$/,
  /^never\s*mind\s*$/,
  /^nevermind\s*$/,
  /^shut\s+up\s*$/,
  /^stop\s+now\s*$/,
  /^that['’]?s?\s+enough\s*$/,
];

/** Terminate phrases — end the discussion entirely. */
const TERMINATE_PATTERNS: RegExp[] = [
  /^terminate\s*$/,
  /^terminate\s+discussion\s*$/,
  /^terminate\s+the\s+discussion\s*$/,
  /^end\s+discussion\s*$/,
  /^end\s+the\s+discussion\s*$/,
  /^end\s+conversation\s*$/,
  /^end\s+the\s+conversation\s*$/,
  /^end\s+this\s*$/,
  /^close\s+discussion\s*$/,
  /^close\s+the\s+discussion\s*$/,
  /^we['’]?re\s+done\s*$/,
  /^that['’]?s?\s+all\s*$/,
];

/**
 * Normalize an utterance for control matching:
 *   lowercase → strip punctuation → collapse whitespace → strip wake prefixes.
 */
export function normalizeForControl(text: string): string {
  let t = (text || '').toLowerCase().trim();
  if (!t) return '';
  // Strip trailing sentence punctuation and quotes.
  t = t.replace(/[.?!。！？…]+$/, '');
  t = t.replace(/['"“”‘’]+/g, '');
  // Collapse internal whitespace.
  t = t.replace(/\s+/g, ' ');
  // Strip a leading wake/address term (repeatedly, in case of stacking).
  let changed = true;
  while (changed) {
    changed = false;
    for (const w of WAKE_PATTERNS) {
      const next = t.replace(w, '').trim();
      if (next !== t) {
        t = next;
        changed = true;
      }
    }
  }
  return t.trim();
}

/** True when the utterance is only a wake/address term ("Jarvis"). */
export function isStandaloneWake(text: string): boolean {
  return normalizeForControl(text) === '';
}

/** Detect a control command. Returns null when the text is a normal utterance. */
export function detectControlIntent(text: string): ControlCommand | null {
  const normalized = normalizeForControl(text);
  if (!normalized) return null;
  for (const re of TERMINATE_PATTERNS) {
    if (re.test(normalized)) {
      return { kind: 'terminate', raw: text, matched: normalized };
    }
  }
  for (const re of STOP_PATTERNS) {
    if (re.test(normalized)) {
      return { kind: 'stop', raw: text, matched: normalized };
    }
  }
  return null;
}
