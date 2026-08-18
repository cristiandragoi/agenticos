// TEST 6: prove evidence lives in PRODUCTION UserData DB, not dev DB.
// Also capture the conversationId for the TEST 1 chain.
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Database = require('B:/AgenticOS/server/node_modules/better-sqlite3');

const prod = 'C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db';
const dev = 'B:/AgenticOS/server/data/agentic-os.db';

const memoryIds = ['mem-1786900453833-bxn34l', 'mem-1786900453837-zatqtv', 'mem-1786900429158-t1ddfh', 'mem-1786900429175-ri4bv0'];
const candIds = ['cand-1786900453832-3zip77', 'cand-1786900453837-jv134u'];
const verIds = ['ver-2e0edf6f', 'ver-0ecf109f'];
const runIds = ['er-228cc2a3-9', 'er-71f13279-2'];

for (const [label, dbPath] of [['PROD', prod], ['DEV', dev]]) {
  console.log(`=== ${label} ${dbPath}`);
  try {
    const db = new Database(dbPath, { readonly: true });
    for (const id of memoryIds) {
      const r = db.prepare('SELECT COUNT(*) c FROM memory_records WHERE id = ?').get(id);
      console.log(`  mem ${id}: ${r.c}`);
    }
    for (const id of candIds) {
      const r = db.prepare('SELECT COUNT(*) c FROM memory_candidates WHERE id = ?').get(id);
      console.log(`  cand ${id}: ${r.c}`);
    }
    for (const id of verIds) {
      const r = db.prepare('SELECT COUNT(*) c FROM verifications WHERE id = ?').get(id);
      console.log(`  ver ${id}: ${r.c}`);
    }
    for (const id of runIds) {
      const r = db.prepare('SELECT COUNT(*) c FROM execution_runs WHERE id = ?').get(id);
      console.log(`  run ${id}: ${r.c}`);
    }
    // conversation for TEST1 chain
    const conv = db.prepare("SELECT id, title FROM conversations WHERE title = 'Production Memory Proof - Constraints' ORDER BY created_at DESC LIMIT 1").get();
    console.log('  conversation:', JSON.stringify(conv));
    // total memory + candidate counts
    const memTotal = db.prepare('SELECT COUNT(*) c FROM memory_records').get();
    const candTotal = db.prepare('SELECT COUNT(*) c FROM memory_candidates').get();
    console.log('  totals: memory_records', memTotal.c, 'memory_candidates', candTotal.c);
    db.close();
  } catch (e) { console.log('  ERR', String(e).slice(0, 150)); }
}
