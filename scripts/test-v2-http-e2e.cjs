/**
 * test-v2-http-e2e.cjs — Real Multi-Request HTTP E2E Acceptance Test for Jarvis V2.
 *
 * Requirements verified over HTTP against packaged backend (port 4600):
 * 1. Exact natural Free Cash conversation sequence.
 * 2. Reference resolution ("it", "that", "them").
 * 3. State persistence across independent HTTP requests.
 * 4. Safe backend restart between Turn 9 (pending action) and Turn 10 (confirmation).
 * 5. State restoration from SQLite post-restart.
 * 6. Negative tests (no pending action, false rule count claim).
 */

const http = require('http');
const { execSync } = require('child_process');

const BASE_URL = 'http://127.0.0.1:4600';
const convId = `conv-http-e2e-${Date.now()}`;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const bodyStr = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      url,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {})
        },
        timeout: 15000
      },
      res => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      }
    );
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function sendTurn(message) {
  const res = await request('POST', `/api/jarvis-v2/conversations/${convId}/message`, { message });
  if (res.status !== 200) {
    throw new Error(`Turn failed with status ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

async function getState() {
  const res = await request('GET', `/api/jarvis-v2/conversations/${convId}/state`);
  if (res.status !== 200) {
    throw new Error(`Get state failed with status ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

async function waitForHealth(retries = 20, delayMs = 1500) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await request('GET', '/api/health');
      if (res.status === 200) {
        console.log(`[Health] Backend healthy on port 4600 (attempt ${i + 1})`);
        return true;
      }
    } catch {
      // wait and retry
    }
    await sleep(delayMs);
  }
  throw new Error('Backend did not become healthy within timeout.');
}

async function restartBackend() {
  console.log('\n[Restart] Stopping running AgenticOS packaged process...');
  try {
    execSync('powershell.exe -Command "Stop-Process -Name AgenticOS -Force"', { stdio: 'ignore' });
  } catch {}
  await sleep(2000);

  console.log('[Restart] Launching packaged AgenticOS.exe...');
  execSync('powershell.exe -ExecutionPolicy Bypass -File D:\\AgenticOS\\scripts\\launch-detached.ps1', { stdio: 'inherit' });

  console.log('[Restart] Waiting for backend to become healthy...');
  await waitForHealth();
  console.log('[Restart] Backend successfully restarted and verified healthy.\n');
}

