const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

function sha256(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function getSnapshot(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.statSync(filePath);
  return {
    path: path.resolve(filePath),
    size: stat.size,
    mtime: stat.mtime.toISOString(),
    sha256: sha256(filePath)
  };
}

const prodDb1 = path.resolve('server/data/agentic-os.db');
const prodDb2 = path.join(process.env.APPDATA || '', 'agenticos/data/agentic-os.db');

console.log('=== BEFORE TESTS: RECORDING DATABASE CHECKSUMS ===');
const before1 = getSnapshot(prodDb1);
const before2 = getSnapshot(prodDb2);
console.log('Server DB Before:', JSON.stringify(before1, null, 2));
console.log('AppData DB Before:', JSON.stringify(before2, null, 2));

console.log('\n=== RUNNING FOCUSED VITEST TESTS IN ISOLATED TEMP DB ===');
try {
  const output = execSync('npx vitest run src/__tests__/dbIsolationGuard.test.ts src/__tests__/canonicalSnapshotReal.test.ts src/__tests__/jarvisTruthAndLanguageRegression.test.ts', {
    cwd: path.resolve('server'),
    stdio: 'pipe',
    env: { ...process.env, NODE_ENV: 'test', VITEST: 'true' }
  }).toString();
  console.log(output);
} catch (err) {
  console.error('Test Execution Error:', err.stdout ? err.stdout.toString() : err.message);
  process.exit(1);
}

console.log('\n=== AFTER TESTS: RECORDING DATABASE CHECKSUMS ===');
const after1 = getSnapshot(prodDb1);
const after2 = getSnapshot(prodDb2);
console.log('Server DB After:', JSON.stringify(after1, null, 2));
console.log('AppData DB After:', JSON.stringify(after2, null, 2));

console.log('\n=== VERIFYING INTEGRITY (BEFORE === AFTER) ===');
let hasMismatch = false;

if (before1 && after1) {
  if (before1.sha256 !== after1.sha256 || before1.size !== after1.size) {
    console.error('CRITICAL ERROR: Server DB was modified during test execution!');
    hasMismatch = true;
  } else {
    console.log('PASS: Server DB completely unchanged (SHA-256 matches).');
  }
}

if (before2 && after2) {
  if (before2.sha256 !== after2.sha256 || before2.size !== after2.size) {
    console.error('CRITICAL ERROR: AppData DB was modified during test execution!');
    hasMismatch = true;
  } else {
    console.log('PASS: AppData DB completely unchanged (SHA-256 matches).');
  }
}

if (hasMismatch) {
  process.exit(1);
} else {
  console.log('\nSUCCESS: Test DB isolation strictly proven.');
}
