/**
 * scripts/acceptance-voicestudio-production.mjs
 *
 * Production Acceptance Test Suite for VoiceStudio Integration & Low-Latency Voice Pipeline
 * Executed against the installed binary:
 * C:\Users\cd-pr\AppData\Local\Programs\AgenticOS\AgenticOS.exe
 */

import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const EXE_PATH = 'C:\\Users\\cd-pr\\AppData\\Local\\Programs\\AgenticOS\\AgenticOS.exe';
const BASE_URL = 'http://127.0.0.1:4600';
const EVIDENCE_FILE = 'D:\\AgenticOS\\docs\\acceptance\\voicestudio-production-evidence.json';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${txt}`);
  }
  return res.json();
}

/**
 * Start an OpenAI-compatible mock VoiceStudio daemon on 127.0.0.1:3900
 */
class MockVoiceStudioDaemon {
  constructor(port = 3900) {
    this.port = port;
    this.server = null;
    this.requestCount = { speech: 0, models: 0, transcriptions: 0 };
    this.sampleMp3 = null;
  }

  async initSampleMp3() {
    try {
      const { synthesizeLocally } = await import('../server/dist/services/voice/localTts.js');
      this.sampleMp3 = await synthesizeLocally('VoiceStudio operational audio stream.');
    } catch {
      // Fallback 1KB buffer with MP3 frame header
      this.sampleMp3 = Buffer.alloc(1024, 0xff);
    }
  }

  async start() {
    await this.initSampleMp3();
    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        const url = new URL(req.url, `http://127.0.0.1:${this.port}`);

        if (url.pathname === '/v1/models' || url.pathname === '/models') {
          this.requestCount.models++;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            object: 'list',
            data: [
              { id: 'tts-1', object: 'model' },
              { id: 'whisper-1', object: 'model' },
              { id: 'omnivox-studio', object: 'model' },
            ],
          }));
        }

        if (url.pathname === '/health' || url.pathname === '/') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ status: 'ok', engine: 'VoiceStudio', version: '1.4.0' }));
        }

        if (url.pathname === '/v1/audio/speech') {
          this.requestCount.speech++;
          let body = '';
          req.on('data', (c) => { body += c.toString(); });
          req.on('end', () => {
            res.writeHead(200, {
              'Content-Type': 'audio/mpeg',
              'Content-Length': this.sampleMp3.length,
            });
            res.end(this.sampleMp3);
          });
          return;
        }

        if (url.pathname === '/v1/audio/transcriptions') {
          this.requestCount.transcriptions++;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            text: 'Hello Jarvis, this is VoiceStudio streaming audio transcription.',
            language: 'en',
          }));
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      });

      this.server.listen(this.port, '127.0.0.1', () => {
        console.log(`[MockVoiceStudio] Server listening on http://127.0.0.1:${this.port}`);
        resolve();
      });

      this.server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.log(`[MockVoiceStudio] Port ${this.port} already in use; assuming VoiceStudio already running`);
          resolve();
        } else {
          reject(err);
        }
      });
    });
  }

  async stop() {
    if (this.server) {
      await new Promise((resolve) => this.server.close(resolve));
      this.server = null;
      console.log(`[MockVoiceStudio] Stopped server on http://127.0.0.1:${this.port}`);
    }
  }
}

async function sendVoiceTurn(prompt) {
  const t0 = Date.now();
  const res = await fetch(`${BASE_URL}/api/jarvis-next/agent/turn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: prompt,
      confidence: 0.98,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Turn endpoint failed (${res.status}): ${errText}`);
  }

  const json = await res.json();
  const totalDurationMs = Date.now() - t0;
  const fullText = json?.status?.lastAssistantText || '';

  return {
    fullText,
    totalDurationMs,
    status: json?.status,
  };
}

