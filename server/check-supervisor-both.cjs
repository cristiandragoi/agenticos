const Database = require('better-sqlite3');

function check(label, path) {
  console.log(`\n=== ${label}: ${path} ===`);
  try {
    const db = new Database(path, { readonly: true });
    const st = db.prepare('SELECT * FROM revenue_supervisor_state WHERE id = ?').get('supervisor-singleton');
    console.log('supervisor state:', JSON.stringify(st, null, 2));
    // Also list any other rows
    const all = db.prepare('SELECT id, control_state, cycle_count, last_cycle_at, updated_at FROM revenue_supervisor_state').all();
    console.log('all rows:', JSON.stringify(all, null, 2));
    db.close();
  } catch (e) {
    console.log('ERROR:', e.message);
  }
}

check('DEV DB', 'B:/AgenticOS/server/data/agentic-os.db');
check('ROAMING DB', 'C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db');
