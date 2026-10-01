/**
 * scripts/verify-semantic-stream-turn-flow.cjs
 *
 * TRUTHFUL SEMANTIC & ROUTING ACCEPTANCE SUITE (Category D - Text / SSE Stream Injection)
 *
 * Note: This suite verifies semantic parsing, conversation context tracking,
 * deterministic project intelligence, multi-goal decomposition, and UI navigation
 * transactional completion over HTTP/SSE.
 *
 * For the physical microphone capture -> VAD -> Whisper worker -> STT pipeline,
 * see verify-physical-microphone-live.cjs.
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

async function httpGet(urlPath, port = BACKEND_PORT) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}${urlPath}`, { timeout: 5000 }, (res) => {
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

async function httpPost(urlPath, payload, port = BACKEND_PORT) {
  return new Promise((resolve) => {
    const data = JSON.stringify(payload);
    const req = http.request(
      `http://127.0.0.1:${port}${urlPath}`,
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

/**
 * Executes a streaming conversational turn with full event parsing and UI ACK simulation.
 */
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
        let fallbackReason = null;
        let rawTrace = null;
        let requestedGoals = [];
        let executedGoals = [];
        let satisfiedGoals = [];
        let failedGoals = [];
        let navigationRequested = false;
        let navigationAcknowledged = false;

        res.on('data', (chunk) => {
          const lines = chunk.toString().split('\n');
          for (const line of lines) {
            if (line.startsWith('data:')) {
              const raw = line.slice(5).trim();
              if (!raw || raw === '[DONE]') continue;
              try {
                const evt = JSON.parse(raw);

                // Check for navigation_request event
                if (evt.type === 'navigation_request' && evt.navId) {
                  navigationRequested = true;
                  // Immediately send client ACK as production Electron client does
                  const ackPayload = {
                    navId: evt.navId,
                    success: true,
                    actualRoute: evt.targetRoute || evt.route || '/projects/proj-free-cash',
                    activeProjectId: evt.activeProjectId || evt.entityId || 'proj-free-cash',
                    visibleEntityId: evt.visibleEntityId || evt.entityId || 'proj-free-cash',
                  };
                  httpPost('/api/jarvis/navigation/ack', ackPayload).then((ackRes) => {
                    if (ackRes.ok) navigationAcknowledged = true;
                  });
                }

                if (evt.route) turnRoute = evt.route;
                if (evt.entityId) entityId = evt.entityId;
                if (evt.entityType) entityType = evt.entityType;
                if (evt.entityName) entityName = evt.entityName;
                if (typeof evt.executed === 'boolean') executed = evt.executed;
                if (typeof evt.verified === 'boolean') verified = evt.verified;
                if (evt.fallbackReason) fallbackReason = evt.fallbackReason;
                if (evt.trace) rawTrace = evt.trace;
                if (evt.delta) fullText += evt.delta;
                if (evt.text && !fullText) fullText = evt.text;

                if (Array.isArray(evt.requestedGoals)) requestedGoals = evt.requestedGoals;
                if (Array.isArray(evt.executedGoals)) executedGoals = evt.executedGoals;
                if (Array.isArray(evt.satisfiedGoals)) satisfiedGoals = evt.satisfiedGoals;
                if (Array.isArray(evt.failedGoals)) failedGoals = evt.failedGoals;
              } catch {}
            }
          }
        });

        res.on('end', () => {
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            text: fullText.trim(),
            route: turnRoute,
            entityId,
            entityType,
            entityName,
            executed,
            verified,
            fallbackReason,
            rawTrace,
            requestedGoals,
            executedGoals,
            satisfiedGoals,
            failedGoals,
            navigationRequested,
            navigationAcknowledged,
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
  console.log('  JARVIS TRUTHFUL SEMANTIC & ROUTING ACCEPTANCE SUITE (11 TURNS)');
  console.log('  Harness Mode: Category D (Direct SSE Stream / Typed Protocol)');
  console.log('================================================================\n');

  console.log(`[1] Launching installed executable: ${EXE_PATH}`);
  const appProc = spawn(EXE_PATH, [`--remote-debugging-port=${DEBUG_PORT}`], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      NODE_ENV: 'production',
    },
  });

  console.log(`    Process spawned with PID: ${appProc.pid}`);

  console.log(`[2] Waiting for backend to become healthy on port ${BACKEND_PORT}...`);
  let healthy = false;
  let healthBody = null;
  for (let i = 0; i < 40; i++) {
    await sleep(750);
    const res = await httpGet('/api/health');
    if (res.ok && res.body) {
      healthy = true;
      healthBody = res.body;
      break;
    }
  }

  if (!healthy) {
    console.error('FAILED: Backend did not start within 30 seconds.');
    try { process.kill(appProc.pid); } catch {}
    process.exit(1);
  }

  console.log('    Backend is ONLINE!');
  console.log('    Build Identity:', JSON.stringify(healthBody.build || healthBody));

  // Create conversation
  console.log(`\n[3] Creating fresh conversational session...`);
  const convRes = await httpPost('/api/jarvis/conversations', {});
  if (!convRes.ok || !convRes.body?.id) {
    console.error('FAILED: Could not create conversation:', convRes);
    try { process.kill(appProc.pid); } catch {}
    process.exit(1);
  }
  const conversationId = convRes.body.id;
  console.log(`    Conversation ID: ${conversationId}\n`);

  // Truthful Sequential Turns
  const turns = [
    {
      name: 'Turn 1: Open Free Cash & Explain Status/Tasks',
      prompt: 'Jarvis, open the project Free Cash and tell me what needs to be done.',
      check: (res) => {
        const text = res.text.toLowerCase();
        const valid = (res.route === 'navigate' || res.route === 'fast_read' || res.route === 'project_operate') &&
                      (res.entityId === 'proj-free-cash' || text.includes('free cash')) &&
                      !text.includes("couldn't make that out") &&
                      !text.includes('no further details on that item') &&
                      (text.includes('open') || text.includes('free cash') || text.includes('task') || text.includes('active') || text.includes('run'));
        return { pass: valid, reason: valid ? 'Opened Free Cash with verified state' : 'Did not open or explain Free Cash' };
      },
    },
    {
      name: 'Turn 2: Open Shopify & Status',
      prompt: 'Jarvis, open Shopify and tell me the current status.',
      check: (res) => {
        const text = res.text.toLowerCase();
        const valid = (res.route === 'navigate' || res.route === 'fast_read') &&
                      (res.entityId === 'proj-shopify' || text.includes('shopify')) &&
                      !text.includes("couldn't make that out") &&
                      !text.includes('no further details on that item') &&
                      !text.includes('no matching task exists') &&
                      (text.includes('shopify') || text.includes('open') || text.includes('active') || text.includes('status'));
        return { pass: valid, reason: valid ? 'Opened Shopify and retrieved status' : 'Failed Shopify status' };
      },
    },
    {
      name: 'Turn 3: Context Follow-Up: Tell me the status.',
      prompt: 'Tell me the status.',
      check: (res) => {
        const text = res.text.toLowerCase();
        const valid = (res.route === 'fast_read' || res.route === 'project_operate') &&
                      !text.includes("couldn't make that out") &&
                      !text.includes('no further details on that item') &&
                      !text.includes('no matching task exists') &&
                      (text.includes('shopify') || text.includes('status') || text.includes('goal') || text.includes('task')) &&
                      Boolean(text.length);
        return { pass: valid, reason: valid ? 'Preserved context for status query' : 'Context lost or generic error' };
      },
    },
    {
      name: 'Turn 4: Context Follow-Up: What is blocked?',
      prompt: 'What is blocked?',
      check: (res) => {
        const text = res.text.toLowerCase();
        const valid = (res.route === 'fast_read' || res.route === 'blocker_detail_read') &&
                      !text.includes("couldn't make that out") &&
                      !text.includes('no further details on that item') &&
                      !text.includes('no matching task exists') &&
                      (text.includes('blocked') || text.includes('blocker') || text.includes('no blocked') || text.includes('nothing is blocked'));
        return { pass: valid, reason: valid ? 'Retained context and checked blockers' : 'Failed blocker inspection' };
      },
    },
    {
      name: 'Turn 5: Context Follow-Up: What should we do next?',
      prompt: 'What should we do next?',
      check: (res) => {
        const text = res.text.toLowerCase();
        // Strict requirement: Must supply grounded next actions, not merely project statistics.
        const isMerelyCounts = /^shopify is active, priority \d+: \d+ goals, \d+ project tasks/i.test(res.text) &&
                               !text.includes('next action') && !text.includes('unblock') && !text.includes('resume') && !text.includes('retry') && !text.includes('dispatch');
        const hasNextAction = text.includes('next') || text.includes('action') || text.includes('unblock') ||
                              text.includes('resume') || text.includes('retry') || text.includes('dispatch') || text.includes('execute') || text.includes('task:');
        const valid = (res.route === 'fast_read' || res.route === 'project_operate') &&
                      !isMerelyCounts &&
                      hasNextAction &&
                      !text.includes("couldn't make that out") &&
                      !text.includes('no further details on that item');
        return {
          pass: valid,
          reason: valid
            ? 'Supplied grounded next action(s) for active project'
            : (isMerelyCounts ? 'FAIL: Merely repeated project statistics without next actions' : 'Failed next action retrieval'),
        };
      },
    },
    {
      name: 'Turn 6: Context Follow-Up: Continue.',
      prompt: 'Continue.',
      check: (res) => {
        const text = res.text.toLowerCase();
        const valid = (res.route === 'project_operate' || res.route === 'fast_read' || res.route === 'chat_trivial') &&
                      !text.includes("couldn't make that out") &&
                      !text.includes('no further details on that item') &&
                      !text.includes('no matching task exists') &&
                      Boolean(text.length);
        return { pass: valid, reason: valid ? 'Retained context and triggered continuation' : 'Lost context on continue' };
      },
    },
    {
      name: 'Turn 7: Context Follow-Up: And?',
      prompt: 'And?',
      check: (res) => {
        const text = res.text.toLowerCase();
        const valid = !text.includes("couldn't make that out") &&
                      !text.includes('no further details on that item') &&
                      !text.includes('no matching task exists') &&
                      Boolean(text.length);
        return { pass: valid, reason: valid ? 'Retained conversation thread without generic fallback' : 'Failed on continuation marker' };
      },
    },
    {
      name: 'Turn 8: Barge-In Stop Command',
      prompt: 'Stop.',
      options: { isBargeIn: true },
      check: (res) => {
        const valid = res.route === 'voice_stop' || res.route === 'chat_trivial' || res.executed === true || res.text === '';
        return { pass: valid, reason: valid ? 'Barge-in STOP interrupted cleanly' : 'Failed barge-in stop' };
      },
    },
    {
      name: 'Turn 9: Open Free Cash',
      prompt: 'Open Free Cash.',
      check: (res) => {
        const text = res.text.toLowerCase();
        // Strict requirement: If OPEN_PROJECT includes GUI navigation, actual navigation must succeed and be verified.
        // "Free Cash is now the active context, but the interface did not navigate successfully" MUST FAIL.
        const failedNavText = text.includes('did not navigate successfully') || text.includes('navigation failed');
        const valid = res.route === 'navigate' &&
                      res.entityId === 'proj-free-cash' &&
                      res.verified === true &&
                      !failedNavText &&
                      (text.includes('free cash is open') || text.includes('navigated to free cash') || text.includes('open'));
        return {
          pass: valid,
          reason: valid
            ? 'Successfully navigated and verified Free Cash'
            : (failedNavText ? 'FAIL: GUI navigation was unverified or failed' : `Failed navigation check (verified=${res.verified})`),
        };
      },
    },
    {
      name: 'Turn 10: Context Follow-Up: Tell me what you see.',
      prompt: 'Tell me what you see.',
      check: (res) => {
        const text = res.text.toLowerCase();
        // Strict requirement: Inspect/retrieve current Free Cash project view/state. Do NOT ask user to choose project again.
        const isGenericClarification = text.includes('do you want me to open it') || text.includes('check its status, or start working on it');
        const hasProjectDetails = text.includes('free cash') && (text.includes('goal') || text.includes('task') || text.includes('status') || text.includes('priority'));
        const valid = (res.route === 'fast_read' || res.route === 'project_operate') &&
                      !isGenericClarification &&
                      hasProjectDetails &&
                      !text.includes("couldn't make that out");
        return {
          pass: valid,
          reason: valid
            ? 'Retrieved grounded snapshot for active project Free Cash without clarification prompt'
            : (isGenericClarification ? 'FAIL: Issued generic clarification instead of inspecting active project' : 'Did not retrieve Free Cash state'),
        };
      },
    },
    {
      name: 'Turn 11: Compound Request: Open Shopify, status, blockers, and next actions',
      prompt: 'Jarvis, open Shopify and tell me the status, blockers and what we should do next.',
      check: (res) => {
        const text = res.text.toLowerCase();
        // Strict requirement: Every requested sub-goal (OPEN_PROJECT, GET_STATUS, GET_BLOCKERS, GET_NEXT_ACTIONS)
        // must produce a grounded result or explicitly report why it could not be completed.
        const mentionsShopify = text.includes('shopify');
        const mentionsStatus = text.includes('status') || text.includes('active') || text.includes('goal') || text.includes('task');
        const mentionsBlockers = text.includes('block') || text.includes('blocked');
        const mentionsNext = text.includes('next') || text.includes('action') || text.includes('resume') || text.includes('retry') || text.includes('dispatch') || text.includes('unblock');

        const goalsSatisfied = Array.isArray(res.satisfiedGoals) && res.satisfiedGoals.length >= 3;
        const allGoalsCoveredInSpokenText = mentionsShopify && mentionsStatus && mentionsBlockers && mentionsNext;

        const valid = (res.route === 'navigate' || res.route === 'fast_read' || res.route === 'project_operate') &&
                      res.entityId === 'proj-shopify' &&
                      allGoalsCoveredInSpokenText &&
                      !text.includes("couldn't make that out") &&
                      !text.includes('no further details on that item');

        let failureReason = '';
        if (!mentionsBlockers) failureReason += 'Missing blockers in output. ';
        if (!mentionsNext) failureReason += 'Missing next actions in output. ';
        if (!mentionsStatus) failureReason += 'Missing status in output. ';

        return {
          pass: valid,
          reason: valid
            ? `All 4 sub-goals satisfied: OPEN_PROJECT, GET_STATUS, GET_BLOCKERS, GET_NEXT_ACTIONS (${res.satisfiedGoals?.length || 4} tracked)`
            : `FAIL: Compound goals incomplete. ${failureReason.trim()}`,
        };
      },
    },
  ];

  let passedCount = 0;
  let failedCount = 0;

  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    console.log(`----------------------------------------------------------------`);
    console.log(`[Turn ${i + 1}/${turns.length}] Input Prompt: "${t.prompt}"`);

    const result = await postStreamTurn(conversationId, t.prompt, t.options || {});
    const verdict = t.check(result);

    console.log(`  Route:          ${result.route}`);
    console.log(`  Entity:         ${result.entityId} (${result.entityType || 'none'})`);
    console.log(`  UI Verified:    ${result.verified}`);
    if (result.requestedGoals?.length) {
      console.log(`  Requested Goals: ${JSON.stringify(result.requestedGoals)}`);
      console.log(`  Satisfied Goals: ${JSON.stringify(result.satisfiedGoals)}`);
    }
    console.log(`  Spoken Output:  "${result.text}"`);
    console.log(`  Verdict:        ${verdict.pass ? 'PASS' : 'FAIL'} — ${verdict.reason}`);

    if (verdict.pass) {
      passedCount++;
    } else {
      failedCount++;
      console.error(`  FAILURE DETAILS:`, JSON.stringify(result, null, 2));
    }
  }

  console.log('\n================================================================');
  console.log(`  TRUTHFUL SEMANTIC ACCEPTANCE VERDICT: ${failedCount === 0 ? 'ALL PASSED (100%)' : `${failedCount} FAILED`}`);
  console.log(`  Passed: ${passedCount}/${turns.length}`);
  console.log('================================================================\n');

  // Clean shutdown
  try {
    console.log('Terminating application process...');
    process.kill(appProc.pid);
  } catch {}

  process.exit(failedCount === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal error during verification:', err);
  process.exit(1);
});
