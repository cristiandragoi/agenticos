import fs from 'node:fs';
import path from 'node:path';
import { transcribeLocally } from '../src/services/voice/localTranscribe.js';

function buildWav(pcmData: Buffer, sampleRate = 24000, channels = 1): Buffer {
  const header = Buffer.alloc(44);
  const dataLen = pcmData.length;
  const fileLen = 36 + dataLen;

  header.write('RIFF', 0);
  header.writeUInt32LE(fileLen, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // subchunk1 size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28); // byte rate
  header.writeUInt16LE(channels * 2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(dataLen, 40);

  return Buffer.concat([header, pcmData]);
}

async function run() {
  console.log('==================================================');
  console.log('REAL STT PERFORMANCE ACCEPTANCE TEST (STEP 9)');
  console.log('==================================================');

  // Load a real recorded WAV file to extract authentic human speech PCM
  const dir = path.resolve('data', 'voice_turns');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.wav'));
  if (files.length === 0) {
    throw new Error('No recorded WAV files found in data/voice_turns');
  }

  // Find a large file with rich speech
  let richFile = '';
  for (const f of files.reverse()) {
    const stat = fs.statSync(path.join(dir, f));
    if (stat.size > 100000) {
      richFile = path.join(dir, f);
      break;
    }
  }
  if (!richFile) richFile = path.join(dir, files[0]);

  console.log(`Using base audio recording: ${richFile}`);
  const baseWav = fs.readFileSync(richFile);
  const pcmRaw = baseWav.subarray(44); // skip WAV header

  // Generate 2s, 5s, 10s, 20s test samples
  // 24000 Hz, 16-bit mono = 48000 bytes/sec
  const bytesPerSec = 48000;
  const targetDurations = [2, 5, 10, 20];

  const results: any[] = [];

  for (const durSec of targetDurations) {
    const requiredBytes = durSec * bytesPerSec;
    let pcmChunk = Buffer.alloc(requiredBytes);
    let offset = 0;
    while (offset < requiredBytes) {
      const copyLen = Math.min(pcmRaw.length, requiredBytes - offset);
      pcmRaw.copy(pcmChunk, offset, 0, copyLen);
      offset += copyLen;
    }

    const testWav = buildWav(pcmChunk, 24000, 1);
    const actualAudioDurationMs = durSec * 1000;

    console.log(`\n--- Transcribing ${durSec}s sample (${testWav.length} bytes) ---`);
    const t0 = Date.now();
    const result = await transcribeLocally(testWav, '.wav', 'en', 100 + durSec, actualAudioDurationMs);
    const wallTotalMs = Date.now() - t0;

    const summary = {
      targetSec: durSec,
      audioDurationMs: result.audioDurationMs ?? actualAudioDurationMs,
      device: result.device ?? 'unknown',
      model: result.model ?? 'unknown',
      queueWaitMs: result.queueWaitMs ?? 0,
      inferenceMs: result.inferenceMs ?? wallTotalMs,
      totalMs: result.totalMs ?? wallTotalMs,
      text: result.text.substring(0, 60) + (result.text.length > 60 ? '...' : ''),
      timedOut: result.timeout ?? false,
      cancelled: result.cancelled ?? false,
      fallbackReason: result.fallbackReason ?? 'none',
    };
    results.push(summary);

    console.log(`Result for ${durSec}s:`);
    console.log(`  Device:         ${summary.device}`);
    console.log(`  Model:          ${summary.model}`);
    console.log(`  Audio Duration: ${summary.audioDurationMs}ms`);
    console.log(`  Queue Wait:     ${summary.queueWaitMs}ms`);
    console.log(`  Inference Time: ${summary.inferenceMs}ms`);
    console.log(`  Total Time:     ${summary.totalMs}ms`);
    console.log(`  Transcript:     "${summary.text}"`);
  }

  console.log('\n==================================================');
  console.log('SUMMARY TABLE:');
  console.table(results.map(r => ({
    'Audio (s)': `${r.targetSec}s`,
    'Device': r.device,
    'Model': r.model,
    'Queue Wait': `${r.queueWaitMs}ms`,
    'Inference': `${r.inferenceMs}ms`,
    'Total': `${r.totalMs}ms`,
    'Fallback': r.fallbackReason,
  })));

  process.exit(0);
}

run().catch(err => {
  console.error('Error during STT test:', err);
  process.exit(1);
});
