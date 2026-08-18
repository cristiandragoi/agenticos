// Production UserData DB: projects, memory state, candidates, conversations.
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Database = require('B:/AgenticOS/server/node_modules/better-sqlite3');
const db = new Database('C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db', { readonly: true });

console.log('=== PROJECTS ===');
try {
  const rows = db.prepare("SELECT id, name, status, workspace_path, created_at FROM projects ORDER BY created_at DESC LIMIT 10").all();
  for (const r of rows) console.log(JSON.stringify(r));
} catch (e) { console.log('projects ERR', String(e).slice(0,150)); }

console.log('=== MEMORY_RECORDS (by scope/status) ===');
try {
  const rows = db.prepare("SELECT scope, status, verification_status, COUNT(*) c FROM memory_records GROUP BY scope, status, verification_status ORDER BY c DESC LIMIT 20").all();
  for (const r of rows) console.log(JSON.stringify(r));
  const total = db.prepare("SELECT COUNT(*) c FROM memory_records").get();
  console.log('total memory_records:', total.c);
} catch (e) { console.log('mem ERR', String(e).slice(0,150)); }

console.log('=== MEMORY_CANDIDATES ===');
try {
  const c = db.prepare("SELECT COUNT(*) c FROM memory_candidates").get();
  console.log('candidates:', c.c);
  const rows = db.prepare("SELECT status, COUNT(*) c FROM memory_candidates GROUP BY status").all();
  for (const r of rows) console.log(JSON.stringify(r));
} catch (e) { console.log('cand ERR', String(e).slice(0,150)); }

console.log('=== RECENT CONVERSATIONS ===');
try {
  const rows = db.prepare("SELECT id, title, created_at FROM conversations ORDER BY created_at DESC LIMIT 5").all();
  for (const r of rows) console.log(JSON.stringify(r));
} catch (e) { console.log('conv ERR', String(e).slice(0,150)); }

db.close();
