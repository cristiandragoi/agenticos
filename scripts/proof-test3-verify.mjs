// TEST 3/4 evidence: Hermes run er-1a7cd097-0 retrieval metadata + isolation check.
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Database = require('B:/AgenticOS/server/node_modules/better-sqlite3');
const db = new Database('C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db', { readonly: true });

const runId = 'er-1a7cd097-0';
const res = db.prepare('SELECT metadata FROM execution_results WHERE run_id = ?').get(runId);
console.log('RESULT metadata:', res ? String(res.metadata) : 'none');

let metadata = null;
try { metadata = JSON.parse(res.metadata); } catch {}
const retrieved = metadata?.memoryRetrieved?.memoryIds || [];
console.log('RETRIEVED IDs:', JSON.stringify(retrieved));
console.log('--- retrieved memory details ---');
for (const mid of retrieved) {
  const m = db.prepare('SELECT id, title, scope, tags, content FROM memory_records WHERE id = ?').get(mid);
  console.log(`  ${mid} scope=${m?.scope} title=${m?.title}`);
  console.log(`    content=${(m?.content||'').slice(0,80)}`);
}
console.log('--- isolation checks ---');
console.log('Spain (project B) leaked into PROJ_A retrieval:', retrieved.some((id) => {
  const m = db.prepare('SELECT scope FROM memory_records WHERE id = ?').get(id);
  return m?.scope !== 'project:proj-d95123d8';
}) ? 'YES (FAIL)' : 'NO (PASS)');
console.log('engineering-debug (stacktrace) retrieved:', retrieved.includes('mem-1786901507698-sgzttp') ? 'YES (FAIL)' : 'NO (PASS)');
console.log('research Germany retrieved:', retrieved.includes('mem-1786901507684-ymtecg') ? 'YES (PASS)' : 'NO');
console.log('constraint no cold outreach retrieved:', retrieved.includes('mem-1786901507693-xwgsed') ? 'YES (PASS)' : 'NO');
db.close();
