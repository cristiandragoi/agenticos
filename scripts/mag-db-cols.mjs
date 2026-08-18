// Inspect the LIVE backend DB schema for magnitude_runs columns.
import Database from 'better-sqlite3';
const dbPath = 'C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db';
const db = new Database(dbPath, { readonly: true });
const cols = db.prepare(`PRAGMA table_info(magnitude_runs)`).all();
console.log('COLUMNS', cols.map((c) => c.name).join(', '));
db.close();
