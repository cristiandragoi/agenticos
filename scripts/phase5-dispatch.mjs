// Phase 5: dispatch a bounded Hermes planning+delegation task through the
// real path (POST /api/background-tasks -> dispatchTask -> dispatchHermesTask
// -> hermesApiService.createRun -> Hermes API :8643), then observe the full
// evidence chain (task + hermes run record + events).
const BASE = 'http://127.0.0.1:4001';

async function j(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

const objective = [
  'You are the Hermes planning orchestrator in Agentic OS.',
  'Perform a bounded, READ-ONLY repository inspection of the AgenticOS server source, and delegate the actual file inspection to CodeX.',
  '1. Decompose the inspection into 3-4 concrete read-only steps.',
  '2. Delegate the file reading and analysis to CodeX so CodeX executes against the repository (workspace B:/AgenticOS).',
  '3. Collect CodeX findings.',
  '4. Report truthfully: (a) your plan, (b) the delegated CodeX task/run identifier, (c) CodeX actual findings, (d) the provider/model you used.',
  'Do NOT modify any files.',
].join('\n');

console.log('=== PHASE 5 DISPATCH ===');
const create = await j('POST', '/api/background-tasks', {
  title: 'Phase 5: Hermes plan + delegate inspection to CodeX',
  objective,
  originalRequest: objective,
  worker: 'hermes',
  route: 'hermes',
  selectedAgent: 'hermes',
  workspacePath: 'B:\\AgenticOS',
});
console.log('create status', create.status);
if (create.status !== 201) { console.log(JSON.stringify(create.data, null, 2)); process.exit(1); }
const task = create.data;
console.log('taskId:', task.taskId, '| worker:', task.worker, '| status:', task.status);

// Poll until terminal or timeout.
const deadline = Date.now() + 6 * 60 * 1000;
let final = null;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 4000));
  const t = await j('GET', `/api/background-tasks/${task.taskId}`);
  const d = t.data || {};
  const status = d.status;
  const hermesRuns = (await j('GET', '/api/hermes-api/runs')).data || [];
  console.log(`[poll] ${new Date().toISOString().slice(11,19)} status=${status} stage=${d.currentStage || '-'} hermesRuns=${hermesRuns.length}`);
  if (['completed', 'failed', 'cancelled', 'blocked'].includes(status)) {
    final = d;
    break;
  }
}

console.log('\n=== FINAL TASK RECORD ===');
const finalTask = final || (await j('GET', `/api/background-tasks/${task.taskId}`)).data;
const meta = finalTask.metadata || {};
const pick = {
  taskId: finalTask.taskId,
  worker: finalTask.worker,
  status: finalTask.status,
  currentStage: finalTask.currentStage,
  linkedRunId: finalTask.linkedRunId,
  resultText: finalTask.resultText,
  lastError: finalTask.lastError,
  blocker: finalTask.blocker,
  assignedProvider: meta.assignedProvider,
  assignedModel: meta.assignedModel,
  effectiveProvider: meta.effectiveProvider,
  effectiveModel: meta.effectiveModel,
  workerInstanceId: meta.workerInstanceId,
  workspaceRoot: finalTask.workspaceRoot,
};
console.log(JSON.stringify(pick, null, 2));

console.log('\n=== HERMES RUN RECORD(s) ===');
const runs = (await j('GET', '/api/hermes-api/runs')).data || [];
for (const r of runs) {
  console.log(JSON.stringify({
    id: r.id,
    hermesRunId: r.hermesRunId,
    cardId: r.cardId,
    status: r.status,
    provider: r.provider,
    model: r.model,
    errorMessage: r.errorMessage,
    finalText: r.finalText ? r.finalText.slice(0, 2000) : null,
    eventCount: (r.events || []).length,
  }, null, 2));
}

console.log('\n=== HERMES RUN EVENTS (tool + terminal + completion) ===');
for (const r of runs) {
  const evs = r.events || [];
  const interesting = evs.filter((e) => ['tool.started', 'tool.completed', 'tool.failed', 'terminal.command', 'file.changed', 'run.completed', 'run.failed', 'error', 'approval.request'].includes(e.kind));
  console.log(`--- run ${r.id} (${evs.length} events, ${interesting.length} interesting) ---`);
  for (const e of interesting) {
    console.log(`  [${e.kind}] ${e.summary}${e.detail && e.detail.command ? ' :: ' + e.detail.command.slice(0, 200) : ''}`);
  }
}

// Save raw for later inspection.
import { writeFileSync } from 'node:fs';
writeFileSync('B:/AgenticOS/docs/overnight-repair/phase5-raw.json', JSON.stringify({ task: finalTask, runs }, null, 2));
console.log('\nSaved raw evidence -> docs/overnight-repair/phase5-raw.json');
