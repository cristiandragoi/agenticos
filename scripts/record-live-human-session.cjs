/**
 * scripts/record-live-human-session.cjs
 *
 * Captures true physical microphone audio via Electron navigator.mediaDevices.getUserMedia(),
 * saves raw WAV evidence to disk, hashes the audio file, submits to the production Whisper
 * transcription worker, routes the turn through the Jarvis conversation pipeline, and logs
 * the authoritative provenance metadata.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const puppeteer = require('puppeteer-core');

const BACKEND_PORT = 4600;
const DEBUG_PORT = 9222;
const EVIDENCE_DIR = path.resolve(__dirname, '../evidence/audio');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function encodeWav(samples, sampleRate) {
  const buffer = Buffer.alloc(44 + samples.length * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples.length * 2, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // subchunk1size (16 for PCM)
  buffer.writeUInt16LE(1, 20);  // audioFormat (1 = PCM)
  buffer.writeUInt16LE(1, 22);  // numChannels (1)
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // byteRate
  buffer.writeUInt16LE(2, 32);  // blockAlign
  buffer.writeUInt16LE(16, 34); // bitsPerSample
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples.length * 2, 40);

  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(s < 0 ? s * 0x8000 : s * 0x7fff, 44 + i * 2);
  }
  return buffer;
}

async function transcribeWav(wavBuffer, filename = 'speech.wav') {
  const form = new FormData();
  form.append('audio', new Blob([wavBuffer], { type: 'audio/wav' }), filename);

  const res = await fetch(`http://127.0.0.1:${BACKEND_PORT}/api/voice/transcribe`, {
    method: 'POST',
    body: form,
  });

  if (!res.ok) {
    const errText = await res.text();
    return { ok: false, status: res.status, error: errText };
  }
  const data = await res.json();
  return { ok: true, ...data };
}

async function postStreamTurn(conversationId, prompt, confidence = 0.95) {
  return new Promise((resolve) => {
    const data = JSON.stringify({
      prompt,
      confidence,
      isBargeIn: /^(?:stop|jarvis stop|halt|shut up|be quiet)\.?$/i.test(prompt.trim()),
    });

    const req = http.request(
      `http://127.0.0.1:${BACKEND_PORT}/api/jarvis/conversations/${conversationId}/message/stream`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
        timeout: 30000,
      },
      (res) => {
        let fullText = '';
        let route = null;
        let entityId = null;
        let verified = null;
        let requestedGoals = [];
        let satisfiedGoals = [];

        res.on('data', (chunk) => {
          const lines = chunk.toString().split('\n');
          for (const line of lines) {
            if (line.startsWith('data:')) {
              const raw = line.slice(5).trim();
              if (!raw || raw === '[DONE]') continue;
              try {
                const evt = JSON.parse(raw);
                if (evt.route) route = evt.route;
                if (evt.entityId) entityId = evt.entityId;
                if (typeof evt.verified === 'boolean') verified = evt.verified;
                if (evt.delta) fullText += evt.delta;
                if (evt.text && !fullText) fullText = evt.text;
                if (Array.isArray(evt.requestedGoals)) requestedGoals = evt.requestedGoals;
                if (Array.isArray(evt.satisfiedGoals)) satisfiedGoals = evt.satisfiedGoals;
              } catch {}
            }
          }
        });

        res.on('end', () => {
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            text: fullText.trim(),
            route,
            entityId,
            verified,
            requestedGoals,
            satisfiedGoals,
          });
        });
      }
    );

    req.on('error', (err) => resolve({ ok: false, error: err.message, text: '' }));
    req.write(data);
    req.end();
  });
}

async function runPhysicalCaptureSession(durationSeconds = 5) {
  console.log('================================================================');
  console.log('  PHYSICAL MICROPHONE LIVE CAPTURE & PROVENANCE HARNESS');
  console.log('================================================================\n');

  console.log(`[1] Connecting to Electron window via CDP (${DEBUG_PORT})...`);
  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${DEBUG_PORT}`, defaultViewport: null });
  const pages = await browser.pages();
  const page = pages.find((p) => p.url().includes('file://')) || pages[0];

  if (!page) {
    throw new Error('No Electron page found via CDP.');
  }

  // Create conversation
  const convRes = await fetch(`http://127.0.0.1:${BACKEND_PORT}/api/jarvis/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const convData = await convRes.json();
  const conversationId = convData.id;
  console.log(`[2] Active Conversation ID: ${conversationId}`);

  console.log(`\n[3] Capturing physical microphone stream for ${durationSeconds}s...`);
  const captureStart = new Date().toISOString();

  const recordingResult = await page.evaluate(async (maxSeconds) => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    const track = stream.getAudioTracks()[0];
    const settings = track.getSettings();

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    const source = audioCtx.createMediaStreamSource(stream);
    const processor = audioCtx.createScriptProcessor(4096, 1, 1);

    const recordedSamples = [];
    let maxRms = 0;

    processor.onaudioprocess = (e) => {
      const channelData = e.inputBuffer.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < channelData.length; i++) {
        const v = channelData[i];
        recordedSamples.push(v);
        sum += v * v;
      }
      const rms = Math.sqrt(sum / channelData.length);
      if (rms > maxRms) maxRms = rms;
    };

    source.connect(processor);
    processor.connect(audioCtx.destination);

    await new Promise((r) => setTimeout(r, maxSeconds * 1000));

    processor.disconnect();
    source.disconnect();
    track.stop();
    await audioCtx.close();

    return {
      micLabel: track.label,
      sampleRate: audioCtx.sampleRate,
      channelCount: settings.channelCount || 1,
      totalSamples: recordedSamples.length,
      maxRms,
      samples: recordedSamples,
    };
  }, durationSeconds);

  const captureEnd = new Date().toISOString();
  console.log(`    Microphone Hardware: "${recordingResult.micLabel}"`);
  console.log(`    Sample Rate:         ${recordingResult.sampleRate} Hz`);
  console.log(`    Captured Samples:    ${recordingResult.totalSamples}`);
  console.log(`    Peak Captured RMS:   ${recordingResult.maxRms}`);

  const durationMs = Math.round((recordingResult.totalSamples / recordingResult.sampleRate) * 1000);
  const wavBuffer = encodeWav(recordingResult.samples, recordingResult.sampleRate);

  const turnId = `physical_${Date.now()}`;
  const wavFilename = `${turnId}.wav`;
  const wavPath = path.join(EVIDENCE_DIR, wavFilename);
  fs.writeFileSync(wavPath, wavBuffer);

  const hash = crypto.createHash('sha256').update(wavBuffer).digest('hex');

  console.log(`\n[4] Saved WAV Evidence:`);
  console.log(`    Path: ${wavPath}`);
  console.log(`    Hash (SHA-256): ${hash}`);
  console.log(`    Size: ${wavBuffer.length} bytes`);

  console.log(`\n[5] Submitting Real WAV to Whisper Worker (/api/voice/transcribe)...`);
  const sttResult = await transcribeWav(wavBuffer, wavFilename);
  const whisperRaw = sttResult.ok ? (sttResult.text || '') : '';
  const confidence = sttResult.probability ?? 0.0;

  console.log(`    Whisper Raw Transcript: "${whisperRaw}"`);
  console.log(`    Whisper Confidence:     ${confidence}`);

  let route = 'none';
  let entity = 'none';
  let requestedGoals = [];
  let satisfiedGoals = [];
  let finalResponse = '';

  if (whisperRaw.trim().length > 0) {
    console.log(`\n[6] Routing Human Turn through Conversational Pipeline...`);
    const turnResult = await postStreamTurn(conversationId, whisperRaw, confidence);
    route = turnResult.route || 'none';
    entity = turnResult.entityId || 'none';
    requestedGoals = turnResult.requestedGoals || [];
    satisfiedGoals = turnResult.satisfiedGoals || [];
    finalResponse = turnResult.text || '';
  } else {
    console.log(`\n[6] No human speech detected above noise threshold (RMS: ${recordingResult.maxRms}).`);
    finalResponse = 'No speech detected in physical audio buffer.';
  }

  const logEntry = {
    TURN_ID: turnId,
    MIC_DEVICE: recordingResult.micLabel,
    CAPTURE_START: captureStart,
    CAPTURE_END: captureEnd,
    DURATION_MS: durationMs,
    SAMPLE_RATE: recordingResult.sampleRate,
    CHANNEL_COUNT: recordingResult.channelCount,
    WAV_PATH: wavPath,
    WAV_HASH: hash,
    WHISPER_RAW_TRANSCRIPT: whisperRaw,
    WHISPER_CONFIDENCE: confidence,
    ROUTE: route,
    ENTITY: entity,
    REQUESTED_GOALS: requestedGoals,
    SATISFIED_GOALS: satisfiedGoals,
    FINAL_RESPONSE: finalResponse,
  };

  console.log('\n================================================================');
  console.log('  EVIDENCE RECORD LOG');
  console.log('================================================================');
  console.log(JSON.stringify(logEntry, null, 2));

  return logEntry;
}

// Run standalone if invoked directly
if (require.main === module) {
  runPhysicalCaptureSession(5).catch(console.error);
}

module.exports = { runPhysicalCaptureSession };
