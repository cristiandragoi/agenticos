import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { logger } from '../../utils/logger.js';
import { sanitizeMarkdownForSpeech } from './speechMarkdownSanitizer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveScriptPath(): string {
  const candidates = [
    path.resolve(__dirname, '../../../scripts/tts.py'),
    path.resolve(__dirname, '../../scripts/tts.py'),
    path.resolve(process.cwd(), 'scripts/tts.py'),
    path.resolve(process.cwd(), 'server/scripts/tts.py'),
  ];
  for (const c of candidates) {
    if (fsSync.existsSync(c)) return c;
  }
  return candidates[0];
}

const SCRIPT_PATH = resolveScriptPath();

export function resolvePythonExecutable(): string {
  if (process.env.PYTHON_PATH && fsSync.existsSync(process.env.PYTHON_PATH)) {
    return process.env.PYTHON_PATH;
  }
  const venvCandidates = [
    'D:\\AgenticOS\\server\\.venv\\Scripts\\python.exe',
    path.resolve(__dirname, '../../../server/.venv/Scripts/python.exe'),
    path.resolve(__dirname, '../../.venv/Scripts/python.exe'),
    path.resolve(__dirname, '../../../.venv/Scripts/python.exe'),
    path.resolve(process.cwd(), 'server/.venv/Scripts/python.exe'),
    path.resolve(process.cwd(), '.venv/Scripts/python.exe'),
    'D:\\AgenticOS\\.venv\\Scripts\\python.exe',
  ];
  for (const c of venvCandidates) {
    if (fsSync.existsSync(c)) return c;
  }
  const globalCandidates = [
    'C:\\Python314\\python.exe',
    'C:\\Python313\\python.exe',
    'C:\\Python312\\python.exe',
    'C:\\Python311\\python.exe',
    'C:\\Python310\\python.exe',
  ];
  for (const c of globalCandidates) {
    if (fsSync.existsSync(c)) return c;
  }
  return 'python';
}

import { secretStore } from '../gateway/secretStore.js';

export const DEFAULT_NEURAL_VOICE = 'en-GB-RyanNeural'; // Deep, clear, natural British male English voice
export const GERMAN_NEURAL_VOICE = 'de-DE-KillianNeural'; // Legacy (no longer used for Jarvis German speech)
/** The ONE German voice for Jarvis: native German male Deepgram Aura-2 voice. */
export const GERMAN_DEEPGRAM_VOICE = 'aura-2-julius-de';

/**
 * Raised when the German voice (aura-2-julius-de) cannot be produced. German speech
 * NEVER silently falls back to another voice (Piper, Edge or an English voice).
 */
export class GermanVoiceUnavailableError extends Error {
  public readonly voice = GERMAN_DEEPGRAM_VOICE;
  public readonly provider = 'deepgram';
  public readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'GermanVoiceUnavailableError';
    this.status = status;
  }
}

/**
 * Synthesize German speech with Deepgram aura-2-julius-de. Throws a clear
 * GermanVoiceUnavailableError on ANY failure — there is no fallback.
 */
