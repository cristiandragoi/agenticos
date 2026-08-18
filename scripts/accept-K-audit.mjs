// Deep leak audit: grep the FULL raw artifacts (result content, structured_output,
// verification JSON, candidates) of both runs for each marker, byte-level.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Database = require('B:/AgenticOS/server/node_modules/better-sqlite3');
const db = new Database('C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db', { readonly: true });
const ALPHA = 'ROUTINE-K-ALPHA-7F3C91';
const BRAVO = 'ROUTINE-K-BRAVO-2D8E44';

function audit(label, runId) {
  const run = db.prepare('SELECT * FROM execution_runs WHERE id = ?').get(runId);
  const result = run?.final_result_id ? db.prepare('SELECT * FROM execution_results WHERE id = ?').get(run.final_result_id) : null;
  const verifications = db.prepare('SELECT * FROM verifications WHERE target_run_id = ?').all(runId);
  const candidates = db.prepare('SELECT * FROM memory_candidates WHERE source_run_id = ?').all(runId);
  const blob = JSON.stringify({ run, result, verifications, candidates });
  const alpha = (blob.match(new RegExp(ALPHA, 'g')) || []).length;
  const bravo = (blob.match(new RegExp(BRAVO, 'g')) || []).length;
  console.log(`${label}: runId=${runId} resultId=${run?.final_result_id} ALPHA_occurrences=${alpha} BRAVO_occurrences=${bravo} candidateRows=${candidates.length}`);
  return { alpha, bravo };
}

// Project A run (should contain ALPHA only)
const a = audit('PROJECT_A_RAW', 'er-cfeca741-3');
// Project B run (should contain BRAVO only)
const b = audit('PROJECT_B_RAW', 'er-e9680e4c-6');

console.log('---');
console.log('A: ALPHA expected>0, BRAVO must be 0 -> ' + (a.alpha > 0 && a.bravo === 0 ? 'PASS' : 'FAIL'));
console.log('B: BRAVO expected>0, ALPHA must be 0 -> ' + (b.bravo > 0 && b.alpha === 0 ? 'PASS' : 'FAIL'));

// Also confirm the seeded memory scopes are correct
const mA = db.prepare('SELECT id, scope FROM memory_records WHERE id = ?').get('mem-1786912153446-780n91');
const mB = db.prepare('SELECT id, scope FROM memory_records WHERE id = ?').get('mem-1786912153453-7mwat7');
console.log('MEM_A_SCOPE=' + mA.scope);
console.log('MEM_B_SCOPE=' + mB.scope);
