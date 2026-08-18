// Deployed DB: last 8 messages of the active conversation with metadata
// (operationId, provider, model, intent fields if present).
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.join(__dirname, '..', 'server');
const require = createRequire(path.join(serverDir, 'package.json'));
const Database = require('better-sqlite3');
const db = new Database(process.argv[2] || path.join(serverDir, 'data', 'agentic-os.db'), { readonly: true });
const rows = db.prepare(`
  SELECT id, role, substr(content, 1, 120) AS content, metadata, created_at
  FROM conversation_messages
  WHERE conversation_id = 'conv-e41484b4-'
  ORDER BY created_at DESC, rowid DESC LIMIT 8
`).all();
for (const r of rows.reverse()) {
  let meta = '{}';
  try { meta = JSON.stringify(JSON.parse(r.metadata || '{}')).slice(0, 400); } catch { meta = String(r.metadata).slice(0, 400); }
  console.log(`[${r.created_at}] ${r.role} | ${r.content}\n    META: ${meta}`);
}
db.close();
