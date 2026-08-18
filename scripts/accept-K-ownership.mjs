// Verify candidate ownership: the 2 candidates each run produced must be
// project_id = the correct project, and no BRAVO/ALPHA bleed in candidate content.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Database = require('B:/AgenticOS/server/node_modules/better-sqlite3');
const db = new Database('C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db', { readonly: true });
const ALPHA = 'ROUTINE-K-ALPHA-7F3C91';
const BRAVO = 'ROUTINE-K-BRAVO-2D8E44';

for (const [label, runId, expectProject, ownMarker, foreignMarker] of [
  ['A', 'er-cfeca741-3', 'proj-41cdab8f', ALPHA, BRAVO],
  ['B', 'er-e9680e4c-6', 'proj-483ff8e9', BRAVO, ALPHA],
]) {
  const cands = db.prepare('SELECT * FROM memory_candidates WHERE source_run_id = ?').all(runId);
  console.log(`--- ${label} candidates ---`);
  for (const c of cands) {
    const blob = JSON.stringify(c);
    const own = (blob.match(new RegExp(ownMarker, 'g')) || []).length;
    const foreign = (blob.match(new RegExp(foreignMarker, 'g')) || []).length;
    console.log(`  id=${c.id} project_id=${c.project_id} status=${c.status} own=${own} foreign=${foreign} OWNERSHIP_OK=${c.project_id === expectProject}`);
  }
}
