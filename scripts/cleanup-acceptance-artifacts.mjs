// Cleanup acceptance/test artifact projects from the live API + repo DB.
// Mirrors src/lib/universeProjects.ts junk heuristics so the universe filter
// and the harness cleanup can never disagree.
const API = process.env.AGENTICOS_API || 'http://127.0.0.1:4000';
const { createRequire } = await import('module');
const require = createRequire(import.meta.url);

const JUNK_ID_PREFIX = /^proj-(hermes|plan|cancel|dsh|escape|truth|test)(-|$)/i;
const JUNK_NAME = /(\d{13}\s*$|smoke|acceptance|canonical|overnight|verifier evidence|isolation|\bpoc\b|escape test|provider truth|policy e2e|architecture test|cancellation test|hermes research|packaged codex|packaged production|memory proof|\bproof\b|\bdsh\b|^project:|^test$|codex c\b|magnitude b\b|misfire|runnow|cancelj|enablee|diagj|memoryisob)/i;
const JUNK_TAGS = /acceptance|fixture|smoke|harness|test/i;

function isJunk(p) {
  if (JUNK_ID_PREFIX.test(p.id || '')) return true;
  if (JUNK_NAME.test(p.name || '')) return true;
  if (Array.isArray(p.tags) && p.tags.some((t) => JUNK_TAGS.test(String(t)))) return true;
  return false;
}

const j = async (path, opts) => {
  const res = await fetch(API + path, opts);
  let body = null; try { body = await res.json(); } catch {}
  return { status: res.status, body };
};

// ── 1. Live API cleanup ────────────────────────────────────────────────────
const list = await j('/api/projects');
const junkLive = (list.body?.projects || []).filter(isJunk);
console.log(`LIVE: ${(list.body?.projects || []).length} total, ${junkLive.length} junk`);
let deletedLive = 0;
for (const p of junkLive) {
  const r = await j('/api/projects/' + p.id, { method: 'DELETE' });
  if (r.status === 200 || r.status === 204) { deletedLive++; console.log('  DELETE', p.id, p.name); }
  else console.log('  FAIL', p.id, p.name, r.status);
}
const after = await j('/api/projects');
console.log(`LIVE AFTER: ${(after.body?.projects || []).length} projects`);
for (const p of after.body?.projects || []) console.log('  REMAIN', p.id, '|', p.name);

// ── 2. Repo DB cleanup (dev data dir; keep the real AgenticOS project) ─────
const REPO_DB = 'B:/AgenticOS/server/data/agentic-os.db';
try {
  const Database = require('B:/AgenticOS/server/node_modules/better-sqlite3');
  const db = new Database(REPO_DB);
  const rows = db.prepare('SELECT id, name, tags FROM projects').all();
  const junkRepo = rows.filter((r) => isJunk({ id: r.id, name: r.name, tags: (r.tags ? JSON.parse(r.tags) : []) }));
  console.log(`\nREPO DB: ${rows.length} total, ${junkRepo.length} junk`);
  for (const r of junkRepo) {
    db.prepare('DELETE FROM projects WHERE id = ?').run(r.id);
    console.log('  DELETE', r.id, r.name);
  }
  const remain = db.prepare('SELECT id, name FROM projects').all();
  console.log('REPO DB AFTER:');
  for (const r of remain) console.log('  REMAIN', r.id, '|', r.name);
  db.close();
} catch (e) {
  console.log('REPO DB cleanup skipped:', e.message);
}
