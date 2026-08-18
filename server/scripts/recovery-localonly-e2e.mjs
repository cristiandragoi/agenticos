// P13 — REAL localOnly E2E with outbound request spies.
// Force a recovery that would normally escalate to cloud; prove policy blocks
// it, ZERO outbound cloud requests occur, task blocks truthfully, RunLedger
// records blocked_by_policy, ACTIVE RUN clears.
import http from 'node:http';
import https from 'node:https';
import { backgroundTaskRepo, ensureBackgroundTaskTables } from '../dist/services/backgroundTasks/store.js';
import { backgroundTaskManager } from '../dist/services/backgroundTasks/manager.js';
import { projectsStore } from '../dist/services/projectsStore.js';
import { policyStore } from '../dist/services/policy/policyStore.js';
import * as executionState from '../dist/services/executionState.js';

// Outbound request spies (REAL runtime counters).
let httpCount = 0;
let httpsCount = 0;
const origHttp = http.request;
const origHttps = https.request;
http.request = ((...args) => { httpCount += 1; return origHttp(...args); });
https.request = ((...args) => { httpsCount += 1; return origHttps(...args); });

async function main() {
  ensureBackgroundTaskTables();
  const projectId = `proj-locale2e-${Date.now()}`;
  projectsStore.createProject({ id: projectId, name: 'LocalOnly E2E', workspacePath: undefined });
  policyStore.setPolicy(projectId, { privacy: 'sensitive', runtime: 'localOnly', cloudEscalation: 'forbidden' });

  const taskId = `task-locale2e-${Date.now()}`;
  const opId = `op-locale2e-${Date.now()}`;
  backgroundTaskRepo.insertTask({
    taskId,
    title: 'localOnly recovery E2E',
    objective: 'Prove privacy blocks cloud escalation.',
    originalRequest: 'Prove privacy blocks cloud.',
    route: 'direct',
    selectedAgent: 'CodeX',
    status: 'running',
    priority: 'medium',
    projectId,
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    conversationId: 'conv-locale2e',
    conversationSessionId: null,
    worker: 'codex',
    linkedRunId: null,
    linkedBoardCardId: null,
    parentTaskId: null,
    childTaskIds: [],
    currentStage: 'executing',
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
    metadata: {
      operationId: opId,
      assignedProvider: 'ollama',
      assignedModel: 'qwen3.5:8b', // nothing stronger locally → would go cloud
      recovery: {
        executionAttempts: 2,
        gateReworkAttempts: 0,
        sameModelRetries: 2,
        modelEscalations: 0,
        startedAtMs: Date.now(),
      },
    },
  });
  executionState.begin({ operationId: opId, worker: 'codex' });

  console.log('taskId:', taskId, '| projectId:', projectId);
  const decision = await backgroundTaskManager.recoverAfterFailure(taskId, { code: 'EMPTY_CONTENT_AFTER_REASONING' });
  console.log('recovery decision:', decision?.kind, '| blockedByPolicy:', decision?.blockedByPolicy);

  const after = backgroundTaskRepo.getTask(taskId);
  console.log('task status:', after?.status);
  console.log('blocker:', after?.blocker);
  console.log('attempt (must stay 1):', after?.attempt);

  const events = backgroundTaskRepo.getEvents(taskId);
  const policyEvents = events.filter((e) => e.kind === 'run.recovery.blocked_by_policy');
  console.log('run.recovery.blocked_by_policy events:', policyEvents.length);

  console.log('OUTBOUND http.request calls:', httpCount);
  console.log('OUTBOUND https.request calls:', httpsCount);

  const active = executionState.snapshot();
  console.log('ACTIVE RUN current:', active?.operationId === opId ? 'STALE!' : '(cleared)');
  const rec = executionState.get(opId);
  console.log('execution record status:', rec?.status);

  const pass = decision?.kind === 'blocked' && decision?.blockedByPolicy === true
    && after?.status === 'blocked' && /POLICY_BLOCKED/.test(after?.blocker || '')
    && after?.attempt === 1 && policyEvents.length >= 1
    && httpCount === 0 && httpsCount === 0
    && active?.operationId !== opId;
  console.log('\nP13 E2E RESULT:', pass ? 'PASS' : 'FAIL');

  http.request = origHttp;
  https.request = origHttps;
  try { backgroundTaskRepo.updateTask(taskId, { status: 'cancelled' }); } catch { /* ignore */ }
  try { projectsStore.deleteProject(projectId); } catch { /* ignore */ }
  if (!pass) process.exitCode = 1;
}

main().catch((e) => { console.error('P13 E2E ERROR', e); process.exitCode = 1; });
