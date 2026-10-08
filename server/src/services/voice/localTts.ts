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
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Token ${deepgramKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: cleanText }),
      signal: AbortSignal.timeout(15_000),
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
  voiceRuntimeState.recordTtsSynthesis({ provider: 'deepgram', voice: GERMAN_DEEPGRAM_VOICE, model: GERMAN_DEEPGRAM_VOICE, fallbackReason: null });
  return response;
}

/**
 * Stream 24kHz 16-bit mono PCM frames (20ms / 480 samples each) directly from Deepgram.
 * First chunk is yielded in ~400-600ms, with zero ffmpeg subprocess overhead.
 */
export async function* streamGermanJuliusPcmFrames(text: string, onFirstChunk?: (ms: number) => void): AsyncGenerator<Int16Array> {
  const t0 = Date.now();
  const response = await streamGermanJuliusResponse(text, { encoding: 'linear16', sampleRate: 24000 });
  if (!response.body) throw new GermanVoiceUnavailableError('No response body from Deepgram');
  const reader = response.body.getReader();
  let buffer = Buffer.alloc(0);
  let headerSkipped = false;
  let firstChunkLogged = false;

  const SAMPLES_PER_FRAME = 480; // 24000 * 0.02
  const BYTES_PER_FRAME = SAMPLES_PER_FRAME * 2; // 960

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!firstChunkLogged) {
      firstChunkLogged = true;
      onFirstChunk?.(Date.now() - t0);
    }
    buffer = Buffer.concat([buffer, Buffer.from(value)]);

    if (!headerSkipped && buffer.length >= 44) {
      // 44-byte WAV header produced by Deepgram for linear16
      buffer = buffer.subarray(44);
      headerSkipped = true;
    }

    if (headerSkipped) {
      while (buffer.length >= BYTES_PER_FRAME) {
        const frameBuf = buffer.subarray(0, BYTES_PER_FRAME);
        buffer = buffer.subarray(BYTES_PER_FRAME);
        const int16 = new Int16Array(SAMPLES_PER_FRAME);
        for (let i = 0; i < SAMPLES_PER_FRAME; i++) {
          int16[i] = frameBuf.readInt16LE(i * 2);
        }
        yield int16;
      }
    }
  }

  // Final residue frame if there are remaining samples
  if (headerSkipped && buffer.length > 0) {
    const int16 = new Int16Array(SAMPLES_PER_FRAME);
    const availableSamples = Math.floor(buffer.length / 2);
    for (let i = 0; i < SAMPLES_PER_FRAME; i++) {
      int16[i] = i < availableSamples ? buffer.readInt16LE(i * 2) : 0;
    }
    yield int16;
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
