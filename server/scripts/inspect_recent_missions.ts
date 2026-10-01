import Database from 'better-sqlite3';

const dbPath = 'C:\\Users\\cd-pr\\AppData\\Roaming\\AgenticOS\\data\\agentic-os.db';
const db = new Database(dbPath, { readonly: true });

const missions = db.prepare("SELECT * FROM revenue_missions WHERE created_at > '2026-09-22' ORDER BY created_at DESC").all();
console.log('Recent missions count:', missions.length);
for (const m of missions) {
  console.log(JSON.stringify(m, null, 2));
}

db.close();
