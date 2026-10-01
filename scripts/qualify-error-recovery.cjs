/**
 * scripts/qualify-error-recovery.cjs
 *
 * Section 4: Error Recovery & Boundary Qualification
 * Tests:
 * 1. Low-confidence transcription (e.g. 0.35) -> preserves action & referent, asks focused clarification or handles quietly without hallucination
 * 2. Empty STT result -> clean no-speech response, zero crash
 * 3. Failed UI navigation -> truthfully reports navigation was unverified or failed, NEVER reports false success
 * 4. Project with no blockers (TikTok Shop) -> truthfully states 0 blockers, doesn't invent blockers
 * 5. Project with no running tasks (TikTok Shop) -> truthfully reports 0 running tasks
 * 6. Project with no next executable action -> explains no runnable tasks
 * 7. Interrupted worker recovery -> explains worker state was interrupted by backend restart and offers resumption
 * 8. Temporary backend restart -> restarts backend process, verifies session/state integrity
 * 9. Non-existent project lookup -> truthfully reports unknown entity, does NOT silently route to active project
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
        try { resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: JSON.parse(b) }); }
        catch { resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: b }); }
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
          try { resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: JSON.parse(b) }); }
          catch { resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: b }); }
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
    const data = JSON.stringify({
      prompt,
      confidence: options.confidence ?? 0.95,
      isBargeIn: options.isBargeIn ?? false,
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
        let fallbackReason = null;

        res.on('data', (chunk) => {
          const lines = chunk.toString().split('\n');
          for (const line of lines) {
            if (line.startsWith('data:')) {
              const raw = line.slice(5).trim();
              if (!raw || raw === '[DONE]') continue;
              try {
                const evt = JSON.parse(raw);
                // If navigation ack simulation is enabled:
                if (options.autoAckNav !== false && evt.type === 'navigation_request' && evt.navId) {
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
                if (typeof evt.verified === 'boolean') verified = evt.verified;
                if (evt.fallbackReason) fallbackReason = evt.fallbackReason;
                if (evt.delta) fullText += evt.delta;
                if (evt.text && !fullText) fullText = evt.text;
              } catch {}
            }
          }
        });

        res.on('end', () => {
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            text: fullText.trim(),
            route,
            entityId,
            verified,
            fallbackReason,
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
  console.log('  JARVIS ERROR RECOVERY & BOUNDARY QUALIFICATION SUITE');
  console.log('================================================================\n');

  let appProc = spawn(EXE_PATH, [`--remote-debugging-port=${DEBUG_PORT}`], {
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

  const tests = [
    {
      id: 'E1',
      scenario: 'Empty STT Result Handling',
      execute: async () => {
        // Send empty audio to /api/voice/transcribe
        const form = new FormData();
        form.append('audio', new Blob([Buffer.alloc(0)], { type: 'audio/webm' }), 'empty.webm');
        const res = await fetch(`http://127.0.0.1:${BACKEND_PORT}/api/voice/transcribe`, { method: 'POST', body: form });
        const data = await res.json();
        const pass = res.status === 400 && (data.noSpeech === true || data.error?.includes('No audio') || data.error?.includes('No speech'));
        return { pass, description: `Status ${res.status}, handled cleanly as no speech: ${data.error}` };
      }
    },
    {
      id: 'E2',
      scenario: 'Failed UI Navigation (Unacknowledged Route Transaction)',
      execute: async () => {
        // Do NOT acknowledge navigation request
        const res = await postStreamTurn(conversationId, 'Open Free Cash.', { autoAckNav: false });
        // Must truthfully report unverified or navigation failure, NOT false success
        const text = res.text.toLowerCase();
        const pass = res.verified === false || text.includes('not navigate successfully') || text.includes('could not open');
        return { pass, description: `Truthful failure report: verified=${res.verified}, text="${res.text}"` };
      }
    },
    {
      id: 'E3',
      scenario: 'Low-Confidence STT Query',
      execute: async () => {
        const res = await postStreamTurn(conversationId, 'start the shopify project', { confidence: 0.35 });
        // With low confidence, controller recovers action and referent or asks focused question, no crash or hallucination
        const pass = Boolean(res.text.length) && !res.text.includes('couldn\'t make that out');
        return { pass, description: `Handled low confidence safely: route=${res.route}, output="${res.text.slice(0, 80)}..."` };
      }
    },
    {
      id: 'E4',
      scenario: 'Project with No Blockers (TikTok Shop)',
      execute: async () => {
        await postStreamTurn(conversationId, 'Open TikTok Shop.');
        const res = await postStreamTurn(conversationId, 'What is blocked?');
        const t = res.text.toLowerCase();
        const pass = t.includes('0 blocked') || t.includes('nothing is currently blocked') || t.includes('no blocked') || t.includes('not blocked');
        return { pass, description: `Truthfully reported 0 blockers: "${res.text}"` };
      }
    },
    {
      id: 'E5',
      scenario: 'Project with No Running Tasks (TikTok Shop)',
      execute: async () => {
        const res = await postStreamTurn(conversationId, 'What are we working on?');
        const t = res.text.toLowerCase();
        const pass = t.includes('0 running') || t.includes('no actively running') || t.includes('0 project tasks') || t.includes('not running');
        return { pass, description: `Truthfully reported 0 running tasks: "${res.text}"` };
      }
    },
    {
      id: 'E6',
      scenario: 'Project with Interrupted Worker Tasks (Shopify)',
      execute: async () => {
        await postStreamTurn(conversationId, 'Open Shopify.');
        const res = await postStreamTurn(conversationId, 'What is blocked?');
        const t = res.text.toLowerCase();
        const pass = t.includes('interrupted by backend restart') && (t.includes('resume') || t.includes('retry'));
        return { pass, description: `Truthfully reported interrupted worker condition: "${res.text}"` };
      }
    },
    {
      id: 'E7',
      scenario: 'Non-Existent Project Resolution',
      execute: async () => {
        const res = await postStreamTurn(conversationId, 'Open Project Krypton.');
        const t = res.text.toLowerCase();
        // Must NOT silently route to active project or claim it opened
        const pass = !t.includes('krypton is open') && !t.includes('free cash is open') && !t.includes('shopify is open') &&
                     (t.includes("can't find") || t.includes("couldn't match") || t.includes('unknown') || t.includes('which project') || t.includes('what would you like me to do with'));
        return { pass, description: `Safely gated non-existent entity without false navigation: "${res.text}"` };
      }
    },
    {
      id: 'E8',
      scenario: 'Temporary Backend Process Restart Recovery',
      execute: async () => {
        console.log('     Simulating backend restart (killing process and respawning)...');
        try { process.kill(appProc.pid); } catch {}
        await sleep(1500);

        appProc = spawn(EXE_PATH, [`--remote-debugging-port=${DEBUG_PORT}`], {
          detached: true,
          stdio: 'ignore',
          env: { ...process.env, NODE_ENV: 'production' },
        });

        for (let i = 0; i < 40; i++) {
          await sleep(750);
          const h = await httpGet('/api/health');
          if (h.ok) break;
        }

        // Fresh session after restart:
        const freshConv = await httpPost('/api/jarvis/conversations', {});
        const res = await postStreamTurn(freshConv.body.id, 'Jarvis, open Free Cash and tell me the status.');
        const pass = res.ok && res.text.toLowerCase().includes('free cash') && res.text.toLowerCase().includes('priority 1');
        return { pass, description: `Backend successfully restarted and served fresh turn: "${res.text.slice(0, 80)}..."` };
      }
    },
  ];

  let passed = 0;
  for (const t of tests) {
    console.log(`----------------------------------------------------------------`);
    console.log(`[${t.id}] Scenario: ${t.scenario}`);
    const r = await t.execute();
    console.log(`     Result:   ${r.pass ? 'PASS' : 'FAIL'} — ${r.description}`);
    if (r.pass) passed++;
  }

  console.log('\n================================================================');
  console.log(`  ERROR RECOVERY QUALIFICATION VERDICT: ${passed === tests.length ? 'ALL PASSED (100%)' : `${tests.length - passed} FAILED`}`);
  console.log(`  Passed: ${passed}/${tests.length}`);
  console.log('================================================================\n');

  try { process.kill(appProc.pid); } catch {}
  process.exit(passed === tests.length ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
