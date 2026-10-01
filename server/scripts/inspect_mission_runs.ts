import Database from 'better-sqlite3';

const dbPath = 'C:\\Users\\cd-pr\\AppData\\Roaming\\AgenticOS\\data\\agentic-os.db';
const db = new Database(dbPath, { readonly: true });

const ex = db.prepare("SELECT * FROM revenue_experiments WHERE mission_id = 'mission-51b98315-'").all();
console.log('Experiments count:', ex.length);
for (const e of ex) {
  console.log(JSON.stringify(e, null, 2));
}

const runs = db.prepare("SELECT * FROM execution_runs WHERE project_id = 'proj-free-cash' AND created_at > '2026-09-22'").all();
console.log('Execution runs count:', runs.length);
for (const r of runs) {
  console.log(JSON.stringify(r, null, 2));
}

db.close();
