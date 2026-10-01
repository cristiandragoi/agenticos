/**
 * sttNormalizer.ts — Speech-To-Text Normalization & Canonicalization for Jarvis V2.
 *
 * Requirements:
 * 1. Preserves raw transcript while producing normalized transcript.
 * 2. Canonicalizes common STT phonetic misrecognitions:
 *    - "free cache", "free-cache", "freecash" -> "Free Cash"
 *    - "hermis", "her mez" -> "Hermes"
 *    - "code x", "code-x" -> "CodeX"
 *    - "jar vis", "jar-vis" -> "Jarvis"
 * 3. Validates confidence thresholds for high-impact actions (confirm, cancel, delegate).
 */

export interface SttNormalizationResult {
  rawTranscript: string;
  normalizedTranscript: string;
  confidence: number | null;
  canonicalEntity: string | null;
  isHighImpact: boolean;
  isSufficientConfidence: boolean;
}

const HIGH_IMPACT_KEYWORDS = [
  /\b(?:yes|proceed|confirm|do it|do that|go ahead)\b/i,
  /\b(?:cancel|stop|abort|decline)\b/i,
  /\b(?:give that to|delegate|assign to)\b/i,
  /\b(?:withdraw|survey|transfer|delete)\b/i,
];

export function normalizeTranscript(
  rawTranscript: string,
  confidence?: number | null
): SttNormalizationResult {
  const raw = (rawTranscript || '').trim();
  let normalized = raw;
  let canonicalEntity: string | null = null;

  // 1. Phonetic canonicalization for "Free Cash"
  if (/\b(?:free\s+cache|free-cache|freecash)\b/i.test(normalized)) {
    normalized = normalized.replace(/\b(?:free\s+cache|free-cache|freecash)\b/gi, 'Free Cash');
    canonicalEntity = 'Free Cash';
  } else if (/\bfree\s+cash\b/i.test(normalized)) {
    canonicalEntity = 'Free Cash';
  }

  // 2. Phonetic canonicalization for "Hermes"
  if (/\b(?:hermis|her\s+mez|her-mes)\b/i.test(normalized)) {
    normalized = normalized.replace(/\b(?:hermis|her\s+mez|her-mes)\b/gi, 'Hermes');
  }

  // 3. Phonetic canonicalization for "CodeX"
  if (/\b(?:code\s+x|code-x|codexx)\b/i.test(normalized)) {
    normalized = normalized.replace(/\b(?:code\s+x|code-x|codexx)\b/gi, 'CodeX');
  }

  // 4. Phonetic canonicalization for "Jarvis"
  if (/\b(?:jar\s+vis|jar-vis|yarvis)\b/i.test(normalized)) {
    normalized = normalized.replace(/\b(?:jar\s+vis|jar-vis|yarvis)\b/gi, 'Jarvis');
  }

  // 5. Clean up leading "Jarvis, " wake-word preamble if spoken
  const cleanedLeadingWakeWord = normalized.replace(/^(?:jarvis[, ]+)+/i, '');
  if (cleanedLeadingWakeWord.length > 0) {
    normalized = cleanedLeadingWakeWord;
  }

  // 6. Assess impact & confidence
  const isHighImpact = HIGH_IMPACT_KEYWORDS.some(re => re.test(normalized));
  const conf = confidence !== undefined ? confidence : null;
  // If confidence is provided and below 0.3 for high-impact action, flag it
  const isSufficientConfidence = conf === null || conf >= 0.3;

  return {
    rawTranscript: raw,
    normalizedTranscript: normalized,
    confidence: conf,
    canonicalEntity,
    isHighImpact,
    isSufficientConfidence,
  };
}
