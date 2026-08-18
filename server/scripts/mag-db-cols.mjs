// Inspect the LIVE backend DB schema for magnitude_runs columns.
import Database from 'better-sqlite3';
const db = new Database('C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db', { readonly: true });
const cols = db.prepare('PRAGMA table_info(magnitude_runs)').all();
console.log('COLUMNS:', cols.map((c) => c.name).join(', '));
db.close();
