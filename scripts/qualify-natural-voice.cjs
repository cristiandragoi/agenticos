/**
 * scripts/qualify-natural-voice.cjs
 *
 * Section 1: Human Unscripted Voice Qualification
 * Tests natural, unscripted conversational variations through the production runtime.
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
    const req = http.get(`http://127.0.0.1:${BACKEND_PORT}${urlPath}`, { timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: JSON.parse(body) }); }
        catch { resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body }); }
      });
    });
    req.on('error', (err) => resolve({ ok: false, error: err.message }));
  });
}

async function httpPost(urlPath, payload) {
  return new Promise((resolve) => {
    const data = JSON.stringify(payload);
    const req = http.request(
      `http://127.0.0.1:${BACKEND_PORT}${urlPath}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
        timeout: 15000,
      },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          try { resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: JSON.parse(body) }); }
          catch { resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body }); }
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
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
        timeout: 30000,
      },
      (res) => {
        let fullText = '';
        let turnRoute = null;
        let entityId = null;
        let entityType = null;
        let entityName = null;
        let executed = null;
        let verified = null;
        let requestedGoals = [];
        let satisfiedGoals = [];
        let failedGoals = [];

        res.on('data', (chunk) => {
          const lines = chunk.toString().split('\n');
          for (const line of lines) {
            if (line.startsWith('data:')) {
              const raw = line.slice(5).trim();
              if (!raw || raw === '[DONE]') continue;
              try {
                const evt = JSON.parse(raw);

                if (evt.type === 'navigation_request' && evt.navId) {
                  const ackPayload = {
                    navId: evt.navId,
                    success: true,
                    actualRoute: evt.targetRoute || evt.route || '/projects/proj-free-cash',
                    activeProjectId: evt.activeProjectId || evt.entityId || 'proj-free-cash',
                    visibleEntityId: evt.visibleEntityId || evt.entityId || 'proj-free-cash',
                  };
                  httpPost('/api/jarvis/navigation/ack', ackPayload);
                }

                if (evt.route) turnRoute = evt.route;
                if (evt.entityId) entityId = evt.entityId;
                if (evt.entityType) entityType = evt.entityType;
                if (evt.entityName) entityName = evt.entityName;
                if (typeof evt.executed === 'boolean') executed = evt.executed;
                if (typeof evt.verified === 'boolean') verified = evt.verified;
                if (evt.delta) fullText += evt.delta;
                if (evt.text && !fullText) fullText = evt.text;

                if (Array.isArray(evt.requestedGoals)) requestedGoals = evt.requestedGoals;
                if (Array.isArray(evt.satisfiedGoals)) satisfiedGoals = evt.satisfiedGoals;
                if (Array.isArray(evt.failedGoals)) failedGoals = evt.failedGoals;
              } catch {}
            }
          }
        });

        res.on('end', () => {
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            text: fullText.trim(),
            route: turnRoute,
            entityId,
            entityType,
            entityName,
            executed,
            verified,
            requestedGoals,
            satisfiedGoals,
            failedGoals,
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
  console.log('  JARVIS NATURAL UNSCRIPTED VOICE QUALIFICATION (14 TURNS)');
  console.log('================================================================\n');

  console.log(`[1] Launching installed executable: ${EXE_PATH}`);
  const appProc = spawn(EXE_PATH, [`--remote-debugging-port=${DEBUG_PORT}`], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, NODE_ENV: 'production' },
  });

  console.log(`    Process spawned with PID: ${appProc.pid}`);

  console.log(`[2] Waiting for backend to become healthy on port ${BACKEND_PORT}...`);
  let healthy = false;
  for (let i = 0; i < 40; i++) {
    await sleep(750);
    const res = await httpGet('/api/health');
    if (res.ok && res.body) {
      healthy = true;
      break;
    }
  }

  if (!healthy) {
    console.error('FAILED: Backend did not start within 30 seconds.');
    try { process.kill(appProc.pid); } catch {}
    process.exit(1);
  }
  console.log('    Backend is ONLINE!\n');

  console.log(`[3] Creating fresh conversational session...`);
  const convRes = await httpPost('/api/jarvis/conversations', {});
  const conversationId = convRes.body.id;
  console.log(`    Conversation ID: ${conversationId}\n`);

  const variations = [
    {
      turn: 1,
      prompt: "Jarvis, what's happening with Shopify?",
      eval: (r) => {
        const t = r.text.toLowerCase();
        const valid = t.includes('shopify') && (t.includes('goal') || t.includes('task') || t.includes('active') || t.includes('running'));
        return { pass: valid, intent: 'Inspect Shopify status & activities' };
      }
    },
    {
      turn: 2,
      prompt: "Open Free Cash and tell me where we are.",
      eval: (r) => {
        const t = r.text.toLowerCase();
        const valid = (t.includes('free cash') || r.entityId === 'proj-free-cash') && (t.includes('open') || t.includes('goal') || t.includes('task') || t.includes('active'));
        return { pass: valid, intent: 'Navigate Free Cash & describe progress' };
      }
    },
    {
      turn: 3,
      prompt: "What are we waiting on?",
      eval: (r) => {
        const t = r.text.toLowerCase();
        const valid = (t.includes('blocked') || t.includes('blocker') || t.includes('waiting') || t.includes('no blocked') || t.includes('credentials'));
        return { pass: valid, intent: 'Inspect blockers & waiting conditions' };
      }
    },
    {
      turn: 4,
      prompt: "So what do you suggest we do now?",
      eval: (r) => {
        const t = r.text.toLowerCase();
        const valid = (t.includes('next') || t.includes('action') || t.includes('resume') || t.includes('retry') || t.includes('dispatch') || t.includes('unblock') || t.includes('task'));
        return { pass: valid, intent: 'Grounded next action advice' };
      }
    },
    {
      turn: 5,
      prompt: "Okay, carry on.",
      eval: (r) => {
        const t = r.text.toLowerCase();
        const valid = Boolean(t.length) && !t.includes("couldn't make that out");
        return { pass: valid, intent: 'Continuation acknowledgment' };
      }
    },
    {
      turn: 6,
      prompt: "What else?",
      eval: (r) => {
        const t = r.text.toLowerCase();
        const valid = Boolean(t.length) && !t.includes("couldn't make that out");
        return { pass: valid, intent: 'Advance conversational context' };
      }
    },
    {
      turn: 7,
      prompt: "Go back to Shopify.",
      eval: (r) => {
        const t = r.text.toLowerCase();
        const valid = (t.includes('shopify') || r.entityId === 'proj-shopify') && (t.includes('open') || t.includes('active') || r.route === 'navigate' || r.route === 'fast_read');
        return { pass: valid, intent: 'Switch context back to Shopify' };
      }
    },
    {
      turn: 8,
      prompt: "What's stopping us there?",
      eval: (r) => {
        const t = r.text.toLowerCase();
        const valid = (t.includes('shopify') || r.entityId === 'proj-shopify') && (t.includes('blocked') || t.includes('blocker') || t.includes('interrupted'));
        return { pass: valid, intent: 'Inspect Shopify blockers' };
      }
    },
    {
      turn: 9,
      prompt: "Can you continue that?",
      eval: (r) => {
        const t = r.text.toLowerCase();
        const valid = Boolean(t.length) && !t.includes("couldn't make that out");
        return { pass: valid, intent: 'Resume / continue task thread' };
      }
    },
    {
      turn: 10,
      prompt: "Stop.",
      eval: (r) => {
        const valid = r.route === 'voice_stop' || r.route === 'chat_trivial' || r.text === '';
        return { pass: valid, intent: 'Clean barge-in cancellation' };
      }
    },
    {
      turn: 11,
      prompt: "Jarvis stop.",
      eval: (r) => {
        const valid = r.route === 'voice_stop' || r.route === 'chat_trivial' || r.text === '';
        return { pass: valid, intent: 'Named barge-in cancellation' };
      }
    },
    {
      turn: 12,
      prompt: "Shut up.",
      eval: (r) => {
        const valid = r.route === 'voice_stop' || r.route === 'chat_trivial' || r.text === '';
        return { pass: valid, intent: 'Forceful interruption' };
      }
    },
    {
      turn: 13,
      prompt: "Open Free Cash again.",
      eval: (r) => {
        const t = r.text.toLowerCase();
        const valid = (t.includes('free cash') || r.entityId === 'proj-free-cash') && (t.includes('open') || r.route === 'navigate' || r.route === 'fast_read');
        return { pass: valid, intent: 'Re-open Free Cash project' };
      }
    },
    {
      turn: 14,
      prompt: "What do you see there?",
      eval: (r) => {
        const t = r.text.toLowerCase();
        const isClarification = t.includes('do you want me to open it') || t.includes('check its status');
        const valid = !isClarification && (t.includes('free cash') || t.includes('goal') || t.includes('task') || t.includes('priority'));
        return { pass: valid, intent: 'Grounded view of active project' };
      }
    },
  ];

  let passed = 0;
  let failed = 0;
  const results = [];

  for (const v of variations) {
    console.log(`----------------------------------------------------------------`);
    console.log(`[Turn ${v.turn}/14] Spoken: "${v.prompt}"`);

    const res = await postStreamTurn(conversationId, v.prompt);
    const evaluation = v.eval(res);

    console.log(`  Route:     ${res.route}`);
    console.log(`  Entity:    ${res.entityId}`);
    console.log(`  Output:    "${res.text}"`);
    console.log(`  Verdict:   ${evaluation.pass ? 'PASS' : 'FAIL'} — ${evaluation.intent}`);

    results.push({ turn: v.turn, prompt: v.prompt, route: res.route, entity: res.entityId, text: res.text, pass: evaluation.pass, intent: evaluation.intent });
    if (evaluation.pass) passed++;
    else failed++;
  }

  console.log('\n================================================================');
  console.log(`  NATURAL VOICE QUALIFICATION VERDICT: ${failed === 0 ? 'ALL PASSED (100%)' : `${failed} FAILED`}`);
  console.log(`  Passed: ${passed}/${variations.length}`);
  console.log('================================================================\n');

  try {
    console.log('Terminating application process...');
    process.kill(appProc.pid);
  } catch {}

  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
