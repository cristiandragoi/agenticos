import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { logger } from '../../utils/logger.js';
import fsSync from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveScriptPath(): string {
  const candidates = [
    path.resolve(__dirname, '../../../scripts/transcribe.py'),
    path.resolve(__dirname, '../../scripts/transcribe.py'),
    path.resolve(process.cwd(), 'scripts/transcribe.py'),
    path.resolve(process.cwd(), 'server/scripts/transcribe.py'),
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

export interface LocalTranscribeResult {
  text: string;
  language?: string;
  probability?: number;
  effectiveModel?: string;
  effectiveLanguage?: string;
}

export async function transcribeLocally(
  audioBuffer: Buffer,
  extension: string = '.webm',
  language?: string
): Promise<LocalTranscribeResult> {
  const ext = extension.startsWith('.') ? extension : `.${extension}`;
  const tmpFile = path.join(os.tmpdir(), `transcribe-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  await fs.writeFile(tmpFile, audioBuffer);

  return new Promise((resolve, reject) => {
    const pythonExe = resolvePythonExecutable();
    const spawnArgs = [SCRIPT_PATH, tmpFile];
    if (language) {
      spawnArgs.push('--language', language);
    }

    const proc = spawn(pythonExe, spawnArgs, {
      windowsHide: true,
      env: {
        ...process.env,
        HF_HUB_DISABLE_SYMLINKS_WARNING: '1',
      },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', async (code) => {
      try {
        await fs.unlink(tmpFile);
      } catch { /* ignore */ }

      if (code !== 0) {
        logger.warn('[LocalTranscribe] Python process failed', { code, stderr, stdout });
        return reject(new Error(`Local transcription failed (code ${code}): ${stderr || stdout}`));
      }

      try {
        const jsonMatch = stdout.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          return reject(new Error(`No JSON output from transcriber: ${stdout}`));
        }
        const data = JSON.parse(jsonMatch[0]);
        if (data.error) {
          return reject(new Error(data.error));
        }
        resolve({
          text: data.text || '',
          language: data.language,
          probability: data.probability,
          effectiveModel: data.effectiveModel,
          effectiveLanguage: data.effectiveLanguage,
        });
      } catch (err: any) {
        reject(new Error(`Failed to parse transcriber output: ${stdout}`));
      }
    });

    proc.on('error', async (err) => {
      try {
        await fs.unlink(tmpFile);
      } catch { /* ignore */ }
      reject(err);
    });
  });
}
