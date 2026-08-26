/* RO1 deploy: pre-sync safety checks — dist tree parity, argus presence, drizzle hash parity */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RES = 'C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources';
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

// 1. repo fresh dist must contain ARGUS content (HEAD is argus-deploy lineage)
const repoIdx = fs.readFileSync('B:/AgenticOS/server/dist/index.js', 'utf-8');
console.log('repo dist index.js mounts argus:', repoIdx.includes('argus'));
console.log('repo dist index.js mounts revenueOperator:', repoIdx.includes('revenueOperator'));
console.log('repo dist argusService exists:', fs.existsSync('B:/AgenticOS/server/dist/services/argus/argusService.js'));
console.log('repo dist routers/argus.js exists:', fs.existsSync('B:/AgenticOS/server/dist/routers/argus.js'));

// 2. top-level entries in packaged server/dist vs repo server/dist
const pkgDist = fs.readdirSync(path.join(RES, 'server/dist'));
const repoDist = fs.readdirSync('B:/AgenticOS/server/dist');
const onlyPkg = pkgDist.filter(f => !repoDist.includes(f));
const onlyRepo = repoDist.filter(f => !pkgDist.includes(f));
console.log('\nentries only in packaged server/dist (preserved, not overwritten):', onlyPkg);
console.log('entries only in repo server/dist (will be added):', onlyRepo);

// 3. drizzle SQL hash parity (all packaged sql files must match repo versions)
const pkgDr = path.join(RES, 'server/drizzle');
let mismatch = [];
for (const f of fs.readdirSync(pkgDr)) {
  if (!f.endsWith('.sql')) continue;
  const repoFile = path.join('B:/AgenticOS/server/drizzle', f);
  if (!fs.existsSync(repoFile)) { mismatch.push(f + ': MISSING IN REPO'); continue; }
  if (sha(path.join(pkgDr, f)) !== sha(repoFile)) mismatch.push(f + ': HASH MISMATCH');
}
console.log('\ndrizzle parity issues:', mismatch.length ? mismatch : 'NONE — all packaged sql identical to repo');

// 4. preload.cjs parity
const preRepo = sha('B:/AgenticOS/dist-electron/preload.cjs');
const prePkg = sha(path.join(RES, 'app/dist-electron/preload.cjs'));
console.log('\npreload.cjs identical:', preRepo === prePkg);
const preJsRepo = sha('B:/AgenticOS/dist-electron/preload.js');
const preJsPkg = sha(path.join(RES, 'app/dist-electron/preload.js'));
console.log('preload.js identical:', preJsRepo === preJsPkg);

// 5. frontend dist: compare file lists
function walk(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out);
    else out.push(path.relative(base, p).replace(/\\/g, '/'));
  }
  return out;
}
const repoFe = walk('B:/AgenticOS/dist').sort();
const pkgFe = walk(path.join(RES, 'app/dist')).sort();
console.log('\nfrontend only-in-repo:', repoFe.filter(f => !pkgFe.includes(f)));
console.log('frontend only-in-packaged:', pkgFe.filter(f => !repoFe.includes(f)));

// 6. quick integrity check of canonical DB (read-only)
const D = require(path.join(RES, 'server/node_modules/better-sqlite3'));
const db = new D('C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db', { readonly: true });
console.log('\ncanonical DB integrity_check:', db.pragma('integrity_check', { simple: true }));
console.log('canonical DB quick_check:', db.pragma('quick_check', { simple: true }));
db.close();
