import Database from 'better-sqlite3';

const db = new Database('C:/Users/cd-pr/AppData/Roaming/AgenticOS/data/agentic-os.db', { readonly: true });
console.log('=== MISSIONS in Roaming DB ===');
const missions = db.prepare("SELECT * FROM revenue_missions").all();
console.log(JSON.stringify(missions, null, 2));

console.log('=== TABLES in Roaming DB ===');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log(tables.map((t: any) => t.name));

const credTable = tables.find((t: any) => t.name.includes('cred'));
if (credTable) {
  console.log('=== CREDENTIALS ===');
  console.log(db.prepare(`SELECT * FROM ${credTable.name}`).all());
}

console.log('=== EXPERIMENTS in Roaming DB ===');
const experiments = db.prepare("SELECT * FROM revenue_experiments").all();
console.log(JSON.stringify(experiments, null, 2));

db.close();
