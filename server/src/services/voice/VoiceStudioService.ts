import http from 'node:http';
import { logger } from '../../utils/logger.js';

export interface VoiceStudioHealth {
  healthy: boolean;
  endpoint: string;
  error?: string;
  latencyMs?: number;
  models?: string[];
  lastChecked: number;
}

export interface VoiceStudioSynthesisOptions {
  model?: string;
  voice?: string;
  speed?: number;
  responseFormat?: 'mp3' | 'wav' | 'pcm';
}

export class VoiceStudioService {
  private baseUrl: string;
  private isEnabled: boolean;
  private lastHealthCheck: VoiceStudioHealth;
  private checkIntervalMs = 15000;
  private activeVoice = 'alloy';

  constructor() {
    this.baseUrl = (process.env.VOICESTUDIO_BASE_URL || 'http://127.0.0.1:3900').replace(/\/+$/, '');
    this.isEnabled = process.env.VOICESTUDIO_ENABLED !== 'false';
    this.lastHealthCheck = {
      healthy: false,
      endpoint: this.baseUrl,
      lastChecked: 0,
    };
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  public setBaseUrl(url: string): void {
    this.baseUrl = url.replace(/\/+$/, '');
    this.lastHealthCheck.endpoint = this.baseUrl;
    this.lastHealthCheck.lastChecked = 0;
  }

  public getActiveVoice(): string {
    return this.activeVoice;
  }

  public setActiveVoice(voice: string): void {
    this.activeVoice = voice;
  }

  public async checkHealth(force = false): Promise<VoiceStudioHealth> {
    const now = Date.now();
    if (!force && this.lastHealthCheck.lastChecked && (now - this.lastHealthCheck.lastChecked < this.checkIntervalMs)) {
      return this.lastHealthCheck;
    }

    if (!this.isEnabled) {
      this.lastHealthCheck = {
        healthy: false,
        endpoint: this.baseUrl,
        error: 'VoiceStudio is explicitly disabled via configuration',
        lastChecked: now,
      };
      return this.lastHealthCheck;
    }

    const t0 = Date.now();
    try {
      const url = new URL('/v1/models', this.baseUrl);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1200);

      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer local',
        },
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));

      const latencyMs = Date.now() - t0;
      if (res.ok) {
        let models: string[] = [];
        try {
          const data: any = await res.json();
          models = Array.isArray(data?.data) ? data.data.map((m: any) => m.id || m) : [];
        } catch {
          // ignore json parse error
        }
        this.lastHealthCheck = {
          healthy: true,
          endpoint: this.baseUrl,
          latencyMs,
          models,
          lastChecked: now,
        };
        logger.info('[VoiceStudio] Health check passed', { latencyMs, modelsCount: models.length });
        return this.lastHealthCheck;
      }

      // If /v1/models returned non-200, try root /health
      const healthUrl = new URL('/health', this.baseUrl);
      const hRes = await fetch(healthUrl.toString(), {
        method: 'GET',
        signal: AbortSignal.timeout(1000),
      });

      if (hRes.ok) {
        this.lastHealthCheck = {
          healthy: true,
          endpoint: this.baseUrl,
          latencyMs: Date.now() - t0,
          lastChecked: now,
        };
        return this.lastHealthCheck;
      }

      this.lastHealthCheck = {
        healthy: false,
        endpoint: this.baseUrl,
        error: `VoiceStudio endpoint returned HTTP ${res.status}`,
        latencyMs: Date.now() - t0,
        lastChecked: now,
      };
      return this.lastHealthCheck;
    } catch (err: any) {
      const errMsg = err?.name === 'AbortError' ? 'Connection timed out' : (err?.message || 'Connection refused');
      this.lastHealthCheck = {
        healthy: false,
        endpoint: this.baseUrl,
        error: errMsg,
        latencyMs: Date.now() - t0,
        lastChecked: now,
      };
      return this.lastHealthCheck;
    }
  }

  public isAvailable(): boolean {
    return this.lastHealthCheck.healthy && (Date.now() - this.lastHealthCheck.lastChecked < this.checkIntervalMs * 2);
  }

  public getStatus(): VoiceStudioHealth {
    return { ...this.lastHealthCheck };
  }

  /**
   * Synthesize speech using VoiceStudio OpenAI-compatible audio speech endpoint (/v1/audio/speech)
   */
  public async synthesize(
    text: string,
    voice?: string,
    options?: VoiceStudioSynthesisOptions
  ): Promise<Buffer> {
    const t0 = Date.now();
    const targetVoice = voice || this.activeVoice || 'alloy';
    const model = options?.model || 'tts-1';
    const responseFormat = options?.responseFormat || 'mp3';

    const url = new URL('/v1/audio/speech', this.baseUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer local',
        },
        body: JSON.stringify({
          model,
          input: text,
          voice: targetVoice,
          response_format: responseFormat,
          ...(options?.speed ? { speed: options.speed } : {}),
        }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));

      if (!res.ok) {
        const errText = await res.text().catch(() => '(no response body)');
        throw new Error(`VoiceStudio speech synthesis HTTP ${res.status}: ${errText}`);
      }

      const ab = await res.arrayBuffer();
      const buffer = Buffer.from(ab);
      const latencyMs = Date.now() - t0;
      logger.info('[VoiceStudio] Speech synthesized successfully', {
        voice: targetVoice,
        chars: text.length,
        bytes: buffer.byteLength,
        latencyMs,
      });
      return buffer;
    } catch (err: any) {
      logger.warn('[VoiceStudio] Synthesis failed:', { error: err?.message, text: text.slice(0, 50) });
      throw err;
    }
  }

  /**
   * Transcribe speech using VoiceStudio OpenAI-compatible transcription endpoint (/v1/audio/transcriptions)
   */
  public async transcribe(
    audioBuffer: Buffer,
    filename = 'audio.wav',
    language?: string
  ): Promise<{ text: string; language?: string }> {
    const t0 = Date.now();
    const url = new URL('/v1/audio/transcriptions', this.baseUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const formData = new FormData();
      const blob = new Blob([new Uint8Array(audioBuffer)], { type: 'audio/wav' });
      formData.append('file', blob, filename);
      formData.append('model', 'whisper-1');
      if (language && language !== 'auto') {
        formData.append('language', language);
      }

      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer local',
        },
        body: formData,
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));

      if (!res.ok) {
        const errText = await res.text().catch(() => '(no response body)');
        throw new Error(`VoiceStudio transcription HTTP ${res.status}: ${errText}`);
      }

      const data: any = await res.json();
      const latencyMs = Date.now() - t0;
      logger.info('[VoiceStudio] Transcription completed', {
        textLength: data?.text?.length || 0,
        latencyMs,
      });
      return {
        text: data?.text || '',
        language: data?.language,
      };
    } catch (err: any) {
      logger.warn('[VoiceStudio] Transcription failed:', { error: err?.message });
      throw err;
    }
  }
}

export const voiceStudioService = new VoiceStudioService();
