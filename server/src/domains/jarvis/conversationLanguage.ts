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
    ttsVoice: 'de-DE-KillianNeural',
    fallbackTtsVoice: 'de-DE-ConradNeural',
    systemPromptInstruction:
      'KRITISCHE SPRACHANWEISUNG: Du musst ausschließlich auf Deutsch antworten. Antworte natürlich, präzise und professionell. Verwende keine englischen Standardfloskeln.',
  },
  ro: {
    code: 'ro',
    displayName: 'Romanian',
    nativeName: 'Română',
    sttLocale: 'ro-RO',
    ttsVoice: 'ro-RO-EmilNeural',
    fallbackTtsVoice: 'ro-RO-AlinaNeural',
    systemPromptInstruction:
      'INSTRUCȚIUNE CRITICĂ DE LIMBĂ: Trebuie să răspunzi exclusiv în limba română. Răspunde natural, concis și profesionist. Nu folosi formule automate în engleză.',
  },
};

// Persistent table for conversation language preferences
try {
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS jarvis_conversation_languages (
      conversation_id TEXT PRIMARY KEY,
      language_code TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
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
  const p = prompt.toLowerCase().replace(/[.,!?;:'"„”«»]+/g, ' ').replace(/\s+/g, ' ').trim();

  // German patterns
  if (
    /\b(?:can|could|do|will|would)\s+you\s+(?:please\s+)?(?:speak|talk|reply|respond|answer)\s+(?:in\s+|to\s+me\s+in\s+)?german\b/iu.test(p) ||
    /\b(?:i\s+want|i\s+would\s+like|i'd\s+like|i\s+need|please|let's)\s+(?:you\s+to\s+)?(?:speak|talk|reply|respond|switch\s+(?:back\s+|over\s+)?(?:in|to|into)?|use)\s+(?:in\s+|to\s+me\s+in\s+)?german\b/iu.test(p) ||
    /\b(?:speak|talk|reply|respond|switch\s+(?:back\s+|over\s+)?(?:in|to|into)?|use|answer(?:\s+me)?)\s+(?:in\s+|to\s+me\s+in\s+)?german\b/iu.test(p) ||
    /\b(?:reply|answer|talk|speak)\s+in\s+german(?:\s+only|\s+please)?\b/iu.test(p) ||
    /\bswitch\s+(?:back\s+|over\s+)?(?:in|to|into)\s+german\b/iu.test(p) ||
    /\bspeak\s+german\b/iu.test(p) ||
    /\bdeutsch\s+bitte\b/iu.test(p) ||
    /\b(?:du\s+sollst|du\s+musst|du\s+kannst)\s+(?:ab\s+jetzt\s+)?deutsch\s+sprechen\b/iu.test(p) ||
    /\b(?:ich\s+m[oö]chte|ich\s+will)(?:,\s*dass|\s+dass)?\s+du\s+(?:deutsch\s+sprichst|auf\s+deutsch\s+antwortest|deutsch\s+redest)\b/iu.test(p) ||
    /\b(?:kannst|k[oö]nntest)\s+du\s+(?:bitte\s+)?(?:mit\s+mir\s+)?(?:auf\s+)?deutsch\s+(?:sprechen|antworten|reden)\b/iu.test(p) ||
    /\bsprich\s+(?:mit\s+mir\s+)?(?:ab\s+jetzt\s+)?(?:auf\s+)?deutsch\b/iu.test(p) ||
    /\bauf\s+deutsch\s+(?:bitte|antworten|sprechen|weiter|umschalten|wechseln)\b/iu.test(p) ||
    /\bbitte\s+auf\s+deutsch\b/iu.test(p) ||
    /\bantworte\s+(?:bitte\s+)?auf\s+deutsch\b/iu.test(p) ||
    /\bdeutsch\s+sprechen\b/iu.test(p) ||
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
    /\b(?:can|could|do|will|would)\s+you\s+(?:please\s+)?(?:speak|talk|reply|respond|answer)\s+(?:in\s+|to\s+me\s+in\s+)?english\b/iu.test(p) ||
    /\b(?:i\s+want|i\s+would\s+like|i'd\s+like|i\s+need|please|let's)\s+(?:you\s+to\s+)?(?:speak|talk|reply|respond|switch\s+(?:back\s+|over\s+)?(?:in|to|into)?|use)\s+(?:in\s+|to\s+me\s+in\s+)?english\b/iu.test(p) ||
    /\b(?:speak|talk|reply|respond|switch\s+(?:back\s+|over\s+)?(?:in|to|into)?|use|answer(?:\s+me)?)\s+(?:in\s+|to\s+me\s+in\s+)?english\b/iu.test(p) ||
    /\b(?:reply|answer|talk|speak)\s+in\s+english(?:\s+only|\s+please)?\b/iu.test(p) ||
    /\bswitch\s+(?:back\s+|over\s+)?(?:in|to|into)\s+english\b/iu.test(p) ||
    /\bswitch\s+(?:back\s+)?to\s+english\b/iu.test(p) ||
    /\bback\s+to\s+english\b/iu.test(p) ||
    /\bspeak\s+english\b/iu.test(p) ||
    /\benglish\s+please\b/iu.test(p) ||
    /\bsprich\s+(?:wieder\s+)?englisch\b/iu.test(p) ||
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
  // Common German particles / greetings
  if (
    /\b(hallo|guten\s+tag|guten\s+morgen|wie\s+geht|danke|bitte|ja|nein|ich|du|wir|sie|ist|sind|war|nicht|kannst|können|wurde|wird|auf|für|mit|nach)\b/i.test(
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
  if (!conversationId) return 'en';
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
  return 'en';
}

/**
 * Set active language for a conversation with verified read-back.
 */
export function setConversationLanguage(
  conversationId: string,
  lang: SupportedLanguage
): { success: boolean; activeLanguage: SupportedLanguage; config: LanguageConfig } {
  if (!conversationId) {
    return { success: false, activeLanguage: 'en', config: LANGUAGE_CONFIGS.en };
  }
  const target = lang in LANGUAGE_CONFIGS ? lang : 'en';
  const now = new Date().toISOString();

  try {
    rawDb
      .prepare(
        `INSERT INTO jarvis_conversation_languages (conversation_id, language_code, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(conversation_id) DO UPDATE SET
           language_code = excluded.language_code,
           updated_at = excluded.updated_at`
      )
      .run(conversationId, target, now);

    languageCache.set(conversationId, target);

    // Verified read-back
    const verified = getConversationLanguage(conversationId);
    if (verified !== target) {
      logger.error(`[ConversationLanguage] State read-back verification failed! Expected ${target}, got ${verified}`);
      return { success: false, activeLanguage: verified, config: LANGUAGE_CONFIGS[verified] };
    }

    logger.info(`[ConversationLanguage] Set conversation ${conversationId} language to ${target} (verified)`);
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
      return 'Verstanden. Ich spreche ab jetzt Deutsch mit Ihnen.';
    case 'ro':
      return 'Am înțeles. De acum înainte vorbesc cu dumneavoastră în limba română.';
    case 'en':
    default:
      return 'Understood. I will speak English with you from now on.';
  }
}
