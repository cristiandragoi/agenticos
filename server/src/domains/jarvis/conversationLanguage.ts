/**
 * domains/jarvis/conversationLanguage.ts
 *
 * Authoritative Language Preference and Voice Configuration for Jarvis.
 *
 * Responsibilities:
 * 1. Detect explicit natural language instructions:
 *    - German ("Speak German", "Sprich Deutsch", "Antworte bitte auf Deutsch", "Reply in German only")
 *    - Romanian ("Speak Romanian", "Vorbește în română", "Răspunde în română", "Reply in Romanian only")
 *    - English ("Speak English", "Switch back to English", "Reply in English only")
 * 2. Persist active language per conversation with read-back verification.
 * 3. Provide mapping to STT recognition locale and TTS neural voice:
 *    - German: de-DE-KillianNeural / de-DE-ConradNeural, locale de-DE
 *    - Romanian: ro-RO-EmilNeural / ro-RO-AlinaNeural, locale ro-RO
 *    - English: en-US-ChristopherNeural, locale en-US
 * 4. Generate verified, natural in-language confirmations upon language switch.
 */

import { rawDb } from '../../db/index.js';
import { logger } from '../../utils/logger.js';
import { getActiveLanguage, setActiveLanguageState, buildAnswerLanguageInstruction } from '../../services/language/activeLanguageState.js';

export { getActiveLanguage, setActiveLanguageState, buildAnswerLanguageInstruction };

export type SupportedLanguage = 'en' | 'de' | 'ro';

export interface LanguageConfig {
  code: SupportedLanguage;
  displayName: string;
  nativeName: string;
  sttLocale: string;
  ttsVoice: string;
  fallbackTtsVoice: string;
  systemPromptInstruction: string;
}

export const LANGUAGE_CONFIGS: Record<SupportedLanguage, LanguageConfig> = {
  en: {
    code: 'en',
    displayName: 'English',
    nativeName: 'English',
    sttLocale: 'en-GB',
    ttsVoice: 'en-GB-RyanNeural',
    fallbackTtsVoice: 'en-GB-ThomasNeural',
    systemPromptInstruction: 'Respond in natural, conversational English.',
  },
  de: {
    code: 'de',
    displayName: 'German',
    nativeName: 'Deutsch',
    sttLocale: 'de-DE',
    ttsVoice: 'aura-2-julius-de',
    fallbackTtsVoice: 'aura-2-julius-de',
    systemPromptInstruction: buildAnswerLanguageInstruction('de'),
  },
  ro: {
    code: 'ro',
    displayName: 'Romanian',
    nativeName: 'Română',
    sttLocale: 'ro-RO',
    ttsVoice: 'ro-RO-EmilNeural',
    fallbackTtsVoice: 'ro-RO-AlinaNeural',
    systemPromptInstruction: buildAnswerLanguageInstruction('ro'),
  },
};

