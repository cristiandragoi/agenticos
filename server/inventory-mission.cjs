const path = require('path');
const Database = require(path.resolve('B:/AgenticOS/server/node_modules/better-sqlite3'));

function inventory(label, dbPath) {
  console.log(`\n\n########## ${label} ##########`);
  console.log(`DB: ${dbPath}`);
  const db = new Database(dbPath, { readonly: true });

  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name);
  console.log('\n-- TABLES (relevant) --');
  console.log(tables.filter(t => /revenue|sched|routine|argus|mission|experiment|gate|briefing|supervisor/i.test(t)).join(', '));

  // Mission
  try {
    const missions = db.prepare('SELECT * FROM revenue_missions').all();
    console.log('\n-- revenue_missions --');
    missions.forEach(m => console.log(JSON.stringify(m, null, 2)));
  } catch (e) { console.log('missions err', e.message); }

  // Experiments grouped
  try {
    const exps = db.prepare('SELECT engine, status, COUNT(*) c FROM revenue_experiments GROUP BY engine, status ORDER BY engine, status').all();
    console.log('\n-- revenue_experiments (engine x status) --');
    exps.forEach(r => console.log(`  ${r.engine} | ${r.status} | ${r.c}`));
  } catch (e) { console.log('exps err', e.message); }

  // Gates
  try {
    const gates = db.prepare('SELECT gate_type, status, branch_paused, COUNT(*) c FROM revenue_human_gates GROUP BY gate_type, status, branch_paused').all();
    console.log('\n-- revenue_human_gates (type x status x paused) --');
    gates.forEach(r => console.log(`  ${r.gate_type} | ${r.status} | paused=${r.branch_paused} | ${r.c}`));
  } catch (e) { console.log('gates err', e.message); }

  // Briefings
  try {
    const briefs = db.prepare('SELECT type, idempotency_key, created_at FROM revenue_briefings ORDER BY created_at DESC').all();
    console.log('\n-- revenue_briefings --');
    briefs.forEach(b => console.log(`  ${b.type} | ${b.idempotency_key} | ${b.created_at}`));
  } catch (e) { console.log('briefings err', e.message); }

  // Schedules
  try {
    const sched = db.prepare('SELECT id, cron_expression, enabled, execution_type, routine_id, worker FROM schedules ORDER BY id').all();
    console.log('\n-- schedules --');
    sched.forEach(s => console.log(`  ${s.id} | ${s.cron_expression} | enabled=${s.enabled} | ${s.routine_id}`));
  } catch (e) { console.log('schedules err', e.message); }

  // Argus
  try {
    const contracts = db.prepare('SELECT id, goal_id, status, title FROM argus_contracts ORDER BY rowid DESC LIMIT 5').all();
    console.log('\n-- argus_contracts (latest) --');
    contracts.forEach(c => console.log(JSON.stringify(c)));
  } catch (e) { console.log('argus_contracts err', e.message); }
  try {
    const vers = db.prepare('SELECT id, contract_id, attempt, status, evidence_level, provider, model FROM argus_verifications ORDER BY rowid DESC LIMIT 5').all();
    console.log('\n-- argus_verifications (latest) --');
    vers.forEach(v => console.log(JSON.stringify(v)));
  } catch (e) { console.log('argus_verifications err', e.message); }

  db.close();
}

inventory('ROAMING (packaged canonical)', 'C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db');
inventory('DEV', 'B:/AgenticOS/server/data/agentic-os.db');
