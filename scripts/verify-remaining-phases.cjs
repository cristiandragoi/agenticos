/**
 * Verification of Remaining Acceptance Phases: 6, 7, 8 + CodeX Execution & Memory Scoping
 * With Strict Synthetic Task Lifecycle Cleanup and Idempotency Assertions.
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

async function runRemainingPhases() {
  console.log('================================================================');
  console.log('VERIFYING REMAINING PHASES: 6 (RESTART), 7 (VOICE), 8 (MEMORY)');
  console.log('================================================================\n');

  // Verify Revenue Supervisor PAUSED
  const revRes = await requestJson('GET', '/api/revenue-supervisor/status');
  console.log('Revenue Supervisor controlState:', revRes.data?.controlState);
  if (revRes.data?.controlState !== 'PAUSED') {
    throw new Error('Revenue Supervisor MUST be PAUSED!');
  }
  console.log('✓ Revenue Supervisor is confirmed PAUSED.\n');

  // Pre-cleanup: Transition any stale synthetic test tasks from earlier runs to terminal completed
  const { backgroundTaskRepo } = await import('../server/dist/services/backgroundTasks/store.js');
  const staleActive = backgroundTaskRepo.listTasks({ activeOnly: true });
  for (const st of staleActive) {
    if (st.taskId.startsWith('test-') || st.taskId.startsWith('bgtask-synthetic')) {
      backgroundTaskRepo.updateTask(st.taskId, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        resultText: 'Cleaned up by test verifier',
      });
    }
  }

  // Create conversation for remaining tests
  const convRes = await requestJson('POST', '/api/jarvis/conversations', {
    title: 'Remaining Phases Test Conversation',
  });
  const convId = convRes.data?.id;
  console.log(`Created test conversation: ${convId}\n`);

  // ── PHASE 6: Restart Reconciliation ───────────────────────────────────────
  console.log('── PHASE 6: Restart Reconciliation Verification ──');
  const { JarvisExecutionSupervisor, jarvisExecutionSupervisor } = await import('../server/dist/domains/jarvis/executionSupervisor.js');

  const testRestartTaskId = `test-restart-active-${Date.now()}`;
  backgroundTaskRepo.insertTask({
    taskId: testRestartTaskId,
    title: 'Active Code Task Surviving Restart',
    objective: 'Demonstrate restart reconciliation',
    originalRequest: 'Demonstrate restart reconciliation',
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
    metadata: { operationId: `op-reconcile-${Date.now()}` },
    workspaceRoot: '',
  });

  // Create fresh supervisor simulating backend boot/restart
  const freshSupervisor = new JarvisExecutionSupervisor();
  const recoveredTask = freshSupervisor.activeTasks.get(testRestartTaskId);

  if (!recoveredTask) {
    throw new Error('Phase 6 Failed: Active task was not recovered upon supervisor restart reconciliation.');
  }
  console.log(`✓ Active task recovered successfully: taskId=${recoveredTask.taskId}, worker=${recoveredTask.worker}, state=${recoveredTask.state}`);

  // Inspect persisted conversation messages to verify no duplicate initial creation message
  const msgsRes = await requestJson('GET', `/api/jarvis/conversations/${convId}/messages`);
  const messages = Array.isArray(msgsRes.data) ? msgsRes.data : [];
  console.log(`Persisted conversation messages count: ${messages.length}`);

  const hasDuplicateCreation = messages.some(m => m.content && m.content.includes('I have it. CodeX is starting now.'));
  if (hasDuplicateCreation) {
    throw new Error('Phase 6 Failed: Duplicate task creation message emitted during restart reconciliation.');
  }
  console.log('✓ No duplicate task creation acknowledgement emitted upon restart.');

  // Clean up synthetic task lifecycle immediately after assertion
  backgroundTaskRepo.updateTask(testRestartTaskId, {
    status: 'completed',
    completedAt: new Date().toISOString(),
    resultText: 'Restart reconciliation test completed.',
  });
  freshSupervisor.dispose();

  console.log('✓ Phase 6 PASS: Restart reconciliation verified & test supervisor cleanly disposed.\n');

  // ── PHASE 7: Voice Milestone Verification ─────────────────────────────────
  console.log('── PHASE 7: Voice Milestone Verification ──');
  const { progressTranslator } = await import('../server/dist/services/jarvis/progressTranslator.js');

  const milestonesToSpeak = [
    'task_created',
    'delegation_dispatched',
    'intermediate_finding',
    'approval_required',
    'verification_passed',
    'possible_stall',
    'completed',
    'failed',
  ];

  const microEventsToSuppress = [
    'tool_started',
    'tool_completed',
    'tool_failed',
    'inspecting_files',
    'applying_changes',
    'running_tests',
  ];

  for (const m of milestonesToSpeak) {
    if (!progressTranslator.isSpokenMilestone(m)) {
      throw new Error(`Phase 7 Failed: Milestone ${m} should have isSpokenMilestone === true`);
    }
  }
  console.log(`✓ All ${milestonesToSpeak.length} high-level execution milestones marked for spoken TTS.`);

  for (const e of microEventsToSuppress) {
    if (progressTranslator.isSpokenMilestone(e)) {
      throw new Error(`Phase 7 Failed: Micro event ${e} should have isSpokenMilestone === false`);
    }
  }
  console.log(`✓ All ${microEventsToSuppress.length} low-level inspection/tool events suppressed from voice.`);

  // Test semantic deduplication cooldown
  const dedupTaskId = `test-dedup-${Date.now()}`;
  jarvisExecutionSupervisor.superviseTask({
    taskId: dedupTaskId,
    operationId: `op-dedup-${Date.now()}`,
    conversationId: convId,
    worker: 'codex',
    initialState: 'STARTING',
  });

  const firstInspect = jarvisExecutionSupervisor.recordActivity(dedupTaskId, 'inspecting_files', { files: ['src/a.ts'] });
  const secondInspect = jarvisExecutionSupervisor.recordActivity(dedupTaskId, 'inspecting_files', { files: ['src/b.ts'] });
  const thirdInspect = jarvisExecutionSupervisor.recordActivity(dedupTaskId, 'inspecting_files', { files: ['src/c.ts'] });

  if (!firstInspect || secondInspect || thirdInspect) {
    throw new Error('Phase 7 Failed: Semantic inspection cooldown failed to collapse repeated file reads.');
  }
  console.log('✓ Semantic cooldown collapsed rapid repeated file inspections into ONE update.');
  jarvisExecutionSupervisor.recordActivity(dedupTaskId, 'completed', { resultSummary: 'Dedup test done' });
  console.log('✓ Phase 7 PASS: Voice milestone gating & deduplication verified.\n');

  // ── PHASE 8: Persistent Core Memory Verification ──────────────────────────
  console.log('── PHASE 8: Persistent Core Memory & Scoped Recall Verification ──');
  const {
    ensureJarvisCoreMemorySeeded,
    getUserWorkingProfile,
    updateUserWorkingProfile,
    getInteractionPreferences,
    updateInteractionPreferences,
    getScopedJarvisMemoryContext,
  } = await import('../server/dist/domains/jarvis/coreMemory.js');
  const { memoryStore } = await import('../server/dist/services/memory/store.js');
  const { projectsStore } = await import('../server/dist/services/projectsStore.js');

  // Ensure seeded
  ensureJarvisCoreMemorySeeded();

  // 1. Verify structured scopes exist in DB
  const profileList = memoryStore.list({ scope: 'user:profile' });
  const idList = memoryStore.list({ scope: 'system:identity' });
  const rolesList = memoryStore.list({ scope: 'system:roles' });
  const princList = memoryStore.list({ scope: 'system:principles' });
  const interList = memoryStore.list({ scope: 'system:interaction_preferences' });

  console.log(`Verified Core Scopes in DB:
  - user:profile: ${profileList.total}
  - system:identity: ${idList.total}
  - system:roles: ${rolesList.total}
  - system:principles: ${princList.total}
  - system:interaction_preferences: ${interList.total}`);

  if (profileList.total === 0 || idList.total === 0 || rolesList.total === 0 || princList.total === 0 || interList.total === 0) {
    throw new Error('Phase 8 Failed: Core memory scopes missing from persistent database.');
  }

  // 2. User modification survives and is not overwritten by seedDefault
  updateUserWorkingProfile({
    preferredName: 'Lead Commander',
    preferredInteractionStyle: 'Direct, proactive supervisor with spoken milestones',
  });
  ensureJarvisCoreMemorySeeded(); // Idempotency check

  const updatedProfile = getUserWorkingProfile();
  if (updatedProfile.preferredName !== 'Lead Commander') {
    throw new Error('Phase 8 Failed: User profile modification was overwritten by seeding.');
  }
  console.log('✓ User profile customization preserved idempotently across seed calls.');

  // 3. Interaction preferences survive
  updateInteractionPreferences({ locale: 'en-AU', conciseUpdates: true, spokenMilestones: true });
  const prefs = getInteractionPreferences();
  if (prefs.locale !== 'en-AU' || !prefs.conciseUpdates) {
    throw new Error('Phase 8 Failed: Interaction preferences update failed.');
  }
  console.log('✓ Interaction preferences verified (locale: en-AU, concise: true).');

  // 4. Project-scoped memory isolation
  const { storeProjectMemory } = await import('../server/dist/domains/jarvis/projectMemory.js');
  const projA = `proj-a-${Date.now()}`;
  const projB = `proj-b-${Date.now()}`;

  projectsStore.createProject({ id: projA, name: 'Alpha Project', description: 'Alpha confidential project' });
  projectsStore.createProject({ id: projB, name: 'Beta Project', description: 'Beta confidential project' });

  storeProjectMemory(projA, {
    type: 'decision',
    title: 'Alpha Database Constraints',
    summary: 'Alpha strictly uses SQLite with WAL mode only',
    content: 'Alpha strictly uses SQLite with WAL mode only',
    tags: ['constraint', 'database'],
    confidence: 1.0,
  });

  const ctxA = await getScopedJarvisMemoryContext('What database constraints do we have?', projA);
  const ctxB = await getScopedJarvisMemoryContext('What database constraints do we have?', projB);

  if (!ctxA.includes('Alpha Database Constraints')) {
    throw new Error('Phase 8 Failed: Project A scoped memory was not recalled for Project A.');
  }
  if (ctxB.includes('Alpha Database Constraints')) {
    throw new Error('Phase 8 Failed: Project A memory leaked into Project B scoped context.');
  }
  console.log('✓ Project memory scoping isolation verified (Project A isolated from Project B).');

  // 5. Bounded memory recall (does not dump full DB)
  if (ctxA.length > 4000) {
    throw new Error(`Phase 8 Failed: Memory injection exceeded bounded threshold (${ctxA.length} chars).`);
  }
  console.log(`✓ Scoped context is strictly bounded (${ctxA.length} chars).`);
  console.log('✓ Phase 8 PASS: Structured memory persistence, scoping, and bounded recall verified.\n');

  // ── Item D: Post-Execution Cleanup & Idempotency Assertions ───────────────
  console.log('── Post-Execution Cleanup & Idempotency Assertions ──');
  const postActive = backgroundTaskRepo.listTasks({ activeOnly: true });
  const remainingSyntheticActive = postActive.filter(t => t.taskId.startsWith('test-'));
  if (remainingSyntheticActive.length > 0) {
    throw new Error(`Cleanup Assertion Failed: ${remainingSyntheticActive.length} synthetic tasks remain active.`);
  }
  console.log('✓ Cleanup Assertion 1: 0 synthetic active tasks remain reconciliation-eligible.');

  const secondSupervisor = new JarvisExecutionSupervisor();
  const secondRecovered = secondSupervisor.activeTasks.get(testRestartTaskId);
  if (secondRecovered) {
    throw new Error('Cleanup Assertion Failed: Terminal synthetic task resurrected on second supervisor initialization.');
  }
  secondSupervisor.dispose();
  console.log('✓ Cleanup Assertion 2: Terminal synthetic tasks do not resurrect on subsequent restarts.');

  console.log('\n================================================================');
  console.log('ALL REMAINING ACCEPTANCE PHASES VERIFIED SUCCESSFULLY');
  console.log('================================================================\n');
  console.log('PACKAGED CONVERSATIONAL SUPERVISOR ACCEPTANCE: PASS');
}

runRemainingPhases().catch(err => {
  console.error('\nACCEPTANCE ERROR:', err.message || err);
  console.log('PACKAGED CONVERSATIONAL SUPERVISOR ACCEPTANCE: FAIL');
  process.exit(1);
});
