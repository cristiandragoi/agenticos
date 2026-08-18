// Query the DEPLOYED agentic-os.db for the latest Jarvis conversation's
// messages and their persisted provider/model metadata (runtime ground
// truth of what actually served each turn). Read-only.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.join(__dirname, '..', 'server');
const require = createRequire(path.join(serverDir, 'package.json'));
const Database = require('better-sqlite3');
const dbPath = process.argv[2];

const db = new Database(dbPath, { readonly: true });

// Latest conversations, newest first
const convs = db.prepare(`SELECT id, title, created_at, updated_at FROM conversations ORDER BY updated_at DESC LIMIT 6`).all();
console.log('LATEST CONVERSATIONS:');
for (const c of convs) console.log(JSON.stringify(c));

// For each of the 3 newest conversations, dump the last 4 messages with metadata
for (const c of convs.slice(0, 3)) {
  console.log(`\n=== CONV ${c.id} (${String(c.title || '').slice(0, 40)}) ===`);
  const msgs = db.prepare(`SELECT role, content, metadata, created_at FROM conversation_messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 4`).all(c.id);
  for (const m of msgs) {
    let meta = '';
    try { meta = JSON.stringify(JSON.parse(m.metadata || '{}')); } catch { meta = String(m.metadata || '').slice(0, 120); }
    console.log(`[${m.role}] ${String(m.content || '').slice(0, 90).replace(/\n/g, ' ')}`);
    console.log(`    meta: ${meta.slice(0, 300)}`);
  }
}
db.close();
