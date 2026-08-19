// Check all queued goals in live DB + whether goals list includes lease fields
const path = require('path');
const Database = require(path.resolve(__dirname, '../server/node_modules/better-sqlite3'));

const db = new Database('C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db', { readonly: true });
const queued = db.prepare('SELECT id, status, worker_id, lease_expires_at, created_at, updated_at FROM goals WHERE status = ?').all('queued');
console.log('QUEUED GOALS:', JSON.stringify(queued, null, 1));

const evt = db.prepare('SELECT count(*) c FROM goal_events WHERE goal_id = ?').get('goal-b6c255ab');
console.log('ZOMBIE EVENTS:', JSON.stringify(evt));

const steps = db.prepare('SELECT count(*) c FROM goal_steps WHERE goal_id = ?').get('goal-b6c255ab');
console.log('ZOMBIE STEPS:', JSON.stringify(steps));

// check the goals list response fields via API
db.close();
