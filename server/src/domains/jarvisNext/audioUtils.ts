import { getFfmpegPath } from '@livekit/av';
import { AudioFrame } from '@livekit/rtc-node';
import { spawn } from 'node:child_process';
import { logger } from '../../utils/logger.js';

/**
 * Converts an MP3 or encoded audio buffer into raw 24kHz 16-bit mono AudioFrames
 * suitable for LiveKit AudioSource.captureFrame.
 */
export async function mp3ToPcmFrames(
  audioBuffer: Buffer,
  sampleRate: number = 24000,
  frameDurationMs: number = 20
): Promise<AudioFrame[]> {
  const ffmpeg = getFfmpegPath();
  if (!ffmpeg) {
    throw new Error('Bundled ffmpeg binary not found');
  }

  const proc = spawn(ffmpeg, [
    '-i', 'pipe:0',
    '-f', 's16le',
    '-ar', String(sampleRate),
    '-ac', '1',
    'pipe:1',
  ], { windowsHide: true });

  const chunks: Buffer[] = [];
  proc.stdout.on('data', (d: Buffer) => chunks.push(d));
  proc.stderr.on('data', () => {});

  proc.stdin.write(audioBuffer);
  proc.stdin.end();

  await new Promise<void>((resolve, reject) => {
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg decode failed with code ${code}`));
    });
    proc.on('error', reject);
  });

  const rawPcm = Buffer.concat(chunks);
  const bytesPerSample = 2; // 16-bit
  const samplesPerFrame = Math.floor((sampleRate * frameDurationMs) / 1000); // 480 samples for 20ms at 24kHz
  const bytesPerFrame = samplesPerFrame * bytesPerSample; // 960 bytes

  const frames: AudioFrame[] = [];
  // FINAL RESIDUE FIX: the old loop condition `offset + bytesPerFrame <=
  // rawPcm.length` silently DROPPED the tail remainder (up to 19.99ms — the
  // last phoneme of the final word, experienced as "stops before finishing
  // speaking"). Publish a zero-padded final frame instead so every decoded
  // sample reaches the device before playout completion.
  for (let offset = 0; offset < rawPcm.length; offset += bytesPerFrame) {
    // Each AudioFrame MUST own its ArrayBuffer. AudioFrame.protoInfo() marshals the frame as
    // `new Uint8Array(this.data.buffer)` — it takes the pointer to byte 0 of the underlying
    // ArrayBuffer and ignores byteOffset. An Int16Array *view* into the shared decode buffer
    // therefore makes every published frame transmit the first 20ms of the utterance (which is
    // edge-tts leading silence), so the LiveKit track streams but is permanently silent.
    const int16 = new Int16Array(samplesPerFrame);
    for (let i = 0; i < samplesPerFrame; i++) {
      const at = offset + i * bytesPerSample;
      int16[i] = at + bytesPerSample <= rawPcm.length ? rawPcm.readInt16LE(at) : 0;
    }
    const frame = new AudioFrame(int16, sampleRate, 1, samplesPerFrame);
    frames.push(frame);
  }

  logger.debug('[JarvisNext:Audio] Decoded audio to frames:', {
    totalBytes: rawPcm.length,
    framesCount: frames.length,
    durationMs: frames.length * frameDurationMs,
  });

  return frames;
}

/**
 * Packs raw 16-bit mono PCM chunks into a canonical WAV file buffer
 * for local Whisper STT transcription.
 */
export function pcmChunksToWav(
  pcmChunks: Buffer[],
  sampleRate: number = 24000,
  channels: number = 1
): Buffer {
  const pcm = Buffer.concat(pcmChunks);
  const bitsPerSample = 16;
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);

  // RIFF header
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);

  // fmt subchunk
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  header.writeUInt16LE(1, 20);  // AudioFormat (1 = PCM)
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);

  // data subchunk
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

const KNOWN_WHISPER_NOISE_HALLUCINATIONS = new Set([
  'thank you',
  'thanks',
  'thanks for watching',
  'thank you very much',
  'you',
  'bye',
  'goodbye',
  'yeah',
  'yes',
  'okay',
  'so',
  'uh',
  'um',
  'subtitles by',
  'subtitles',
  'transcribed by',
  'amaraorg',
  'please subscribe',
  'subscribe',
]);

/**
 * Detects whether candidate transcribed audio is an acoustic echo / self-hearing
 * of what Jarvis is currently speaking or recently spoke, or a Whisper hallucination
 * triggered by speaker bleed / background noise.
 */
export function isSelfHearingEcho(candidateText: string, assistantTextOrTexts: string | string[]): boolean {
  if (!candidateText || !candidateText.trim()) return false;
  const rawCandidate = candidateText.trim();
  const lowerCandidate = rawCandidate.toLowerCase();

  // Invariant: User control commands and interruption phrases must NEVER be dropped as echo.
  if (/\b(?:stop|halt|cancel|shut\s*up|be\s*quiet|quiet|silence|pause|hold\s*on|start\s*working|stop\s*working)\b/i.test(lowerCandidate)) {
    return false;
  }

  // Invariant: Genuine questions, instructions, and interactive inquiries must NEVER be dropped as echo.
  const isQuestionOrInstruction = rawCandidate.endsWith('?') ||
    /\b(?:what|how|why|who|when|where|which)\b/i.test(lowerCandidate) ||
    /^(?:can|could|will|would|tell|show|explain|is|are|do|does|create|read|verify|check|list|describe)\b/i.test(lowerCandidate);
  if (isQuestionOrInstruction) {
    return false;
  }

  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/(\d)\.(\d)/g, '$1 point $2')
      .replace(/\b1\b/g, 'one')
      .replace(/\b2\b/g, 'two')
      .replace(/\b3\b/g, 'three')
      .replace(/\b4\b/g, 'four')
      .replace(/\b5\b/g, 'five')
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();

  const cNorm = normalize(candidateText);
  if (!cNorm) return false;

  // 1. Whisper hallucination on low audio / speaker bleed
  if (KNOWN_WHISPER_NOISE_HALLUCINATIONS.has(cNorm)) {
    return true;
  }

  const texts = Array.isArray(assistantTextOrTexts) ? assistantTextOrTexts : [assistantTextOrTexts];
  const combinedAssistant = texts.map(normalize).filter(Boolean).join(' ');
  if (!combinedAssistant) return false;

  const cWords = cNorm.split(/\s+/).filter((w) => w.length > 2);
  if (cWords.length === 0) return false;

  // 2. Exact full sentence match
  if (cNorm === combinedAssistant) {
    return true;
  }

  // 3. High-fidelity verbatim echo match: candidate is a substantial contiguous substring (4+ words) of what assistant spoke
  if (cWords.length >= 4 && combinedAssistant.includes(cNorm)) {
    return true;
  }

  // 4. Substantial consecutive n-gram overlap: 4+ consecutive words of candidate appear verbatim in assistant speech
  if (cWords.length >= 5) {
    for (let i = 0; i <= cWords.length - 4; i++) {
      const quadGram = cWords.slice(i, i + 4).join(' ');
      if (combinedAssistant.includes(quadGram)) {
        return true;
      }
    }
  }

  return false;
}
