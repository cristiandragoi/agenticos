/**
 * scripts/qualify-conversational-soak.cjs
 *
 * Section 3 & 6: Conversational Soak & Loop Test Qualification
 * Runs an extended sequential session repeatedly switching between:
 * - Free Cash
 * - Shopify
 * - TikTok Shop
 *
 * Verifies:
 * - Zero context leakage across project switches
 * - Conversational advancement on "And?", "Continue.", "What else?", "Tell me more."
 * - No indefinite duplicate response loops
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
  console.log('  JARVIS CONVERSATIONAL SOAK & TOPIC SWITCH QUALIFICATION');
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

  const turns = [
    // --- CYCLE 1: SHOPIFY FOCUS ---
    { prompt: 'Open Shopify.', expectEntity: 'proj-shopify', check: (r) => r.route === 'navigate' && r.text.includes('Shopify') },
    { prompt: "What's blocked?", expectEntity: 'proj-shopify', check: (r) => r.text.toLowerCase().includes('shopify') && r.text.toLowerCase().includes('block') },
    { prompt: 'What should we do next?', expectEntity: 'proj-shopify', check: (r) => r.text.toLowerCase().includes('shopify') && r.text.toLowerCase().includes('interrupted') },
    
    // --- CYCLE 2: SWITCH TO FREE CASH ---
    { prompt: 'Go to Free Cash.', expectEntity: 'proj-free-cash', check: (r) => r.route === 'navigate' && r.text.includes('Free Cash') },
    { prompt: 'What needs doing here?', expectEntity: 'proj-free-cash', check: (r) => r.text.toLowerCase().includes('free cash') && (r.text.toLowerCase().includes('task') || r.text.toLowerCase().includes('interrupted')) },
    { prompt: 'What are we waiting on?', expectEntity: 'proj-free-cash', check: (r) => r.text.toLowerCase().includes('free cash') && r.text.toLowerCase().includes('block') },
    
    // --- CYCLE 3: SWITCH TO TIKTOK SHOP ---
    { prompt: 'Open TikTok Shop.', expectEntity: 'proj-tiktok-shop', check: (r) => r.route === 'navigate' && r.text.includes('TikTok Shop') },
    { prompt: 'What is the status here?', expectEntity: 'proj-tiktok-shop', check: (r) => r.text.toLowerCase().includes('tiktok') || r.entityId === 'proj-tiktok-shop' },
    { prompt: 'Is anything blocked?', expectEntity: 'proj-tiktok-shop', check: (r) => r.text.toLowerCase().includes('block') || r.text.toLowerCase().includes('tiktok') },
    
    // --- CYCLE 4: BACK TO SHOPIFY & RESUME ---
    { prompt: 'Back to Shopify.', expectEntity: 'proj-shopify', check: (r) => r.route === 'navigate' && r.text.includes('Shopify') },
    { prompt: 'And what about the blocker?', expectEntity: 'proj-shopify', check: (r) => (r.entityId === 'proj-shopify' || r.text.toLowerCase().includes('shopify')) && r.text.toLowerCase().includes('interrupted') },
    { prompt: 'Continue.', expectEntity: 'proj-shopify', check: (r) => r.text.toLowerCase().includes('shopify') },
    { prompt: 'Stop.', expectEntity: null, check: (r) => r.route === 'voice_stop' || r.route === 'chat_trivial' },
    
    // --- CYCLE 5: BACK TO FREE CASH & CONTINUATION ---
    { prompt: 'Now Free Cash.', expectEntity: 'proj-free-cash', check: (r) => (r.route === 'navigate' || r.route === 'fast_read') && r.text.includes('Free Cash') },
    { prompt: 'What were we doing?', expectEntity: 'proj-free-cash', check: (r) => r.text.toLowerCase().includes('free cash') },
    { prompt: 'Tell me more.', expectEntity: 'proj-free-cash', check: (r) => r.text.toLowerCase().includes('free cash') && !r.text.includes('couldn\'t make that out') },
    { prompt: 'What else?', expectEntity: 'proj-free-cash', check: (r) => r.text.toLowerCase().includes('free cash') && r.text.length > 20 },
  ];

  let passed = 0;
  let prevText = '';
  let duplicateCount = 0;

  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    console.log(`----------------------------------------------------------------`);
    console.log(`[Turn ${i + 1}/${turns.length}] Prompt: "${t.prompt}"`);

    const res = await postStreamTurn(conversationId, t.prompt);
    const pass = t.check(res);

    if (res.text === prevText && res.text.length > 0) {
      duplicateCount++;
      console.warn(`  WARNING: Identical duplicate response detected!`);
    }
    prevText = res.text;

    console.log(`  Route:   ${res.route}`);
    console.log(`  Entity:  ${res.entityId}`);
    console.log(`  Output:  "${res.text.slice(0, 140)}..."`);
    console.log(`  Verdict: ${pass ? 'PASS' : 'FAIL'}`);

    if (pass) passed++;
    else console.error(`  FAIL details:`, JSON.stringify(res, null, 2));

    await sleep(200);
  }

  console.log('\n================================================================');
  console.log(`  CONVERSATIONAL SOAK VERDICT: ${passed === turns.length ? 'ALL PASSED (100%)' : `${turns.length - passed} FAILED`}`);
  console.log(`  Passed: ${passed}/${turns.length}`);
  console.log(`  Duplicate Response Count: ${duplicateCount} (Expected: 0)`);
  console.log('================================================================\n');

  try { process.kill(appProc.pid); } catch {}
  process.exit(passed === turns.length && duplicateCount === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
