import { cp, rm, readFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';

const APP = 'C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources';
const TS = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

const targets = [
  { src: 'B:/AgenticOS/server/dist',        dst: `${APP}/server/dist`,        name: 'server/dist' },
  { src: 'B:/AgenticOS/dist',               dst: `${APP}/app/dist`,           name: 'app/dist' },
  { src: 'B:/AgenticOS/dist-electron',      dst: `${APP}/app/dist-electron`,  name: 'app/dist-electron' },
];

async function sha256(p) { return createHash('sha256').update(await readFile(p)).digest('hex').slice(0, 16); }

// 1. Backup current packaged trees.
for (const t of targets) {
  const bak = `${t.dst}.bak-overnight-${TS}`;
  if (existsSync(t.dst)) {
    await cp(t.dst, bak, { recursive: true });
    console.log(`backed up ${t.name} -> ${bak}`);
  }
}

// 2. Sync source -> packaged (clean replace).
for (const t of targets) {
  await rm(t.dst, { recursive: true, force: true });
  await cp(t.src, t.dst, { recursive: true });
  console.log(`synced ${t.name}`);
}

// 3. Hash-verify key files.
const keyFiles = [
  `${APP}/server/dist/index.js`,
  `${APP}/server/dist/services/backgroundTasks/adapters.js`,
  `${APP}/server/dist/loops/codexLoop.js`,
  `${APP}/server/dist/services/backgroundTasks/taskControl.js`,
  `${APP}/app/dist/index.html`,
  `${APP}/app/dist-electron/main.js`,
];
const srcKey = [
  'B:/AgenticOS/server/dist/index.js',
  'B:/AgenticOS/server/dist/services/backgroundTasks/adapters.js',
  'B:/AgenticOS/server/dist/loops/codexLoop.js',
  'B:/AgenticOS/server/dist/services/backgroundTasks/taskControl.js',
  'B:/AgenticOS/dist/index.html',
  'B:/AgenticOS/dist-electron/main.js',
];

console.log('\n=== HASH VERIFICATION ===');
let allMatch = true;
for (let i = 0; i < keyFiles.length; i++) {
  const a = await sha256(srcKey[i]);
  const b = await sha256(keyFiles[i]);
  const ok = a === b;
  if (!ok) allMatch = false;
  console.log(`${ok ? 'MATCH' : 'MISMATCH'}  ${srcKey[i].replace('B:/AgenticOS/', '')}  ${a} ${ok ? '==' : '!='} ${b}`);
}
console.log('\n' + (allMatch ? 'ALL HASHES MATCH — deploy verified.' : 'HASH MISMATCH — DO NOT RESTART.'));