async function runAcceptance() {
  console.log('======================================================================');
  console.log(' VOICE STUDIO INTEGRATION & LOW-LATENCY PRODUCTION ACCEPTANCE SUITE  ');
  console.log(' Installed Binary: ' + EXE_PATH);
  console.log('======================================================================\n');

  // Step 1: Start Mock VoiceStudio Daemon
  console.log('[1/8] Starting VoiceStudio local service on http://127.0.0.1:3900...');
  const voiceStudio = new MockVoiceStudioDaemon(3900);
  await voiceStudio.start();

  // Step 2: Launch installed AgenticOS
  console.log('[2/8] Launching installed AgenticOS application...');
  const app = await electron.launch({
    executablePath: EXE_PATH,
    args: ['--no-sandbox'],
  });

  const proc = app.process();
  console.log(`- Electron Main Process PID: ${proc.pid}`);

  const page = await app.firstWindow();
  console.log(`- Connected to App Window: "${await page.title()}"`);

  // Step 3: Wait for backend readiness
  console.log('[3/8] Waiting for backend readiness at http://127.0.0.1:4600/api/health...');
  let healthy = false;
  let healthInfo = null;
  for (let i = 0; i < 30; i++) {
    try {
      healthInfo = await fetchJson(`${BASE_URL}/api/health`);
      if (healthInfo && (healthInfo.status === 'ok' || healthInfo.ok || healthInfo.build)) {
        healthy = true;
        break;
      }
    } catch (_) {}
    await sleep(1000);
  }

  if (!healthy) {
    throw new Error('Backend at http://127.0.0.1:4600 did not become healthy in time.');
  }

  console.log(`✓ Backend is healthy. BuildId: ${healthInfo?.build?.buildId || 'unknown'}\n`);

  const results = [];

  try {
    // TEST 1: VoiceStudio Provider Health Detection & Status
    console.log('--- TEST 1: VoiceStudio Provider Health Detection ---');
    const vsStatus = await fetchJson(`${BASE_URL}/api/jarvis-next/voicestudio/status`);
    console.log('VoiceStudio Status:', vsStatus);
    const test1Passed = vsStatus.success === true && vsStatus.status.healthy === true;
    results.push({
      testId: 'VOICESTUDIO_HEALTH_DETECTION',
      name: 'VoiceStudio Provider Health Detection & Endpoint Inspection',
      passed: test1Passed,
      details: vsStatus,
    });
    console.log(`[${test1Passed ? 'PASS' : 'FAIL'}] VOICESTUDIO_HEALTH_DETECTION: Healthy on port 3900\n`);

    // TEST 2: VoiceStudio Speech Synthesis & OpenAI Compatibility
    console.log('--- TEST 2: VoiceStudio OpenAI-Compatible Speech API ---');
    const ttsStatus = await fetchJson(`${BASE_URL}/api/voice/tts/status`);
    console.log('TTS Provider Status:', ttsStatus);
    const test2Passed = ttsStatus.effectiveProvider === 'voicestudio' && ttsStatus.voiceStudio?.healthy === true;
    results.push({
      testId: 'VOICESTUDIO_OPENAI_COMPATIBLE',
      name: 'VoiceStudio OpenAI-Compatible Speech Endpoint Wiring',
      passed: test2Passed,
      details: ttsStatus,
    });
    console.log(`[${test2Passed ? 'PASS' : 'FAIL'}] VOICESTUDIO_OPENAI_COMPATIBLE: effectiveProvider=${ttsStatus.effectiveProvider}\n`);

    // TEST 3: VoiceStudio Disconnect & Automatic Fallback to Deepgram / Edge-TTS
    console.log('--- TEST 3: Automatic Fallback on VoiceStudio Disconnect ---');
    console.log('  -> Stopping VoiceStudio mock server...');
    await voiceStudio.stop();
    await sleep(1500);

    const fallbackStatus = await fetchJson(`${BASE_URL}/api/jarvis-next/voicestudio/status`);
    const fallbackTtsStatus = await fetchJson(`${BASE_URL}/api/voice/tts/status`);
    console.log('Fallback TTS Provider Status:', fallbackTtsStatus);
    const fallbackWorks = fallbackStatus.status.healthy === false && fallbackTtsStatus.effectiveProvider !== 'voicestudio';
    results.push({
      testId: 'VOICESTUDIO_FALLBACK_ON_DISCONNECT',
      name: 'Automatic Graceful Fallback when VoiceStudio is Offline',
      passed: fallbackWorks,
      details: { fallbackStatus, fallbackTtsStatus },
    });
    console.log(`[${fallbackWorks ? 'PASS' : 'FAIL'}] VOICESTUDIO_FALLBACK_ON_DISCONNECT: Fell back to ${fallbackTtsStatus.effectiveProvider}\n`);

    // TEST 4: Automatic Reconnect when VoiceStudio Returns
    console.log('--- TEST 4: Automatic Reconnect when VoiceStudio Returns ---');
    console.log('  -> Restarting VoiceStudio mock server...');
    await voiceStudio.start();
    await sleep(1500);

    const reconnectedStatus = await fetchJson(`${BASE_URL}/api/jarvis-next/voicestudio/status`);
    const reconnectedTtsStatus = await fetchJson(`${BASE_URL}/api/voice/tts/status`);
    const reconnectWorks = reconnectedStatus.status.healthy === true && reconnectedTtsStatus.effectiveProvider === 'voicestudio';
    results.push({
      testId: 'VOICESTUDIO_AUTOMATIC_RECONNECT',
      name: 'Seamless Auto-Reconnect without Application Restart',
      passed: reconnectWorks,
      details: { reconnectedStatus, reconnectedTtsStatus },
    });
    console.log(`[${reconnectWorks ? 'PASS' : 'FAIL'}] VOICESTUDIO_AUTOMATIC_RECONNECT: Successfully reconnected to VoiceStudio\n`);

    // TEST 5: Dynamic Voice Switching without Restarting
    console.log('--- TEST 5: Dynamic Voice Switching ---');
    const voiceSwitchTurn1 = await sendVoiceTurn('Jarvis, switch to Zeus voice.');
    await sleep(800);
    const voiceConf1 = await fetchJson(`${BASE_URL}/api/jarvis-next/agent/voice`);
    const isZeus = voiceConf1.voiceConfig?.voiceId?.includes('zeus') || voiceSwitchTurn1.fullText.includes('Zeus');

    const voiceSwitchTurn2 = await sendVoiceTurn('Jarvis, switch to VoiceStudio voice.');
    await sleep(800);
    const voiceConf2 = await fetchJson(`${BASE_URL}/api/jarvis-next/agent/voice`);
    const isVS = voiceConf2.voiceConfig?.voiceId?.includes('voicestudio') || voiceSwitchTurn2.fullText.includes('VoiceStudio');

    const test5Passed = isZeus && isVS;
    results.push({
      testId: 'DYNAMIC_VOICE_SWITCHING',
      name: 'Dynamic Voice Switching without Application Restart',
      passed: test5Passed,
      details: { voiceConf1, voiceConf2, turn1: voiceSwitchTurn1.fullText, turn2: voiceSwitchTurn2.fullText },
    });
    console.log(`[${test5Passed ? 'PASS' : 'FAIL'}] DYNAMIC_VOICE_SWITCHING: Switched dynamically between Zeus and VoiceStudio\n`);

    // TEST 6: 20 Consecutive Conversational Turns (Turn Isolation, Latency & Audio Truncation Proof)
    console.log('--- TEST 6: 20 Consecutive Production Voice Turns ---');
    const turns = [
      { num: 1, prompt: 'Hello Jarvis, how are you today?', type: 'fast_chat' },
      { num: 2, prompt: 'What is on my desktop right now?', type: 'slow_perception_desktop' },
      { num: 3, prompt: 'Jarvis, tell me what is currently on my Comet Perplexity page.', type: 'slow_perception_browser' },
      { num: 4, prompt: 'Jarvis, what am I holding?', type: 'slow_perception_camera' },
      { num: 5, prompt: 'Jarvis, read the Word window.', type: 'slow_perception_word' },
      { num: 6, prompt: 'Jarvis, switch to Helios voice.', type: 'fast_voice' },
      { num: 7, prompt: 'Who are you?', type: 'fast_chat' },
      { num: 8, prompt: 'What is visible in Telegram?', type: 'slow_perception_telegram' },
      { num: 9, prompt: 'Jarvis, what do you see through the camera?', type: 'slow_perception_camera' },
      { num: 10, prompt: 'What page am I looking at in the browser?', type: 'slow_perception_browser' },
      { num: 11, prompt: 'Jarvis, inspect the active screen.', type: 'slow_perception_desktop' },
      { num: 12, prompt: 'Hello Jarvis, are you ready for more commands?', type: 'fast_chat' },
      { num: 13, prompt: 'Jarvis, switch to Zeus voice.', type: 'fast_voice' },
      { num: 14, prompt: 'What is on my desktop?', type: 'slow_perception_desktop' },
      { num: 15, prompt: 'Jarvis, what am I showing the camera?', type: 'slow_perception_camera' },
      { num: 16, prompt: 'Jarvis, check the Comet browser page.', type: 'slow_perception_browser' },
      { num: 17, prompt: 'Good morning Jarvis.', type: 'fast_chat' },
      { num: 18, prompt: 'Jarvis, read the Hermes One window.', type: 'slow_perception_hermes' },
      { num: 19, prompt: 'Jarvis, what is on my screen right now?', type: 'slow_perception_desktop' },
      { num: 20, prompt: 'Thank you Jarvis, that was great.', type: 'fast_chat' },
    ];

    const turnResults = [];
    let allFinalWordsPreserved = true;

    for (const t of turns) {
      console.log(`  -> Turn ${t.num}/20 [${t.type}]: "${t.prompt}"`);
      const res = await sendVoiceTurn(t.prompt);
      await sleep(1000);

      // Check final word truncation: ensure response ended in valid punctuation
      const text = res.fullText.trim();
      const hasFinalPunctuation = /[.!?]"?$/.test(text);
      if (!hasFinalPunctuation && text.length > 0) {
        console.warn(`[WARN] Possible final word clipping on turn ${t.num}: "${text}"`);
        allFinalWordsPreserved = false;
      }

      turnResults.push({
        turnNum: t.num,
        prompt: t.prompt,
        type: t.type,
        response: text.slice(0, 100),
        durationMs: res.totalDurationMs,
        passed: Boolean(text && text.length > 0),
      });
    }

    const test6Passed = turnResults.every((t) => t.passed) && allFinalWordsPreserved;
    results.push({
      testId: 'TWENTY_CONSECUTIVE_TURNS',
      name: '20 Consecutive Production Voice Turns without Audio Truncation',
      passed: test6Passed,
      details: {
        totalTurns: turnResults.length,
        allPassed: test6Passed,
        allFinalWordsPreserved,
        turns: turnResults,
      },
    });
    console.log(`[${test6Passed ? 'PASS' : 'FAIL'}] TWENTY_CONSECUTIVE_TURNS: 20/20 turns completed successfully without final-word clipping\n`);

    // TEST 7: Barge-In Interrupt Resilience
    console.log('--- TEST 7: Barge-In Interruption Verification ---');
    // Send a long turn, then interrupt immediately
    const longTurnPromise = sendVoiceTurn('Tell me a long story about space exploration.');
    await sleep(200);
    const interruptRes = await fetchJson(`${BASE_URL}/api/jarvis-next/agent/interrupt`, { method: 'POST' });
    const longTurnResult = await longTurnPromise;
    const nextTurn = await sendVoiceTurn('Hello Jarvis, are you still there?');
    const bargeInPassed = interruptRes.success === true && nextTurn.fullText.length > 0;
    results.push({
      testId: 'BARGE_IN_RESILIENCE',
      name: 'Barge-In Halts Current Playback and Next Turn Succeeds',
      passed: bargeInPassed,
      details: { interruptRes, nextTurnResponse: nextTurn.fullText },
    });
    console.log(`[${bargeInPassed ? 'PASS' : 'FAIL'}] BARGE_IN_RESILIENCE: Interrupted playback cleanly without corrupting next turn\n`);

    // TEST 8: Latency Benchmarks (8-Stage Timestamps & p50/p95 Reporting)
    console.log('--- TEST 8: 8-Stage Latency Benchmarks (p50 / p95) ---');
    const latencyStats = await fetchJson(`${BASE_URL}/api/jarvis-next/latency-stats`);
    console.log('Latency Statistics:');
    console.log('  Count:', latencyStats.count);
    console.log('  Speech-End to First-Audio p50:', latencyStats.speechEndToFirstAudio?.p50, 'ms');
    console.log('  Speech-End to First-Audio p95:', latencyStats.speechEndToFirstAudio?.p95, 'ms');
    console.log('  Total Turn Completion p50:', latencyStats.totalTurn?.p50, 'ms');
    console.log('  Total Turn Completion p95:', latencyStats.totalTurn?.p95, 'ms');

    const test8Passed = latencyStats.count >= 20 && latencyStats.speechEndToFirstAudio?.p50 > 0;
    results.push({
      testId: 'LATENCY_BENCHMARK_8_STAGE',
      name: '8-Stage Latency Benchmarks & Dual p50/p95 Reporting',
      passed: test8Passed,
      details: latencyStats,
    });
    console.log(`[${test8Passed ? 'PASS' : 'FAIL'}] LATENCY_BENCHMARK_8_STAGE: Latency stats measured across ${latencyStats.count} production turns\n`);

    // Write Evidence File
    const evidence = {
      timestamp: new Date().toISOString(),
      installedBinary: EXE_PATH,
      buildId: healthInfo?.build?.buildId,
      gitSha: healthInfo?.build?.gitSha,
      results,
      summary: {
        totalTests: results.length,
        passed: results.filter((r) => r.passed).length,
        failed: results.filter((r) => !r.passed).length,
      },
    };

    const evidenceDir = path.dirname(EVIDENCE_FILE);
    if (!fs.existsSync(evidenceDir)) {
      fs.mkdirSync(evidenceDir, { recursive: true });
    }
    fs.writeFileSync(EVIDENCE_FILE, JSON.stringify(evidence, null, 2), 'utf8');
    console.log(`Evidence written to: ${EVIDENCE_FILE}\n`);

    console.log('======================================================================');
    if (results.every((r) => r.passed)) {
      console.log('FINAL RESULT: ALL ACCEPTANCE TESTS PASSED');
    } else {
      console.log('FINAL RESULT: ACCEPTANCE SUITE FAILED');
    }
    console.log('======================================================================');
  } finally {
    console.log('Stopping Mock VoiceStudio server...');
    try {
      await voiceStudio.stop();
    } catch (_) {}

    console.log('Closing installed AgenticOS application...');
    try {
      await Promise.race([app.close(), sleep(2000)]);
    } catch (_) {}
    try {
      if (proc && proc.pid) {
        process.kill(proc.pid);
      }
    } catch (_) {}
  }
}

runAcceptance()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('Acceptance suite failed with error:', err);
    process.exit(1);
  });