export async function synthesizeGermanJulius(text: string): Promise<Buffer> {
  const cleanText = sanitizeMarkdownForSpeech(text) || text;
  const deepgramKey = process.env.DEEPGRAM_API_KEY || secretStore.getSync('deepgram');
  if (!deepgramKey) {
    const err = new GermanVoiceUnavailableError(
      `German voice ${GERMAN_DEEPGRAM_VOICE} unavailable: no Deepgram API key is configured.`,
    );
    voiceRuntimeState.recordTtsSynthesis({ provider: 'none', voice: GERMAN_DEEPGRAM_VOICE, model: GERMAN_DEEPGRAM_VOICE, fallbackReason: err.message });
    throw err;
  }
  let response: Response;
  try {
    response = await fetch(`https://api.deepgram.com/v1/speak?model=${GERMAN_DEEPGRAM_VOICE}`, {
      method: 'POST',
      headers: { Authorization: `Token ${deepgramKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: cleanText }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (netErr: any) {
    const err = new GermanVoiceUnavailableError(
      `German voice ${GERMAN_DEEPGRAM_VOICE} unavailable: Deepgram request failed (${netErr?.message || netErr}).`,
    );
    voiceRuntimeState.recordTtsSynthesis({ provider: 'none', voice: GERMAN_DEEPGRAM_VOICE, model: GERMAN_DEEPGRAM_VOICE, fallbackReason: err.message });
    logger.error('[LocalTTS] ' + err.message);
    throw err;
  }
  if (!response.ok) {
    const body = (await response.text().catch(() => '')).slice(0, 300);
    const err = new GermanVoiceUnavailableError(
      `German voice ${GERMAN_DEEPGRAM_VOICE} unavailable: Deepgram returned HTTP ${response.status} ${body}`,
      response.status,
    );
    voiceRuntimeState.recordTtsSynthesis({ provider: 'none', voice: GERMAN_DEEPGRAM_VOICE, model: GERMAN_DEEPGRAM_VOICE, fallbackReason: err.message });
    logger.error('[LocalTTS] ' + err.message);
    throw err;
  }
  const audio = Buffer.from(await response.arrayBuffer());
  if (!audio.length) {
    const err = new GermanVoiceUnavailableError(`German voice ${GERMAN_DEEPGRAM_VOICE} unavailable: Deepgram returned empty audio.`);
    voiceRuntimeState.recordTtsSynthesis({ provider: 'none', voice: GERMAN_DEEPGRAM_VOICE, model: GERMAN_DEEPGRAM_VOICE, fallbackReason: err.message });
    throw err;
  }
  voiceRuntimeState.recordTtsSynthesis({ provider: 'deepgram', voice: GERMAN_DEEPGRAM_VOICE, model: GERMAN_DEEPGRAM_VOICE, fallbackReason: null });
  return audio;
}

export const synthesizeGermanFabian = synthesizeGermanJulius;

/**
 * Stream German speech directly from Deepgram aura-2-julius-de.
 * Returns the raw fetch Response so chunks can be consumed as they arrive.
 */
export async function streamGermanJuliusResponse(text: string, options?: { encoding?: string; sampleRate?: number }): Promise<Response> {
  const cleanText = sanitizeMarkdownForSpeech(text) || text;
  const deepgramKey = process.env.DEEPGRAM_API_KEY || secretStore.getSync('deepgram');
  if (!deepgramKey) {
    const err = new GermanVoiceUnavailableError(
      `German voice ${GERMAN_DEEPGRAM_VOICE} unavailable: no Deepgram API key is configured.`,
    );
    voiceRuntimeState.recordTtsSynthesis({ provider: 'none', voice: GERMAN_DEEPGRAM_VOICE, model: GERMAN_DEEPGRAM_VOICE, fallbackReason: err.message });
    throw err;
  }
  const encoding = options?.encoding ? `&encoding=${encodeURIComponent(options.encoding)}` : '';
  const sampleRate = options?.sampleRate ? `&sample_rate=${options.sampleRate}` : '';
  const url = `https://api.deepgram.com/v1/speak?model=${GERMAN_DEEPGRAM_VOICE}${encoding}${sampleRate}`;

  const controller = new AbortController();
  // Timeout strictly for the initial connection / TTFB (headers arrival), NOT for the whole body stream!
  const ttfbTimeout = setTimeout(() => {
    controller.abort(new Error('Deepgram TTFB timeout after 8000ms'));
  }, 8000);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Token ${deepgramKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: cleanText }),
      signal: controller.signal,
    });
  } catch (netErr: any) {
    clearTimeout(ttfbTimeout);
    const isTimeout = netErr?.name === 'AbortError' || netErr?.message?.includes('timeout');
    const err = new GermanVoiceUnavailableError(
      `German voice ${GERMAN_DEEPGRAM_VOICE} unavailable: Deepgram request failed (${isTimeout ? 'TTFB timeout after 8s' : (netErr?.message || netErr)}).`,
    );
    voiceRuntimeState.recordTtsSynthesis({ provider: 'none', voice: GERMAN_DEEPGRAM_VOICE, model: GERMAN_DEEPGRAM_VOICE, fallbackReason: err.message });
    logger.error('[LocalTTS] ' + err.message);
    throw err;
  } finally {
    clearTimeout(ttfbTimeout);
  }

  if (!response.ok) {
    const body = (await response.text().catch(() => '')).slice(0, 300);
    const err = new GermanVoiceUnavailableError(
      `German voice ${GERMAN_DEEPGRAM_VOICE} unavailable: Deepgram returned HTTP ${response.status} ${body}`,
      response.status,
    );
    voiceRuntimeState.recordTtsSynthesis({ provider: 'none', voice: GERMAN_DEEPGRAM_VOICE, model: GERMAN_DEEPGRAM_VOICE, fallbackReason: err.message });
    logger.error('[LocalTTS] ' + err.message);
    throw err;
  }
  voiceRuntimeState.recordTtsSynthesis({ provider: 'deepgram', voice: GERMAN_DEEPGRAM_VOICE, model: GERMAN_DEEPGRAM_VOICE, fallbackReason: null });
  return response;
}

