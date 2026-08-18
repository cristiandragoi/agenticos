// P20 + P22 + P23 live fixtures: completion gating without workers.
import { writeFileSync } from 'node:fs';
const API = 'http://localhost:4000/api';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function createTask(body) {
  const r = await fetch(`${API}/background-tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dispatch: false, projectId: 'proj-ac4c89f0', workspacePath: 'B:/AgenticOS', worker: 'codex', selectedAgent: 'CodeX', ...body }) });
  return r.json();
}
async function getTask(id) { return (await fetch(`${API}/background-tasks/${id}`)).json(); }

// ── P22: failing required gate → NOT completed, evidence persisted ──────────
const p22 = await createTask({
  title: 'P22 fixture — gate failure blocks completion',
  objective: 'Controlled gate-failure fixture.',
  metadata: { gates: [{ type: 'file-exists', id: 'required-artifact', path: 'scripts/p22-missing-artifact.json', required: true }] },
});
console.log('P22_CREATED ' + p22.taskId);
const v22 = await (await fetch(`${API}/background-tasks/${p22.taskId}/gates/verify`, { method: 'POST' })).json();
const t22 = await getTask(p22.taskId);
console.log('P22_VERIFY ' + JSON.stringify({ allRequiredPassed: v22.allRequiredPassed, results: v22.results?.map((r) => ({ gateId: r.gateId, status: r.status, reason: r.reason })) }));
console.log('P22_TASK ' + JSON.stringify({ status: t22.status, verificationState: t22.verificationState, blocker: t22.blocker, gateResults: (t22.metadata?.gateResults || []).map((g) => ({ gateId: g.gateId, status: g.status, evidence: (g.evidence || []).slice(0, 2) })) }));

// ── P23: retry/re-run — gate fails, rework (create the file), re-run passes ─
const p23 = await createTask({
  title: 'P23 fixture — gate retry after rework',
  objective: 'Controlled retry fixture.',
  metadata: { gates: [{ type: 'file-exists', id: 'rework-artifact', path: 'scripts/p23-output-v2.json', required: true, retryOnFail: true, maxRetries: 2 }] },
});
console.log('P23_CREATED ' + p23.taskId);
const v23a = await (await fetch(`${API}/background-tasks/${p23.taskId}/gates/verify`, { method: 'POST' })).json();
const t23a = await getTask(p23.taskId);
console.log('P23_ATTEMPT1 ' + JSON.stringify({ allRequiredPassed: v23a.allRequiredPassed, status: t23a.status, verificationState: t23a.verificationState, resumable: t23a.resumable }));
// the "rework": produce the artifact (this is what CodeX would do after
// receiving the gate-failure evidence summary)
writeFileSync('scripts/p23-output-v2.json', JSON.stringify({ produced: true, by: 'P23 rework step' }));
await sleep(500);
const v23b = await (await fetch(`${API}/background-tasks/${p23.taskId}/gates/verify`, { method: 'POST' })).json();
const t23b = await getTask(p23.taskId);
console.log('P23_ATTEMPT2 ' + JSON.stringify({ allRequiredPassed: v23b.allRequiredPassed, status: t23b.status, verificationState: t23b.verificationState, progressMessage: t23b.progressMessage }));

// ── P20: human approval — pending blocks completion; explicit approval completes
const p20 = await createTask({
  title: 'P20 fixture — human approval gate',
  objective: 'Controlled human-approval fixture.',
  resultText: 'Fixture work finished; awaiting human review.',
  metadata: { gates: [{ type: 'human-approval', id: 'human-review', required: true, reason: 'Review the fixture output before completion.' }] },
});
console.log('P20_CREATED ' + p20.taskId);
const v20a = await (await fetch(`${API}/background-tasks/${p20.taskId}/gates/verify`, { method: 'POST' })).json();
const t20a = await getTask(p20.taskId);
console.log('P20_PENDING ' + JSON.stringify({ allRequiredPassed: v20a.allRequiredPassed, status: t20a.status, verificationState: t20a.verificationState, gateStatus: (t20a.metadata?.gateResults || [])[0]?.status }));
// NOT completed at this point — the invariant. Now the explicit human action:
const v20b = await (await fetch(`${API}/background-tasks/${p20.taskId}/gates/human-review/approve`, { method: 'POST' })).json();
const t20b = await getTask(p20.taskId);
console.log('P20_APPROVED ' + JSON.stringify(v20b));
console.log('P20_TASK ' + JSON.stringify({ status: t20b.status, verificationState: t20b.verificationState, progressMessage: t20b.progressMessage, gateStatus: (t20b.metadata?.gateResults || [])[0]?.status, approvedGates: t20b.metadata?.approvedGates }));
