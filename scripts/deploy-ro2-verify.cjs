/* RO2 deploy: hash-verify synced files + frontend bundle markers */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const RES = 'C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources';
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const pairs = [
  'server/dist/services/revenueOperator/traceService.js',
  'server/dist/routers/revenueOperator.js',
  'server/dist/routers/revenueEngine.js',
  'server/dist/index.js',
  'server/dist/services/revenueOperator/operatorService.js',
  'server/dist/services/revenueOperator/germanSmeEngine.js',
  'server/dist/services/revenueOperator/digitalProductEngine.js',
  'server/dist/services/argus/argusService.js',
];
let bad = 0;
for (const rel of pairs) {
  const a = path.join('B:/AgenticOS', rel), b = path.join(RES, rel);
  const ok = fs.existsSync(b) && sha(a) === sha(b);
  console.log(ok ? 'MATCH ' : 'MISMATCH ', rel);
  if (!ok) bad++;
}
const html = fs.readFileSync(path.join(RES, 'app/dist/index.html'), 'utf-8');
const jsAsset = (html.match(/assets\/(index-[^"]+\.js)/) || [])[1];
console.log('index.html asset:', jsAsset, 'MATCH:', sha(`B:/AgenticOS/dist/assets/${jsAsset}`) === sha(path.join(RES, `app/dist/assets/${jsAsset}`)));
const bundle = fs.readFileSync(path.join(RES, `app/dist/assets/${jsAsset}`), 'utf-8');
const markers = ['kpi-target', 'kpi-drilldown', 'kanban-digital_products', 'kanban-german_sme', 'kanban-pipeline', 'experiment-drawer', 'gate-queue', 'live-execution-table', 'ledger-filter', 'tab-pipeline', '/api/revenue-operator/missions/', '/kpi/', '/board/', '/live-execution', '/gates/queue', '/trace'];
for (const m of markers) {
  const ok = bundle.includes(m);
  console.log(ok ? 'MARKER ' : 'MISSING', m);
  if (!ok) bad++;
}
console.log(bad === 0 ? 'RO2 VERIFY: ALL MATCH' : `RO2 VERIFY: ${bad} ISSUES`);
