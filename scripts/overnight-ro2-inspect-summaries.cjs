/* OVERNIGHT RO2 — inspect actual execution summaries for discovery runs */
const path = require('path');
const RES = 'C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources';
const Database = require(path.join(RES, 'server/node_modules/better-sqlite3'));
const db = new Database('C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db', { readonly: true });
const runs = db.prepare(`
  SELECT er.id, er.status, er.start_time, exr.summary, exr.status AS result_status
  FROM execution_runs er
  LEFT JOIN execution_results exr ON exr.run_id = er.id
  WHERE er.id LIKE 'er-6cab84c3%' OR er.id LIKE 'er-4b882f3a%'
  ORDER BY er.created_at DESC LIMIT 4`).all();
for (const r of runs) {
  console.log('=== RUN', r.id, r.status, 'result_status:', r.result_status);
  console.log('SUMMARY (first 1800 chars):');
  console.log(String(r.summary || '(null)').slice(0, 1800));
  console.log('');
}
db.close();
