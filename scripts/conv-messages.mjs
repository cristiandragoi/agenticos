// Read the stored messages for a conversation (roles + content previews).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const convId = process.argv[2] || 'conv-8334def4-';
const res = await fetch(`http://127.0.0.1:4000/api/jarvis/conversations/${convId}/messages`);
const msgs = await res.json();
if (!Array.isArray(msgs)) { console.log('NOT_ARRAY ' + JSON.stringify(msgs).slice(0, 200)); process.exit(0); }
for (const m of msgs) {
  console.log((m.role || '?').padEnd(6) + ' | ' + String(m.content || '').replace(/\s+/g, ' ').slice(0, 110));
}
