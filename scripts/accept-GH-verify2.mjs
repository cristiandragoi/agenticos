// Verify G3 (run_once → 1 recovery) + H3 (skip → 0 recovery) after restart.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Database = require('B:/AgenticOS/server/node_modules/better-sqlite3');
const db = new Database('C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db', { readonly: true });
const row = (q,p) => { try { return db.prepare(q).get(...p); } catch(e){ return {_err:e.message}; } };
const G3 = { rid: 'routine-a3072d74-3045-48b8-8779-4c134261410f', sid: 'sched-747071e9-a2dc-47d6-bcd8-1f558204d29f' };
const H3 = { rid: 'routine-58cb64a3-b7c8-4a2c-a1ba-e1957205a1b4', sid: 'sched-0bacfc42-5d4d-4d3f-8fe8-8c1ae05b2520' };
for (const [label, t] of [['G3', G3], ['H3', H3]]) {
  const s = row('SELECT enabled, misfire_policy, last_triggered_at, last_outcome FROM schedules WHERE id=?', [t.sid]);
  const rec = row('SELECT COUNT(*) c FROM schedule_executions WHERE routine_id=? AND trigger_type=?', [t.rid, 'recovery']).c;
  const sched = row('SELECT COUNT(*) c FROM schedule_executions WHERE routine_id=? AND trigger_type=?', [t.rid, 'schedule']).c;
  console.log(`${label}: misfire=${s?.misfire_policy} enabled=${s?.enabled} last_triggered=${s?.last_triggered_at}`);
  console.log(`${label}: recovery_executions=${rec} schedule_executions=${sched}`);
}
db.close();
