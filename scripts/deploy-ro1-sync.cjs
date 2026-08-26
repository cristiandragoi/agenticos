/* RO1 deploy: controlled sync — server dist, frontend dist, drizzle migrations + journal */
const fs = require('fs');
const path = require('path');

const RES = 'C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources';
const REPO = 'B:/AgenticOS';

// ── 1. Server dist sync (recursive overwrite; never deletes packaged-only files) ──
fs.cpSync(path.join(REPO, 'server/dist'), path.join(RES, 'server/dist'), { recursive: true });
console.log('server dist synced');

// ── 2. Drizzle: ship 0021 + 0023 SQL ──
for (const f of ['0021_add_revenue_metrics.sql', '0023_revenue_operator.sql']) {
  fs.copyFileSync(path.join(REPO, 'server/drizzle', f), path.join(RES, 'server/drizzle', f));
  console.log('drizzle copied:', f);
}

// ── 3. Journal: append 0021 + 0023 entries (exact repo values) ──
const repoJournal = JSON.parse(fs.readFileSync(path.join(REPO, 'server/drizzle/meta/_journal.json'), 'utf-8'));
const pkgJournalPath = path.join(RES, 'server/drizzle/meta/_journal.json');
const pkgJournal = JSON.parse(fs.readFileSync(pkgJournalPath, 'utf-8'));
const have = new Set(pkgJournal.entries.map(e => e.tag));
let maxIdx = Math.max(...pkgJournal.entries.map(e => e.idx));
for (const tag of ['0021_add_revenue_metrics', '0023_revenue_operator']) {
  if (have.has(tag)) { console.log('journal already has', tag, '— skipped'); continue; }
  const src = repoJournal.entries.find(e => e.tag === tag);
  if (!src) throw new Error('repo journal missing ' + tag);
  maxIdx += 1;
  pkgJournal.entries.push({ idx: maxIdx, version: src.version, when: src.when, tag: src.tag, breakpoints: src.breakpoints });
  console.log('journal appended:', tag, 'idx', maxIdx, 'when', src.when);
}
fs.writeFileSync(pkgJournalPath, JSON.stringify(pkgJournal, null, 2) + '\n');
console.log('journal written,', pkgJournal.entries.length, 'entries');

// ── 4. Frontend dist sync ──
fs.cpSync(path.join(REPO, 'dist'), path.join(RES, 'app/dist'), { recursive: true });
console.log('frontend dist synced');

// ── 5. package.json parity check (report only) ──
const a = fs.readFileSync(path.join(REPO, 'server/package.json'), 'utf-8');
const b = fs.readFileSync(path.join(RES, 'server/package.json'), 'utf-8');
console.log('server package.json identical:', a === b);
console.log('SYNC COMPLETE');
