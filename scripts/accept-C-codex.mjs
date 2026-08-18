// Test C — CodeX read-only scheduled run. Selects B:\AgenticOS workspace,
// runs a read-only "identify primary language" analysis, verifies no repo changes.
import { createRequire } from 'module';
import { execSync } from 'child_process';
const require = createRequire(import.meta.url);
const API = 'http://127.0.0.1:4000/api';

async function post(path, body) {
  const r = await fetch(`${API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

// Select B:\AgenticOS as the canonical workspace.
const ws = await post('/workspace/select', { workspaceRoot: 'B:/AgenticOS' });
console.log('WORKSPACE_SELECT', JSON.stringify(ws.body));

// Snapshot git status before.
const before = execSync('git -C B:/AgenticOS status --porcelain', { encoding: 'utf8' });
console.log('GIT_STATUS_BEFORE_LINES=' + before.trim().split('\n').filter(Boolean).length);

const proj = await post('/projects', { name: `CodeX C ${Date.now()}`, workspacePath: 'B:/AgenticOS', tags: ['acceptance'] });
const projectId = proj.body.id;
const routine = await post('/routines', {
  projectId,
  name: 'CodeX ReadOnly Smoke Test C',
  objective: 'Analyze this repository and identify its primary programming language. Do not modify any files.',
  worker: 'codex',
  timeoutSeconds: 180,
  enabled: true,
});
console.log('ROUTINE_ID=' + routine.body.routineId);

const rn = await post(`/routines/${routine.body.routineId}/run-now`, {});
console.log('RUN_NOW', JSON.stringify(rn.body));

// Poll up to 4 min for terminal
const deadline = Date.now() + 240000;
let runs = [];
while (Date.now() < deadline) {
  runs = await (await fetch(`${API}/routines/${routine.body.routineId}/runs`)).json();
  if (runs.length > 0 && runs.some(r => ['completed','execution_failed','failed','dispatch_failed','cancelled'].includes(r.status))) { await new Promise(r=>setTimeout(r,5000)); runs = await (await fetch(`${API}/routines/${routine.body.routineId}/runs`)).json(); break; }
  await new Promise(r => setTimeout(r, 5000));
}
console.log('RUNS_VIEW', JSON.stringify(runs, null, 2));

const after = execSync('git -C B:/AgenticOS status --porcelain', { encoding: 'utf8' });
console.log('GIT_STATUS_AFTER_LINES=' + after.trim().split('\n').filter(Boolean).length);
// Only the scripts/*.mjs I created + deployed files should differ; count changed .mjs only for isolation.

const Database = require('B:/AgenticOS/server/node_modules/better-sqlite3');
const db = new Database('C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db', { readonly: true });
const row = (q,p) => { try { return db.prepare(q).get(...p); } catch(e){ return {_err:e.message}; } };
const execRow = row('SELECT * FROM schedule_executions WHERE routine_id=? ORDER BY triggered_at DESC LIMIT 1', [routine.body.routineId]);
console.log('SCHEDULE_EXEC', JSON.stringify(execRow));
if (execRow.run_id) {
  const run = row('SELECT status,worker_type,failure_reason FROM execution_runs WHERE id=?', [execRow.run_id]);
  console.log('RUN', JSON.stringify(run));
  if (execRow.result_id) {
    const result = row('SELECT summary FROM execution_results WHERE id=?', [execRow.result_id]);
    console.log('RESULT_SUMMARY', (result.summary||'').slice(0,200));
  }
  if (execRow.verification_id) {
    const v = row('SELECT verdict FROM verifications WHERE id=?', [execRow.verification_id]);
    console.log('VERDICT', JSON.stringify(v));
  }
}
db.close();
