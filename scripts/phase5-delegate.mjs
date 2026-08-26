// Phase 5 — bounded Hermes plan+delegate-to-CodeX test against a fresh DEV backend.
const BASE = process.env.BASE || 'http://127.0.0.1:4002';

async function j(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

const objective = [
  'You are the Hermes planning orchestrator in Agentic OS.',
  'Perform a bounded READ-ONLY inspection of the AgenticOS repository at B:/AgenticOS, and delegate the file-reading step to CodeX.',
  '1. Plan: list 2 concrete read-only inspection steps.',
  '2. Delegate the file reading to CodeX so CodeX executes against B:/AgenticOS.',
  '3. Report truthfully: (a) your plan, (b) the delegated CodeX identifier, (c) CodeX findings, (d) the provider/model you used.',
  'Do NOT modify any files.',
].join('\n');

console.log('=== PHASE 5 DELEGATION (bounded) ===');
const create = await j('POST', '/api/background-tasks', {
  title: 'Phase 5: Hermes plan + delegate read to CodeX',
  objective,
  originalRequest: objective,
  worker: 'hermes',
  route: 'hermes',
  selectedAgent: 'hermes',
  workspacePath: 'B:\\AgenticOS',
});
console.log('create status', create.status);
if (create.status !== 201 && create.status !== 200) {
  console.log(JSON.stringify(create.data, null, 2).slice(0, 1500));
  process.exit(1);
}
const task = create.data;
console.log('taskId:', task.taskId, '| worker:', task.worker, '| status:', task.status);

const deadline = Date.now() + 10 * 60 * 1000;
let final = null;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 5000));
  const t = await j('GET', `/api/background-tasks/${task.taskId}`);
  const d = t.data || {};
  if (['completed', 'failed', 'cancelled', 'blocked'].includes(d.status)) { final = d; break; }
  console.log(`[poll] ${new Date().toISOString().slice(11,19)} status=${d.status} stage=${d.currentStage || '-'}`);
}

console.log('\n=== FINAL TASK ===');
const ft = final || (await j('GET', `/api/background-tasks/${task.taskId}`)).data;
const meta = ft.metadata || {};
console.log(JSON.stringify({
  taskId: ft.taskId, worker: ft.worker, status: ft.status,
  currentStage: ft.currentStage, linkedRunId: ft.linkedRunId,
  resultText: (ft.resultText || '').slice(0, 600),
  lastError: ft.lastError, blocker: ft.blocker,
  provider: meta.assignedProvider || meta.effectiveProvider,
  model: meta.assignedModel || meta.effectiveModel,
  workerInstanceId: meta.workerInstanceId,
}, null, 2));

console.log('\n=== HERMES RUNS ===');
const runs = (await j('GET', '/api/hermes-api/runs')).data || [];
for (const r of runs) {
  console.log(JSON.stringify({
    id: r.id, hermesRunId: r.hermesRunId, status: r.status,
    provider: r.provider, model: r.model,
    errorMessage: r.errorMessage,
    finalText: (r.finalText || '').slice(-400),
    eventCount: (r.events || []).length,
  }, null, 2));
}

import { writeFileSync } from 'node:fs';
writeFileSync('B:/AgenticOS/docs/overnight-repair/phase5-delegation-raw.json', JSON.stringify({ task: ft, runs }, null, 2));
console.log('\nSaved -> docs/overnight-repair/phase5-delegation-raw.json');
