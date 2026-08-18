// TEST 5 post-restart: verify promoted memories + candidate links + retrieval IDs survive.
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Database = require('B:/AgenticOS/server/node_modules/better-sqlite3');
const db = new Database('C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db', { readonly: true });

console.log('=== PROMOTED MEMORIES (should survive restart) ===');
const promoted = db.prepare("SELECT id, title, status, verification_status, scope FROM memory_records WHERE verification_status = 'verified'").all();
for (const m of promoted) console.log(JSON.stringify(m));

console.log('=== CANDIDATE -> MEMORY LINKS ===');
const links = db.prepare("SELECT id, status, memory_id, verification_verdict FROM memory_candidates WHERE status = 'promoted'").all();
for (const l of links) console.log(JSON.stringify(l));

console.log('=== CODEX GOAL runSummary (retrieval persistence) ===');
const goal = db.prepare("SELECT id, status, run_summary FROM goals WHERE id = 'goal-b6213f20-'").get();
if (goal) {
  let rs = null; try { rs = typeof goal.run_summary === 'string' ? JSON.parse(goal.run_summary) : goal.run_summary; } catch {}
  console.log('goal status', goal.status, 'memoryRetrieved', JSON.stringify(rs?.memoryRetrieved));
} else console.log('codex goal not found');

console.log('=== ACTIVE MEMORY COUNTS ===');
const active = db.prepare("SELECT COUNT(*) c FROM memory_records WHERE status='active'").get();
const superseded = db.prepare("SELECT COUNT(*) c FROM memory_records WHERE status='superseded'").get();
console.log('active', active.c, 'superseded', superseded.c);
db.close();
