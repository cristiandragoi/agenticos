// Read-only pre-boot safety inspection of the Roaming (live) DB.
// Determines whether a backend relaunch could auto-dispatch paid work.
const Database = require('B:/AgenticOS/server/node_modules/better-sqlite3');
const ROAMING = 'C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db';
const db = new Database(ROAMING, { readonly: true });

function tables() {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name);
}
const t = tables();
console.log('=== supervisor control state ===');
try {
  const st = db.prepare("SELECT * FROM revenue_supervisor_state WHERE id='supervisor-singleton'").get();
  console.log(st ? JSON.stringify(st) : '(no supervisor state row — boots to ACTIVE default)');
} catch (e) { console.log('err:', e.message); }

console.log('\n=== running/queued goals (would auto-resume on boot?) ===');
if (t.includes('goals')) {
  try {
    const cols = db.prepare("PRAGMA table_info(goals)").all().map(c => c.name);
    console.log('goals cols:', cols.join(','));
    const rows = db.prepare("SELECT * FROM goals WHERE status IN ('running','executing','queued','planning','waiting_for_approval','waiting_approval','dispatching') ORDER BY rowid DESC LIMIT 10").all();
    console.log('active goals:', rows.length);
    for (const r of rows) console.log(JSON.stringify({id: r.id, status: r.status, created: r.created_at || r.createdAt}).slice(0,200));
  } catch (e) { console.log('err:', e.message); }
}

console.log('\n=== running/queued background tasks ===');
if (t.includes('background_tasks')) {
  try {
    const rows = db.prepare("SELECT id,status FROM background_tasks WHERE status IN ('running','queued','planning','dispatching','waiting_approval') ORDER BY rowid DESC LIMIT 10").all();
    console.log('active tasks:', rows.length);
    for (const r of rows) console.log(JSON.stringify(r));
  } catch (e) { console.log('err:', e.message); }
}

console.log('\n=== gate lock state (any tables with gate/lock) ===');
console.log(t.filter(n => /gate|lock|pause/i.test(n)));

db.close();
console.log('\nDONE (read-only)');
