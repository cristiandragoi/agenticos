import Database from 'better-sqlite3';

const dbPath = 'C:\\Users\\cd-pr\\AppData\\Roaming\\AgenticOS\\data\\agentic-os.db';
const db = new Database(dbPath, { readonly: true });

console.log('=== REVENUE MISSIONS ===');
const missions = db.prepare("SELECT * FROM revenue_missions WHERE project_id = 'proj-free-cash'").all();
console.log('Missions count:', missions.length);
for (const m of missions) {
  console.log(JSON.stringify(m, null, 2));
}

console.log('=== REVENUE EXPERIMENTS ===');
const experiments = db.prepare("SELECT * FROM revenue_experiments WHERE project_id = 'proj-free-cash'").all();
console.log('Experiments count:', experiments.length);
for (const ex of experiments) {
  console.log(JSON.stringify(ex, null, 2));
}

db.close();