/**
 * Stream 24kHz 16-bit mono PCM frames (20ms / 480 samples each) directly from Deepgram.
 * Decouples network reading from audio playback:
 * - Chunks are downloaded from Deepgram as fast as network permits into an in-memory queue.
 * - Audio playback begins immediately on the first chunk (~300-500ms TTFA).
 * - Playback can continue smoothly for 40+ seconds even after the network stream finishes.
 */
async function* streamSingleTextPcmFrames(
  text: string,
  onFirstChunk?: (ms: number) => void
): AsyncGenerator<Int16Array> {
  const t0 = Date.now();
  const response = await streamGermanJuliusResponse(text, { encoding: 'linear16', sampleRate: 24000 });
  if (!response.body) throw new GermanVoiceUnavailableError('No response body from Deepgram');

  const reader = response.body.getReader();
  const frameQueue: Int16Array[] = [];
  const waiter: { resolve: (() => void) | null } = { resolve: null };
  const notifyFrameAvailable = () => {
    if (waiter.resolve) {
      const r = waiter.resolve;
      waiter.resolve = null;
      r();
    }
  };
  let readerFinished = false;
  let readerError: Error | null = null;
  let totalBytesReceived = 0;
  let firstChunkReported = false;

  const SAMPLES_PER_FRAME = 480; // 24000 * 0.02
  const BYTES_PER_FRAME = SAMPLES_PER_FRAME * 2; // 960

  // Digital gain boost (+4.8 dB) with smooth hyperbolic tangent limiting to prevent clipping
  function applyDigitalGainSoft(sample: number, gain = 1.75): number {
    const scaled = sample * gain;
    if (scaled > 30000) {
      const excess = scaled - 30000;
      return Math.min(32767, Math.round(30000 + (2767 * Math.tanh(excess / 4000))));
    } else if (scaled < -30000) {
      const excess = -scaled - 30000;
      return Math.max(-32768, Math.round(-(30000 + (2768 * Math.tanh(excess / 4000)))));
    }
    return Math.round(scaled);
  }

  // Background producer: read from Deepgram as fast as network delivers
  (async () => {
    let rawBuffer = Buffer.alloc(0);
    let headerSkipped = false;

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        totalBytesReceived += value.length;

        if (!firstChunkReported) {
          firstChunkReported = true;
          onFirstChunk?.(Date.now() - t0);
        }

        rawBuffer = Buffer.concat([rawBuffer, Buffer.from(value)]);

        if (!headerSkipped && rawBuffer.length >= 44) {
          // 44-byte WAV header produced by Deepgram for linear16
          rawBuffer = rawBuffer.subarray(44);
          headerSkipped = true;
        }

        if (headerSkipped) {
          while (rawBuffer.length >= BYTES_PER_FRAME) {
            const frameBuf = rawBuffer.subarray(0, BYTES_PER_FRAME);
            rawBuffer = rawBuffer.subarray(BYTES_PER_FRAME);
            const int16 = new Int16Array(SAMPLES_PER_FRAME);
            for (let i = 0; i < SAMPLES_PER_FRAME; i++) {
              int16[i] = applyDigitalGainSoft(frameBuf.readInt16LE(i * 2));
            }
            frameQueue.push(int16);
            notifyFrameAvailable();
          }
        }
      }

      // Handle final residue frame if any
      if (headerSkipped && rawBuffer.length > 0) {
        const int16 = new Int16Array(SAMPLES_PER_FRAME);
        const availableSamples = Math.floor(rawBuffer.length / 2);
        for (let i = 0; i < SAMPLES_PER_FRAME; i++) {
          int16[i] = i < availableSamples ? applyDigitalGainSoft(rawBuffer.readInt16LE(i * 2)) : 0;
        }
        frameQueue.push(int16);
        notifyFrameAvailable();
      }
      logger.info(`[LocalTTS] Deepgram download completed in ${Date.now() - t0}ms (${totalBytesReceived} bytes received, queued ${frameQueue.length} frames).`);
    } catch (err: any) {
      logger.error(`[LocalTTS] Deepgram network stream read error: ${err?.message || err}`);
      readerError = err instanceof Error ? err : new Error(String(err));
    } finally {
      readerFinished = true;
      notifyFrameAvailable();
    }
  })();

  // Consumer generator: yields frames as requested by playback loop
  try {
    while (true) {
      if (frameQueue.length > 0) {
        yield frameQueue.shift()!;
      } else if (readerFinished) {
        if (readerError) {
          throw readerError;
        }
        break;
      } else {
        await new Promise<void>((resolve) => {
          waiter.resolve = resolve;
        });
      }
    }
  } finally {
    // If consumer broke out early (e.g. barge-in or user stop), cancel reader
    try {
      await reader.cancel();
    } catch {
      /* ignore cancel error */
    }
  }
}

