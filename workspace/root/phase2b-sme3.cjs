// Dump full event metadata for SME branches to recover researched URLs
const fs = require('fs');
const T = process.env.LOCALAPPDATA + '\\Temp\\';
for (const f of ['ro-trace-sme1.json', 'ro-trace-sme2.json', 'ro-trace-sme3.json']) {
  const d = JSON.parse(fs.readFileSync(T + f, 'utf8'));
  console.log('=====', f, '=====');
  for (const e of d.events || []) {
    const m = JSON.stringify(e.metadata || {});
    if (m.length > 4) console.log(e.type, '|', m.slice(0, 300));
  }
  console.log('--- evidence entries:');
  const exp = d.experiment || {};
  for (const ev of exp.evidence || []) {
    console.log('-', ev.classification, '|', ev.title, '|', ev.sourceUrl || ev.source || '');
    console.log('  ', String(ev.summary || '').slice(0, 200));
  }
  console.log('');
}
