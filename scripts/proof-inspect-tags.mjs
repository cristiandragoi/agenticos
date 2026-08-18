// Inspect the actual tags/content of the retrieved memories to find the filter gap.
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Database = require('B:/AgenticOS/server/node_modules/better-sqlite3');
const db = new Database('C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db', { readonly: true });

for (const id of ['mem-1786900453833-bxn34l', 'mem-1786900429158-t1ddfh', 'mem-1786900453837-zatqtv', 'mem-1786900429175-ri4bv0']) {
  const m = db.prepare('SELECT id, type, title, tags, content FROM memory_records WHERE id = ?').get(id);
  console.log('---', id);
  console.log('  type', m?.type, '| title', m?.title);
  console.log('  tags', JSON.stringify(m?.tags));
  console.log('  content', JSON.stringify(m?.content));
}
db.close();
