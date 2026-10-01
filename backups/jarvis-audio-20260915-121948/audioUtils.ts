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
  for (let offset = 0; offset + bytesPerFrame <= rawPcm.length; offset += bytesPerFrame) {
    const slice = rawPcm.subarray(offset, offset + bytesPerFrame);
    // Create an Int16Array copy to ensure alignment and safety for native WebRTC
    const int16 = new Int16Array(slice.buffer, slice.byteOffset, samplesPerFrame);
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
