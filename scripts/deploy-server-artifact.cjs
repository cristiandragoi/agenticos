// Phase 1 release boundary: retired. scripts/deploy-installed.cjs is the ONLY deploy path
// (it breaks repo<->installed links, verifies parity and writes deployment.json).
// The original implementation is kept below for reference but is unreachable.
console.error('[deploy] ' + require('path').basename(__filename) + ' is retired. Use: node scripts/deploy-installed.cjs');
process.exit(1);
// deploy-server-artifact.cjs — backend-only artifact deployment (current machine paths).
// Same mechanism as deploy-server-only.cjs: backup -> complete replacement -> per-file sha256 verify.
// Differences from the legacy script: current install root (LOCALAPPDATA\Programs\AgenticOS) and
// current source root (D:\AgenticOS), plus the standalone server/scripts/*.py runtime scripts that
// live beside the bundled dist (whisper_worker.py is executed directly by the warm STT worker).
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SRC_ROOT = 'D:/AgenticOS/server';
const PKG = 'C:/Users/cd-pr/AppData/Local/Programs/AgenticOS/resources/server';

const SRC_DIST = path.join(SRC_ROOT, 'dist');
const DST_DIST = path.join(PKG, 'dist');
const SRC_SCRIPTS = path.join(SRC_ROOT, 'scripts');
const DST_SCRIPTS = path.join(PKG, 'scripts');

// Only these runtime scripts are shipped/overwritten (never delete unrelated deployed scripts).
const RUNTIME_SCRIPTS = ['whisper_worker.py', 'transcribe.py'];

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

function sha256(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}
function walk(d, o = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    e.isDirectory() ? walk(p, o) : o.push(p);
  }
  return o;
}

console.log('=== BACKEND ARTIFACT DEPLOYMENT ===');
console.log('src:', SRC_ROOT);
console.log('dst:', PKG);

// 1. Backups (deployed dist + deployed runtime scripts).
const distBak = path.join(PKG, `dist.bak-server-${ts}`);
if (fs.existsSync(DST_DIST)) {
  fs.cpSync(DST_DIST, distBak, { recursive: true });
  console.log('[1/4] Backed up deployed server/dist ->', distBak);
}
const scriptsBak = path.join(PKG, `scripts.bak-server-${ts}`);
if (fs.existsSync(DST_SCRIPTS)) {
  fs.cpSync(DST_SCRIPTS, scriptsBak, { recursive: true });
  console.log('[1/4] Backed up deployed server/scripts ->', scriptsBak);
}

// 2. Complete replacement of server/dist (no merge).
console.log('[2/4] Replacing server/dist ...');
fs.rmSync(DST_DIST, { recursive: true, force: true });
fs.cpSync(SRC_DIST, DST_DIST, { recursive: true });

// 3. Runtime python scripts.
console.log('[3/4] Syncing runtime scripts ...');
for (const name of RUNTIME_SCRIPTS) {
  const s = path.join(SRC_SCRIPTS, name);
  if (!fs.existsSync(s)) { console.log('  - skip (absent in source):', name); continue; }
  fs.copyFileSync(s, path.join(DST_SCRIPTS, name));
  console.log('  - synced', name);
}

// 4. Hash verification.
console.log('[4/4] Verifying ...');
let failures = 0;
const a = walk(SRC_DIST).sort();
const b = walk(DST_DIST).sort();
const ar = a.map((f) => path.relative(SRC_DIST, f));
const br = b.map((f) => path.relative(DST_DIST, f));
if (ar.length !== br.length) {
  console.log('  COUNT MISMATCH', ar.length, br.length);
  failures++;
} else {
  let mm = 0;
  for (let i = 0; i < a.length; i++) {
    if (sha256(a[i]) !== sha256(b[i])) { mm++; console.log('  DIFF', ar[i]); }
  }
  console.log(`  server/dist: ${a.length} files, ${mm} mismatches -> ${mm ? 'MISMATCH' : 'MATCH'}`);
  if (mm) failures++;
}
for (const name of RUNTIME_SCRIPTS) {
  const s = path.join(SRC_SCRIPTS, name);
  const d = path.join(DST_SCRIPTS, name);
  if (!fs.existsSync(s)) continue;
  const ok = fs.existsSync(d) && sha256(s) === sha256(d);
  console.log(`  script ${name}: ${ok ? 'MATCH' : 'MISMATCH'}`);
  if (!ok) failures++;
}
console.log(failures ? 'RESULT: FAILED' : 'RESULT: OK');
process.exit(failures ? 1 : 0);
