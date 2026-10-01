const Database = require('better-sqlite3');
const path = require('path');
const dbPath = process.env.APPDATA + '/agenticos/data/agentic-os.db';
const db = new Database(dbPath);

console.log('--- SELFHEAL-2136 ---');
const inc2136 = db.prepare("SELECT * FROM repair_incidents WHERE id = 'SELFHEAL-2136'").get();
console.log(inc2136);

console.log('--- SELFHEAL-6158 ---');
const inc6158 = db.prepare("SELECT * FROM repair_incidents WHERE id = 'SELFHEAL-6158'").get();
console.log(inc6158);

console.log('--- GOALS for 2136 and 6158 ---');
const goals = db.prepare("SELECT goal_id, original_user_input, status, recovery_incident_id FROM goal_runs WHERE recovery_incident_id IN ('SELFHEAL-2136', 'SELFHEAL-6158') OR goal_id IN ('goal-1790545900080-d92z0', 'goal-1790545872590-8rsyl')").all();
console.log(goals);
