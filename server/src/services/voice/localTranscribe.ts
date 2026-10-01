import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { logger } from '../../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveWorkerScriptPath(): string {
  const candidates = [
    path.resolve(__dirname, '../../../scripts/whisper_worker.py'),
    path.resolve(__dirname, '../../scripts/whisper_worker.py'),
    path.resolve(process.cwd(), 'scripts/whisper_worker.py'),
    path.resolve(process.cwd(), 'server/scripts/whisper_worker.py'),
  ];
  for (const c of candidates) {
    if (fsSync.existsSync(c)) return c;
  }
  return candidates[0];
}

function resolveOneShotScriptPath(): string {
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

const WORKER_SCRIPT_PATH = resolveWorkerScriptPath();
const ONE_SHOT_SCRIPT_PATH = resolveOneShotScriptPath();

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
  confidence?: number;
  noSpeechProb?: number;
  avgLogprob?: number;
  effectiveModel?: string;
  effectiveLanguage?: string;
  device?: string;
  latencyMs?: number;
}

export function isMeaningfulSpeech(
  text: string | null | undefined,
  meta?: {
    noSpeechProb?: number;
    avgLogprob?: number;
    probability?: number | null;
    confidence?: number | null;
    /** Deepgram-style confidence (0–1 float); used for low-confidence rejection. */
    deepgramConfidence?: number | null;
    /** Number of words returned by STT (Deepgram words array length). */
    wordCount?: number | null;
    /** Audio duration in seconds (from Deepgram metadata.duration). */
    audioDurationSec?: number | null;
  }
): boolean {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;

  // Filter out pure punctuation or non-word characters
  const alphanumeric = trimmed.replace(/[^a-zA-Z0-9\u00C0-\u024F\u1E00-\u1EFF]/g, '');
  if (alphanumeric.length === 0) return false;

  // ── Deepgram confidence gate ──────────────────────────────────────
  // Deepgram returns a per-alternative confidence (0–1). Very low values
  // indicate the STT is guessing at noise/ambient sound.
  if (meta?.deepgramConfidence !== undefined && meta.deepgramConfidence !== null) {
    // Hard reject: confidence below 0.3 is almost certainly noise
    if (meta.deepgramConfidence < 0.3) {
      return false;
    }
    // Soft reject: low confidence on very short transcripts (≤3 words)
    const effectiveWordCount = meta?.wordCount ?? trimmed.split(/\s+/).length;
    if (meta.deepgramConfidence < 0.5 && effectiveWordCount <= 3) {
      return false;
    }
  }

  // ── Minimum audio duration gate ───────────────────────────────────
  // Audio shorter than 0.3 seconds is almost always a click/pop/noise.
  if (meta?.audioDurationSec !== undefined && meta.audioDurationSec !== null) {
    if (meta.audioDurationSec < 0.3) {
      return false;
    }
  }

  // If whisper explicitly detected silence / no-speech
  if (meta?.noSpeechProb !== undefined && meta.noSpeechProb > 0.45) {
    return false;
  }

  // If very low probability or confidence on short fragments
  if (meta?.probability !== undefined && meta.probability !== null && meta.probability < 0.25 && alphanumeric.length < 5) {
    return false;
  }

  // Reject tokens in brackets/parentheses which Whisper emits for non-speech audio events
  const withoutAudioTags = trimmed.replace(/\[.*?\]|\(.*?\)|<.*?>/g, '').trim();
  if (withoutAudioTags.length === 0) {
    return false;
  }

  // Known Whisper hallucination phrases triggered by silence, room tone, or breathing
  const lower = trimmed.toLowerCase().replace(/[.,!?;:()\[\]"'\-]/g, ' ').replace(/\s+/g, ' ').trim();
  const SILENCE_HALLUCINATIONS = [
    // Whisper hallucination phrases on silence/room tone
    'thank you',
    'thanks for watching',
    'thank you for watching',
    'thanks',
    'subtitles by',
    'amara org',
    'bye',
    'bye bye',
    'goodbye',
    'you',
    'the end',
    'music',
    'applause',
    'silence',
    'cough',
    'laughter',
    'repeated tough',
    'mbc',
    'subscribe',
    'like and subscribe',
    'see you in the next video',
    'watching',
    'blank audio',
    'inaudible',
    // Common filler/noise tokens from Deepgram and Whisper
    'um',
    'uh',
    'hmm',
    'huh',
    'ah',
    'oh',
    'ugh',
    'mhm',
    'uh huh',
    'mm hmm',
    'mm',
    'hm',
    'er',
    'so',
    'well',
    'right',
    'yeah',
    'yep',
    'nope',
    'okay',
    'ok',
  ];

  if (SILENCE_HALLUCINATIONS.includes(lower)) {
    return false;
  }

  // Single characters like "a", "s", "t" generated from clicks/pops
  if (alphanumeric.length === 1 && !/^[ai]$/i.test(alphanumeric)) {
    return false;
  }

  // Two-character noise tokens without any supporting confidence metadata
  if (alphanumeric.length <= 2 && !meta?.deepgramConfidence && !meta?.confidence && !meta?.probability) {
    return false;
  }

  return true;
}

interface PendingItem {
  resolve: (res: LocalTranscribeResult) => void;
  reject: (err: Error) => void;
  tmpFile: string;
  t0: number;
}

class WarmWhisperWorker {
  private proc: ChildProcess | null = null;
  private isReady = false;
  private stdoutBuffer = '';
  private currentRequest: PendingItem | null = null;
  private requestQueue: Array<{
    tmpFile: string;
    language?: string;
    resolve: (res: LocalTranscribeResult) => void;
    reject: (err: Error) => void;
    t0: number;
  }> = [];
  public device = 'unknown';
  public model = process.env.WHISPER_MODEL || 'base';
  private spawnPromise: Promise<void> | null = null;

  public async ensureStarted(): Promise<void> {
    if (this.isReady && this.proc && !this.proc.killed) return;
    if (this.spawnPromise) return this.spawnPromise;

    this.spawnPromise = new Promise<void>((resolve, reject) => {
      try {
        const pythonExe = resolvePythonExecutable();
        logger.info('[WarmWhisperWorker] Starting persistent warm Whisper worker...');
        const proc = spawn(pythonExe, [WORKER_SCRIPT_PATH], {
          windowsHide: true,
          env: {
            ...process.env,
            HF_HUB_DISABLE_SYMLINKS_WARNING: '1',
          },
        });
        this.proc = proc;

        let startupResolved = false;

        proc.stdout?.on('data', (d: Buffer) => {
          this.stdoutBuffer += d.toString('utf8');
          this.drainLines((line) => {
            if (!this.isReady) {
              try {
                const initData = JSON.parse(line);
                if (initData.status === 'ready') {
                  this.isReady = true;
                  this.device = initData.device || 'cpu';
                  this.model = initData.model || 'tiny.en';
                  logger.info('[WarmWhisperWorker] Warm Whisper worker READY on device:', this.device, 'model:', this.model);
                  startupResolved = true;
                  resolve();
                  this.pumpQueue();
                  return;
                }
              } catch {
                // ignore leading non-json
              }
            }

            if (this.currentRequest) {
              const req = this.currentRequest;
              this.currentRequest = null;
              try {
                const data = JSON.parse(line);
                if (data.error) {
                  req.reject(new Error(data.error));
                } else {
                  req.resolve({
                    text: data.text || '',
                    language: data.language,
                    probability: data.probability,
                    confidence: data.confidence !== undefined ? data.confidence : 1.0,
                    noSpeechProb: data.noSpeechProb,
                    avgLogprob: data.avgLogprob,
                    effectiveModel: data.effectiveModel || this.model,
                    effectiveLanguage: data.effectiveLanguage,
                    device: data.device || this.device,
                    latencyMs: Date.now() - req.t0,
                  });
                }
              } catch (parseErr: any) {
                req.reject(new Error(`Failed to parse worker output: ${line}`));
              } finally {
                // The temp WAV is deliberately NOT deleted here: a worker-side
                // error triggers the one-shot fallback in transcribeLocally(),
                // which re-reads this same path. Deleting it here is what made
                // every fallback fail with "Audio file not found". Cleanup is
                // owned by transcribeLocally()'s finally (single-owner rule).
                this.pumpQueue();
              }
            }
          });
        });

        proc.stderr?.on('data', (d: Buffer) => {
          const errText = d.toString('utf8').trim();
          if (errText) logger.warn('[WarmWhisperWorker] stderr:', errText);
        });

        proc.on('close', (code) => {
          logger.warn(`[WarmWhisperWorker] Worker process exited with code ${code}`);
          this.isReady = false;
          this.proc = null;
          this.spawnPromise = null;
          if (!startupResolved) {
            startupResolved = true;
            reject(new Error(`Worker exited with code ${code} during startup`));
          }
          if (this.currentRequest) {
            const req = this.currentRequest;
            this.currentRequest = null;
            // No unlink: the caller falls back to the one-shot transcriber with
            // this same path; transcribeLocally() owns cleanup.
            req.reject(new Error(`Worker process exited unexpectedly with code ${code}`));
          }
          // Drain remaining queued items with error so caller can fall back
          while (this.requestQueue.length > 0) {
            const item = this.requestQueue.shift()!;
            // No unlink: same single-owner rule as above.
            item.reject(new Error('Worker process unavailable'));
          }
        });

        proc.on('error', (err) => {
          logger.warn('[WarmWhisperWorker] Process error:', err);
          if (!startupResolved) {
            startupResolved = true;
            reject(err);
          }
        });

        // Timeout startup after 15 seconds
        setTimeout(() => {
          if (!this.isReady && !startupResolved) {
            startupResolved = true;
            logger.warn('[WarmWhisperWorker] Worker startup timed out.');
            resolve(); // do not block, allow fallback
          }
        }, 15000);
      } catch (err) {
        this.spawnPromise = null;
        reject(err);
      }
    });

    return this.spawnPromise;
  }

  private drainLines(onLine: (line: string) => void): void {
    let idx: number;
    while ((idx = this.stdoutBuffer.indexOf('\n')) !== -1) {
      const line = this.stdoutBuffer.slice(0, idx).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(idx + 1);
      if (line) onLine(line);
    }
  }

  /**
   * Truthful warm-worker status for runtime self-diagnosis (systemDiagnostics).
   * Reports only what this process actually observed: the worker is "ready" once
   * its startup handshake completed and "running" only while the child process
   * is alive. Never inferred.
   */
  public getStatus(): { ready: boolean; running: boolean; device: string; model: string } {
    return {
      ready: this.isReady,
      running: Boolean(this.proc && !this.proc.killed),
      device: this.device,
      model: this.model,
    };
  }

  public transcribe(tmpFile: string, language?: string): Promise<LocalTranscribeResult> {
    return new Promise((resolve, reject) => {
      this.requestQueue.push({ tmpFile, language, resolve, reject, t0: Date.now() });
      this.pumpQueue();
    });
  }

  private pumpQueue(): void {
    if (!this.isReady || this.currentRequest || !this.proc || this.requestQueue.length === 0) {
      return;
    }
    const next = this.requestQueue.shift()!;
    this.currentRequest = next;
    const reqJson = JSON.stringify({ audioPath: next.tmpFile, language: next.language }) + '\n';
    try {
      this.proc.stdin?.write(reqJson);
    } catch (err: any) {
      this.currentRequest = null;
      // No unlink: the caller falls back to the one-shot transcriber with this
      // same path; transcribeLocally() owns cleanup.
      next.reject(err);
    }
  }
}

const warmWorker = new WarmWhisperWorker();
// Eagerly initiate warm worker startup in background
warmWorker.ensureStarted().catch((e) => logger.warn('[WarmWhisperWorker] Eager startup notice:', e?.message));

/** Live warm-worker status for runtime self-diagnosis (read-only, never throws). */
export function getWarmWorkerStatus(): { ready: boolean; running: boolean; device: string; model: string } {
  return warmWorker.getStatus();
}

import { voiceStudioService } from './VoiceStudioService.js';

export async function transcribeLocally(
  audioBuffer: Buffer,
  extension: string = '.webm',
  language?: string
): Promise<LocalTranscribeResult> {
  const t0 = Date.now();
  // If VoiceStudio is healthy/available, use it as first-class local real-time provider
  const vsHealth = await voiceStudioService.checkHealth().catch(() => ({ healthy: false } as any));
  if (vsHealth.healthy) {
    try {
      const vsResult = await voiceStudioService.transcribe(audioBuffer, `audio${extension}`, language);
      if (vsResult && vsResult.text) {
        const { voiceRuntimeState } = await import('./VoiceRuntimeState.js');
        voiceRuntimeState.recordSttTranscription({
          provider: 'voicestudio',
          language: vsResult.language || language || 'en',
          model: 'whisper-1',
        });
        return {
          text: vsResult.text,
          language: vsResult.language || language || 'en',
          probability: 1.0,
          confidence: 1.0,
          effectiveModel: 'voicestudio-whisper',
          latencyMs: Date.now() - t0,
        };
      }
    } catch (vsErr: any) {
      logger.warn('[LocalTranscribe] VoiceStudio transcription failed, falling back to local whisper:', vsErr?.message);
    }
  }

  const ext = extension.startsWith('.') ? extension : `.${extension}`;
  const tmpFile = path.join(os.tmpdir(), `transcribe-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  await fs.writeFile(tmpFile, audioBuffer);

  try {
    await warmWorker.ensureStarted();
    const res = await warmWorker.transcribe(tmpFile, language);
    const { voiceRuntimeState } = await import('./VoiceRuntimeState.js');
    voiceRuntimeState.recordSttTranscription({
      provider: 'local-whisper',
      language: res.language || language || 'en',
      model: res.effectiveModel || 'tiny.en',
    });
    return res;
  } catch (workerErr: any) {
    logger.warn('[LocalTranscribe] Warm worker error, falling back to one-shot transcribe.py:', workerErr?.message);
    const res = await transcribeOneShot(tmpFile, language);
    const { voiceRuntimeState } = await import('./VoiceRuntimeState.js');
    voiceRuntimeState.recordSttTranscription({
      provider: 'local-whisper',
      language: res.language || language || 'en',
      model: res.effectiveModel || 'tiny.en',
    });
    return res;
  } finally {
    // Single-owner temp-file cleanup: runs exactly once, AFTER the warm-worker
    // attempt and (if it was needed) the one-shot fallback have both settled.
    // Nothing inside the failure branches may delete this file, because the
    // fallback transcriber re-reads the very same path.
    await fs.unlink(tmpFile).catch(() => {});
  }
}

async function transcribeOneShot(
  tmpFile: string,
  language?: string
): Promise<LocalTranscribeResult> {
  return new Promise((resolve, reject) => {
    const pythonExe = resolvePythonExecutable();
    const spawnArgs = [ONE_SHOT_SCRIPT_PATH, tmpFile];
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
      // Temp-file cleanup is owned by transcribeLocally()'s finally — not here.

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

    proc.on('error', (err) => {
      // Temp-file cleanup is owned by transcribeLocally()'s finally — not here.
      reject(err);
    });
  });
}
