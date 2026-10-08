/**
 * unclearUtteranceGuard.ts — Guards against hallucinating meaning from short, unclear STT fragments.
 *
 * User directive:
 * "Wenn die Spracherkennung nur 1–2 unklare Wörter liefert oder unsicher ist, soll Jarvis
 * kurz fragen „Wie bitte?“ oder „Das habe ich nicht verstanden“, statt etwas zu deuten."
 *
 * CRITICAL RULE:
 * Legitimate short commands (e.g. "Sprich Deutsch", "Öffne Gmail", "Sende es", "Zeig Termine",
 * "Guten Morgen", "Stopp", "Ja bitte") MUST NEVER be rejected or trigger "Wie bitte?".
 */

// Known filler sounds / acoustic noises representing throat-clearing, hesitation, or mic rumble
const FILLER_TOKENS = new Set([
  'ähm', 'äh', 'eh', 'uhm', 'uh', 'um', 'hm', 'mhm', 'er', 'ah', 'oh', 'ha', 'mmh', 'hmmm',
]);

// Acoustic hallucination fragments commonly output by Whisper on mic noise / background clicks
const KNOWN_NOISE_FRAGMENTS = new Set([
  'just da', 'da just', 'just', 'da da', 'so so', 'so und', 'und so', 'da so', 'so da',
]);

// Common verbs, actions, entities, pronouns, and keywords that make a 1–2 word utterance completely valid
const VALID_COMMAND_WORDS = new Set([
  // Verbs / Actions (German & English)
  'sprich', 'spreche', 'sprechen', 'rede', 'reden', 'sag', 'sage', 'sagen', 'öffne', 'öffnen', 'open',
  'schreib', 'schreibe', 'schreiben', 'write', 'sende', 'senden', 'schick', 'schicken', 'send',
  'zeig', 'zeige', 'zeigen', 'show', 'lies', 'lese', 'lesen', 'read', 'starte', 'starten', 'start',
  'stopp', 'stoppe', 'stoppen', 'stop', 'halt', 'halten', 'warte', 'warten', 'wait',
  'mach', 'mache', 'machen', 'do', 'make', 'such', 'suche', 'suchen', 'search', 'find',
  'spiel', 'spiele', 'spielen', 'play', 'hilf', 'helfe', 'helfen', 'help', 'lösch', 'lösche', 'delete',
  'erzähl', 'erzähle', 'erzählen', 'tell', 'erklär', 'erkläre', 'erklären', 'explain',
  'abbrechen', 'cancel', 'wiederholen', 'repeat', 'weiter', 'next', 'zurück', 'back',
  // Affirmative / Confirmation / Negative
  'ja', 'yes', 'yeah', 'yep', 'klar', 'sure', 'ok', 'okay', 'genau', 'richtig', 'correct',
  'nein', 'no', 'nicht', 'not', 'bitte', 'please', 'danke', 'thanks', 'thank', 'gerne',
  'einverstanden', 'bestätigen', 'confirm', 'fertig', 'done',
  // Nouns / Entities / Targets
  'deutsch', 'german', 'englisch', 'english', 'gmail', 'mail', 'email', 'postfach', 'inbox',
  'chrome', 'browser', 'youtube', 'video', 'musik', 'music', 'hermes', 'codex', 'shopify',
  'terminal', 'nachricht', 'message', 'termin', 'termine', 'kalender', 'calendar', 'zeit', 'uhrzeit',
  'time', 'status', 'wetter', 'weather', 'witz', 'joke', 'notiz', 'note', 'aufgabe', 'task',
  'projekt', 'project', 'system', 'agenticos', 'jarvis',
  // Greetings
  'hallo', 'hello', 'hi', 'hey', 'guten', 'morgen', 'tag', 'abend', 'servus', 'moin',
  // Pronouns / Particles
  'es', 'das', 'it', 'that', 'this', 'an', 'auf', 'ab', 'zu', 'aus', 'ein', 'alles', 'all',
  'jetzt', 'now', 'kurz', 'mehr', 'more', 'mir', 'dir', 'mich', 'dich', 'me', 'you',
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

  // Pure filler sounds (e.g. "ähm", "uhm uh") are always unclear noise
  const allFillers = tokens.every((t) => FILLER_TOKENS.has(t));
  if (allFillers) return true;

  const normalizedPhrase = tokens.join(' ');
  if (KNOWN_NOISE_FRAGMENTS.has(normalizedPhrase)) {
    return true;
  }

  // 1 token
  if (tokens.length === 1) {
    if (FILLER_TOKENS.has(tokens[0])) return true;
    if (VALID_COMMAND_WORDS.has(tokens[0])) return false;
    // Single unrecognized token is unclear noise unless it is >= 4 chars with good confidence
    if (tokens[0].length >= 4 && (confidence === undefined || confidence >= 0.70)) {
      return false;
    }
    return true;
  }

  // 2 tokens
  if (tokens.length === 2) {
    // If it's a question, let it pass
    const isQuestion = clean.endsWith('?') || /^(?:was|wie|wer|wo|wann|warum|what|how|why|who|when|where)\b/i.test(clean);
    if (isQuestion) return false;

    // If at least one word is a known verb, action, entity, greeting, pronoun or affirmative
    const hasKnownWord = tokens.some((t) => VALID_COMMAND_WORDS.has(t));
    if (hasKnownWord) {
      return false; // Valid short command like "Sprich Deutsch", "Öffne Gmail", "Sende es", "Ja bitte", "Guten Morgen"
    }

    // Neither word is recognized and confidence is low/medium
    if (confidence !== undefined && confidence < 0.65) {
      return true;
    }

    // If neither word is recognized and both are short (< 4 chars), treat as noise
    if (tokens[0].length < 4 && tokens[1].length < 4) {
      return true;
    }

    return false;
  }

  // 3 or more tokens:
  // Only treat as unclear if confidence is very low (< 0.35) and all words are tiny noise fragments
  if (confidence !== undefined && confidence < 0.35 && tokens.length <= 4 && tokens.every(t => t.length <= 3)) {
    return true;
  }

  return false;
}

export function getClarificationReply(lang: string = 'de'): string {
  return lang === 'de' ? 'Wie bitte? Das habe ich leider nicht verstanden.' : "I didn't catch that. Could you repeat?";
}
