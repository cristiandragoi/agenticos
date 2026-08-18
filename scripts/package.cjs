/**
 * package.cjs
 *
 * Authoritative single-command cross-platform packaging runner for Agentic OS.
 * Steps:
 * 1. Generates build identity (Git SHA, timestamp, buildId)
 * 2. Compiles TypeScript backend (server/src -> server/dist)
 * 3. Stages build-identity.json into server/dist/
 * 4. Compiles TypeScript frontend and Electron bundles (tsc -b && vite build)
 * 5. Packages release directory via electron-builder
 */
'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function run(cmd, cwd = ROOT) {
  console.log(`\n[package] > ${cmd} (in ${cwd})`);
  execSync(cmd, { cwd, stdio: 'inherit' });
}

console.log('═'.repeat(60));
console.log('  AGENTIC OS — AUTHORITATIVE PACKAGING PIPELINE');
console.log('═'.repeat(60));

// 1. Build Identity
run('node scripts/build-identity.cjs', ROOT);

// 2. Server Build
const serverDir = path.join(ROOT, 'server');
run('npm run build', serverDir);

// 3. Stage build-identity.json to server/dist
const srcId = path.join(ROOT, 'server', 'src', 'build-identity.json');
const distId = path.join(ROOT, 'server', 'dist', 'build-identity.json');
fs.mkdirSync(path.dirname(distId), { recursive: true });
fs.copyFileSync(srcId, distId);
console.log(`[package] Staged build identity: ${distId}`);

// 4. Frontend & Electron Build
run('npx tsc -b', ROOT);
run('npx vite build', ROOT);

// 5. Electron Packaging
run('npx electron-builder --win --dir', ROOT);

console.log('\n' + '═'.repeat(60));
console.log('  PACKAGING COMPLETE -> release/win-unpacked/');
console.log('═'.repeat(60) + '\n');
