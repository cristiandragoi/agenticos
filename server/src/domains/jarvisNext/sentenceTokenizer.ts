/**
 * Authoritative sentence tokenizer for Jarvis TTS and speech pipeline.
 *
 * Requirements:
 * 1. Sentence endings support terminal punctuation followed by closing characters: ' " ’ ” ) ] }
 * 2. Nested punctuation (e.g. state.'. AgenticOS said: ...) is preserved with all intervening text.
 * 3. Conservation invariant: normalized concatenation of all chunks equals normalized input.
 * 4. Punctuation-only chunks are rejected/merged with adjacent content.
 * 5. Deterministic fallback scanner if Intl.Segmenter is unavailable.
 * 6. Runtime diagnostics and safe non-destructive fallback if invariant fails.
 */

export interface SentenceSegmentationResult {
  sentences: string[];
  inputChars: number;
  outputChars: number;
  chunksCount: number;
  invariantPassed: boolean;
  methodUsed: 'intl-segmenter' | 'fallback-scanner' | 'fallback-original';
}

export function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export function isPunctuationOnly(s: string): boolean {
  const trimmed = s.trim();
  if (!trimmed) return true;
  return !/[0-9A-Za-z\p{L}\p{N}]/u.test(trimmed);
}

export function scanSentencesFallback(text: string): string[] {
  const result: string[] = [];
  let start = 0;
  const len = text.length;
  const isClosingOrTerminal = (ch: string) => /['"’”)\]}\.\!\?]/.test(ch);

  for (let i = 0; i < len; i++) {
    const ch = text[i];
    // Protect decimal numbers (e.g. 2.6)
    if (ch === '.' && i > 0 && i + 1 < len && /\d/.test(text[i - 1]) && /\d/.test(text[i + 1])) {
      continue;
    }
    if (ch === '.' || ch === '!' || ch === '?') {
      let j = i + 1;
      // Consume any trailing closing characters or consecutive punctuation (e.g. '.'. or !? or .")
      while (j < len && isClosingOrTerminal(text[j])) {
        // Protect decimals inside trailing sequence if any
        if (text[j] === '.' && j + 1 < len && /\d/.test(text[j + 1])) {
          break;
        }
        j++;
      }
      if (j >= len || /\s/.test(text[j])) {
        result.push(text.slice(start, j));
        while (j < len && /\s/.test(text[j])) {
          j++;
        }
        start = j;
        i = j - 1;
      }
    }
  }

  if (start < len) {
    const remaining = text.slice(start);
    if (remaining.trim()) {
      result.push(remaining);
    }
  }

  return result.length > 0 ? result : [text];
}

export function splitIntoSentences(text: string): SentenceSegmentationResult {
  if (!text || typeof text !== 'string') {
    return {
      sentences: [],
      inputChars: 0,
      outputChars: 0,
      chunksCount: 0,
      invariantPassed: true,
      methodUsed: 'intl-segmenter',
    };
  }

  const trimmedText = text.trim();
  if (!trimmedText) {
    return {
      sentences: [],
      inputChars: text.length,
      outputChars: 0,
      chunksCount: 0,
      invariantPassed: true,
      methodUsed: 'intl-segmenter',
    };
  }

  let rawSegments: string[] = [];
  let method: 'intl-segmenter' | 'fallback-scanner' | 'fallback-original' = 'intl-segmenter';

  try {
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
      const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
      rawSegments = Array.from(segmenter.segment(text)).map((s) => s.segment);
    }
  } catch (_err) {
    rawSegments = [];
  }

  if (rawSegments.length === 0) {
    rawSegments = scanSentencesFallback(text);
    method = 'fallback-scanner';
  }

  // Merge punctuation-only chunks so they never reach TTS independently
  const merged: string[] = [];
  for (const seg of rawSegments) {
    if (isPunctuationOnly(seg) && merged.length > 0) {
      merged[merged.length - 1] += seg;
    } else {
      merged.push(seg);
    }
  }

  // Clean chunks for TTS while verifying conservation
  const cleaned = merged.map((s) => s.trim()).filter(Boolean);
  if (cleaned.length === 0) {
    return {
      sentences: [trimmedText],
      inputChars: text.length,
      outputChars: trimmedText.length,
      chunksCount: 1,
      invariantPassed: true,
      methodUsed: method,
    };
  }

  // Invariant verification: normalized join must match normalized input
  const normalizedOriginal = normalizeWhitespace(text);
  const normalizedOutput = normalizeWhitespace(cleaned.join(' '));
  const invariantPassed = normalizedOriginal === normalizedOutput;

  if (!invariantPassed) {
    return {
      sentences: [trimmedText],
      inputChars: text.length,
      outputChars: trimmedText.length,
      chunksCount: 1,
      invariantPassed: false,
      methodUsed: 'fallback-original',
    };
  }

  return {
    sentences: cleaned,
    inputChars: text.length,
    outputChars: cleaned.reduce((acc, s) => acc + s.length, 0),
    chunksCount: cleaned.length,
    invariantPassed: true,
    methodUsed: method,
  };
}
