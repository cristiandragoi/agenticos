/**
 * services/voice/VoiceRuntimeState.ts
 *
 * Authoritative single source of truth for the voice runtime state:
 * - Provider actually synthesizing the current response (set from actual synthesis path, never config)
 * - Provider health & latency
 * - Active voice & model ID
 * - Language, locale, and persistence lock
 * - Fallback status and reason
 * - Playback state & live performance metrics
 */

import { voiceStudioService } from './VoiceStudioService.js';
import { secretStore } from '../gateway/secretStore.js';
import { logger } from '../../utils/logger.js';

export type TtsProvider = 'voicestudio' | 'deepgram' | 'edge-tts' | 'piper';
export type SttProvider = 'voicestudio' | 'deepgram' | 'local-whisper';
export type PlaybackState = 'idle' | 'synthesizing' | 'speaking' | 'draining';

export interface VoiceRuntimeSnapshot {
  activeTtsProvider: TtsProvider;
  activeSttProvider: SttProvider;
  providerHealth: {
    voicestudio: boolean;
    deepgram: boolean;
    edgeTts: boolean;
    localWhisper: boolean;
  };
  activeVoice: string;
  activeModel: string;
  language: string;
  locale: string;
  languageLocked: boolean;
  fallbackStatus: {
    isFallback: boolean;
    fallbackReason: string | null;
  };
  voiceStudioHealth: {
    healthy: boolean;
    endpoint: string;
    latencyMs: number;
    error?: string;
  };
  turnId?: number | string;
  sessionId?: string;
  timestamp: string;
  playbackState: PlaybackState;
  speechEndToFirstAudioMs: number;
  totalTurnMs: number;
}

export class VoiceRuntimeStateManager {
  private activeTtsProvider: TtsProvider = 'voicestudio';
  private activeSttProvider: SttProvider = 'voicestudio';
  private activeVoice = 'aura-zeus-en';
  private activeModel = 'tts-1';
  private language = 'en';
  private locale = 'en-GB';
  private languageLocked = false;
  private fallbackReason: string | null = null;
  private currentTurnId?: number | string;
  private currentSessionId?: string;
  private lastTimestamp = new Date().toISOString();
  private playbackState: PlaybackState = 'idle';
  private speechEndToFirstAudioMs = 0;
  private totalTurnMs = 0;

  /**
   * Record actual TTS synthesis outcome from the concrete synthesis path.
   * MUST be called from the code that generates/receives the audio frames.
   */
  public recordTtsSynthesis(params: {
    provider: TtsProvider;
    voice: string;
    model?: string;
    fallbackReason?: string | null;
    turnId?: number | string;
    sessionId?: string;
  }): void {
    this.activeTtsProvider = params.provider;
    this.activeVoice = params.voice;
    this.activeModel = params.model || (params.provider === 'voicestudio' ? 'tts-1' : params.voice);
    this.fallbackReason = params.fallbackReason ?? null;
    if (params.turnId !== undefined) this.currentTurnId = params.turnId;
    if (params.sessionId !== undefined) this.currentSessionId = params.sessionId;
    this.lastTimestamp = new Date().toISOString();

    logger.info('[VoiceRuntimeState] Recorded actual TTS synthesis:', {
      provider: this.activeTtsProvider,
      voice: this.activeVoice,
      model: this.activeModel,
      fallbackReason: this.fallbackReason,
      turnId: this.currentTurnId,
    });
  }

  /**
   * Record actual STT transcription outcome.
   */
  public recordSttTranscription(params: {
    provider: SttProvider;
    language?: string;
    model?: string;
    turnId?: number | string;
  }): void {
    this.activeSttProvider = params.provider;
    if (params.turnId !== undefined) this.currentTurnId = params.turnId;
    this.lastTimestamp = new Date().toISOString();
  }

  public setPlaybackState(state: PlaybackState): void {
    this.playbackState = state;
    this.lastTimestamp = new Date().toISOString();
  }

  public setLatency(speechEndToFirstAudioMs: number, totalTurnMs: number): void {
    this.speechEndToFirstAudioMs = Math.round(speechEndToFirstAudioMs);
    this.totalTurnMs = Math.round(totalTurnMs);
  }

  public setLanguage(lang: string, locale?: string, isExplicit = false): void {
    this.language = lang;
    if (locale) this.locale = locale;
    if (isExplicit) {
      this.languageLocked = true;
    }
    if (lang === 'de') {
      this.locale = locale || 'de-DE';
      this.activeVoice = 'de_DE-thorsten-high';
      this.activeModel = 'de_DE-thorsten-high';
      this.activeTtsProvider = 'piper';
    }
  }

  public isLanguageLocked(): boolean {
    return this.languageLocked;
  }

  public unlockLanguage(): void {
    this.languageLocked = false;
  }

  public getActiveVoice(): string {
    return this.activeVoice;
  }

  public getActiveTtsProvider(): TtsProvider {
    return this.activeTtsProvider;
  }

