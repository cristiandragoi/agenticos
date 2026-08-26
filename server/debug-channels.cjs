// Debug: why does seedChannels insert nothing? Reproduce the exact insert.
const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.resolve(__dirname, 'data/agentic-os.db');
const db = new Database(dbPath);
const t = new Date().toISOString();
const id = 'chan-debug-' + Date.now();
try {
  const info = db.prepare(
    `INSERT INTO revenue_distribution_channels (id, channel, capabilities, automation_allowed, human_gate_required, status, config, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(id, 'DEBUG_CHANNEL', JSON.stringify({discover: true}), 1, 0, 'configured', null, t, t);
  console.log('INSERT INFO:', JSON.stringify(info));
  const rows = db.prepare('SELECT id, channel, capabilities, automation_allowed FROM revenue_distribution_channels').all();
  console.log('ALL ROWS:', JSON.stringify(rows));
} catch (e) {
  console.log('INSERT ERROR:', e.message);
}
// cleanup
db.prepare('DELETE FROM revenue_distribution_channels WHERE id = ?').run(id);
db.close();
console.log('DONE');
