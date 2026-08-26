const Database = require('better-sqlite3');
const db = new Database('B:/AgenticOS/server/data/agentic-os.db', { readonly: true });
const st = db.prepare('SELECT * FROM revenue_supervisor_state WHERE id = ?').get('supervisor-singleton');
console.log('supervisor state:', JSON.stringify(st, null, 2));
db.close();
