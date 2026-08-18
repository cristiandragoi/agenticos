// F/G/H verify — after restart + missed fire window.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Database = require('B:/AgenticOS/server/node_modules/better-sqlite3');
const db = new Database('C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db', { readonly: true });
const row = (q,p) => { try { return db.prepare(q).get(...p); } catch(e){ return {_err:e.message}; } };

const F = { rid: 'routine-68847a1a-f707-491e-970e-d9cd0eeb8bbb', sid: 'sched-3937f71b-9ed4-4734-976e-341f476abe3a' };
const G = { rid: 'routine-8cca83b2-87fd-4f8a-943b-c0d68daf2a8a', sid: 'sched-97bc8593-930e-447f-a3ac-bf3cb6186985' };
const H = { rid: 'routine-848474ba-a503-4427-ba66-298ac16e8657', sid: 'sched-d1725133-ba67-4aaa-87e2-f8a420a910f2' };

for (const [label, t] of [['F', F], ['G', G], ['H', H]]) {
  const r = row('SELECT enabled FROM routines WHERE routine_id=?', [t.rid]);
  const s = row('SELECT enabled, misfire_policy, last_triggered_at, last_outcome FROM schedules WHERE id=?', [t.sid]);
  const byTrigger = (trigger) => row('SELECT COUNT(*) c FROM schedule_executions WHERE routine_id=? AND trigger_type=?', [t.rid, trigger]).c;
  console.log(`${label}: routine_enabled=${r?.enabled} schedule_enabled=${s?.enabled} misfire=${s?.misfire_policy}`);
  console.log(`${label}: last_triggered=${s?.last_triggered_at} last_outcome=${s?.last_outcome}`);
  console.log(`${label}: executions recovery=${byTrigger('recovery')} schedule=${byTrigger('schedule')} manual=${byTrigger('manual')}`);
}
db.close();
