// Phase 2B read-only inspection of persisted overnight state (gates already read from API)
const fs = require('fs');
const T = process.env.LOCALAPPDATA + '\\Temp\\';
const exps = JSON.parse(fs.readFileSync(T + 'ro-exps.json', 'utf8'));
const list = Array.isArray(exps) ? exps : (exps.experiments || []);
console.log('total experiments:', list.length);
const byStatus = {};
for (const e of list) {
  byStatus[e.status] = (byStatus[e.status] || 0) + 1;
}
console.log('by status:', JSON.stringify(byStatus));
console.log('\nREADY_TO_PUBLISH / QA / blocked branches:');
for (const e of list) {
  if (['READY_TO_PUBLISH', 'QA', 'BUILDING', 'PUBLISHED'].includes(e.status)) {
    console.log(e.id, '|', e.engine, '|', e.status, '|', String(e.title || '').slice(0, 80));
  }
}
const live = JSON.parse(fs.readFileSync(T + 'ro-live.json', 'utf8'));
const runs = Array.isArray(live) ? live : (live.runs || live.live || []);
console.log('\nlive-execution rows:', runs.length);
for (const r of runs.slice(0, 10)) {
  console.log(r.runId || r.id, '|', r.status, '|', String(r.task || r.title || '').slice(0, 55), '|', r.executor || '', r.providerModel || r.provider || '');
}
