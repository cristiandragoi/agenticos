#!/usr/bin/env node
// Append 0023_revenue_operator to the drizzle journal (source tree).
const fs = require('fs');
const path = require('path');
const journalPath = path.resolve(__dirname, '../server/drizzle/meta/_journal.json');
const j = JSON.parse(fs.readFileSync(journalPath, 'utf-8'));
const existing = j.entries.find((e) => e.tag === '0023_revenue_operator');
if (existing) { console.log('0023 already in journal'); process.exit(0); }
const lastIdx = Math.max(...j.entries.map((e) => e.idx));
j.entries.push({ idx: lastIdx + 1, version: '6', when: Date.now(), tag: '0023_revenue_operator', breakpoints: true });
fs.writeFileSync(journalPath, JSON.stringify(j, null, 2) + '\n');
console.log(`journal updated: idx ${lastIdx + 1} → 0023_revenue_operator (${j.entries.length} entries)`);
