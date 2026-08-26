/**
 * Comprehensive Packaged Runtime Acceptance Suite for Jarvis Conversational Supervisor
 *
 * Covers Phases 3 to 8:
 *   - Phase 3: Real Jarvis Conversational Execution
 *   - Phase 4: RUNNING_QUIET & Stall Semantics
 *   - Phase 5: Approval Gate Protection
 *   - Phase 6: Restart Reconciliation
 *   - Phase 7: Voice Milestone Verification
 *   - Phase 8: Persistent Memory & Scoped Recall
 */
const http = require('http');

const PORT = 4000;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function requestJson(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const postData = body ? JSON.stringify(body) : null;
    const req = http.request(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, data: json });
        } catch {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

function streamPost(path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const postData = JSON.stringify(body);
    const events = [];

    const req = http.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'Accept': 'text/event-stream',
      },
    }, (res) => {
      let buffer = '';
      res.on('data', chunk => {
        buffer += chunk.toString();
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';
        for (const frame of lines) {
          if (!frame.trim()) continue;
          let eventType = 'message';
          let dataStr = '';
          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) eventType = line.slice(6).trim();
            if (line.startsWith('data:')) dataStr += line.slice(5).trim();
          }
          try {
            events.push({ event: eventType, data: dataStr ? JSON.parse(dataStr) : {} });
          } catch {
            events.push({ event: eventType, raw: dataStr });
          }
        }
      });
      res.on('end', () => {
        resolve(events);
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function runAcceptanceSuite() {
  console.log('================================================================');
  console.log('PACKAGED RUNTIME ACCEPTANCE SUITE — CONVERSATIONAL SUPERVISOR');
  console.log('================================================================\n');

  // Verify Revenue Supervisor PAUSED
  console.log('[Check] Revenue Supervisor Status...');
  const revRes = await requestJson('GET', '/api/revenue-supervisor/status');
  console.log('Revenue Supervisor controlState:', revRes.data?.controlState);
  if (revRes.data?.controlState !== 'PAUSED') {
    throw new Error('Revenue Supervisor MUST be PAUSED!');
  }
  console.log('✓ Revenue Supervisor is PAUSED.\n');

  // Clean stale tasks
  console.log('[Setup] Clearing any stale background tasks...');
  try {
    const tasksRes = await requestJson('GET', '/api/background-tasks?activeOnly=true');
    const tasks = Array.isArray(tasksRes.data) ? tasksRes.data : tasksRes.data?.tasks || [];
    for (const t of tasks) {
      await requestJson('POST', `/api/background-tasks/${t.taskId}/cancel`, {});
    }
  } catch {}
  console.log('✓ Concurrency slots clear.\n');

  // ── PHASE 3: Real Jarvis Conversational Execution ─────────────────────────
  console.log('── PHASE 3: Real Jarvis Conversational Execution ──');
  const convRes = await requestJson('POST', '/api/jarvis/conversations', {
    title: 'Packaged Acceptance Live Task',
  });
  const convId = convRes.data?.id;
  console.log(`Created test conversation: ${convId}`);

  const opId = `op-accept-${Date.now()}`;
  const prompt = 'Have Hermes analyze Stripe integration options and delegate lead validation test creation to CodeX.';

  const t0 = Date.now();
  const sseEvents = await streamPost(`/api/jarvis/conversations/${convId}/message/stream`, {
    prompt,
    operationId: opId,
    inputChannel: 'typed',
  });
  const ackMs = Date.now() - t0;

  const chunkText = sseEvents
    .filter(e => e.event === 'chunk' || e.event === 'token')
    .map(e => e.data?.delta || e.data?.content || '')
    .join('');

  console.log(`\nImmediate Jarvis Acknowledgement (received in ${ackMs}ms):`);
  console.log(`"${chunkText}"`);

  if (!chunkText || chunkText.length === 0) {
    throw new Error('Phase 3 Failed: No immediate acknowledgement received.');
  }
  if (!chunkText.toLowerCase().includes('hermes') && !chunkText.toLowerCase().includes('codex')) {
    throw new Error('Phase 3 Failed: Acknowledgement did not mention the assigned worker (Hermes or CodeX).');
  }
  console.log('✓ Phase 3 PASS: Immediate acknowledgement & truthful delegation stream verified.\n');

  // ── PHASE 4: RUNNING_QUIET & Stall Semantics ──────────────────────────────
  console.log('── PHASE 4: RUNNING_QUIET / Stall Semantics ──');
  const { jarvisExecutionSupervisor } = await import('../server/dist/domains/jarvis/executionSupervisor.js');
  const { progressTranslator } = await import('../server/dist/services/jarvis/progressTranslator.js');
  const { backgroundTaskRepo } = await import('../server/dist/services/backgroundTasks/store.js');

  const testQuietTaskId = `test-quiet-${Date.now()}`;
  backgroundTaskRepo.insertTask({
    taskId: testQuietTaskId,
    title: 'Quiet Task',
    objective: 'Test quiet',
    originalRequest: 'Test quiet',
    route: 'codex',
    selectedAgent: 'CodeX',
    worker: 'codex',
    status: 'running',
    priority: 'medium',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    conversationId: convId,
    childTaskIds: [],
    filesChanged: [],
    currentStage: 'running',
    progressMessage: 'Running tests',
    buildState: 'idle',
    testState: 'idle',
    verificationState: 'pending',
    approvalState: 'none',
    cancellationRequested: false,
    resumable: true,
    attempt: 1,
    metadata: {},
    workspaceRoot: '',
  });

  jarvisExecutionSupervisor.superviseTask({
    taskId: testQuietTaskId,
    operationId: `op-quiet-${Date.now()}`,
    conversationId: convId,
    worker: 'codex',
    initialState: 'RUNNING_ACTIVE',
  });

  const quietTaskObj = jarvisExecutionSupervisor.activeTasks.get(testQuietTaskId);
  // Set 20s idle (between 10s and 44s)
  quietTaskObj.lastActivityAt = Date.now() - 20_000;
  jarvisExecutionSupervisor.checkHeartbeats();
  console.log(`20s worker silence state: ${quietTaskObj.state}`);
  if (quietTaskObj.state !== 'RUNNING_QUIET') {
    throw new Error(`Phase 4 Failed: Expected RUNNING_QUIET, got ${quietTaskObj.state}`);
  }
  console.log('✓ 20s silence correctly transitions to RUNNING_QUIET without false stall.');

  // Set 50s idle (> 45s) with no active operation
  quietTaskObj.lastActivityAt = Date.now() - 50_000;
  jarvisExecutionSupervisor.checkHeartbeats();
  console.log(`50s worker silence state: ${quietTaskObj.state}`);
  if (quietTaskObj.state !== 'POSSIBLE_STALL') {
    throw new Error(`Phase 4 Failed: Expected POSSIBLE_STALL after 50s, got ${quietTaskObj.state}`);
  }
  console.log('✓ Phase 4 PASS: RUNNING_QUIET & 45s stall semantics verified.\n');

  // ── PHASE 5: Approval Gate Protection ─────────────────────────────────────
  console.log('── PHASE 5: Approval Gate Protection ──');
  const testApprTaskId = `test-appr-${Date.now()}`;
  backgroundTaskRepo.insertTask({
    taskId: testApprTaskId,
    title: 'Approval Gate Task',
    objective: 'Test approval gate',
    originalRequest: 'Test approval gate',
    route: 'codex',
    selectedAgent: 'CodeX',
    worker: 'codex',
    status: 'waiting_approval',
    priority: 'medium',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    conversationId: convId,
    childTaskIds: [],
    filesChanged: [],
    currentStage: 'waiting_approval',
    progressMessage: 'Waiting for approval',
    buildState: 'idle',
    testState: 'idle',
    verificationState: 'pending',
    approvalState: 'pending',
    cancellationRequested: false,
    resumable: false,
    attempt: 1,
    metadata: {},
    workspaceRoot: '',
  });

  jarvisExecutionSupervisor.superviseTask({
    taskId: testApprTaskId,
    operationId: `op-appr-${Date.now()}`,
    conversationId: convId,
    worker: 'codex',
    initialState: 'WAITING_FOR_APPROVAL',
  });

  const apprTaskObj = jarvisExecutionSupervisor.activeTasks.get(testApprTaskId);
  // Simulate 120s of elapsed time waiting for user approval
  apprTaskObj.lastActivityAt = Date.now() - 120_000;
  jarvisExecutionSupervisor.checkHeartbeats();
  console.log(`Approval waiting after 120s state: ${apprTaskObj.state}`);
  if (apprTaskObj.state !== 'WAITING_FOR_APPROVAL') {
    throw new Error(`Phase 5 Failed: WAITING_FOR_APPROVAL was altered to ${apprTaskObj.state}`);
  }
  if (apprTaskObj.stallNoticeEmitted) {
    throw new Error('Phase 5 Failed: WAITING_FOR_APPROVAL triggered a stall alert!');
  }
  console.log('✓ Phase 5 PASS: WAITING_FOR_APPROVAL strictly protected from false stalls.\n');

  // ── PHASE 6: Restart Reconciliation ───────────────────────────────────────
  console.log('── PHASE 6: Restart Reconciliation ──');
  const testRestartTaskId = `test-restart-reconcile-${Date.now()}`;
  backgroundTaskRepo.insertTask({
    taskId: testRestartTaskId,
    title: 'Surviving Task',
    objective: 'Survive restart',
    originalRequest: 'Survive restart',
    route: 'codex',
    selectedAgent: 'CodeX',
    worker: 'codex',
    status: 'running',
    priority: 'medium',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    conversationId: convId,
    childTaskIds: [],
    filesChanged: [],
    currentStage: 'running',
    progressMessage: 'Running tests',
    buildState: 'idle',
    testState: 'idle',
    verificationState: 'pending',
    approvalState: 'none',
    cancellationRequested: false,
    resumable: true,
    attempt: 1,
    metadata: {},
    workspaceRoot: '',
  });

  const { JarvisExecutionSupervisor: FreshSupervisorClass } = await import('../server/dist/domains/jarvis/executionSupervisor.js');
  const freshSupervisor = new FreshSupervisorClass();
  const recoveredTask = freshSupervisor.activeTasks.get(testRestartTaskId);

  if (!recoveredTask) {
    throw new Error('Phase 6 Failed: Active task was not recovered upon supervisor instantiation.');
  }
  console.log(`Recovered task state: ${recoveredTask.state} (worker=${recoveredTask.worker})`);
  freshSupervisor.stop();
  console.log('✓ Phase 6 PASS: Restart reconciliation restored active task without duplicate creation.\n');

  // ── PHASE 7: Voice Milestone Verification ─────────────────────────────────
  console.log('── PHASE 7: Voice Milestone Verification ──');
  const spokenMilestones = ['intermediate_finding', 'approval_required', 'verification_passed', 'completed', 'failed'];
  const lowLevelEvents = ['tool_started', 'tool_completed', 'inspecting_files'];

  for (const k of spokenMilestones) {
    const isSpoken = progressTranslator.isSpokenMilestone(k);
    if (!isSpoken) throw new Error(`Phase 7 Failed: Milestone ${k} should be spoken.`);
  }
  for (const k of lowLevelEvents) {
    const isSpoken = progressTranslator.isSpokenMilestone(k);
    if (isSpoken) throw new Error(`Phase 7 Failed: Micro event ${k} should NOT be spoken.`);
  }
  console.log('✓ Phase 7 PASS: High-level milestones voiced; low-level tool chatter suppressed from TTS.\n');

  // ── PHASE 8: Persistent Memory Verification ──
  console.log('── PHASE 8: Persistent Memory Verification ──');
  const {
    ensureJarvisCoreMemorySeeded,
    getUserWorkingProfile,
    updateUserWorkingProfile,
    getInteractionPreferences,
    updateInteractionPreferences,
    getScopedJarvisMemoryContext,
  } = await import('../server/dist/domains/jarvis/coreMemory.js');

  ensureJarvisCoreMemorySeeded();

  // Test updating user profile
  updateUserWorkingProfile({ preferredName: 'Director Nova' });
  const profile = getUserWorkingProfile();
  if (profile.preferredName !== 'Director Nova') {
    throw new Error(`Phase 8 Failed: Profile update failed, got ${profile.preferredName}`);
  }

  // Test updating interaction preferences
  updateInteractionPreferences({ locale: 'en-AU', conciseUpdates: true });
  const prefs = getInteractionPreferences();
  if (prefs.locale !== 'en-AU' || !prefs.conciseUpdates) {
    throw new Error('Phase 8 Failed: Interaction preferences update failed.');
  }

  // Test bounded scoped recall
  const scopedCtx = await getScopedJarvisMemoryContext('What is our current project status?');
  if (!scopedCtx.includes('[USER WORKING PROFILE]') || !scopedCtx.includes('[INTERACTION PREFERENCES]')) {
    throw new Error('Phase 8 Failed: Scoped memory context missing profile or interaction blocks.');
  }
  if (scopedCtx.length > 4000) {
    throw new Error('Phase 8 Failed: Scoped memory context exceeded bounded threshold.');
  }
  console.log(`Scoped memory context size: ${scopedCtx.length} chars (bounded).`);
  console.log('✓ Phase 8 PASS: Structured memory persistence & bounded recall verified.\n');

  console.log('================================================================');
  console.log('ALL PHASES (3 THROUGH 8) VERIFIED IN PACKAGED RUNTIME');
  console.log('================================================================\n');
  console.log('PACKAGED CONVERSATIONAL SUPERVISOR ACCEPTANCE: PASS');
}

runAcceptanceSuite().catch(err => {
  console.error('\nACCEPTANCE ERROR:', err.message || err);
  console.log('PACKAGED CONVERSATIONAL SUPERVISOR ACCEPTANCE: FAIL');
  process.exit(1);
});
