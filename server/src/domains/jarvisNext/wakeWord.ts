/**
 * wakeWord.ts — Deterministic wake-word stripping for live voice turns.
 *
 * Supported prefixes:
 * - "Jarvis"
 * - "Hey Jarvis"
 * - "Okay Jarvis" / "OK Jarvis"
 * - "Hi Jarvis"
 * - "Hello Jarvis"
 * - "Jarvis please"
 * - "Please Jarvis"
 *
 * Preserves remainder command text exactly.
 */

export interface WakeWordStripResult {
  wakeWordDetected: boolean;
  wakePrefixRemoved: boolean;
  commandText: string;
  isBareGreeting: boolean;
}

const WAKE_PREFIX_RE = /^\s*(?:(?:come\s+on|no,?\s+you\s+(?:didn't|did\s+not)\s+open\s+it[.!]?|no,?\s+that's\s+not\s+it[.!]?|listen|now|hey|ok(?:ay)?|hi|hello|please)\s+)?(?:jarvis|javis|jarves|jarviss|javi|javvy|chavis|travis|service|jarv)(?:[.,\s:;-]+(?:please|could you|can you|would you))?[.,\s:;-]*/i;
const WAKE_SUFFIX_RE = /[.,\s:;-]+(?:please\s+)?(?:jarvis|javis|jarves|jarviss|javi|javvy|chavis|travis|service|jarv)[.!?\s]*$/i;
const BARE_WAKE_RE = /^\s*(?:(?:come\s+on|hey|ok(?:ay)?|hi|hello)\s+)?(?:jarvis|javis|jarves|jarviss|javi|javvy|chavis|travis|service|jarv)[.!?\s]*$/i;
const CONVERSATIONAL_PREAMBLE_RE = /^\s*(?:come\s+on|no,?\s+you\s+(?:didn't|did\s+not)\s+open\s+it[.!]?|no,?\s+that's\s+not\s+it[.!]?)[.,\s:;-]+/i;

export function stripWakeWord(rawText: string): WakeWordStripResult {
  const trimmed = (rawText || '').trim();
  if (!trimmed) {
    return {
      wakeWordDetected: false,
      wakePrefixRemoved: false,
      commandText: '',
      isBareGreeting: false,
    };
  }

  const isBare = BARE_WAKE_RE.test(trimmed);
  if (isBare) {
    return {
      wakeWordDetected: true,
      wakePrefixRemoved: false,
      commandText: '',
      isBareGreeting: true,
    };
  }

  let commandText = trimmed;
  let wakeWordDetected = false;
  let wakePrefixRemoved = false;

  if (WAKE_PREFIX_RE.test(commandText)) {
    wakeWordDetected = true;
    wakePrefixRemoved = true;
    commandText = commandText.replace(WAKE_PREFIX_RE, '');
  }

  if (CONVERSATIONAL_PREAMBLE_RE.test(commandText)) {
    wakeWordDetected = true;
    commandText = commandText.replace(CONVERSATIONAL_PREAMBLE_RE, '');
  }

  // A suffix wake word is an address pattern (e.g. "What time is it, Jarvis?" or "Open YouTube, please, Jarvis").
  // It must NEVER be stripped if:
  // 1. A wake prefix was already stripped (e.g. "Jarvis, search for Moritz Jarvis" must not lose "Jarvis" from the query)
  // 2. The command is a search/lookup utterance where the trailing term is legitimate query payload (e.g. "Search for Moritz Jarvis")
  const hasSearchClause = /\b(?:search\s+for|search|find|look\s+up|query)\b/i.test(commandText);
  if (!wakePrefixRemoved && !hasSearchClause && WAKE_SUFFIX_RE.test(commandText)) {
    wakeWordDetected = true;
    commandText = commandText.replace(WAKE_SUFFIX_RE, '');
  }

  // Strip leading and trailing punctuation and whitespace leftover from wake words
  commandText = commandText.replace(/^[.,:;\-\s]+/, '').trim();

  if (!commandText || /^[^a-zA-Z0-9]+$/.test(commandText)) {
    return {
      wakeWordDetected: true,
      wakePrefixRemoved: false,
      commandText: '',
      isBareGreeting: true,
    };
  }

  return {
    wakeWordDetected,
    wakePrefixRemoved,
    commandText,
    isBareGreeting: false,
  };
}
