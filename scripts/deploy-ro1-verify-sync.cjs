/* RO1 deploy: verify sync — hash all RO1-relevant files + check external imports resolve in packaged node_modules */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RES = 'C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources';
const REPO = 'B:/AgenticOS';
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

const pairs = [
  // server core
  ['server/dist/index.js'], ['server/dist/types.js'], ['server/dist/data.js'],
  ['server/dist/db/schema.js'], ['server/dist/db/index.js'],
  ['server/dist/services/goalStore.js'], ['server/dist/loops/codexLoop.js'],
  ['server/dist/routers/revenue.js'], ['server/dist/routers/revenueOperator.js'],
  ['server/dist/routers/revenueEngine.js'], ['server/dist/routers/argus.js'],
  ['server/dist/services/argus/argusService.js'],
  ['server/dist/services/revenueOperator/operatorService.js'],
  ['server/dist/services/revenueOperator/revenueEngine.js'],
  ['server/dist/services/revenueOperator/digitalProductEngine.js'],
  ['server/dist/services/revenueOperator/germanSmeEngine.js'],
  ['server/dist/services/revenueOperator/distributionService.js'],
  ['server/dist/services/revenueOperator/revenueMissionRunner.js'],
];
let bad = 0;
for (const [rel] of pairs) {
  const a = path.join(REPO, rel), b = path.join(RES, rel);
  if (!fs.existsSync(b)) { console.log('MISSING IN PACKAGED:', rel); bad++; continue; }
  const ha = sha(a), hb = sha(b);
  console.log(ha === hb ? 'MATCH ' : 'MISMATCH ', rel);
  if (ha !== hb) bad++;
}

// drizzle
for (const f of ['0021_add_revenue_metrics.sql', '0023_revenue_operator.sql', 'meta/_journal.json']) {
  const a = path.join(REPO, 'server/drizzle', f), b = path.join(RES, 'server/drizzle', f);
  const ok = sha(a) === sha(b);
  console.log(ok ? 'MATCH ' : 'MISMATCH ', 'server/drizzle/' + f);
  if (!ok) bad++;
}

// frontend
const fe = fs.readFileSync(path.join(RES, 'app/dist/index.html'), 'utf-8');
console.log('frontend index.html MATCH:', sha(path.join(REPO, 'dist/index.html')) === sha(path.join(RES, 'app/dist/index.html')));
const jsAsset = (fe.match(/assets\/(index-[^"]+\.js)/) || [])[1];
const cssAsset = (fe.match(/assets\/(index-[^"]+\.css)/) || [])[1];
console.log('frontend js asset:', jsAsset, 'MATCH:', jsAsset && sha(path.join(REPO, 'dist/assets', jsAsset)) === sha(path.join(RES, 'app/dist/assets', jsAsset)));
console.log('frontend css asset:', cssAsset, 'MATCH:', cssAsset && sha(path.join(REPO, 'dist/assets', cssAsset)) === sha(path.join(RES, 'app/dist/assets', cssAsset)));
// UI marker: RevenueOperatorPage bundled
const bundle = fs.readFileSync(path.join(RES, 'app/dist/assets', jsAsset), 'utf-8');
console.log('bundle contains REVENUE OPERATOR marker:', bundle.includes('REVENUE OPERATOR'));
console.log('bundle contains revenue-operator route:', /revenue-operator/.test(bundle));

// external imports used by new RO1 modules — resolve in packaged node_modules
function collectImports(file) {
  const src = fs.readFileSync(file, 'utf-8');
  const out = [];
  for (const m of src.matchAll(/from\s+['"]([^'".][^'"]*)['"]/g)) out.push(m[1]);
  return out;
}
const mods = [
  'server/dist/services/revenueOperator/operatorService.js',
  'server/dist/services/revenueOperator/digitalProductEngine.js',
  'server/dist/services/revenueOperator/germanSmeEngine.js',
  'server/dist/services/revenueOperator/distributionService.js',
  'server/dist/services/revenueOperator/revenueEngine.js',
  'server/dist/services/revenueOperator/revenueMissionRunner.js',
  'server/dist/routers/revenueOperator.js',
  'server/dist/routers/revenueEngine.js',
];
const external = new Set();
for (const m of mods) for (const imp of collectImports(path.join(REPO, m))) {
  if (!imp.startsWith('.') && !imp.startsWith('node:') && !imp.includes('://')) external.add(imp.split('/')[0]);
}
console.log('\nexternal package imports:', [...external].join(', ') || '(none)');
for (const pkg of external) {
  const exists = fs.existsSync(path.join(RES, 'server/node_modules', pkg));
  console.log(exists ? 'RESOLVES ' : 'MISSING ', pkg);
  if (!exists) bad++;
}
console.log('\nVERIFY RESULT:', bad === 0 ? 'ALL MATCH' : `${bad} ISSUES`);
