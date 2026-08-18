// Post-restart closure verification: candidate table + verification_status column in PRODUCTION UserData DB, and live API.
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const SERVER_NM = 'B:/AgenticOS/server/node_modules/';
const Database = require(path.join(SERVER_NM, 'better-sqlite3'));
const db = new Database('C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db', { readonly: true });
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'memory%' ORDER BY name").all();
console.log('memory tables:', tables.map(t => t.name).join(', '));
const cand = db.prepare("SELECT COUNT(*) c FROM memory_candidates").get();
console.log('memory_candidates rows:', cand.c);
const cols = db.prepare('PRAGMA table_info(memory_records)').all();
console.log('verification_status col present:', cols.some(c => c.name === 'verification_status'));
const vs = db.prepare("SELECT verification_status, COUNT(*) c FROM memory_records GROUP BY verification_status").all();
console.log('verification_status dist:', JSON.stringify(vs));
db.close();

// Live API
const API = 'http://127.0.0.1:4000/api';
for (const url of [`${API}/memory/candidates`, `${API}/memory/memories?limit=2`]) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const text = await res.text();
    console.log('API', url.split('/api/')[1], 'HTTP', res.status, text.slice(0, 160));
  } catch (e) { console.log('API ERR', url, String(e).slice(0, 100)); }
}
