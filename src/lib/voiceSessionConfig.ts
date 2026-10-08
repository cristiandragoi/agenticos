/**
 * voiceSessionConfig — ONE authoritative TTS voice configuration per
 * active voice session (Phase 15, Failure B: voice-identity pinning).
 *
 * Supports multi-language TTS and STT locales (English, German, Romanian).
 */

export const AGENT_VOICE_DEFAULTS: Record<string, string> = {
  'agent-jarvis': 'en-GB-RyanNeural',
  'agent-hermes': 'en-GB-ThomasNeural',
};

export const DEEPGRAM_AGENT_VOICE_DEFAULTS: Record<string, string> = {
  'agent-jarvis': 'aura-helios-en',
  'agent-hermes': 'aura-orion-en',
};

/** The ONE German voice for Jarvis: native German male Deepgram Aura-2 voice. */
export const GERMAN_VOICE_ID = 'aura-2-julius-de';

export const DEEPGRAM_GERMAN_AGENT_VOICE_DEFAULTS: Record<string, string> = {
  'agent-jarvis': GERMAN_VOICE_ID,
  'agent-hermes': GERMAN_VOICE_ID,
};

export const LANGUAGE_VOICE_DEFAULTS: Record<string, { locale: string; voice: string }> = {
  en: { locale: 'en-GB', voice: 'en-GB-RyanNeural' },
  de: { locale: 'de-DE', voice: GERMAN_VOICE_ID },
  ro: { locale: 'ro-RO', voice: 'ro-RO-EmilNeural' },
};

export const VOICE_LOCALE = 'en-GB';

export const VOICE_LANGUAGE_STORAGE_KEY = 'agenticos_voice_language';

export function getSavedLanguageChoice(): string {
  if (typeof localStorage !== 'undefined') {
    try {
      const saved = localStorage.getItem(VOICE_LANGUAGE_STORAGE_KEY);
      if (saved && (saved === 'de' || saved === 'en' || saved === 'ro')) {
        return saved;
      }
    } catch {
      // ignore
    }
  }
  return 'en';
}

export function saveLanguageChoice(lang: string): void {
  if (typeof localStorage !== 'undefined') {
    try {
      const normalized = (lang || 'en').toLowerCase().trim().slice(0, 2);
      localStorage.setItem(VOICE_LANGUAGE_STORAGE_KEY, normalized);
    } catch {
      // ignore
    }
  }
}

export interface VoiceSessionConfig {
  provider: 'deepgram' | 'edge-tts' | 'local';
  model: string;
  voiceId: string;
  locale: string;
  language: string;
  override: string | null;
}

export function isVoiceCompatibleWithLanguage(voice: string | null | undefined, language: string): boolean {
  if (!voice) return false;
  const langKey = (language || 'en').toLowerCase().trim().slice(0, 2);
  const v = voice.toLowerCase().trim();
  if (langKey === 'de') {
    // German has exactly one voice: Deepgram aura-2-fabian-de.
    return v === GERMAN_VOICE_ID;
  }
  if (langKey === 'ro') {
    // Edge TTS: ro-RO-* | Piper: ro_ro-* (ro_RO-mihai-medium)
    return v.startsWith('ro-') || v.startsWith('ro_ro-') || v.startsWith('ro_') ||
      v.includes('emil') || v.includes('mihai') || v.includes('alina');
  }
  if (langKey === 'en') {
    return (
      v.startsWith('en-') ||
      (v.startsWith('aura-') && !v.endsWith('-de')) ||
      v.includes('ryan') ||
      v.includes('thomas') ||
      v.includes('christopher') ||
      v.includes('sonia') ||
      v.includes('guy') ||
      v.includes('aria') ||
      v.includes('jenny')
    );
  }
  return false;
}

export function resolveVoiceSessionConfig(
  agentId: string,
  override: string | null,
  fallbackVoice = 'en-GB-RyanNeural',
  language = 'en',
  hasDeepgram = true
): VoiceSessionConfig {
  const rawLang = (language || 'en').toLowerCase().trim();
  const langKey = rawLang === 'auto' ? 'en' : rawLang.slice(0, 2);
  const langConfig = LANGUAGE_VOICE_DEFAULTS[langKey] || LANGUAGE_VOICE_DEFAULTS.en;

  const validOverride = override && isVoiceCompatibleWithLanguage(override, langKey) ? override : null;

  // German is ALWAYS Deepgram Fabian. If Deepgram is unavailable the server reports a
  // clear error — we never silently swap in an Edge/Piper or English voice.
  if (langKey === 'de') {
    return {
      provider: 'deepgram',
      model: GERMAN_VOICE_ID,
      voiceId: GERMAN_VOICE_ID,
      locale: 'de-DE',
      language: 'de',
      override: validOverride,
    };
  }

  if (hasDeepgram && langKey === 'en') {
    const dgModel = (validOverride && validOverride.startsWith('aura-'))
      ? validOverride
      : (DEEPGRAM_AGENT_VOICE_DEFAULTS[agentId] || 'aura-helios-en');
    return {
      provider: 'deepgram',
      model: dgModel,
      voiceId: dgModel,
      locale: 'en-US',
      language: 'en',
      override: validOverride,
    };
  }

  // Edge TTS is the authoritative free neural TTS default
  let edgeModel = langConfig.voice;
  if (langKey === 'en') {
    edgeModel = AGENT_VOICE_DEFAULTS[agentId] || fallbackVoice || langConfig.voice;
  }
  if (validOverride && validOverride.endsWith('Neural') && !validOverride.startsWith('aura-')) {
    edgeModel = validOverride;
  }

  return {
    provider: 'edge-tts',
    model: edgeModel,
    voiceId: edgeModel,
    locale: langConfig.locale,
    language: langKey,
    override: validOverride,
  };
}

export interface VoiceSynthesisRecord {
  voiceSessionId: string | null;
  turnId: number | null;
  ttsProvider: string;
  ttsModel: string;
  voiceId: string;
  fallbackReason: string | null;
  at: number;
}

const synthesisLog: VoiceSynthesisRecord[] = [];
const SYNTH_LOG_LIMIT = 200;

export function recordVoiceSynthesis(rec: VoiceSynthesisRecord): void {
  synthesisLog.push(rec);
  if (synthesisLog.length > SYNTH_LOG_LIMIT) synthesisLog.shift();
}

export function voiceSynthesisLog(limit = 50): VoiceSynthesisRecord[] {
  return synthesisLog.slice(-limit);
}

export function distinctVoicesInLog(limit = 50): string[] {
  return [...new Set(synthesisLog.slice(-limit).map((r) => r.voiceId))];
}

export function installVoiceSynthesisProbe() {
  if (typeof window === 'undefined') return;
  (window as any).__voiceSynthesisLog = () => voiceSynthesisLog();
  (window as any).__voiceDistinctVoices = () => distinctVoicesInLog();
}

if (typeof window !== 'undefined') installVoiceSynthesisProbe();
