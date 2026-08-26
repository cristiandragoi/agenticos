// deploy-overnight-final.cjs — sync built artifacts to the packaged app, with
// timestamped backups and full hash verification. No process management.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PKG = 'C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources';
const SRC = 'B:/AgenticOS';

const targets = [
  { name: 'server/dist', src: path.join(SRC, 'server/dist'), dst: path.join(PKG, 'server/dist') },
  { name: 'app/dist',    src: path.join(SRC, 'dist'),        dst: path.join(PKG, 'app/dist') },
  { name: 'dist-electron', src: path.join(SRC, 'dist-electron'), dst: path.join(PKG, 'app/dist-electron') },
];

function sha256(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

const ts = new Date().toISOString().replace(/[:.]/g, '-');
const backupRoot = path.join(PKG, `backup-final-${ts}`);

console.log('=== Deploy: backup + sync + hash-verify ===');
let ok = true;
for (const t of targets) {
  if (!fs.existsSync(t.src)) { console.log(`SKIP ${t.name}: source missing ${t.src}`); ok = false; continue; }
  // backup existing
  if (fs.existsSync(t.dst)) {
    const bdst = path.join(backupRoot, t.name);
    fs.mkdirSync(path.dirname(bdst), { recursive: true });
    fs.cpSync(t.dst, bdst, { recursive: true });
    console.log(`BACKUP ${t.name} -> ${bdst}`);
  }
}

for (const t of targets) {
  if (!fs.existsSync(t.src)) continue;
  fs.rmSync(t.dst, { recursive: true, force: true });
  fs.cpSync(t.src, t.dst, { recursive: true });
  console.log(`SYNC   ${t.name}`);
}

// hash-verify
console.log('\n=== Hash verification (source vs packaged) ===');
let allMatch = true;
for (const t of targets) {
  const srcFiles = walk(t.src).sort();
  const dstFiles = walk(t.dst).sort();
  const srcRel = srcFiles.map(f => path.relative(t.src, f));
  const dstRel = dstFiles.map(f => path.relative(t.dst, f));
  if (srcRel.length !== dstRel.length) {
    console.log(`MISMATCH ${t.name}: file count ${srcRel.length} vs ${dstRel.length}`);
    allMatch = false;
    continue;
  }
  let mismatches = 0;
  for (let i = 0; i < srcFiles.length; i++) {
    const a = sha256(srcFiles[i]);
    const b = sha256(dstFiles[i]);
    if (a !== b) { mismatches++; allMatch = false; console.log(`  DIFF ${srcRel[i]}`); }
  }
  console.log(`${t.name}: ${srcFiles.length} files, ${mismatches} mismatches`);
}

console.log(`\nRESULT: ${allMatch ? 'ALL HASHES MATCH' : 'HASH MISMATCH — DO NOT RESTART'}`);
process.exit(allMatch ? 0 : 1);
