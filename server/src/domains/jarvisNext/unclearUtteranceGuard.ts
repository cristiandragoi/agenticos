/**
 * unclearUtteranceGuard.ts — Guards against hallucinating meaning from short, unclear STT fragments.
 *
 * User directive:
 * "Wenn die Spracherkennung nur 1–2 unklare Wörter liefert oder unsicher ist, soll Jarvis
 * kurz fragen „Wie bitte?“ oder „Das habe ich nicht verstanden“, statt etwas zu deuten."
 */

const VALID_SHORT_WORDS_DE = new Set([
  // Affirmative
  'ja', 'bitte', 'gerne', 'sicher', 'klar', 'ok', 'okay', 'genau', 'richtig', 'bestätigen', 'einverstanden', 'mach', 'das',
  // Negative / Stop
  'nein', 'nicht', 'stop', 'stopp', 'halt', 'abbrechen', 'ruhe', 'pause',
  // Greetings / Presence
  'hallo', 'hi', 'hey', 'morgen', 'tag', 'abend', 'servus', 'moin', 'jarvis',
  // Commands
  'weiter', 'zurück', 'hilfe', 'status', 'wiederholen', 'nochmal', 'los',
  // Polite
  'danke', 'super', 'perfekt',
  // Entities / Apps
  'gmail', 'chrome', 'youtube', 'hermes', 'codex', 'shopify', 'terminal', 'browser',
]);

const VALID_SHORT_WORDS_EN = new Set([
  'yes', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay', 'please', 'confirm', 'correct', 'right',
  'no', 'nope', 'stop', 'halt', 'cancel', 'pause', 'quiet',
  'hello', 'hi', 'hey', 'jarvis',
  'next', 'back', 'help', 'status', 'again', 'repeat',
  'thanks', 'cool', 'great', 'perfect',
  'gmail', 'chrome', 'youtube', 'hermes', 'codex', 'shopify', 'terminal', 'browser',
]);

export function isUnclearShortUtterance(text: string | null | undefined, confidence?: number): boolean {
  if (!text || typeof text !== 'string') return true;
  const clean = text.trim();
  if (clean.length === 0) return true;

  // Strip punctuation and normalize
  const tokens = clean
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length === 0) return true;

  // If confidence is very low (< 0.50) on 3 or fewer words, treat as unclear
  if (confidence !== undefined && confidence !== null && confidence < 0.50 && tokens.length <= 3) {
    return true;
  }

  // 1–2 word utterances must match recognized vocabulary or be clear questions
  if (tokens.length <= 2) {
    // If it ends with question mark or is a question word with 2 words (e.g. "wie spät?"), let it through
    const isQuestion = clean.endsWith('?') || /^(?:was|wie|wer|wo|wann|warum|what|how|why|who|when|where)\b/i.test(clean);
    if (isQuestion && tokens.length >= 2) {
      return false;
    }

    // Check if all tokens are known valid short command/affirmative/entity
    const allTokensKnown = tokens.every(
      (t) => VALID_SHORT_WORDS_DE.has(t) || VALID_SHORT_WORDS_EN.has(t)
    );

    if (allTokensKnown) {
      return false; // Valid short command like "Ja bitte", "Hallo Jarvis", "Stopp", "Danke"
    }

    // Otherwise it's an unclear fragment like "just. Da.", "da", "so", acoustic noise
    return true;
  }

  return false;
}

export function getClarificationReply(lang: string = 'de'): string {
  return lang === 'de' ? 'Wie bitte?' : "I didn't catch that. Could you repeat?";
}
