// Verify the PASS promotion chain in PRODUCTION DB for run er-228cc2a3-9.
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Database = require('B:/AgenticOS/server/node_modules/better-sqlite3');
const db = new Database('C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db', { readonly: true });

const runId = 'er-228cc2a3-9';
const resultId = 'exr-95067c83-8';
const verId = 'ver-2e0edf6f';

console.log('=== VERIFICATION ===');
console.log(JSON.stringify(db.prepare('SELECT id, verdict, target_run_id FROM verifications WHERE id = ?').get(verId)));

console.log('=== CANDIDATES (promoted) ===');
const cands = db.prepare('SELECT id, project_id, source_run_id, source_result_id, verification_id, verification_verdict, cand_key, status, memory_id FROM memory_candidates WHERE source_run_id = ?').all(runId);
for (const c of cands) console.log(JSON.stringify(c));

console.log('=== PROMOTED MEMORIES (canonical) ===');
for (const c of cands) {
  if (c.memory_id) {
    const m = db.prepare('SELECT id, type, title, scope, status, verification_status, source_type, source_worker, content FROM memory_records WHERE id = ?').get(c.memory_id);
    console.log(JSON.stringify(m, null, 1));
  }
}

console.log('=== RUN metadata (memoryRetrieved) ===');
const run = db.prepare('SELECT metadata FROM execution_runs WHERE id = ?').get(runId);
console.log(run ? String(run.metadata) : 'no run');

console.log('=== RESULT metadata ===');
const res = db.prepare('SELECT metadata FROM execution_results WHERE id = ?').get(resultId);
console.log(res ? String(res.metadata) : 'no result');

db.close();