async function run() {
  console.log('================================================================');
  console.log(' JARVIS V2 REAL HTTP MULTI-REQUEST E2E ACCEPTANCE TEST');
  console.log(' Conversation ID:', convId);
  console.log('================================================================\n');

  await waitForHealth();

  // ── TURN 1 ────────────────────────────────────────────────────────────────
  console.log('TURN 1: "Let\'s work on Free Cash."');
  const t1 = await sendTurn("Let's work on Free Cash.");
  console.log('Response:', t1.text);
  if (t1.intent !== 'ENTITY_ACTIVATION') throw new Error(`Turn 1 intent expected ENTITY_ACTIVATION, got ${t1.intent}`);
  if (!t1.activeProject?.name.includes('Free Cash')) throw new Error('Turn 1 activeProject mismatch');
  if (!t1.activeEntity?.name.includes('Free Cash')) throw new Error('Turn 1 activeEntity mismatch');
  console.log('✔ Turn 1 PASSED (Entity activated: Free Cash Finance Automation, Priority 1)\n');

  // ── TURN 2 ────────────────────────────────────────────────────────────────
  console.log('TURN 2: "What do you remember about it?"');
  const t2 = await sendTurn('What do you remember about it?');
  console.log('Response:', t2.text);
  if (t2.intent !== 'ENTITY_RECALL') throw new Error(`Turn 2 intent expected ENTITY_RECALL, got ${t2.intent}`);
  if (!t2.text.includes('Free Cash')) throw new Error('Turn 2 text missing Free Cash reference');
  if (!t2.text.includes('Priority 1')) throw new Error('Turn 2 text missing Priority 1');
  console.log('✔ Turn 2 PASSED (Reference "it" resolved directly to Free Cash from state)\n');

  // ── TURN 3 ────────────────────────────────────────────────────────────────
  console.log('TURN 3: "I want to give you a set of instructions you should follow for Free Cash."');
  const t3 = await sendTurn('I want to give you a set of instructions you should follow for Free Cash.');
  console.log('Response:', t3.text);
  if (t3.intent !== 'PREPARE_INSTRUCTIONS') throw new Error(`Turn 3 intent expected PREPARE_INSTRUCTIONS, got ${t3.intent}`);
  if (t3.expectedInput?.type !== 'instruction_set') throw new Error('Turn 3 expectedInput mismatch');
  console.log('✔ Turn 3 PASSED (expectedInput = instruction_set)\n');

  // ── TURN 4 ────────────────────────────────────────────────────────────────
  console.log('TURN 4: "Are you ready?"');
  const t4 = await sendTurn('Are you ready?');
  console.log('Response:', t4.text);
  if (t4.intent !== 'CHECK_READY') throw new Error(`Turn 4 intent expected CHECK_READY, got ${t4.intent}`);
  if (t4.text !== 'Yes. Send the instructions.') throw new Error(`Turn 4 text mismatch: ${t4.text}`);
  console.log('✔ Turn 4 PASSED ("Yes. Send the instructions.")\n');

  // ── TURN 5 ────────────────────────────────────────────────────────────────
  console.log('TURN 5: "Continue them."');
  const t5 = await sendTurn('Continue them.');
  console.log('Response:', t5.text);
  if (t5.intent !== 'CONTINUE_UNSUPPLIED') throw new Error(`Turn 5 intent expected CONTINUE_UNSUPPLIED, got ${t5.intent}`);
  if (!t5.text.includes("I don't have the instruction contents yet. Send them first.")) {
    throw new Error(`Turn 5 text mismatch: ${t5.text}`);
  }
  console.log('✔ Turn 5 PASSED (Truthfully rejected execution without rules)\n');

  // ── TURN 6 ────────────────────────────────────────────────────────────────
  console.log('TURN 6: Supplies 4 numbered instructions');
  const rules = `For Free Cash:
1. No earning action automatically.
2. Check status once per day.
3. Notify me if earnings or account status changes.
4. Human approval before any external action.`;
  const t6 = await sendTurn(rules);
  console.log('Response:', t6.text);
  if (t6.intent !== 'SUPPLY_INSTRUCTIONS') throw new Error(`Turn 6 intent expected SUPPLY_INSTRUCTIONS, got ${t6.intent}`);
  if (t6.expectedInput !== null) throw new Error('Turn 6 expectedInput was not cleared');
  console.log('✔ Turn 6 PASSED (Stored 4 discrete rules, cleared expectedInput)\n');

  // ── TURN 7 ────────────────────────────────────────────────────────────────
  console.log('TURN 7: "Do you have them?"');
  const t7 = await sendTurn('Do you have them?');
  console.log('Response:', t7.text);
  if (t7.intent !== 'VERIFY_INSTRUCTIONS') throw new Error(`Turn 7 intent expected VERIFY_INSTRUCTIONS, got ${t7.intent}`);
  if (!t7.text.includes('1. No earning action automatically.')) throw new Error('Missing rule 1');
  if (!t7.text.includes('2. Check status once per day.')) throw new Error('Missing rule 2');
  if (!t7.text.includes('3. Notify me if earnings or account status changes.')) throw new Error('Missing rule 3');
  if (!t7.text.includes('4. Human approval before any external action.')) throw new Error('Missing rule 4');
  console.log('✔ Turn 7 PASSED (Truthfully retrieved 4 persisted instructions)\n');

  // ── TURN 8 ────────────────────────────────────────────────────────────────
  console.log('TURN 8: "What should we do next?"');
  const t8 = await sendTurn('What should we do next?');
  console.log('Response:', t8.text);
  if (t8.intent !== 'RECOMMEND_NEXT') throw new Error(`Turn 8 intent expected RECOMMEND_NEXT, got ${t8.intent}`);
  if (!t8.text.includes('Hermes')) throw new Error('Turn 8 missing Hermes recommendation');
  console.log('✔ Turn 8 PASSED (Context-aware recommendation formulated)\n');

  // ── TURN 9 ────────────────────────────────────────────────────────────────
  console.log('TURN 9: "Give that to Hermes."');
  const t9 = await sendTurn('Give that to Hermes.');
  console.log('Response:', t9.text);
  if (t9.intent !== 'DELEGATE_WORKER') throw new Error(`Turn 9 intent expected DELEGATE_WORKER, got ${t9.intent}`);
  if (!t9.pendingAction) throw new Error('Turn 9 missing pendingAction');
  if (t9.pendingAction.status !== 'awaiting_confirmation') throw new Error('Turn 9 pendingAction status not awaiting_confirmation');
  if (t9.currentTask !== null) throw new Error('Turn 9 currentTask must be null (premature execution)');
  console.log('✔ Turn 9 PASSED (Pending action created with awaiting_confirmation, not executed)\n');

  // ── BACKEND RESTART BETWEEN TURN 9 AND TURN 10 ────────────────────────────
  console.log('────────────────────────────────────────────────────────────────');
  console.log(' EXECUTING REQUIRED SAFE BACKEND RESTART BEFORE CONFIRMATION');
  console.log('────────────────────────────────────────────────────────────────');
  await restartBackend();

  // Verify SQLite state restoration post-restart
  console.log('Verifying state restoration post-restart via GET /state...');
  const statePostRestart = await getState();
  if (!statePostRestart.activeEntity?.name.includes('Free Cash')) throw new Error('Post-restart activeEntity lost');
  if (!statePostRestart.activeProject?.name.includes('Free Cash')) throw new Error('Post-restart activeProject lost');
  if (statePostRestart.constraints?.length !== 4) throw new Error('Post-restart constraints lost');
  if (!statePostRestart.pendingAction || statePostRestart.pendingAction.status !== 'awaiting_confirmation') {
    throw new Error('Post-restart pendingAction lost or not awaiting_confirmation');
  }
  console.log('✔ State successfully restored from SQLite post-restart:');
  console.log('  - activeEntity:', statePostRestart.activeEntity.name);
  console.log('  - activeProject:', statePostRestart.activeProject.name);
  console.log('  - constraints count:', statePostRestart.constraints.length);
  console.log('  - pendingAction ID:', statePostRestart.pendingAction.id, `(${statePostRestart.pendingAction.status})\n`);

  // ── TURN 10 ───────────────────────────────────────────────────────────────
  console.log('TURN 10: "Yes, proceed." (Executing post-restart)');
  const t10 = await sendTurn('Yes, proceed.');
  console.log('Response:', t10.text);
  if (t10.intent !== 'CONFIRM_ACTION') throw new Error(`Turn 10 intent expected CONFIRM_ACTION, got ${t10.intent}`);
  if (!t10.currentTask?.taskId) throw new Error('Turn 10 missing currentTask taskId');
  if (t10.currentTask.worker !== 'hermes') throw new Error('Turn 10 worker not hermes');
  console.log(`✔ Turn 10 PASSED (Action approved post-restart, Task created: ${t10.currentTask.taskId})\n`);

  // ── TURN 11 ───────────────────────────────────────────────────────────────
  console.log('TURN 11: "What are you doing right now?"');
  const t11 = await sendTurn('What are you doing right now?');
  console.log('Response:', t11.text);
  if (t11.intent !== 'CURRENT_STATUS') throw new Error(`Turn 11 intent expected CURRENT_STATUS, got ${t11.intent}`);
  if (!t11.text.includes(t10.currentTask.taskId)) throw new Error('Turn 11 text missing live task ID');
  console.log('✔ Turn 11 PASSED (Reports live task status truthfully)\n');

  // ── NEGATIVE TEST A ───────────────────────────────────────────────────────
  console.log('NEGATIVE TEST A: Fresh conversation -> "Yes, do it."');
  const freshConv = `conv-fresh-${Date.now()}`;
  const negA = await request('POST', `/api/jarvis-v2/conversations/${freshConv}/message`, { message: 'Yes, do it.' });
  console.log('Response:', negA.body.text);
  if (negA.body.text !== 'There is no pending action waiting for confirmation.') {
    throw new Error(`Negative A mismatch: ${negA.body.text}`);
  }
  console.log('✔ Negative Test A PASSED (Refuses to fabricate action)\n');

  // ── NEGATIVE TEST B ───────────────────────────────────────────────────────
  console.log('NEGATIVE TEST B: "Didn\'t I already give you five rules?"');
  const negB = await sendTurn("Didn't I already give you five rules?");
  console.log('Response:', negB.text);
  if (!negB.text.includes('No, you provided 4 rules for Free Cash Finance Automation, not 5.')) {
    throw new Error(`Negative B mismatch: ${negB.text}`);
  }
  const stateAfterB = await getState();
  if (stateAfterB.constraints.length !== 4) throw new Error('Negative B state was overwritten!');
  console.log('✔ Negative Test B PASSED (Truthfully reports 4 rules, zero state overwrite)\n');

  console.log('================================================================');
  console.log(' ALL 11 REAL HTTP TURNS + SAFE RESTART + NEGATIVE TESTS PASSED! ');
  console.log('================================================================');
}

run().catch(err => {
  console.error('\n❌ E2E TEST FAILED:', err.message);
  process.exit(1);
});
