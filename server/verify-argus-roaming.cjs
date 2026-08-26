const path = require('path');
const Database = require(path.resolve('B:/AgenticOS/server/node_modules/better-sqlite3'));
const db = new Database('C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db', { readonly: true });

console.log('=== ROAMING: Phase 2C ARGUS verification record ===');
const ver = db.prepare("SELECT id, contract_id, attempt, status, evidence_level, created_at, completed_at FROM argus_verifications WHERE contract_id='argus-revenue-phase2c-' ORDER BY rowid DESC LIMIT 1").get();
console.log(JSON.stringify(ver, null, 2));

console.log('\n=== ROAMING: contract status ===');
const con = db.prepare("SELECT id, status, updated_at FROM argus_contracts WHERE id='argus-revenue-phase2c-'").get();
console.log(JSON.stringify(con, null, 2));

console.log('\n=== ROAMING: supervisor state ===');
console.log(JSON.stringify(db.prepare("SELECT control_state, cycle_count, active_mission_id FROM revenue_supervisor_state WHERE id='supervisor-singleton'").get()));

console.log('\n=== ROAMING: gates (5 open + 5 resolved) ===');
console.log(JSON.stringify(db.prepare("SELECT status, COUNT(*) c FROM revenue_human_gates GROUP BY status").all()));

console.log('\n=== ROAMING: experiments (no IN_PROGRESS, 2 READY_TO_PUBLISH + 3 QA restored) ===');
console.log(JSON.stringify(db.prepare("SELECT status, COUNT(*) c FROM revenue_experiments WHERE mission_id='mission-616808fe-' GROUP BY status ORDER BY status").all()));

console.log('\n=== ROAMING: autonomous supervisor tasks (should be 0) ===');
console.log('task-sup-* count:', db.prepare("SELECT COUNT(*) c FROM tasks WHERE id LIKE 'task-sup-%'").get().c);

db.close();