/**
 * Stream 24kHz 16-bit mono PCM frames (20ms / 480 samples each) directly from Deepgram.
 * Decouples network reading from audio playback.
 * Automatically chunks text if it exceeds Deepgram's 2000 character limit so long responses
 * (40s, 60s, or several minutes) stream seamlessly without hitting HTTP 413.
 */
export async function* streamGermanJuliusPcmFrames(
  text: string,
  onFirstChunk?: (ms: number) => void
): AsyncGenerator<Int16Array> {
  const clean = (sanitizeMarkdownForSpeech(text) || text).trim();
  if (!clean) return;

  // Deepgram speak API has a hard limit of 2000 characters per request.
  // When text exceeds 1400 characters, chunk it cleanly by sentences.
  if (clean.length > 1400) {
    const protectedText = clean.replace(/(\d)\.(\d)/g, '$1\u2024$2');
    const rawSentences = (protectedText.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) || [protectedText])
      .map((s) => s.replace(/\u2024/g, '.').trim())
      .filter(Boolean);

    const chunks: string[] = [];
    let current = '';
    for (const s of rawSentences) {
      if ((current + ' ' + s).trim().length > 1400 && current) {
        chunks.push(current.trim());
        current = s;
      } else {
        current = (current + ' ' + s).trim();
      }
    }
    if (current) chunks.push(current.trim());

    let chunkIdx = 0;
    for (const chunk of chunks) {
      for await (const frame of streamSingleTextPcmFrames(chunk, (ttfa) => {
        if (chunkIdx === 0) onFirstChunk?.(ttfa);
      })) {
        yield frame;
      }
      chunkIdx++;
    }
    return;
  }

  for await (const frame of streamSingleTextPcmFrames(clean, onFirstChunk)) {
    yield frame;
  }
}

export function isGermanVoiceId(voice?: string): boolean {
  const v = (voice || '').toLowerCase().trim();
  return v.endsWith('-de') || v.startsWith('de-') || v.startsWith('de_');
}
export const ROMANIAN_NEURAL_VOICE = 'ro-RO-EmilNeural';  // Natural Romanian male voice

export const AURA_TO_NEURAL_FALLBACK: Record<string, string> = {
  'aura-helios-en': 'en-GB-RyanNeural',
  'aura-zeus-en': 'en-US-ChristopherNeural',
  'aura-orion-en': 'en-US-GuyNeural',
  'aura-athena-en': 'en-US-AriaNeural',
  'aura-angus-en': 'en-IE-ConnorNeural',
  'aura-orpheus-en': 'en-US-EricNeural',
};

