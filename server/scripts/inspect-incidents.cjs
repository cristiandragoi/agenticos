const Database = require('better-sqlite3');
const db = new Database(process.env.APPDATA + '/agenticos/data/agentic-os.db');

console.log('--- 2136 ---');
const inc2136 = db.prepare("SELECT * FROM repair_incidents WHERE id = 'SELFHEAL-2136'").get();
console.log(inc2136);
const goal2136 = db.prepare("SELECT * FROM goal_runs WHERE goal_id = 'goal-1790545900080-d92z0'").get();
console.log(goal2136);

console.log('\n--- 6158 ---');
const inc6158 = db.prepare("SELECT * FROM repair_incidents WHERE id = 'SELFHEAL-6158'").get();
console.log(inc6158);
const goal6158 = db.prepare("SELECT * FROM goal_runs WHERE goal_id = 'goal-1790545872590-8rsyl'").get();
console.log(goal6158);
