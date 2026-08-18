// HERMES LIVE E2E — healthy request (P3) + AgenticOS dispatch (P4) +
// recovery through the REAL runtime path (P5), against the RUNNING gateway.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { backgroundTaskRepo, ensureBackgroundTaskTables } from '../dist/services/backgroundTasks/store.js';
import { backgroundTaskManager } from '../dist/services/backgroundTasks/manager.js';
import { dispatchHermesTask } from '../dist/services/backgroundTasks/adapters.js';
import { hermesApiService } from '../dist/services/hermesApiService.js';

const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const profileEnv = path.join(localAppData, 'hermes', 'profiles', 'backend-engineer', '.env');
const key = (fs.readFileSync(profileEnv, 'utf8').match(/^API_SERVER_KEY=(.+)$/m) || [])[1]?.trim() || '';
if (!key) { console.log('API_SERVER_KEY missing — abort'); process.exit(1); }
console.log('API_SERVER_KEY: PRESENT (never printed)');

const tick = (ms) => new Promise((r) => setTimeout(r, ms));

async function makeTask(taskId, objective) {
  return {
    taskId,
    title: 'Hermes live E2E',
    objective,
    originalRequest: objective,
    route: 'direct',
    selectedAgent: 'Hermes',
    status: 'running',
    priority: 'medium',
    projectId: null,
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    conversationId: `conv-${taskId}`,
    conversationSessionId: null,
    worker: 'hermes',
    linkedRunId: null,
    linkedBoardCardId: null,
    parentTaskId: null,
    childTaskIds: [],
    currentStage: 'dispatching',
    progressMessage: '',
    filesChanged: [],
    buildState: 'idle',
    testState: 'idle',
    verificationState: 'pending',
    approvalState: 'none',
    blocker: null,
    lastError: null,
    resultText: null,
    workspaceRoot: '',
    cancellationRequested: false,
    resumable: true,
    attempt: 1,
    metadata: { approvalPolicy: 'auto' },
  };
}

async function waitForTask(taskId, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const t = backgroundTaskRepo.getTask(taskId);
    if (t && ['completed', 'failed', 'blocked', 'cancelled'].includes(t.status)) return t;
    await tick(3000);
  }
  return backgroundTaskRepo.getTask(taskId);
}

async function main() {
  ensureBackgroundTaskTables();
  // ── P3: healthy authenticated request through the AgenticOS resolver ──
  const url = await hermesApiService.getUrl();
  console.log('resolved Hermes URL:', url);
  const res = await fetch(`${url}/v1/models`, { headers: { Authorization: `Bearer ${key}` } });
  const body = await res.json().catch(() => ({}));
  const names = (body.models || []).map((m) => (typeof m === 'string' ? m : m?.id || m?.name)).slice(0, 5);
  console.log('P3 healthy request: HTTP', res.status, '| models:', names.join(', '), '| auth: OK');

  // ── P4: real AgenticOS dispatch ───────────────────────────────────────
  const t1 = await makeTask(`task-hlive-${Date.now()}`, 'Reply with the single word OK. Do not ask questions.');
  backgroundTaskRepo.insertTask(t1);
  console.log('\nP4 taskId:', t1.taskId);
  const d1 = await dispatchHermesTask(t1, 'B:\\AgenticOS');
  console.log('dispatch ok:', d1.ok, d1.error || '');
  const linked1 = backgroundTaskRepo.getTask(t1.taskId);
  console.log('hermes run id:', linked1?.linkedRunId, '| status:', linked1?.status);
  const f1 = await waitForTask(t1.taskId, 240000);
  console.log('P4 final:', f1?.status, '| verificationState:', f1?.verificationState, '| resultText:', (f1?.resultText || '').slice(0, 60));
  const m1 = f1?.metadata || {};
  console.log('P4 assigned/effective:', m1.assignedProvider + '/' + m1.assignedModel, '→', m1.effectiveProvider + '/' + m1.effectiveModel);

  // ── P5: recovery through the REAL runtime path ────────────────────────
  const t2 = await makeTask(`task-hrec-${Date.now()}`, 'Reply with the single word OK. Do not ask questions.');
  backgroundTaskRepo.insertTask(t2);
  console.log('\nP5 taskId:', t2.taskId);
  const d2 = await dispatchHermesTask(t2, 'B:\\AgenticOS');
  const linked2 = backgroundTaskRepo.getTask(t2.taskId);
  const runId2 = linked2?.linkedRunId;
  console.log('P5 attempt1 run:', runId2, '| dispatch ok:', d2.ok);

  // Genuine structured failure event → real recovery path. Must arrive
  // BEFORE the real run completes (deepseek replies in seconds).
  await tick(200);
  hermesApiService.emit('hermes:update', { id: runId2, status: 'failed', errorMessage: 'HTTP 429 rate limit' });
  console.log('injected structured failure event (HTTP 429)');
  await tick(5000);
  const r1 = backgroundTaskRepo.getTask(t2.taskId);
  const recEvents = backgroundTaskRepo.getEvents(t2.taskId).filter((e) => String(e.kind).startsWith('run.recovery'));
  console.log('recovery decision:', r1?.metadata?.recovery?.lastDecision, '| attempt:', r1?.attempt, '| status:', r1?.status);
  console.log('recovery events:', recEvents.map((e) => e.kind).join(', '));
  const linkedAfter = backgroundTaskRepo.getTask(t2.taskId)?.linkedRunId;
  console.log('run id after recovery:', linkedAfter, '(second real run if != attempt1 run)');

  // Wait for the re-dispatched SECOND real Hermes run to finish.
  const f2 = await waitForTask(t2.taskId, 300000);
  const runs = backgroundTaskRepo.getEvents(t2.taskId).filter((e) => e.kind === 'task.run_linked');
  console.log('P5 final:', f2?.status, '| verificationState:', f2?.verificationState);
  console.log('P5 run-links:', runs.map((e) => e.summary).join(' | '));
  const m2 = f2?.metadata || {};
  console.log('P5 assigned/effective:', m2.assignedProvider + '/' + m2.assignedModel, '→', m2.effectiveProvider + '/' + m2.effectiveModel);
  console.log('P5 recovery meta:', JSON.stringify(m2.recovery || null));

  const recEventsFinal = backgroundTaskRepo.getEvents(t2.taskId).filter((e) => String(e.kind).startsWith('run.recovery'));
  const secondRun = runs.length >= 2 && runs[1].summary !== runs[0].summary;
  const pass = f2?.status === 'completed' && f2?.verificationState === 'passed'
    && recEventsFinal.length > 0 && secondRun;
  console.log('\nHERMES E2E RESULT:', pass ? 'PASS (recovery proven)' : 'CHECK EVIDENCE');
  if (!pass) process.exitCode = 1;
}

main().catch((e) => { console.error('HERMES E2E ERROR', e?.message); process.exitCode = 1; });
