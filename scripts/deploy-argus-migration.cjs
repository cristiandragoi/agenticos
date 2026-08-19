/* Deploy ARGUS migration 0022 to packaged app drizzle folder (no revenue 0021).
 * 1. Copy 0022_argus.sql from source drizzle
 * 2. Append journal entry {idx:21, tag:'0022_argus'} to packaged _journal.json
 */
const fs = require('fs');
const path = require('path');

const SRC = 'B:/AgenticOS/server/drizzle/0022_argus.sql';
const DEP = 'C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources/server/drizzle';
const journalPath = path.join(DEP, 'meta', '_journal.json');

const sql = fs.readFileSync(SRC, 'utf8');
fs.writeFileSync(path.join(DEP, '0022_argus.sql'), sql);
console.log('copied 0022_argus.sql, bytes=', sql.length);

const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
const has0022 = journal.entries.some((e) => e.tag === '0022_argus');
const has0021 = journal.entries.some((e) => e.tag === '0021_add_revenue_metrics');
console.log('journal: has 0022?', has0022, ' has 0021?', has0021);

if (!has0022) {
  const lastIdx = Math.max(...journal.entries.map((e) => e.idx));
  journal.entries.push({
    idx: lastIdx + 1,
    version: '6',
    when: Date.now(),
    tag: '0022_argus',
    breakpoints: true,
  });
  fs.writeFileSync(journalPath, JSON.stringify(journal, null, 2));
  console.log('appended 0022_argus entry at idx', lastIdx + 1);
} else {
  console.log('0022 already in journal');
}
console.log('DONE');
