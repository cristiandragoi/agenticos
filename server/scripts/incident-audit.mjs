/**
 * incident-audit.mjs — classify every repair incident in the live database.
 *
 * Usage (from D:/AgenticOS/server):
 *   node scripts/incident-audit.mjs "<path to agentic-os.db>"
 *
 * Read-only. Answers: how many incidents are open, in which component, at what
 * status and priority, and when they were detected.
 */
import Database from 'better-sqlite3';

const DB = process.argv[2];
if (!DB) {
  console.error('Usage: node scripts/incident-audit.mjs <agentic-os.db>');
  process.exit(1);
}
const db = new Database(DB, { readonly: true });

const total = db.prepare('SELECT COUNT(*) c FROM repair_incidents').get().c;
const byStatus = db.prepare('SELECT status, COUNT(*) c FROM repair_incidents GROUP BY status ORDER BY c DESC').all();

const open = db.prepare(
  `SELECT id, status, component, failure_domain, priority, detected_at, substr(symptom,1,120) symptom
   FROM repair_incidents WHERE status NOT IN ('resolved','closed')
   ORDER BY detected_at DESC`,
).all();

// Deduplicate by (component, symptom) to separate D = duplicate from real defects.
const bySignature = {};
for (const r of open) {
  const key = `${r.component}::${(r.symptom || '').slice(0, 60)}`;
  (bySignature[key] ||= []).push(r.id);
}

console.log('DB               =', DB);
console.log('TOTAL_INCIDENTS  =', total);
console.log('OPEN_INCIDENTS   =', open.length);
console.log('DISTINCT_CAUSES  =', Object.keys(bySignature).length);
console.log('');
console.log('--- BY STATUS ---');
for (const r of byStatus) console.log(String(r.c).padStart(5), r.status);
console.log('');
console.log('--- OPEN BY COMPONENT ---');
const byComp = {};
for (const r of open) byComp[r.component] = (byComp[r.component] || 0) + 1;
for (const [c, n] of Object.entries(byComp).sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(5), c);
console.log('');
console.log('--- OPEN BY DOMAIN ---');
const byDom = {};
for (const r of open) byDom[r.failure_domain] = (byDom[r.failure_domain] || 0) + 1;
for (const [c, n] of Object.entries(byDom).sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(5), c);
console.log('');
console.log('--- OPEN BY PRIORITY ---');
const byPri = {};
for (const r of open) byPri[r.priority] = (byPri[r.priority] || 0) + 1;
for (const [c, n] of Object.entries(byPri).sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(5), c);
console.log('');
console.log('--- DEDUP: same cause, how many incident ids ---');
for (const [sig, ids] of Object.entries(bySignature).sort((a, b) => b[1].length - a[1].length)) {
  console.log(String(ids.length).padStart(4), sig, '=>', ids.slice(0, 6).join(',') + (ids.length > 6 ? ` +${ids.length - 6}` : ''));
}
console.log('');
console.log('--- OPEN INCIDENTS (newest first) ---');
for (const r of open) console.log(`${r.id} | ${r.status} | ${r.priority} | ${r.component} | ${r.detected_at} | ${r.symptom}`);
