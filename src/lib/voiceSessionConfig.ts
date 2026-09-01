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

export const LANGUAGE_VOICE_DEFAULTS: Record<string, { locale: string; voice: string }> = {
  en: { locale: 'en-GB', voice: 'en-GB-RyanNeural' },
  de: { locale: 'de-DE', voice: 'de-DE-KillianNeural' },
  ro: { locale: 'ro-RO', voice: 'ro-RO-EmilNeural' },
};

export const VOICE_LOCALE = 'en-GB';


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
    // Edge TTS: de-DE-* | Piper: de_de-* (de_DE-thorsten-high)
    return v.startsWith('de-') || v.startsWith('de_de-') || v.startsWith('de_') ||
      v.includes('killian') || v.includes('thorsten') || v.includes('conrad') || v.includes('katja') || v.includes('amala');
  }
  if (langKey === 'ro') {
    // Edge TTS: ro-RO-* | Piper: ro_ro-* (ro_RO-mihai-medium)
    return v.startsWith('ro-') || v.startsWith('ro_ro-') || v.startsWith('ro_') ||
      v.includes('emil') || v.includes('mihai') || v.includes('alina');
  }
  if (langKey === 'en') {
    return (
      v.startsWith('en-') ||
      v.startsWith('aura-') ||
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
  hasDeepgram = false
): VoiceSessionConfig {
  const rawLang = (language || 'en').toLowerCase().trim();
  const langKey = rawLang === 'auto' ? 'en' : rawLang.slice(0, 2);
  const langConfig = LANGUAGE_VOICE_DEFAULTS[langKey] || LANGUAGE_VOICE_DEFAULTS.en;

  const validOverride = override && isVoiceCompatibleWithLanguage(override, langKey) ? override : null;

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
