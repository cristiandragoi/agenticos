const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

console.log('=== SAFE PACKAGED DEPLOYMENT — PHASE 2C & CAPABILITY DISPATCHER ===\n');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const RES = 'C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources';
const DATA = 'C:/Users/Cris/AppData/Roaming/agenticos/data';

function getHash(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// 1. Backups
console.log('[1/4] Creating timestamped backups...');
const dbSrc = `${DATA}/agentic-os.db`;
const dbDst = `${DATA}/agentic-os.db.backup-phase2c-${ts}`;
if (fs.existsSync(dbSrc)) {
  fs.copyFileSync(dbSrc, dbDst);
  console.log(`- Backed up DB to: ${dbDst} (${fs.statSync(dbDst).size} bytes)`);
}

const serverDistBak = path.join(RES, `server/dist.bak-phase2c-${ts}`);
if (fs.existsSync(path.join(RES, 'server/dist'))) {
  fs.cpSync(path.join(RES, 'server/dist'), serverDistBak, { recursive: true });
  console.log(`- Backed up server dist to: ${serverDistBak}`);
}

const appDistBak = path.join(RES, `app/dist.bak-phase2c-${ts}`);
if (fs.existsSync(path.join(RES, 'app/dist'))) {
  fs.cpSync(path.join(RES, 'app/dist'), appDistBak, { recursive: true });
  console.log(`- Backed up app dist to: ${appDistBak}`);
}

// 2. Controlled Sync
console.log('\n[2/4] Deploying built artifacts to packaged app...');
fs.cpSync('B:/AgenticOS/server/dist', path.join(RES, 'server/dist'), { recursive: true });
console.log('- Synced server/dist');
fs.cpSync('B:/AgenticOS/dist', path.join(RES, 'app/dist'), { recursive: true });
console.log('- Synced app/dist');
if (fs.existsSync('B:/AgenticOS/dist-electron')) {
  fs.cpSync('B:/AgenticOS/dist-electron', path.join(RES, 'app/dist-electron'), { recursive: true });
  console.log('- Synced app/dist-electron');
}

// 3. Byte & Hash Verification
console.log('\n[3/4] Verifying deployed artifacts against source build...');
const serverIndexSrc = 'B:/AgenticOS/server/dist/index.js';
const serverIndexDst = path.join(RES, 'server/dist/index.js');
const appHtmlSrc = 'B:/AgenticOS/dist/index.html';
const appHtmlDst = path.join(RES, 'app/dist/index.html');

const serverHashSrc = getHash(serverIndexSrc);
const serverHashDst = getHash(serverIndexDst);
if (serverHashSrc !== serverHashDst) {
  throw new Error(`Server index hash mismatch: ${serverHashSrc} vs ${serverHashDst}`);
}
console.log(`- Server index hash verified: ${serverHashSrc.slice(0, 16)}... (MATCH)`);

const appHashSrc = getHash(appHtmlSrc);
const appHashDst = getHash(appHtmlDst);
if (appHashSrc !== appHashDst) {
  throw new Error(`App index.html hash mismatch: ${appHashSrc} vs ${appHashDst}`);
}
console.log(`- App index.html hash verified: ${appHashSrc.slice(0, 16)}... (MATCH)`);

console.log('\n[4/4] Safe deployment sync complete.');
console.log('DEPLOYMENT COMPLETE ts=' + ts);
