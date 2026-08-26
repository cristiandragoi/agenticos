// final-leave-state.cjs — READ-ONLY leave-state verification (no writes).
const Database = require('B:/AgenticOS/server/node_modules/better-sqlite3');
const db = new Database('C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db', { readonly: true });
function q(sql, ...p) { try { return db.prepare(sql).all(...p); } catch (e) { return [{ ERROR: e.message }]; } }

console.log('=== FINAL LEAVE-STATE (Roaming, read-only) ===');
const sup = q("SELECT control_state, cycle_count, active_mission_id FROM revenue_supervisor_state WHERE id='supervisor-singleton'");
console.log('Supervisor:', JSON.stringify(sup[0]));

const gates = q("SELECT status, gate_type, COUNT(*) n FROM revenue_human_gates GROUP BY status, gate_type ORDER BY status");
console.log('Gates:', JSON.stringify(gates));

const tasks = q("SELECT COUNT(*) n FROM tasks WHERE id LIKE 'task-sup-%'");
console.log('Autonomous supervisor tasks (task-sup-*):', tasks[0].n);

const ext = q("SELECT entry_type, COUNT(*) n FROM revenue_ledger_entries GROUP BY entry_type");
console.log('Ledger by type:', JSON.stringify(ext));

const experiments = q("SELECT status, COUNT(*) n FROM revenue_experiments GROUP BY status ORDER BY status");
console.log('Experiments by status:', JSON.stringify(experiments));

const argus = q("SELECT id, status, evidence_level, created_at FROM argus_verifications ORDER BY created_at DESC LIMIT 3");
console.log('Recent ARGUS verifications:', JSON.stringify(argus));

db.close();
console.log('\nLEAVE-STATE CHECK DONE');
