// Inspect the Hermes proof run: verification record, candidates, result, run metadata.
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Database = require('B:/AgenticOS/server/node_modules/better-sqlite3');
const db = new Database('C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db', { readonly: true });

const runId = 'er-71f13279-2';
const resultId = 'exr-79fbe082-4';
const verId = 'ver-0ecf109f';

console.log('=== VERIFICATION ===');
try {
  const v = db.prepare('SELECT * FROM verifications WHERE id = ?').get(verId);
  console.log(JSON.stringify(v, null, 1));
} catch (e) { console.log('ver ERR', String(e).slice(0, 150)); }

console.log('=== RESULT structured_output ===');
try {
  const r = db.prepare('SELECT id, run_id, task_id, status, structured_output, metadata FROM execution_results WHERE id = ?').get(resultId);
  if (r) {
    console.log('id', r.id, 'run', r.run_id, 'status', r.status);
    console.log('structured_output:', String(r.structured_output).slice(0, 1200));
    console.log('metadata:', String(r.metadata).slice(0, 500));
  } else console.log('no result row');
} catch (e) { console.log('res ERR', String(e).slice(0, 150)); }

console.log('=== CANDIDATES ===');
try {
  const cands = db.prepare('SELECT id, project_id, source_run_id, source_result_id, verification_id, verification_verdict, cand_key, status, memory_id FROM memory_candidates WHERE source_run_id = ?').all(runId);
  console.log('count', cands.length);
  for (const c of cands) console.log(JSON.stringify(c));
} catch (e) { console.log('cand ERR', String(e).slice(0, 150)); }

console.log('=== RUN metadata ===');
try {
  const run = db.prepare('SELECT id, status, final_result_id, metadata FROM execution_runs WHERE id = ?').get(runId);
  console.log(JSON.stringify(run, null, 1));
} catch (e) { console.log('run ERR', String(e).slice(0, 150)); }

db.close();
