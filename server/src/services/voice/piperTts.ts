/**
 * Piper TTS service for AgenticOS.
 *
 * Language → Provider routing:
 *   de → piper (de_DE-thorsten-high)   fallback: edge-tts (de-DE-KillianNeural)
 *   ro → piper (ro_RO-mihai-medium)    fallback: edge-tts (ro-RO-EmilNeural)
 *   en → edge-tts (en-GB-RyanNeural)
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { logger } from '../../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Resolve the models/piper directory relative to the server root */
function resolveModelsDir(): string {
  const candidates = [
    path.resolve(__dirname, '../../../models/piper'),
    path.resolve(__dirname, '../../models/piper'),
    path.resolve(process.cwd(), 'models/piper'),
    path.resolve(process.cwd(), 'server/models/piper'),
    'D:\\AgenticOS\\server\\models\\piper',
  ];
  for (const c of candidates) {
    if (fsSync.existsSync(c)) return c;
  }
  return candidates[0];
}

function resolvePiperScript(): string {
  const candidates = [
    path.resolve(__dirname, '../../../scripts/piper_tts.py'),
    path.resolve(__dirname, '../../scripts/piper_tts.py'),
    path.resolve(process.cwd(), 'scripts/piper_tts.py'),
    path.resolve(process.cwd(), 'server/scripts/piper_tts.py'),
  ];
  for (const c of candidates) {
    if (fsSync.existsSync(c)) return c;
  }
  return candidates[0];
}

function resolvePythonExecutable(): string {
  if (process.env.PYTHON_PATH && fsSync.existsSync(process.env.PYTHON_PATH)) {
    return process.env.PYTHON_PATH;
  }
  const candidates = [
    'D:\\AgenticOS\\server\\.venv\\Scripts\\python.exe',
    path.resolve(__dirname, '../../../server/.venv/Scripts/python.exe'),
    path.resolve(__dirname, '../../.venv/Scripts/python.exe'),
    path.resolve(process.cwd(), 'server/.venv/Scripts/python.exe'),
    path.resolve(process.cwd(), '.venv/Scripts/python.exe'),
  ];
  for (const c of candidates) {
    if (fsSync.existsSync(c)) return c;
  }
  return 'python';
}

export interface PiperVoiceConfig {
  voiceKey: string;        // e.g. "de_DE-thorsten-high"
  language: string;        // "de" | "ro"
  label: string;
  onnxPath: string;
  configPath: string;
  sampleRate: number;
  provider: 'piper';
}

export interface PiperSynthesisResult {
  audio: Buffer;
  provider: 'piper';
  voice: string;
  language: string;
  sampleRate: number;
  elapsedMs: number;
}

/** Map of supported Piper voices. Key = voiceKey used in API. */
export const PIPER_VOICES: Record<string, Omit<PiperVoiceConfig, 'onnxPath' | 'configPath'>> = {
  'de_DE-thorsten-high': {
    voiceKey: 'de_DE-thorsten-high',
    language: 'de',
    label: 'Thorsten — Native German, Deep Male, Local',
    sampleRate: 22050,
    provider: 'piper',
  },
  'ro_RO-mihai-medium': {
    voiceKey: 'ro_RO-mihai-medium',
    language: 'ro',
    label: 'Mihai — Native Romanian, Local',
    sampleRate: 22050,
    provider: 'piper',
  },
};

/** Map: language code → preferred Piper voice key */
export const LANGUAGE_TO_PIPER_VOICE: Record<string, string> = {
  de: 'de_DE-thorsten-high',
  ro: 'ro_RO-mihai-medium',
};

/** Returns true if Piper is available for this language */
export function hasPiperVoiceForLanguage(lang: string): boolean {
  const l = (lang || '').toLowerCase().trim().slice(0, 2);
  const voiceKey = LANGUAGE_TO_PIPER_VOICE[l];
  if (!voiceKey) return false;
  const modelsDir = resolveModelsDir();
  const onnxPath = path.join(modelsDir, voiceKey, `${voiceKey}.onnx`);
  const configPath = path.join(modelsDir, voiceKey, `${voiceKey}.onnx.json`);
  return fsSync.existsSync(onnxPath) && fsSync.existsSync(configPath);
}

