// Phase A — read-only runtime revalidation.
const { execSync } = require('child_process');

function sh(cmd) { try { return execSync(cmd, { encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 }).trim(); } catch (e) { return 'ERR: ' + (e.message || '').slice(0, 200); } }

console.log('=== port 4000 owners ===');
const net = sh('netstat -ano');
const lines = net.split('\n').filter(l => l.includes(':4000') && l.includes('LISTENING'));
console.log(lines.length ? lines.join('\n') : '(no :4000 LISTENING)');

const pids = new Set();
for (const l of lines) { const p = l.trim().split(/\s+/).pop(); if (p && /^\d+$/.test(p)) pids.add(p); }

for (const pid of pids) {
  console.log(`\n=== process ${pid} ===`);
  const info = sh(`wmic process where "ProcessId=${pid}" get Name,CommandLine,CreationDate,ProcessId /format:list`);
  console.log(info);
  // parent pid + executable path
  const p2 = sh(`wmic process where "ProcessId=${pid}" get ParentProcessId /format:list`);
  console.log(p2);
}

console.log('\n=== is PID 17668 alive? ===');
const check17668 = sh('tasklist /fi "PID eq 17668"');
console.log(check17668);

console.log('\n=== packaged app / electron processes ===');
const tl = sh('tasklist /v /fo csv');
const interesting = tl.split('\n').filter(l => /electron|Agentic OS/i.test(l));
console.log(interesting.length ? interesting.join('\n') : '(no Electron / "Agentic OS" processes)');

console.log('\n=== node processes with dist/index.js ===');
const nodeLines = tl.split('\n').filter(l => /node\.exe/i.test(l));
console.log(`total node.exe lines: ${nodeLines.length}`);
