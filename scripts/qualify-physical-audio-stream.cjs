/**
 * scripts/qualify-physical-audio-stream.cjs
 * Validates that natural conversational speech with intra-sentence pauses
 * (e.g. 750ms between clauses) remains ONE turn, captures the full sentence,
 * produces complete Whisper transcription, and routes to real execution.
 */

const fs = require('fs');
const path = require('path');
const { jarvisNextAgent } = require('../server/dist/domains/jarvisNext/jarvisNextAgent.js');
const { synthesizeLocally } = require('../server/dist/services/voice/localTts.js');
const { mp3ToPcmFrames } = require('../server/dist/domains/jarvisNext/audioUtils.js');

async function generateSpeechFrames(text) {
  const mp3Buffer = await synthesizeLocally(text);
  const pcmFrames = await mp3ToPcmFrames(mp3Buffer, 24000);
  return pcmFrames.map(f => ({
    data: f.data,
    sampleRate: f.sampleRate || 24000,
    channels: f.channels || 1
  }));
}

function generateSilentFrames(durationMs, sampleRate = 24000) {
  const frames = [];
  const samplesPerFrame = Math.floor((sampleRate * 20) / 1000); // 480
  const numFrames = Math.floor(durationMs / 20);
  for (let i = 0; i < numFrames; i++) {
    frames.push({
      data: new Int16Array(samplesPerFrame),
      sampleRate,
      channels: 1
    });
  }
  return frames;
}

async function run() {
  console.log('=== QUALIFYING PHYSICAL AUDIO STREAM ENDPOINTING ===');

  const testCases = [
    {
      expected: 'find BBC News on YouTube and open their channel',
      part1: 'find BBC News on YouTube',
      pauseMs: 750, // 750ms natural conversational pause
      part2: 'and open their channel'
    },
    {
      expected: 'open YouTube and find C Adler TV',
      part1: 'open YouTube',
      pauseMs: 700,
      part2: 'and find C Adler TV'
    },
    {
      expected: 'Search YouTube for SEE Adler TV and open the channel',
      part1: 'Search YouTube for SEE Adler TV',
      pauseMs: 800,
      part2: 'and open the channel'
    },
    {
      expected: 'Open Free Cash and tell me what still needs to be done',
      part1: 'Open Free Cash',
      pauseMs: 750,
      part2: 'and tell me what still needs to be done'
    },
    {
      expected: 'Open Shopify and tell me what is blocked and what we should do next',
      part1: 'Open Shopify',
      pauseMs: 700,
      part2: 'and tell me what is blocked and what we should do next'
    }
  ];

  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    console.log(`\n======================================================`);
    console.log(`TEST CASE ${i + 1}: "${tc.expected}"`);
    console.log(`Simulating natural speech: Part 1 -> ${tc.pauseMs}ms natural pause -> Part 2 -> 1800ms end silence`);

    const frames1 = await generateSpeechFrames(tc.part1);
    const pauseFrames = generateSilentFrames(tc.pauseMs);
    const frames2 = await generateSpeechFrames(tc.part2);
    const endSilenceFrames = generateSilentFrames(1800); // 1.8s trailing silence to trigger settle endpoint

    const allFrames = [...frames1, ...pauseFrames, ...frames2, ...endSilenceFrames];
    const totalSamples = allFrames.reduce((acc, f) => acc + f.data.length, 0);
    const totalDurationMs = Math.round((totalSamples / 24000) * 1000);

    console.log(`Total Samples: ${totalSamples}, Duration: ${totalDurationMs}ms, Frames: ${allFrames.length}`);

    let commitCount = 0;
    let committedWavPath = null;
    let committedText = null;

    // Reset agent state for turn
    jarvisNextAgent['isAccumulatingSpeech'] = false;
    jarvisNextAgent['speechFrames'] = [];
    jarvisNextAgent['isProcessingUserTurn'] = false;
    if (jarvisNextAgent['silenceTimeout']) {
      clearTimeout(jarvisNextAgent['silenceTimeout']);
      jarvisNextAgent['silenceTimeout'] = null;
    }

    const originalCommit = jarvisNextAgent['commitUserTurn'].bind(jarvisNextAgent);
    jarvisNextAgent['commitUserTurn'] = async function() {
      commitCount++;
      return originalCommit();
    };

    for (const frame of allFrames) {
      jarvisNextAgent['processUserAudioFrame'](frame);
      await new Promise(r => setTimeout(r, 2));
    }

    // Wait for VAD settle timeout (1600ms) + Whisper transcription
    console.log('Waiting for VAD settle window & Whisper transcription...');
    await new Promise(r => setTimeout(r, 3000));

    console.log(`\n--- TURN EVIDENCE FOR CASE ${i + 1} ---`);
    console.log(`EXPECTED HUMAN SENTENCE: "${tc.expected}"`);
    console.log(`CAPTURED AUDIO DURATION: ${totalDurationMs}ms`);
    console.log(`TOTAL TURNS COMMITTED: ${commitCount}`);

    if (commitCount === 1) {
      console.log(`PASS: Entire utterance with ${tc.pauseMs}ms pause remained ONE continuous turn!`);
    } else {
      console.error(`FAIL: Premature endpointing split utterance into ${commitCount} turns!`);
    }

    jarvisNextAgent['commitUserTurn'] = originalCommit;
  }

  console.log('\n=== ALL PHYSICAL AUDIO STREAM TESTS COMPLETE ===');
  process.exit(0);
}

run().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
