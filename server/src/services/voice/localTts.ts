import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { logger } from '../../utils/logger.js';

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

export const DEFAULT_NEURAL_VOICE = 'en-GB-RyanNeural'; // Deep, clear, natural British male English voice
export const GERMAN_NEURAL_VOICE = 'de-DE-KillianNeural'; // Natural German male voice
export const ROMANIAN_NEURAL_VOICE = 'ro-RO-EmilNeural';  // Natural Romanian male voice

export function isVoiceCompatible(voice?: string, lang?: string): boolean {
  if (!voice) return false;
  const l = (lang || 'en').toLowerCase().trim().slice(0, 2);
  const v = voice.toLowerCase().trim();
  if (l === 'de') {
    return v.startsWith('de-') || v.includes('killian') || v.includes('conrad') || v.includes('katja') || v.includes('amala');
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
  // Only allow valid Neural voice overrides if strictly compatible with the target language
  if (
    requestedVoice &&
    requestedVoice.trim() &&
    !requestedVoice.startsWith('aura-') &&
    requestedVoice.endsWith('Neural') &&
    isVoiceCompatible(requestedVoice, l || 'en')
  ) {
    return requestedVoice.trim();
  }
  if (l === 'de') return GERMAN_NEURAL_VOICE;
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

export async function synthesizeLocally(text: string, voice: string = DEFAULT_NEURAL_VOICE): Promise<Buffer> {
  const tmpFile = path.join(os.tmpdir(), `tts-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`);
  const pythonExe = resolvePythonExecutable();

  return new Promise((resolve, reject) => {
    const proc = spawn(pythonExe, [SCRIPT_PATH, '--text', text, '--voice', voice, '--output', tmpFile], {
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
