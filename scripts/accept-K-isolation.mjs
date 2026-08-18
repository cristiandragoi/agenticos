// Test K — Project Memory isolation (both directions).
// Seed ALPHA in Project A (proj-41cdab8f), BRAVO in a fresh Project B.
// Run a Hermes Routine bound to each, prove scoped retrieval + zero foreign leakage.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Database = require('B:/AgenticOS/server/node_modules/better-sqlite3');
const prodDb = new Database('C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db', { readonly: true });
const API = 'http://127.0.0.1:4000/api';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(path, body) { const r = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }); return { status: r.status, body: await r.json().catch(() => ({})) }; }
async function get(path) { const r = await fetch(API + path); return { status: r.status, body: await r.json().catch(() => ({})) }; }

const ALPHA = 'ROUTINE-K-ALPHA-7F3C91';
const BRAVO = 'ROUTINE-K-BRAVO-2D8E44';
const projectA = 'proj-41cdab8f';

// ── 1. Create a fresh Project B ──────────────────────────────────────────────
const projB = await post('/projects', { name: `MemoryIsoB ${Date.now()}`, tags: ['acceptance'] });
const projectB = projB.body.id;
console.log('PROJECT_A=' + projectA);
console.log('PROJECT_B=' + projectB);

// ── 2. Seed markers (human-confirmed, project-scoped) ────────────────────────
const memA = await post('/memory/memories', {
  type: 'decision', title: `Alpha isolation marker ${ALPHA}`,
  summary: `Project A owns the ${ALPHA} marker.`,
  content: `This durable fact is scoped to Project A only. Marker token: ${ALPHA}. It must never appear in Project B retrieval.`,
  scope: `project:${projectA}`, tags: ['research', 'verified', 'isolation'], human: true,
});
const memB = await post('/memory/memories', {
  type: 'decision', title: `Bravo isolation marker ${BRAVO}`,
  summary: `Project B owns the ${BRAVO} marker.`,
  content: `This durable fact is scoped to Project B only. Marker token: ${BRAVO}. It must never appear in Project A retrieval.`,
  scope: `project:${projectB}`, tags: ['research', 'verified', 'isolation'], human: true,
});
console.log('MEMORY_A_ID=' + memA.body.id);
console.log('MEMORY_B_ID=' + memB.body.id);

// ── 3. Helper: run a routine and extract provenance + leak analysis ──────────
async function runRoutine(projectId, label, marker) {
  const routine = await post('/routines', {
    projectId,
    name: `MemoryIso ${label}`,
    objective: `Identify any durable project facts currently stored in project memory. Report every distinct fact and its exact marker token. Do not invent facts.`,
    worker: 'hermes',
    taskTemplate: { objective: 'Identify durable project facts and report exact marker tokens.', worker: 'hermes', input: { mode: 'research' } },
    timeoutSeconds: 600,
  });
  const routineId = routine.body.routineId;
  const rn = await post(`/routines/${routineId}/run-now`);
  // run-now blocks until terminal (dispatches synchronously for schedule-less routines)
  const se = prodDb.prepare('SELECT * FROM schedule_executions WHERE routine_id = ? ORDER BY triggered_at DESC LIMIT 1').get(routineId);
  const run = prodDb.prepare('SELECT * FROM execution_runs WHERE id = ?').get(se.run_id);
  const result = run?.final_result_id ? prodDb.prepare('SELECT * FROM execution_results WHERE id = ?').get(run.final_result_id) : null;
  let meta = {};
  try { meta = result?.metadata ? JSON.parse(result.metadata) : {}; } catch {}
  const retrievedIds = meta?.memoryRetrieved?.memoryIds || [];
  const retrievedMemories = retrievedIds.map(id => prodDb.prepare('SELECT id, scope, title, content FROM memory_records WHERE id = ?').get(id)).filter(Boolean);
  // Foreign leakage: any retrieved memory whose scope is not this project.
  const foreign = retrievedMemories.filter(m => m.scope !== `project:${projectId}`);
  // Leak counts: does the foreign marker string appear in retrieved titles/content?
  const foreignMarker = (projectId === projectA ? BRAVO : ALPHA);
  const ownMarker = (projectId === projectA ? ALPHA : BRAVO);
  const summary = result?.summary || '';
  const structOut = result?.structured_output || '';
  const fullText = JSON.stringify(retrievedMemories) + ' ' + summary + ' ' + structOut;
  const foreignCount = (fullText.match(new RegExp(foreignMarker, 'g')) || []).length;
  const ownCount = (fullText.match(new RegExp(ownMarker, 'g')) || []).length;
  const promoted = prodDb.prepare("SELECT id, project_id, memory_id FROM memory_candidates WHERE source_run_id = ? AND status = 'promoted'").all(se.run_id);
  const verdict = prodDb.prepare('SELECT id, verdict FROM verifications WHERE target_run_id = ?').all(se.run_id);
  return {
    projectId, routineId, scheduleExecutionId: se.id, backgroundTaskId: se.background_task_id,
    projectTaskId: se.project_task_id, workerRunId: se.run_id, executionResultId: run?.final_result_id || null,
    verificationId: verdict[0]?.id || null, verdict: verdict[0]?.verdict || null,
    retrievedMemoryIds: retrievedIds, retrievedMemoryScopes: retrievedMemories.map(m => m.scope),
    retrievedMemoryProjectIds: retrievedMemories.map(m => m.scope),
    ownMarkerCount: ownCount, foreignMarkerCount: foreignCount,
    foreignScopedRetrievals: foreign.length,
    promotedCandidateIds: promoted.map(p => p.id),
    promotedScopes: promoted.map(p => p.project_id),
    promotedProjects: promoted.map(p => p.project_id),
  };
}

// ── 4. Direction 1: Project A ────────────────────────────────────────────────
console.log('--- Project A run ---');
const resA = await runRoutine(projectA, 'A', ALPHA);
console.log('RESULT_A=' + JSON.stringify(resA, null, 1));

// ── 5. Direction 2: Project B ────────────────────────────────────────────────
console.log('--- Project B run ---');
const resB = await runRoutine(projectB, 'B', BRAVO);
console.log('RESULT_B=' + JSON.stringify(resB, null, 1));

process.exit(0);