// Persistent table for conversation language preferences
try {
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS jarvis_conversation_languages (
      conversation_id TEXT PRIMARY KEY,
      language_code TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      is_explicit INTEGER DEFAULT 0
    );
  `);
  try {
    rawDb.exec(`ALTER TABLE jarvis_conversation_languages ADD COLUMN is_explicit INTEGER DEFAULT 0;`);
  } catch (_) {}
} catch (err) {
  logger.warn(`[ConversationLanguage] SQLite table init warning: ${err}`);
}

// In-memory cache for fast lookup
const languageCache = new Map<string, SupportedLanguage>();

/**
 * Detect if a user message is an explicit instruction to switch language.
 */
export function detectLanguageSwitchRequest(prompt: string): {
  isLanguageSwitch: boolean;
  targetLanguage?: SupportedLanguage;
  reason?: string;
} {
  // Explicit AntiGravity engineering delegation payloads must NEVER trigger language switching
  if (/\b(?:anti[- ]?gravity)\b/i.test(prompt)) {
    return { isLanguageSwitch: false };
  }

  const p = prompt.toLowerCase().replace(/[.,!?;:'"„”«»]+/g, ' ').replace(/\s+/g, ' ').trim();

  // German patterns
  if (
    /\b(?:bitte\s+)?auf\s+deutsch(?:\s+bitte)?\b/iu.test(p) ||
    /\b(?:bitte\s+)?(?:ab\s+jetzt\s+)?deutsch\s+(?:reden|sprechen|antworten)\b/iu.test(p) ||
    /\b(?:bitte\s+)?redet?\s+(?:ab\s+jetzt\s+)?(?:auf\s+)?deutsch\b/iu.test(p) ||
    /\b(?:bitte\s+)?sprich\s+(?:ab\s+jetzt\s+)?(?:auf\s+)?deutsch\b/iu.test(p) ||
    /\b(?:bitte\s+)?spreche?n?\s+(?:ab\s+jetzt\s+)?(?:auf\s+)?deutsch\b/iu.test(p) ||
    /\bdeutsch\s+bitte\b/iu.test(p) ||
    /\bauf\s+deutsch\s+bitte\b/iu.test(p) ||
    /\bspeak\s+german\b/iu.test(p) ||
    /\bswitch\s+(?:back\s+|over\s+)?(?:in|to|into)\s+german\b/iu.test(p) ||
    /\bchange\s+(?:to\s+)?german\b/iu.test(p) ||
    /\btalk\s+(?:in\s+)?german\b/iu.test(p) ||
    /\b(?:can|could|do|will|would)\s+you\s+(?:please\s+)?(?:speak|talk|reply|respond|answer)\s+(?:in\s+|to\s+me\s+in\s+)?german\b/iu.test(p) ||
    /\b(?:i\s+want|i\s+would\s+like|i'd\s+like|i\s+need|please|let's)\s+(?:you\s+to\s+)?(?:speak|talk|reply|respond|switch\s+(?:back\s+|over\s+)?(?:in|to|into)?|use)\s+(?:in\s+|to\s+me\s+in\s+)?german\b/iu.test(p) ||
    /\b(?:speak|talk|reply|respond|switch\s+(?:back\s+|over\s+)?(?:in|to|into)?|use|answer(?:\s+me)?)\s+(?:in\s+|to\s+me\s+in\s+)?german\b/iu.test(p) ||
    /\b(?:reply|answer|talk|speak)\s+in\s+german(?:\s+only|\s+please)?\b/iu.test(p) ||
    /\b(?:du\s+sollst|du\s+musst|du\s+kannst)\s+(?:ab\s+jetzt\s+)?deutsch\s+sprechen\b/iu.test(p) ||
    /\b(?:ich\s+m[oö]chte|ich\s+will)(?:,\s*dass|\s+dass)?\s+du\s+(?:deutsch\s+sprichst|auf\s+deutsch\s+antwortest|deutsch\s+redest)\b/iu.test(p) ||
    /\b(?:kannst|k[oö]nntest)\s+du\s+(?:bitte\s+)?(?:mit\s+mir\s+)?(?:auf\s+)?deutsch\s+(?:sprechen|antworten|reden)\b/iu.test(p) ||
    /\b(?:bitte\s+)?rede\s+(?:bitte\s+)?(?:mit\s+mir\s+)?(?:ab\s+jetzt\s+)?(?:bitte\s+)?(?:auf\s+)?deutsch\b/iu.test(p) ||
    /\b(?:k[oö]nnen\s+wir|wollen\s+wir)\s+(?:bitte\s+)?(?:ab\s+jetzt\s+)?(?:auf\s+)?deutsch\s+(?:sprechen|reden)\b/iu.test(p) ||
    /\b(?:ab\s+jetzt\s+)?auf\s+deutsch\s+(?:bitte|antworten|sprechen|weiter|umschalten|wechseln)\b/iu.test(p) ||
    /\bantworte\s+(?:bitte\s+)?auf\s+deutsch\b/iu.test(p) ||
    /\b(?:du\s+sollst\s+deutsch\s+sprechen|ich\s+spreche\s+bereits\s+deutsch|nicht\s+deutsch\s+lernen.*du\s+sollst\s+deutsch\s+sprechen)\b/iu.test(p)
  ) {
    return {
      isLanguageSwitch: true,
      targetLanguage: 'de',
      reason: 'Explicit user instruction to speak German',
    };
  }

  // Romanian patterns
  if (
    /\b(?:can|could|do|will|would)\s+you\s+(?:please\s+)?(?:speak|talk|reply|respond|answer)\s+(?:in\s+|to\s+me\s+in\s+)?romanian\b/iu.test(p) ||
    /\b(?:i\s+want|i\s+would\s+like|i'd\s+like|i\s+need|please|let's)\s+(?:you\s+to\s+)?(?:speak|talk|reply|respond|switch\s+(?:back\s+|over\s+)?(?:in|to|into)?|use)\s+(?:in\s+|to\s+me\s+in\s+)?romanian\b/iu.test(p) ||
    /\b(?:speak|talk|reply|respond|switch\s+(?:back\s+|over\s+)?(?:in|to|into)?|use|answer(?:\s+me)?)\s+(?:in\s+|to\s+me\s+in\s+)?romanian\b/iu.test(p) ||
    /\b(?:reply|answer|talk|speak)\s+in\s+romanian(?:\s+only|\s+please)?\b/iu.test(p) ||
    /\bswitch\s+(?:back\s+|over\s+)?(?:in|to|into)\s+romanian\b/iu.test(p) ||
    /\bspeak\s+romanian\b/iu.test(p) ||
    /\b(?:po[tț]i|ai\s+putea)\s+(?:s[aă]\s+)?vorbe[sș]ti\s+(?:cu\s+mine\s+)?(?:[iî]n\s+)?(?:limba\s+)?român[aăe](?:\b|[\s\W]|$)/iu.test(p) ||
    /\b(?:vreau|a[sș]\s+dori)\s+s[aă]\s+vorbe[sș]ti\s+(?:[iî]n\s+)?(?:limba\s+)?român[aăe](?:\b|[\s\W]|$)/iu.test(p) ||
    /\bvorbe[sș]te\s+(?:cu\s+mine\s+)?(?:de\s+acum\s+)?(?:[iî]n\s+)?(?:limba\s+)?român[aăe](?:\b|[\s\W]|$)/iu.test(p) ||
    /\b[iî]n\s+(?:limba\s+)?român[aă](?:\b|[\s\W]|$)/iu.test(p) ||
    /\br[aă]spunde\s+(?:te\s+rog\s+)?(?:[iî]n\s+)?(?:limba\s+)?român[aă](?:\b|[\s\W]|$)/iu.test(p) ||
    /\bvorbim\s+(?:[iî]n\s+)?(?:limba\s+)?român[aă](?:\b|[\s\W]|$)/iu.test(p) ||
    /\bcomut[aă]\s+(?:pe\s+)?român[aă](?:\b|[\s\W]|$)/iu.test(p) ||
    /\bvorbe[sș]te\s+române[sș]te(?:\b|[\s\W]|$)/iu.test(p) ||
    /\bpo[tț]i\s+vorbi\s+române[sș]te(?:\b|[\s\W]|$)/iu.test(p)
  ) {
    return {
      isLanguageSwitch: true,
      targetLanguage: 'ro',
      reason: 'Explicit user instruction to speak Romanian',
    };
  }

  // English patterns
  if (
    /\b(?:please\s+)?(?:in\s+)?english(?:\s+please)?\b/iu.test(p) ||
    /\b(?:speak|talk|reply|respond|switch\s+(?:to\s+)?|change\s+(?:to\s+)?)\s+english\b/iu.test(p) ||
    /\bsprich\s+(?:wieder\s+)?(?:auf\s+)?englisch\b/iu.test(p) ||
    /\brede\s+(?:wieder\s+)?(?:auf\s+)?englisch\b/iu.test(p) ||
    /\bauf\s+englisch\s+bitte\b/iu.test(p) ||
    /\bbitte\s+auf\s+englisch\b/iu.test(p) ||
    /\b(?:can|could|do|will|would)\s+you\s+(?:please\s+)?(?:speak|talk|reply|respond|answer)\s+(?:in\s+|to\s+me\s+in\s+)?english\b/iu.test(p) ||
    /\b(?:i\s+want|i\s+would\s+like|i'd\s+like|i\s+need|please|let's)\s+(?:you\s+to\s+)?(?:speak|talk|reply|respond|switch\s+(?:back\s+|over\s+)?(?:in|to|into)?|use)\s+(?:in\s+|to\s+me\s+in\s+)?english\b/iu.test(p) ||
    /\b(?:speak|talk|reply|respond|switch\s+(?:back\s+|over\s+)?(?:in|to|into)?|use|answer(?:\s+me)?)\s+(?:in\s+|to\s+me\s+in\s+)?english\b/iu.test(p) ||
    /\b(?:reply|answer|talk|speak)\s+in\s+english(?:\s+only|\s+please)?\b/iu.test(p) ||
    /\bswitch\s+(?:back\s+|over\s+)?(?:in|to|into)\s+english\b/iu.test(p) ||
    /\bswitch\s+(?:back\s+)?to\s+english\b/iu.test(p) ||
    /\bback\s+to\s+english\b/iu.test(p) ||
    /\bspeak\s+english\b/iu.test(p) ||
    /\benglish\s+please\b/iu.test(p) ||
    /\bvorbe[sș]te\s+(?:din\s+nou\s+)?(?:[iî]n\s+)?englez[aă]\b/iu.test(p)
  ) {
    return {
      isLanguageSwitch: true,
      targetLanguage: 'en',
      reason: 'Explicit user instruction to speak English',
    };
  }

  return { isLanguageSwitch: false };
}

/**
 * Detect if text is written in German or Romanian (for auto-context hints without overwriting explicit choice).
 */
export function detectTextLanguage(text: string): SupportedLanguage | null {
  const p = text.toLowerCase().trim();
  // Common German particles / greetings / pronouns / interrogatives / auxiliary verbs
  if (
    /\b(hallo|guten\s+tag|guten\s+morgen|wie\s+geht|danke|bitte|ja|nein|ich|du|wir|sie|ist|sind|war|nicht|kannst|können|kann|wurde|wird|auf|für|mit|nach|wer|wann|warum|wo|welche|welcher|welches|wie|hilf|zeig|sag|sprich|deutsch|heute|morgen|gestern|uhr|zeit|wetter|deutschland|berlin|fragen|frage|hast|alles|klar|gut|sehr|viel|viele|machen)\b/i.test(
      p
    ) &&
    !/\b(the|is|are|you|this|that|what|how|where)\b/i.test(p)
  ) {
    return 'de';
  }
  // Common Romanian particles / greetings
  if (
    /\b(bună|salut|ce\s+faci|mulțumesc|mersi|da|nu|eu|tu|noi|este|sunt|fost|nu|poți|putem|pentru|cu|la|în|din)\b/i.test(
      p
    ) &&
    !/\b(the|is|are|you|this|that|what|how|where)\b/i.test(p)
  ) {
    return 'ro';
  }
  return null;
}

/**
 * Determine if an STT/Whisper language detection is substantive and confident
 * enough to automatically switch the persistent conversation language.
 */
export function isSubstantiveLanguageDetection(
  text: string,
  detectedLang?: string | null,
  probability?: number | null
): boolean {
  if (!text || !detectedLang) return false;
  const rawLang = detectedLang.toLowerCase().trim().slice(0, 2);
  if (rawLang !== 'de' && rawLang !== 'ro' && rawLang !== 'en') return false;

  const trimmed = text.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);

  // Short single-word or ambiguous tokens (e.g. "Jarvis", "Alex", "Ok", "Hi")
  // must never accidentally trigger a language switch.
  if (words.length <= 1 || trimmed.length < 5) {
    return false;
  }

  // If text analysis directly confirms clear language particles (e.g. "guten morgen", "ce faci")
  const textMatches = detectTextLanguage(trimmed);
  if (textMatches === rawLang) {
    if (words.length >= 2 || trimmed.length >= 8) return true;
  }

  // For general utterances without matched greeting particles:
  // require at least 3 words, length >= 12 chars, and high probability if provided.
  if (words.length >= 3 && trimmed.length >= 12) {
    if (typeof probability === 'number' && probability < 0.60) {
      return false;
    }
    return true;
  }

  return false;
}

/**
 * Get active language for a conversation. Defaults to 'en'.
 */
export function getConversationLanguage(conversationId: string): SupportedLanguage {
  if (!conversationId) return getActiveLanguage();
  if (languageCache.has(conversationId)) {
    return languageCache.get(conversationId)!;
  }
  try {
    const row = rawDb
      .prepare('SELECT language_code FROM jarvis_conversation_languages WHERE conversation_id = ?')
      .get(conversationId) as any;
    if (row?.language_code && row.language_code in LANGUAGE_CONFIGS) {
      const lang = row.language_code as SupportedLanguage;
      languageCache.set(conversationId, lang);
      return lang;
    }
  } catch (err) {
    logger.warn(`[ConversationLanguage] DB read error for ${conversationId}: ${err}`);
  }
  return getActiveLanguage();
}

// In-memory cache for explicit language lock
const explicitLockMap = new Map<string, boolean>();

export function isExplicitLanguage(conversationId: string): boolean {
  if (!conversationId) return false;
  if (explicitLockMap.has(conversationId)) {
    return explicitLockMap.get(conversationId) === true;
  }
  try {
    const row = rawDb
      .prepare('SELECT is_explicit FROM jarvis_conversation_languages WHERE conversation_id = ?')
      .get(conversationId) as any;
    const isExp = row?.is_explicit === 1;
    explicitLockMap.set(conversationId, isExp);
    return isExp;
  } catch {
    return false;
  }
}

/**
 * Set active language for a conversation with verified read-back.
 * If isExplicit is true, locks the language so implicit Whisper detection cannot mutate it.
 */
export function setConversationLanguage(
  conversationId: string,
  lang: SupportedLanguage,
  isExplicit = false,
): { success: boolean; activeLanguage: SupportedLanguage; config: LanguageConfig } {
  if (!conversationId) {
    setActiveLanguageState(lang, 'conversation:global');
    return { success: false, activeLanguage: lang, config: LANGUAGE_CONFIGS[lang] || LANGUAGE_CONFIGS.en };
  }

  // If an explicit lock is active and this is an implicit auto-detection attempt, reject the mutation
  if (!isExplicit && isExplicitLanguage(conversationId)) {
    const current = getConversationLanguage(conversationId);
    logger.info(`[ConversationLanguage] Preserving explicit language lock (${current}); ignoring implicit detection (${lang})`);
    return { success: true, activeLanguage: current, config: LANGUAGE_CONFIGS[current] };
  }

  const target = lang in LANGUAGE_CONFIGS ? lang : 'en';
  const now = new Date().toISOString();
  const explicitVal = isExplicit ? 1 : (isExplicitLanguage(conversationId) ? 1 : 0);

  try {
    rawDb
      .prepare(
        `INSERT INTO jarvis_conversation_languages (conversation_id, language_code, updated_at, is_explicit)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(conversation_id) DO UPDATE SET
           language_code = excluded.language_code,
           updated_at = excluded.updated_at,
           is_explicit = excluded.is_explicit`
      )
      .run(conversationId, target, now, explicitVal);

    languageCache.set(conversationId, target);
    explicitLockMap.set(conversationId, explicitVal === 1);
    setActiveLanguageState(target, `conversation:${conversationId}`);

    // Verified read-back
    const verified = getConversationLanguage(conversationId);
    if (verified !== target) {
      logger.error(`[ConversationLanguage] State read-back verification failed! Expected ${target}, got ${verified}`);
      return { success: false, activeLanguage: verified, config: LANGUAGE_CONFIGS[verified] };
    }

    try {
      import('../../services/voice/VoiceRuntimeState.js').then(({ voiceRuntimeState }) => {
        voiceRuntimeState.setLanguage(target, LANGUAGE_CONFIGS[target].sttLocale, isExplicit);
      }).catch(() => {});
    } catch {}

    logger.info(`[ConversationLanguage] Set conversation ${conversationId} language to ${target} (explicit=${explicitVal === 1}, verified)`);
    return { success: true, activeLanguage: target, config: LANGUAGE_CONFIGS[target] };
  } catch (err) {
    logger.error(`[ConversationLanguage] Failed to set language for ${conversationId}: ${err}`);
    const fallback = getConversationLanguage(conversationId);
    return { success: false, activeLanguage: fallback, config: LANGUAGE_CONFIGS[fallback] };
  }
}

/**
 * Build natural in-language confirmation of language change.
 */
export function buildLanguageSwitchConfirmation(lang: SupportedLanguage): string {
  switch (lang) {
    case 'de':
      return 'Verstanden. Ich spreche ab jetzt Deutsch mit dir.';
    case 'ro':
      return 'Am înțeles. De acum înainte vorbesc cu dumneavoastră în limba română.';
    case 'en':
    default:
      return 'Understood. I will speak English with you from now on.';
  }
}
