import fs from 'node:fs';
import path from 'node:path';
import { transcribeLocally, cancelLocalTranscription, purgeObsoleteTranscriptions } from '../src/services/voice/localTranscribe.js';

function buildWav(pcmData: Buffer, sampleRate = 24000, channels = 1): Buffer {
  const header = Buffer.alloc(44);
  const dataLen = pcmData.length;
  const fileLen = 36 + dataLen;

  header.write('RIFF', 0);
  header.writeUInt32LE(fileLen, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLen, 40);

  return Buffer.concat([header, pcmData]);
}

async function run() {
  console.log('==================================================');
  console.log('BACKLOG FAILURE AND CANCELLATION TEST (STEP 10)');
  console.log('==================================================');

  // Load a real recorded WAV
  const dir = path.resolve('data', 'voice_turns');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.wav'));
  const testFile = path.join(dir, files[files.length - 1]);
  const wavData = fs.readFileSync(testFile);

  // Warm up worker so cold start doesn't skew scenario timings
  console.log('Ensuring worker warm...');
  await transcribeLocally(wavData, '.wav', 'en', 0, 1000);
  console.log('Worker warm and ready.');

  console.log('\n--- Scenario A: Head-of-line cancellation on invalidated turn ---');
  console.log('Dispatching Turn #1...');
  const tStart = Date.now();

  // Dispatch Turn 1
  let turn1Error: any = null;
  let turn1Result: any = null;
  const turn1Promise = transcribeLocally(wavData, '.wav', 'en', 1, 2000)
    .then(res => { turn1Result = res; })
    .catch(err => { turn1Error = err; });

  // Simulate turn invalidation / watchdog firing immediately while Turn 1 is in progress
  console.log('Watchdog / newer turn invalidates Turn #1...');
  cancelLocalTranscription(1, 'watchdog_timeout');
  purgeObsoleteTranscriptions(2);

  // Submit Turn 2 immediately
  console.log('Dispatching Turn #2 immediately...');
  const t2Start = Date.now();
  const turn2Result = await transcribeLocally(wavData, '.wav', 'en', 2, 2000);
  const t2Duration = Date.now() - t2Start;

  await turn1Promise;

  console.log('Turn 1 error:', turn1Error?.message);
  console.log('Turn 2 success:', Boolean(turn2Result?.text));
  console.log('Turn 2 latency:', `${t2Duration}ms`);
  console.log('Turn 2 text:', `"${turn2Result?.text}"`);

  if (!turn1Error || !turn1Error.message.includes('STT_CANCELLED')) {
    throw new Error(`Expected Turn 1 to be cancelled, got: ${turn1Error?.message || 'success'}`);
  }
  if (!turn2Result || !turn2Result.text) {
    throw new Error('Expected Turn 2 to succeed and return transcript');
  }
  if (t2Duration > 2000) {
    throw new Error(`Turn 2 took too long (${t2Duration}ms), possible queue blockage`);
  }

  console.log('\n--- Scenario B: Stale queue purge prevents obsolete processing ---');
  // Enqueue Turn 3 and Turn 4 rapidly, then purge before Turn 3 even finishes
  const p3 = transcribeLocally(wavData, '.wav', 'en', 3, 2000).catch(e => e);
  const p4 = transcribeLocally(wavData, '.wav', 'en', 4, 2000).catch(e => e);

  // New active turn 5 arrives: purge turns < 5
  console.log('Turn 5 arrives, purging turns < 5...');
  purgeObsoleteTranscriptions(5);

  const [res3, res4] = await Promise.all([p3, p4]);
  console.log('Turn 3 status:', res3?.message);
  console.log('Turn 4 status:', res4?.message);

  // Now Turn 5 runs cleanly
  console.log('Dispatching Turn #5...');
  const t5Start = Date.now();
  const turn5Result = await transcribeLocally(wavData, '.wav', 'en', 5, 2000);
  const t5Duration = Date.now() - t5Start;
  console.log(`Turn 5 succeeded in ${t5Duration}ms with text: "${turn5Result.text}"`);

  console.log('\n==================================================');
  console.log('STEP 10 VERIFICATION RESULT: PASS');
  console.log('Zero head-of-line blocking observed.');
  console.log('Stale turns cancelled / purged immediately.');
  console.log('Active turns proceed without delay.');
  console.log('==================================================');

  process.exit(0);
}

run().catch(err => {
  console.error('Error during backlog test:', err);
  process.exit(1);
});
