// Ground truth: last 10 messages of the active Jarvis conversation in the
// DEPLOYED DB (role, content prefix, provider/model metadata).
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.join(__dirname, '..', 'server');
const require = createRequire(path.join(serverDir, 'package.json'));
const Database = require('better-sqlite3');
const db = new Database(process.argv[2] || path.join(serverDir, 'data', 'agentic-os.db'), { readonly: true });
const rows = db.prepare(`
  SELECT id, role, content, json_extract(metadata, '$.provider') AS provider,
         json_extract(metadata, '$.model') AS model, created_at
  FROM conversation_messages
  WHERE conversation_id = 'conv-e41484b4-'
  ORDER BY created_at DESC, rowid DESC LIMIT 4
`).all();
for (const r of rows.reverse()) {
  console.log(`[${r.created_at}] ${r.role} | ${r.provider || ''}/${r.model || ''}`);
  console.log(`  FULL: ${JSON.stringify(r.content)}`);
}
db.close();
