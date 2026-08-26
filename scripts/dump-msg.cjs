// dump-msg.cjs — print full content of one conversation message by id (arg).
const Database = require('B:/AgenticOS/server/node_modules/better-sqlite3');
const DB = process.argv[2] || 'C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db';
const id = process.argv[3];
const db = new Database(DB, { readonly: true, fileMustExist: true });
try {
  const m = db.prepare('SELECT content FROM conversation_messages WHERE id = ?').get(id);
  if (!m) { console.log('NOT FOUND:', id); process.exit(1); }
  console.log(m.content);
} finally { db.close(); }
