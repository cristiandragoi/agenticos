// deploy-phase2d.cjs — SAFE PACKAGED DEPLOYMENT (sync only, no restart).
// 1. Consistent Roaming DB backup (VACUUM INTO).
// 2. Backup packaged server/dist + app/dist.
// 3. Sync built artifacts to packaged resources.
// 4. Byte + hash verification.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require(path.resolve(__dirname, '../server/node_modules/better-sqlite3'));

console.log('=== SAFE PACKAGED DEPLOYMENT — PHASE 2D REAL EXECUTION BRIDGE ===\n');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const RES = 'C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources';
const DATA = 'C:/Users/Cris/AppData/Roaming/agenticos/data';

function getHash(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// 1. Consistent Roaming DB backup via VACUUM INTO (snapshot, WAL-safe).
console.log('[1/4] Creating timestamped backups...');
const dbSrc = `${DATA}/agentic-os.db`;
const dbDst = `${DATA}/agentic-os.db.backup-phase2d-${ts}`;
if (fs.existsSync(dbSrc)) {
  const src = new Database(dbSrc, { readonly: true });
  src.prepare('VACUUM INTO ?').run(dbDst);
  src.close();
  console.log(`- Backed up DB (consistent snapshot) to: ${dbDst} (${fs.statSync(dbDst).size} bytes)`);
}

const serverDistBak = path.join(RES, `server/dist.bak-phase2d-${ts}`);
if (fs.existsSync(path.join(RES, 'server/dist'))) {
  fs.cpSync(path.join(RES, 'server/dist'), serverDistBak, { recursive: true });
  console.log(`- Backed up server dist to: ${serverDistBak}`);
}
const appDistBak = path.join(RES, `app/dist.bak-phase2d-${ts}`);
if (fs.existsSync(path.join(RES, 'app/dist'))) {
  fs.cpSync(path.join(RES, 'app/dist'), appDistBak, { recursive: true });
  console.log(`- Backed up app dist to: ${appDistBak}`);
}

// 2. Controlled sync.
console.log('\n[2/4] Deploying built artifacts to packaged app...');
fs.cpSync('B:/AgenticOS/server/dist', path.join(RES, 'server/dist'), { recursive: true });
console.log('- Synced server/dist');
fs.cpSync('B:/AgenticOS/dist', path.join(RES, 'app/dist'), { recursive: true });
console.log('- Synced app/dist');
if (fs.existsSync('B:/AgenticOS/dist-electron')) {
  fs.cpSync('B:/AgenticOS/dist-electron', path.join(RES, 'app/dist-electron'), { recursive: true });
  console.log('- Synced app/dist-electron');
}

// 3. Hash verification.
console.log('\n[3/4] Verifying deployed artifacts against source build...');
const serverIndexSrc = 'B:/AgenticOS/server/dist/index.js';
const serverIndexDst = path.join(RES, 'server/dist/index.js');
const serverHashSrc = getHash(serverIndexSrc);
const serverHashDst = getHash(serverIndexDst);
if (serverHashSrc !== serverHashDst) throw new Error(`Server index hash mismatch: ${serverHashSrc} vs ${serverHashDst}`);
console.log(`- server/dist/index.js hash: ${serverHashSrc.slice(0, 16)}... (MATCH)`);

const appHtmlSrc = 'B:/AgenticOS/dist/index.html';
const appHtmlDst = path.join(RES, 'app/dist/index.html');
const appHashSrc = getHash(appHtmlSrc);
const appHashDst = getHash(appHtmlDst);
if (appHashSrc !== appHashDst) throw new Error(`App index.html hash mismatch: ${appHashSrc} vs ${appHashDst}`);
console.log(`- app/dist/index.html hash: ${appHashSrc.slice(0, 16)}... (MATCH)`);

// Verify the bridge modules are present in the deployed server dist.
for (const m of ['executorSelection.js', 'actionResolver.js', 'branchScheduler.js', 'revenueActionExecutor.js']) {
  const p = path.join(RES, 'server/dist/services/revenueOperator', m);
  if (!fs.existsSync(p)) throw new Error(`Missing deployed module: ${m}`);
  console.log(`- deployed module present: ${m}`);
}

console.log('\n[4/4] Safe deployment sync complete (NO restart performed).');
console.log(`DEPLOYMENT COMPLETE ts=${ts}`);
console.log(`DB backup: ${dbDst}`);
console.log(`server dist backup: ${serverDistBak}`);
console.log(`app dist backup: ${appDistBak}`);
