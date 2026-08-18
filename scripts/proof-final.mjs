// Final consolidated evidence snapshot for the report.
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Database = require('B:/AgenticOS/server/node_modules/better-sqlite3');
const prod = 'C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db';
const dev = 'B:/AgenticOS/server/data/agentic-os.db';

console.log('=== TEST 1 chain (PASS run) ===');
const chain = {
  conversationId: 'conv-dcf0ff43-',
  projectId: 'proj-d95123d8',
  goalId: 'pg-f0b44dfe',
  taskId: 'pt-9bb47335',
  runId: 'er-228cc2a3-9',
  resultId: 'exr-95067c83-8',
  verificationId: 'ver-2e0edf6f',
  candidateIds: ['cand-1786900453832-3zip77', 'cand-1786900453837-jv134u'],
  memoryIds: ['mem-1786900453833-bxn34l', 'mem-1786900453837-zatqtv'],
};
for (const [k, v] of Object.entries(chain)) console.log(`  ${k}: ${JSON.stringify(v)}`);

console.log('=== PROD vs DEV counts ===');
for (const [label, p] of [['PROD', prod], ['DEV', dev]]) {
  const db = new Database(p, { readonly: true });
  const mem = db.prepare('SELECT COUNT(*) c FROM memory_records').get().c;
  const cand = db.prepare('SELECT COUNT(*) c FROM memory_candidates').get().c;
  const ver = db.prepare('SELECT COUNT(*) c FROM verifications').get().c;
  const promoted = db.prepare("SELECT COUNT(*) c FROM memory_records WHERE verification_status='verified'").get().c;
  const human = db.prepare("SELECT COUNT(*) c FROM memory_records WHERE verification_status='human_confirmed'").get().c;
  console.log(`  ${label}: memories=${mem} candidates=${cand} verifications=${ver} verified=${promoted} human_confirmed=${human}`);
  // proof IDs present?
  const proofMem = db.prepare("SELECT COUNT(*) c FROM memory_records WHERE id IN (?, ?)").get(chain.memoryIds[0], chain.memoryIds[1]).c;
  console.log(`    proof promoted memories present: ${proofMem}/2`);
  db.close();
}