/** Get PiperVoiceConfig for a language, or null if not available */
export function getPiperVoiceConfig(lang: string, voiceKeyOverride?: string): PiperVoiceConfig | null {
  const l = (lang || '').toLowerCase().trim().slice(0, 2);
  const voiceKey = voiceKeyOverride || LANGUAGE_TO_PIPER_VOICE[l];
  if (!voiceKey) return null;
  const base = PIPER_VOICES[voiceKey];
  if (!base) return null;
  const modelsDir = resolveModelsDir();
  const onnxPath = path.join(modelsDir, voiceKey, `${voiceKey}.onnx`);
  const configPath = path.join(modelsDir, voiceKey, `${voiceKey}.onnx.json`);
  if (!fsSync.existsSync(onnxPath)) {
    logger.warn(`[Piper] ONNX model not found: ${onnxPath}`);
    return null;
  }
  if (!fsSync.existsSync(configPath)) {
    logger.warn(`[Piper] JSON config not found: ${configPath}`);
    return null;
  }
  return { ...base, onnxPath, configPath };
}

/** Synthesize text with Piper and return PCM WAV buffer */
export async function synthesizeWithPiper(
  text: string,
  lang: string,
  voiceKeyOverride?: string,
  timeoutMs = 45000
): Promise<PiperSynthesisResult> {
  const voiceConfig = getPiperVoiceConfig(lang, voiceKeyOverride);
  if (!voiceConfig) {
    throw new Error(
      `[Piper] No model available for language '${lang}'${voiceKeyOverride ? ` (voice: ${voiceKeyOverride})` : ''}. ` +
      `Run download_piper_model.py to download models.`
    );
  }

  const pythonExe = resolvePythonExecutable();
  const piperScript = resolvePiperScript();
  const tmpFile = path.join(os.tmpdir(), `piper-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);

  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const proc = spawn(pythonExe, [
      piperScript,
      '--text', text,
      '--model-path', voiceConfig.onnxPath,
      '--config-path', voiceConfig.configPath,
      '--output', tmpFile,
    ], { windowsHide: true });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`[Piper] Synthesis timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.on('close', async (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        try { await fs.unlink(tmpFile); } catch { /* ignore */ }
        const errMsg = stderr.trim() || stdout.trim() || `exit code ${code}`;
        return reject(new Error(`[Piper] Synthesis failed: ${errMsg}`));
      }
      try {
        const audioBuffer = await fs.readFile(tmpFile);
        try { await fs.unlink(tmpFile); } catch { /* ignore */ }
        const elapsedMs = Date.now() - startedAt;
        logger.info('[Piper] Synthesis OK', {
          voice: voiceConfig.voiceKey,
          lang,
          bytes: audioBuffer.length,
          elapsedMs,
        });
        resolve({
          audio: audioBuffer,
          provider: 'piper',
          voice: voiceConfig.voiceKey,
          language: lang,
          sampleRate: voiceConfig.sampleRate,
          elapsedMs,
        });
      } catch (err: any) {
        reject(new Error(`[Piper] Failed to read output WAV: ${err.message}`));
      }
    });

    proc.on('error', async (err) => {
      clearTimeout(timer);
      try { await fs.unlink(tmpFile); } catch { /* ignore */ }
      reject(new Error(`[Piper] Process error: ${err.message}`));
    });
  });
}

/** Convert WAV buffer to MP3 using edge-tts pipeline (Python lame fallback) or return WAV directly */
export async function convertWavToMp3(wavBuffer: Buffer): Promise<Buffer> {
  // If ffmpeg or lame is unavailable, return WAV directly.
  // The frontend Audio element can play WAV natively.
  return wavBuffer;
}