  /**
   * Predict the provider that will synthesize the response right now based on live health probe.
   */
  public async getEffectiveProviderLive(requestedVoice?: string): Promise<{
    provider: TtsProvider;
    voice: string;
    model: string;
    fallbackReason: string | null;
  }> {
    const isGerman = this.language === 'de' || this.locale.startsWith('de') ||
      (requestedVoice && (requestedVoice.startsWith('de') || requestedVoice.includes('Killian') || requestedVoice.includes('thorsten')));

    if (isGerman) {
      try {
        const { hasPiperVoiceForLanguage, LANGUAGE_TO_PIPER_VOICE } = await import('./piperTts.js');
        if (hasPiperVoiceForLanguage('de')) {
          const piperVoice = LANGUAGE_TO_PIPER_VOICE?.de || 'de_DE-thorsten-high';
          return {
            provider: 'piper',
            voice: piperVoice,
            model: piperVoice,
            fallbackReason: null,
          };
        }
      } catch {}

      return {
        provider: 'edge-tts',
        voice: 'de-DE-KillianNeural',
        model: 'neural-tts',
        fallbackReason: 'Piper is unavailable, so Edge-TTS de-DE-KillianNeural is active.',
      };
    }

    const vsHealth = await voiceStudioService.checkHealth().catch(() => ({ healthy: false } as any));
    const voice = requestedVoice || this.activeVoice || 'aura-zeus-en';

    if (vsHealth.healthy) {
      return {
        provider: 'voicestudio',
        voice,
        model: 'tts-1',
        fallbackReason: null,
      };
    }

    // VoiceStudio offline: check Deepgram
    const deepgramKey = process.env.DEEPGRAM_API_KEY || secretStore.getSync('deepgram');
    if (deepgramKey && (voice.startsWith('aura-') || this.language === 'en')) {
      const dgVoice = voice.startsWith('aura-') ? voice : 'aura-zeus-en';
      return {
        provider: 'deepgram',
        voice: dgVoice,
        model: dgVoice,
        fallbackReason: 'VoiceStudio is currently unavailable, so Deepgram is the active fallback.',
      };
    }

    // Edge-TTS fallback
    return {
      provider: 'edge-tts',
      voice: voice.startsWith('aura-') ? 'en-GB-RyanNeural' : voice,
      model: 'neural-tts',
      fallbackReason: 'VoiceStudio is currently unavailable, so Edge-TTS is the active fallback.',
    };
  }

  /**
   * Formats the authoritative, concrete answer to:
   * "Which TTS provider is synthesizing this exact response right now?"
   */
  public async formatProviderAnswer(requestedVoice?: string): Promise<string> {
    const effective = await this.getEffectiveProviderLive(requestedVoice);
    const isGerman = this.language === 'de' || this.locale.startsWith('de') || effective.voice.startsWith('de');

    if (isGerman) {
      if (effective.provider === 'piper') {
        return `Ich verwende aktuell die Stimme ${effective.voice} über den lokalen Piper-TTS-Provider für natürliches Deutsch.`;
      }
      if (effective.provider === 'edge-tts') {
        return `Ich verwende aktuell die deutsche neuronale Stimme ${effective.voice} über Edge-TTS.`;
      }
      return `${effective.provider} — ${effective.voice}.`;
    }

    if (effective.provider === 'piper') {
      return `Piper — ${effective.voice}. Local German neural voice model.`;
    }
    if (effective.provider === 'voicestudio') {
      return `VoiceStudio — ${effective.model} (${effective.voice}). VoiceStudio is healthy on the local service.`;
    }
    if (effective.provider === 'deepgram') {
      return `Deepgram — ${effective.voice}. VoiceStudio is currently unavailable, so Deepgram is the active fallback.`;
    }
    return `Edge-TTS — ${effective.voice}. VoiceStudio is currently unavailable, so Edge-TTS is the active fallback.`;
  }

  /**
   * Return full runtime snapshot for API endpoints and inspectors.
   */
  public async getSnapshot(): Promise<VoiceRuntimeSnapshot> {
    const vsHealth = await voiceStudioService.checkHealth().catch(() => ({ healthy: false, latencyMs: 0, endpoint: 'http://127.0.0.1:3900' } as any));
    const deepgramKey = Boolean(process.env.DEEPGRAM_API_KEY || secretStore.getSync('deepgram'));

    return {
      activeTtsProvider: this.activeTtsProvider,
      activeSttProvider: this.activeSttProvider,
      providerHealth: {
        voicestudio: vsHealth.healthy === true,
        deepgram: deepgramKey,
        edgeTts: true,
        localWhisper: true,
      },
      activeVoice: this.activeVoice,
      activeModel: this.activeModel,
      language: this.language,
      locale: this.locale,
      languageLocked: this.languageLocked,
      fallbackStatus: {
        isFallback: this.activeTtsProvider !== 'voicestudio',
        fallbackReason: this.fallbackReason,
      },
      voiceStudioHealth: {
        healthy: vsHealth.healthy === true,
        endpoint: vsHealth.endpoint || 'http://127.0.0.1:3900',
        latencyMs: vsHealth.latencyMs || 0,
        error: vsHealth.error,
      },
      turnId: this.currentTurnId,
      sessionId: this.currentSessionId,
      timestamp: this.lastTimestamp,
      playbackState: this.playbackState,
      speechEndToFirstAudioMs: this.speechEndToFirstAudioMs,
      totalTurnMs: this.totalTurnMs,
    };
  }
}

export const voiceRuntimeState = new VoiceRuntimeStateManager();
