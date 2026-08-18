// Live normal-path request with ORDERED frame capture: records every SSE
// event in arrival order, then compares the concatenated deltas to what the
// backend persisted for that operationId.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.join(__dirname, '..', 'server');
const require = createRequire(path.join(serverDir, 'package.json'));
const Database = require('better-sqlite3');

const BASE = 'http://127.0.0.1:4000';
const CONV = 'conv-e41484b4-';
const operationId = `jarvis-order-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const prompt = 'What model are you using?';

const res = await fetch(`${BASE}/api/jarvis/conversations/${CONV}/message/stream`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt, operationId, inputChannel: 'typed' }),
  signal: AbortSignal.timeout(90000),
});
const reader = res.body.getReader();
const decoder = new TextDecoder();
let buf = '';
const frames = [];
let seq = 0;
while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  buf += decoder.decode(value, { stream: true });
  const parts = buf.split('\n\n');
  buf = parts.pop() || '';
  for (const p of parts) {
    const dl = p.split('\n').find((l) => l.startsWith('data:'));
    if (!dl) continue;
    const raw = dl.slice(5).trim();
    if (!raw || raw === '[DONE]') continue;
    let ev;
    try { ev = JSON.parse(raw); } catch { continue; }
    seq += 1;
    frames.push({ seq, type: ev.type || ev.event || '?', delta: ev.delta, marker: ev.marker });
  }
}
const deltas = frames.filter((f) => typeof f.delta === 'string').map((f) => f.delta).join('');
console.log('OP:', operationId);
console.log('FRAMES:', frames.map((f) => `${f.seq}:${f.type}${f.delta ? `"${f.delta.slice(0, 30)}"` : f.marker ? `(${f.marker})` : ''}`).join(' ').slice(0, 1500));
console.log('CLIENT_JOINED_DELTAS:', JSON.stringify(deltas));

// What did the backend persist for this operation?
const db = new Database(process.argv[2] || path.join(serverDir, 'data', 'agentic-os.db'), { readonly: true });
const msgs = db.prepare(`
  SELECT role, content FROM conversation_messages
  WHERE conversation_id = ? AND (content LIKE ? OR metadata LIKE ?)
  ORDER BY rowid DESC LIMIT 3
`).all(CONV, `%${prompt.slice(0, 20)}%`, `%${operationId}%`);
db.close();
console.log('DB_LAST_MATCHES:');
for (const m of msgs.slice(0, 3)) console.log(`  ${m.role}: ${JSON.stringify(m.content.slice(0, 300))}`);