export function resolveAuthoritativeTtsTarget(requestedVoice: string): { provider: string; voice: string } {
  const trimmed = (requestedVoice || '').trim();
  // German is authoritative: always Deepgram Fabian, never an English/neural fallback.
  if (voiceRuntimeState.getLanguage() === 'de' || isGermanVoiceId(trimmed)) {
    return { provider: 'deepgram', voice: GERMAN_DEEPGRAM_VOICE };
  }
  if (trimmed.startsWith('aura-')) {
    const deepgramKey = process.env.DEEPGRAM_API_KEY || secretStore.getSync('deepgram');
    if (deepgramKey) {
      return { provider: 'deepgram', voice: trimmed };
    }
    return { provider: 'edge-tts', voice: AURA_TO_NEURAL_FALLBACK[trimmed] || DEFAULT_NEURAL_VOICE };
  }
  return { provider: 'edge-tts', voice: trimmed || DEFAULT_NEURAL_VOICE };
}

export function isVoiceCompatible(voice?: string, lang?: string): boolean {
  if (!voice) return false;
  const l = (lang || 'en').toLowerCase().trim().slice(0, 2);
  const v = voice.toLowerCase().trim();
  if (l === 'de') {
    return v === GERMAN_DEEPGRAM_VOICE;
  }
  if (l === 'ro') {
    return v.startsWith('ro-') || v.includes('emil') || v.includes('alina');
  }
  if (l === 'en') {
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

export function resolveVoiceForLanguage(lang?: string, requestedVoice?: string): string {
  const l = (lang || '').toLowerCase().trim().slice(0, 2);
  const deepgramKey = process.env.DEEPGRAM_API_KEY || secretStore.getSync('deepgram');
  if (requestedVoice && requestedVoice.trim()) {
    const trimmed = requestedVoice.trim();
    if (l === 'de') return GERMAN_DEEPGRAM_VOICE;
    if (trimmed.startsWith('aura-')) {
      if (l === 'ro') return ROMANIAN_NEURAL_VOICE;
      if (deepgramKey) return trimmed;
      return AURA_TO_NEURAL_FALLBACK[trimmed] || DEFAULT_NEURAL_VOICE;
    }
    if (trimmed.endsWith('Neural') && isVoiceCompatible(trimmed, l || 'en')) {
      return trimmed;
    }
  }
  if (l === 'de') return GERMAN_DEEPGRAM_VOICE;
  if (l === 'ro') return ROMANIAN_NEURAL_VOICE;
  return DEFAULT_NEURAL_VOICE;
}

export function resolveLocaleForLanguage(lang?: string): string {
  const l = (lang || '').toLowerCase().trim();
  if (l.startsWith('de')) return 'de-DE';
  if (l.startsWith('ro')) return 'ro-RO';
  return 'en-GB';
}

let lastSynthesisHealth: { available: boolean; testedAt: number; error?: string } = {
  available: false,
  testedAt: 0,
};

export async function verifySpeechSynthesisAvailability(voice: string = DEFAULT_NEURAL_VOICE, force = false): Promise<{ available: boolean; error?: string }> {
  const now = Date.now();
  // Reuse successful test for 30s unless force probe requested
  if (!force && lastSynthesisHealth.testedAt && (now - lastSynthesisHealth.testedAt < 30000) && lastSynthesisHealth.available) {
    return { available: true };
  }

  try {
    const pythonExe = resolvePythonExecutable();
    logger.info('[LocalTTS] Executing TTS availability probe with interpreter:', { pythonExe, voice });
    await synthesizeLocally('Ready.', voice);
    lastSynthesisHealth = { available: true, testedAt: now };
    return { available: true };
  } catch (err: any) {
    const errMsg = err?.message || 'Synthesis probe failed';
    lastSynthesisHealth = { available: false, testedAt: now, error: errMsg };
    logger.warn('[LocalTTS] TTS availability probe failed:', { error: errMsg });
    return { available: false, error: errMsg };
  }
}

import { voiceStudioService } from './VoiceStudioService.js';
import { voiceRuntimeState } from './VoiceRuntimeState.js';

export interface SynthesisOptions {
  rate?: string;
  pitch?: string;
  provider?: string;
}

export async function synthesizeLocally(
  text: string,
  voice: string = DEFAULT_NEURAL_VOICE,
  options?: SynthesisOptions,
): Promise<Buffer> {
  const cleanText = sanitizeMarkdownForSpeech(text) || text;

  // 1. German: ALWAYS Deepgram aura-2-julius-de. No Piper / Edge / English fallback —
  //    a failure surfaces as GermanVoiceUnavailableError so the caller can show it.
  const isGerman =
    voiceRuntimeState.getLanguage() === 'de' ||
    isGermanVoiceId(voice) ||
    voice.includes('thorsten') ||
    voice.includes('Killian');

  if (isGerman) {
    return synthesizeGermanJulius(cleanText);
  }

  // 2. If VoiceStudio is healthy/available, use it as first-class local real-time provider for English
  const vsHealth = await voiceStudioService.checkHealth().catch(() => ({ healthy: false } as any));
  if ((vsHealth.healthy || options?.provider === 'voicestudio' || voice.toLowerCase().includes('voicestudio')) && !isGerman) {
    try {
      const vsAudio = await voiceStudioService.synthesize(cleanText, voice);
      if (vsAudio && vsAudio.byteLength > 0) {
        voiceRuntimeState.recordTtsSynthesis({
          provider: 'voicestudio',
          voice,
          model: 'tts-1',
          fallbackReason: null,
        });
        return vsAudio;
      }
    } catch (vsErr: any) {
      logger.warn('[LocalTTS] VoiceStudio synthesis failed, falling back to next provider:', vsErr?.message);
    }
  }

  // 3. If voice is an Aura voice, attempt to synthesize via Deepgram API first
  if (voice && voice.startsWith('aura-') && !isGerman) {
    const deepgramKey = process.env.DEEPGRAM_API_KEY || secretStore.getSync('deepgram');
    if (deepgramKey) {
      try {
        const response = await fetch(`https://api.deepgram.com/v1/speak?model=${voice}`, {
          method: 'POST',
          headers: {
            'Authorization': `Token ${deepgramKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ text: cleanText }),
        });
        if (response.ok) {
          const ab = await response.arrayBuffer();
          voiceRuntimeState.recordTtsSynthesis({
            provider: 'deepgram',
            voice,
            model: voice,
            fallbackReason: vsHealth.healthy ? null : 'VoiceStudio is currently unavailable, so Deepgram is the active fallback.',
          });
          return Buffer.from(ab);
        }
        logger.warn('[LocalTTS] Deepgram speak returned non-ok:', response.status);
      } catch (dgErr: any) {
        logger.warn('[LocalTTS] Deepgram speak exception, falling back to neural TTS:', dgErr?.message);
      }
    }
    // Fall back to distinct high-quality Neural voice corresponding to this Aura persona
    voice = AURA_TO_NEURAL_FALLBACK[voice] || DEFAULT_NEURAL_VOICE;
  }

  const tmpFile = path.join(os.tmpdir(), `tts-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`);
  const pythonExe = resolvePythonExecutable();

  return new Promise((resolve, reject) => {
    const args = [SCRIPT_PATH, '--text', cleanText, '--voice', voice, '--output', tmpFile];
    if (options?.rate) {
      args.push('--rate', options.rate);
    }
    if (options?.pitch) {
      args.push('--pitch', options.pitch);
    }

    const proc = spawn(pythonExe, args, {
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', async (code) => {
      if (code !== 0) {
        logger.warn('[LocalTTS] Python synthesis process failed', { code, stderr, stdout });
        try { await fs.unlink(tmpFile); } catch { /* ignore */ }
        return reject(new Error(`Local TTS synthesis failed (code ${code}): ${stderr || stdout}`));
      }

      try {
        const audioBuffer = await fs.readFile(tmpFile);
        try { await fs.unlink(tmpFile); } catch { /* ignore */ }
        voiceRuntimeState.recordTtsSynthesis({
          provider: 'edge-tts',
          voice,
          model: 'neural-tts',
          fallbackReason: vsHealth.healthy ? null : 'VoiceStudio is currently unavailable, so Edge-TTS is the active fallback.',
        });
        resolve(audioBuffer);
      } catch (err: any) {
        reject(new Error(`Failed to read generated TTS audio: ${err.message}`));
      }
    });

    proc.on('error', async (err) => {
      try { await fs.unlink(tmpFile); } catch { /* ignore */ }
      reject(err);
    });
  });
}
