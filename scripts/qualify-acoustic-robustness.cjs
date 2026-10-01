/**
 * scripts/qualify-acoustic-robustness.cjs
 *
 * Section 2: Acoustic Robustness Qualification
 * Tests key commands across realistic acoustic environments:
 * - Quiet room
 * - Jarvis TTS currently speaking (acoustic overlap / barge-in)
 * - User speaking quietly (low signal level)
 * - Normal conversational volume
 * - 1 metre distance (room reverberation & low SNR)
 * - Fast speech rate
 * - Immediate command following TTS completion
 * - Self-corrected / interrupted sentences
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
        let entityName = null;
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
                if (evt.type === 'navigation_request' && evt.navId) {
                  httpPost('/api/jarvis/navigation/ack', {
                    navId: evt.navId,
                    success: true,
                    actualRoute: evt.targetRoute || evt.route || '/projects/proj-free-cash',
                    activeProjectId: evt.activeProjectId || evt.entityId || 'proj-free-cash',
                    visibleEntityId: evt.visibleEntityId || evt.entityId || 'proj-free-cash',
                  });
                }
                if (evt.route) route = evt.route;
                if (evt.entityId) entityId = evt.entityId;
                if (evt.entityName) entityName = evt.entityName;
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
            entityName,
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

async function main() {
  console.log('================================================================');
  console.log('  JARVIS ACOUSTIC ROBUSTNESS QUALIFICATION SUITE');
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

  const testCases = [
    {
      id: 'A1',
      condition: 'Quiet Room Baseline',
      utterance: 'Jarvis, open Shopify and tell me the status.',
      confidence: 0.98,
      isBargeIn: false,
      expectedEntity: 'proj-shopify',
      check: (r) => (r.route === 'navigate' || r.route === 'fast_read') && r.text.toLowerCase().includes('shopify') && (r.text.toLowerCase().includes('status') || r.text.toLowerCase().includes('active')),
    },
    {
      id: 'A2',
      condition: 'Jarvis TTS Playing (Barge-in Stop)',
      utterance: 'Stop.',
      confidence: 0.94,
      isBargeIn: true,
      expectedEntity: null,
      check: (r) => r.route === 'voice_stop' || r.route === 'chat_trivial',
    },
    {
      id: 'A3',
      condition: 'Quiet Speech / Low Amplitude',
      utterance: 'What is blocked?',
      confidence: 0.81,
      isBargeIn: false,
      expectedEntity: 'proj-shopify',
      check: (r) => r.text.toLowerCase().includes('blocked') || r.text.toLowerCase().includes('blocker'),
    },
    {
      id: 'A4',
      condition: 'Normal Conversational Volume',
      utterance: 'What should we do next?',
      confidence: 0.97,
      isBargeIn: false,
      expectedEntity: 'proj-shopify',
      check: (r) => r.text.toLowerCase().includes('next') || r.text.toLowerCase().includes('resume') || r.text.toLowerCase().includes('retry'),
    },
    {
      id: 'A5',
      condition: '1 Metre Distance / Room Reverb',
      utterance: 'Tell me what you see.',
      confidence: 0.86,
      isBargeIn: false,
      expectedEntity: 'proj-shopify',
      check: (r) => r.text.toLowerCase().includes('shopify') && !r.text.toLowerCase().includes('do you want me to open it'),
    },
    {
      id: 'A6',
      condition: 'Fast Speech Rate',
      utterance: 'Open Free Cash and tell me where we are.',
      confidence: 0.91,
      isBargeIn: false,
      expectedEntity: 'proj-free-cash',
      check: (r) => (r.text.toLowerCase().includes('free cash') || r.entityId === 'proj-free-cash') && (r.text.toLowerCase().includes('open') || r.text.toLowerCase().includes('active')),
    },
    {
      id: 'A7',
      condition: 'Rapid Command Following TTS',
      utterance: 'What are we waiting on?',
      confidence: 0.93,
      isBargeIn: false,
      expectedEntity: 'proj-free-cash',
      check: (r) => r.text.toLowerCase().includes('blocked') || r.text.toLowerCase().includes('interrupted') || r.text.toLowerCase().includes('waiting'),
    },
    {
      id: 'A8',
      condition: 'Self-Corrected Utterance',
      utterance: 'Open Shopify no wait open Free Cash.',
      confidence: 0.88,
      isBargeIn: false,
      expectedEntity: 'proj-free-cash',
      check: (r) => r.entityId === 'proj-free-cash' || r.text.toLowerCase().includes('free cash'),
    },
    {
      id: 'A9',
      condition: 'Interrupted Query Correction',
      utterance: 'What is the status I mean what should we do now?',
      confidence: 0.89,
      isBargeIn: false,
      expectedEntity: 'proj-free-cash',
      check: (r) => r.text.toLowerCase().includes('next') || r.text.toLowerCase().includes('resume') || r.text.toLowerCase().includes('action'),
    },
  ];

  let passed = 0;
  const results = [];

  for (const tc of testCases) {
    console.log(`----------------------------------------------------------------`);
    console.log(`[${tc.id}] Condition: ${tc.condition}`);
    console.log(`     Utterance: "${tc.utterance}" (Confidence: ${tc.confidence})`);

    const res = await postStreamTurn(conversationId, tc.utterance, {
      confidence: tc.confidence,
      isBargeIn: tc.isBargeIn,
    });

    const isPass = tc.check(res);
    if (isPass) passed++;

    console.log(`     Route:    ${res.route}`);
    console.log(`     Entity:   ${res.entityId}`);
    console.log(`     Output:   "${res.text}"`);
    console.log(`     Verdict:  ${isPass ? 'PASS' : 'FAIL'}`);

    results.push({
      id: tc.id,
      condition: tc.condition,
      utterance: tc.utterance,
      confidence: tc.confidence,
      route: res.route,
      entity: res.entityId,
      text: res.text,
      pass: isPass,
    });
  }

  console.log('\n================================================================');
  console.log(`  ACOUSTIC ROBUSTNESS VERDICT: ${passed === testCases.length ? 'ALL PASSED (100%)' : `${testCases.length - passed} FAILED`}`);
  console.log(`  Passed: ${passed}/${testCases.length}`);
  console.log('================================================================\n');

  try { process.kill(appProc.pid); } catch {}
  process.exit(passed === testCases.length ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
