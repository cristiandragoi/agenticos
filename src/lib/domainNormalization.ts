/**
 * domainNormalization.ts — project-context-aware STT variant normalization.
 *
 * The human test observed "Agentic OS" being misheard / drifted into
 * "Authentic OS" and other unrelated concepts. Deepgram can mis-transcribe the
 * local project name. This module maps plausible STT variants back to the
 * LOCAL project concept — but ONLY when the surrounding context strongly
 * indicates a project reference. It must never blindly rewrite unrelated
 * user words.
 */

export interface DomainAlias {
  /** Regex that matches a plausible STT variant (lowercased input). */
  pattern: RegExp;
  /** Canonical replacement token. */
  canonical: string;
}

/**
 * Ordered alias table. Most-specific first.
 *
 * "Argentic OS", "Authentic OS", "Agenticos", "Agentic operating system" are
 * all plausible mis-hearings of "Agentic OS". We normalize them ONLY in a
 * project-question context (architecture / project / explain / our / this).
 */
export const AGENTIC_OS_ALIASES: DomainAlias[] = [
  { pattern: /\bargentic\s+(?:os|operating\s+systems?)\b/i, canonical: 'Agentic OS' },
  { pattern: /\bauthentic\s+(?:os|operating\s+systems?)\b/i, canonical: 'Agentic OS' },
  { pattern: /\bagenticos\b/i, canonical: 'Agentic OS' },
  { pattern: /\bagentic\s+operating\s+systems?\b/i, canonical: 'Agentic OS' },
  { pattern: /\bagentic\s+o\.?s\.?\b/i, canonical: 'Agentic OS' },
];

/** Terms that signal the utterance is a project/architecture reference. */
const PROJECT_CONTEXT_SIGNALS = [
  /\barchitecture\b/,
  /\bproject\b/,
  /\bexplain\b/,
  /\bdescribe\b/,
  /\bour\b/,
  /\bthis\b/,
  /\bthe\s+(?:system|os|platform|codebase|stack)\b/,
  /\byour\b/,
  /\blocal\b/,
  /\bhow\s+does\b/,
  /\bwhat\s+is\b/,
];

/** True when the text appears to be asking about the local project/system. */
export function hasProjectContextSignal(text: string): boolean {
  const t = (text || '').toLowerCase();
  return PROJECT_CONTEXT_SIGNALS.some((re) => re.test(t));
}

/**
 * Normalize Agentic-OS STT variants toward the local project name, but only
 * when the utterance looks like a project/architecture reference. Returns the
 * (possibly unchanged) text.
 */
export function normalizeDomainTerms(text: string): string {
  if (!text) return text;
  if (!hasProjectContextSignal(text)) return text;
  let out = text;
  for (const alias of AGENTIC_OS_ALIASES) {
    out = out.replace(alias.pattern, alias.canonical);
  }
  return out;
}
