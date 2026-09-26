/**
 * controlIntent.ts — local, deterministic control-intent detection.
 *
 * This runs BEFORE any assistant/model routing. It is the authoritative
/**
 * controlIntent.ts — local, deterministic control-intent detection.
 *
 * This runs BEFORE any assistant/model routing. It is the authoritative
 * barrier that makes "Jarvis, stop" mean STOP — never an LLM prompt.
 *
 * Detection is local (regex over normalized text), so it never depends on
 * the model deciding what "stop" means.
 */

export type GranularControlAction = 'stop_speech' | 'cancel_request' | 'end_conversation';
export type ControlKind = 'stop' | 'terminate' | GranularControlAction;

export interface ControlCommand {
  kind: ControlKind;
  action: GranularControlAction;
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

/** True only when an utterance is explicitly addressed to the assistant.
 * Unlike `normalizeForControl`, this is intentionally anchored: a wake word
 * mentioned later in background speech must not grant model authority. */
export function hasWakePrefix(text: string): boolean {
  return /^\s*(?:(?:hey\s+|ok(?:ay)?\s+)?(?:jarvis|jarvus|jarvas|jervis|jarvis'|jarvis's)|(?:agentic\s+os|agenticos|argentic\s+os|agentic)|computer)\b[,\s.:!]*/i.test(text || '');
}

/** Cancel phrases — specifically cancel an in-flight model request. */
const CANCEL_PATTERNS: RegExp[] = [
  /^cancel\s*$/,
  /^cancel\s+that\s*$/,
  /^cancel\s+please\s*$/,
  /^cancel\s+request\s*$/,
  /^cancel\s+response\s*$/,
  /^never\s*mind\s*$/,
  /^nevermind\s*$/,
  /^abort\s*$/,
  /^abbrechen\s*$/,
  /^anuleaz[aă]\s*$/,
];

/** Stop speech phrases — specifically halt audio playback / speech synthesis. */
const STOP_SPEECH_PATTERNS: RegExp[] = [
  /^stop\s+talking\s*$/,
  /^stop\s+speaking\s*$/,
  /^don'?t\s+talk\s*$/,
  /^do\s+not\s+talk\s*$/,
  /^be\s+quiet\s*$/,
  /^quiet\s*$/,
  /^shut\s+up\s*$/,
  /^silence\s*$/,
  /^hush\s*$/,
  /^nicht\s+mehr\s+sprechen\s*$/,
  /^taci\s*$/,
  /^taci\s+din\s+gur[aă]\s*$/,
  /^lini[sș]te\s*$/,
  /^nu\s+mai\s+vorbi\s*$/,
];

/** General stop phrases — stop playback or cancel depending on context. */
const GENERAL_STOP_PATTERNS: RegExp[] = [
  /^stop\s*$/,
  /^stop\s+it\s*$/,
  /^halt\s*$/,
  /^stop\s+now\s*$/,
  /^that['’]?s?\s+enough\s*$/,
  /^please\s+stop\s*$/,
  /^stop\s+please\s*$/,

  // German: stopp, halt, hör auf, aufhören, schweig, ruhe
  /^stopp\s*$/,
  /^stopp\s+jetzt\s*$/,
  /^h[oö]r\s+auf\s*$/,
  /^aufh[oö]ren\s*$/,
  /^schweig\s*$/,
  /^schweigen\s*$/,
  /^ruhe\s*$/,
  /^sei\s+still\s*$/,
  /^stille\s*$/,
  /^genug\s*$/,

  // Romanian: oprește, opreste, gata
  /^opre[sș]te\s*$/,
  /^opre[sș]te-?te\s*$/,
  /^gata\s*$/,
];

/** Terminate phrases — end the discussion/conversation entirely. */
const TERMINATE_PATTERNS: RegExp[] = [
  /^terminate\s*$/,
  /^terminate\s+discussion\s*$/,
  /^terminate\s+the\s+discussion\s*$/,
  /^terminate\s+conversation\s*$/,
  /^end\s+discussion\s*$/,
  /^end\s+the\s+discussion\s*$/,
  /^end\s+conversation\s*$/,
  /^end\s+the\s+conversation\s*$/,
  /^end\s+this\s*$/,
  /^close\s+discussion\s*$/,
  /^close\s+the\s+discussion\s*$/,
  /^close\s+conversation\s*$/,
  /^turn\s+off\s+mic\s*$/,
  /^turn\s+off\s+microphone\s*$/,
  /^mic\s+off\s*$/,
  /^microphone\s+off\s*$/,
  /^we['’]?re\s+done\s*$/,
  /^that['’]?s?\s+all\s*$/,
  // German terminate
  /^gespr[aä]ch\s+beenden\s*$/,
  /^unterhaltung\s+beenden\s*$/,
  // Romanian terminate
  /^termin[aă]\s+conversa[tț]ia\s*$/,
  /^inchide\s+conversa[tț]ia\s*$/,
  /^închide\s+conversa[tț]ia\s*$/,
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
      return { kind: 'terminate', action: 'end_conversation', raw: text, matched: normalized };
    }
  }
  for (const re of CANCEL_PATTERNS) {
    if (re.test(normalized)) {
      return { kind: 'stop', action: 'cancel_request', raw: text, matched: normalized };
    }
  }
  for (const re of STOP_SPEECH_PATTERNS) {
    if (re.test(normalized)) {
      return { kind: 'stop', action: 'stop_speech', raw: text, matched: normalized };
    }
  }
  for (const re of GENERAL_STOP_PATTERNS) {
    if (re.test(normalized)) {
      return { kind: 'stop', action: 'stop_speech', raw: text, matched: normalized };
    }
  }
  return null;
}
