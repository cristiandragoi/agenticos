import Database from 'better-sqlite3';

const db = new Database('C:/Users/cd-pr/AppData/Roaming/AgenticOS/data/agentic-os.db', { readonly: true });
console.log('=== TABLES in Roaming DB ===');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log(tables.map((t: any) => t.name));

const credTable = tables.find((t: any) => t.name.includes('cred'));
if (credTable) {
  console.log('=== CREDENTIALS ===');
  console.log(db.prepare(`SELECT * FROM ${credTable.name}`).all());
} else {
  console.log('No credentials table found.');
}
db.close();
