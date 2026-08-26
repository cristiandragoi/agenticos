/* OVERNIGHT RO2 — inspect full execution_results output/structured_output */
const path = require('path');
const RES = 'C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources';
const Database = require(path.join(RES, 'server/node_modules/better-sqlite3'));
const db = new Database('C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db', { readonly: true });
const rows = db.prepare(`SELECT id, run_id, status, summary, structured_output, artifact_refs, metadata FROM execution_results WHERE run_id IN ('er-6cab84c3-a','er-4b882f3a-7')`).all();
for (const r of rows) {
  console.log('=== RESULT for run', r.run_id);
  console.log('summary len:', (r.summary || '').length);
  console.log('structured_output:', String(r.structured_output || '(null)').slice(0, 800));
  console.log('artifact_refs:', r.artifact_refs);
  console.log('metadata:', String(r.metadata || '').slice(0, 300));
}
// also the runs table output column
const runs = db.prepare(`SELECT id, output FROM execution_runs WHERE id IN ('er-6cab84c3-a','er-4b882f3a-7')`).all();
for (const r of runs) {
  console.log('=== RUN OUTPUT', r.id, ':', String(r.output || '(null)').slice(0, 1500));
}
db.close();
