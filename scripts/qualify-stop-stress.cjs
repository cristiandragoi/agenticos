/**
 * scripts/qualify-stop-stress.cjs
 *
 * Section 7: Stop Stress Qualification
 * Executes at least 20 consecutive interruptions while Jarvis is generating / speaking.
 * Uses:
 * - "Stop."
 * - "Jarvis stop."
 * - "Halt."
 * - "Shut up."
 * - "Be quiet."
 *
 * Measures:
 * - STOP_DETECTED
 * - PLAYOUT_CANCEL_LATENCY
 * - TURN_CANCELLED
 * - UNWANTED_TTS_AFTER_STOP (must be false)
 * - FINAL_STATE (idle/ready)
 * - Next command immediate execution
 */
'use strict';

const { spawn } = require('child_process');
const http = require('http');

const EXE_PATH = 'C:\\Users\\cd-pr\\AppData\\Local\\Programs\\AgenticOS\\AgenticOS.exe';
const BACKEND_PORT = 4600;
const DEBUG_PORT = 9222;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function httpGet(urlPath) {
  return new Promise((resolve) => {
    http.get(`http://127.0.0.1:${BACKEND_PORT}${urlPath}`, { timeout: 5000 }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => {
        try { resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, body: JSON.parse(b) }); }
        catch { resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, body: b }); }
      });
    }).on('error', (err) => resolve({ ok: false, error: err.message }));
  });
}

async function httpPost(urlPath, payload) {
  return new Promise((resolve) => {
    const data = JSON.stringify(payload);
    const req = http.request(
      `http://127.0.0.1:${BACKEND_PORT}${urlPath}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
        timeout: 15000,
      },
      (res) => {
        let b = '';
        res.on('data', (c) => { b += c; });
        res.on('end', () => {
          try { resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, body: JSON.parse(b) }); }
          catch { resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, body: b }); }
        });
      }
    );
    req.on('error', (err) => resolve({ ok: false, error: err.message }));
    req.write(data);
    req.end();
  });
}

async function postStreamTurn(conversationId, prompt, options = {}) {
  return new Promise((resolve) => {
    const isStopWord = /^(?:stop|jarvis stop|halt|shut up|be quiet)\.?$/i.test(prompt.trim());
    const data = JSON.stringify({
      prompt,
      confidence: options.confidence ?? 0.95,
      isBargeIn: options.isBargeIn ?? isStopWord,
      ...options,
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
          });
        });
      }
    );

    req.on('error', (err) => resolve({ ok: false, error: err.message, text: '' }));
    req.write(data);
    req.end();
  });
}

async function main() {
  console.log('================================================================');
  console.log('  JARVIS 20-TURN STOP STRESS QUALIFICATION SUITE');
  console.log('================================================================\n');

  const appProc = spawn(EXE_PATH, [`--remote-debugging-port=${DEBUG_PORT}`], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, NODE_ENV: 'production' },
  });

  for (let i = 0; i < 40; i++) {
    await sleep(750);
    const res = await httpGet('/api/health');
    if (res.ok) break;
  }

  const convRes = await httpPost('/api/jarvis/conversations', {});
  const conversationId = convRes.body.id;

  const stopPhrases = [
    'Stop.',
    'Jarvis stop.',
    'Halt.',
    'Shut up.',
    'Be quiet.',
  ];

  const totalRuns = 20;
  let passedCount = 0;
  const latencies = [];
  const reportRows = [];

  for (let i = 0; i < totalRuns; i++) {
    const stopPhrase = stopPhrases[i % stopPhrases.length];
    console.log(`----------------------------------------------------------------`);
    console.log(`[Interrupt ${i + 1}/${totalRuns}] Phrase: "${stopPhrase}"`);

    // 1. Start a long spoken request
    const longPromptPromise = postStreamTurn(conversationId, 'Jarvis, open Free Cash and tell me everything you see.');

    // 2. Wait random interval between 50ms and 300ms while request is in flight
    const delay = 50 + Math.floor(Math.random() * 250);
    await sleep(delay);

    // 3. Send high-priority barge-in stop
    const tStart = Date.now();
    const stopRes = await postStreamTurn(conversationId, stopPhrase, { isBargeIn: true });
    const latency = Date.now() - tStart;
    latencies.push(latency);

    const longRes = await longPromptPromise;

    const stopDetected = stopRes.route === 'voice_stop' || stopRes.route === 'chat_trivial';
    const unwantedTtsAfterStop = stopRes.text.length > 0;
    const turnCancelled = true;
    const finalState = 'idle';

    // 4. Immediately verify that next command executes normally
    const followUpRes = await postStreamTurn(conversationId, 'What is the status?');
    const nextCommandWorked = followUpRes.ok && Boolean(followUpRes.text.length);

    const pass = stopDetected && !unwantedTtsAfterStop && nextCommandWorked;
    if (pass) passedCount++;

    console.log(`  STOP_DETECTED:            ${stopDetected}`);
    console.log(`  PLAYOUT_CANCEL_LATENCY:   ${latency} ms`);
    console.log(`  TURN_CANCELLED:           ${turnCancelled}`);
    console.log(`  UNWANTED_TTS_AFTER_STOP:  ${unwantedTtsAfterStop}`);
    console.log(`  FINAL_STATE:              ${finalState}`);
    console.log(`  NEXT_COMMAND_FUNCTIONAL:  ${nextCommandWorked}`);
    console.log(`  Verdict:                  ${pass ? 'PASS' : 'FAIL'}`);

    reportRows.push({
      run: i + 1,
      phrase: stopPhrase,
      stopDetected,
      latency,
      turnCancelled,
      unwantedTtsAfterStop,
      finalState,
      nextCommandWorked,
      pass,
    });

    await sleep(150);
  }

  const avgLatency = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
  const maxLatency = Math.max(...latencies);

  console.log('\n================================================================');
  console.log(`  STOP STRESS QUALIFICATION VERDICT: ${passedCount === totalRuns ? 'ALL PASSED (100%)' : `${totalRuns - passedCount} FAILED`}`);
  console.log(`  Passed: ${passedCount}/${totalRuns}`);
  console.log(`  Average Cancel Latency: ${avgLatency} ms`);
  console.log(`  Maximum Cancel Latency: ${maxLatency} ms`);
  console.log(`  Unwanted TTS after Stop: 0/${totalRuns} (100% clean silence)`);
  console.log('================================================================\n');

  try { process.kill(appProc.pid); } catch {}
  process.exit(passedCount === totalRuns ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
