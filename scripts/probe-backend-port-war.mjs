import { execSync } from 'node:child_process';

function run(cmd) {
  try { return execSync(cmd, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); }
  catch (e) { return 'ERR: ' + (e.stdout || e.message); }
}

// 1) All node processes with command lines — find real backend (dist/index.js) vs stub
console.log('=== node/pwsh processes on this box ===');
const procs = run('wmic process where "Name=\'node.exe\' or Name=\'pwsh.exe\'" get ProcessId,CommandLine /format:list');
const lines = procs.split('\n');
let cur = {};
const out = [];
for (const l of lines) {
  const m = /^([^=]+)=(.*)$/.exec(l.trim());
  if (m) cur[m[1].trim()] = m[2];
  if (l.trim() === '') {
    if (cur.ProcessId && (cur.CommandLine || '').includes('4000')) out.push({ pid: cur.ProcessId.trim(), cmd: (cur.CommandLine || '').slice(0, 220) });
    cur = {};
  }
}
out.forEach((o) => console.log(o.pid, '|', o.cmd));

// 2) Listeners on 4000/4001/5173
console.log('\n=== listeners ===');
console.log(run('netstat -ano | findstr /R "LISTENING" | findstr /R ":4000 :4001 :5173"').trim() || 'none');

// 3) agenticos_stdout.txt — when did backend stdout stop / what happened around 17:22
console.log('\n=== agenticos_stdout.txt tail ===');
const log = run('powershell -NoProfile -Command "Get-Content \\"$env:LOCALAPPDATA\\Temp\\agenticos_stdout.txt\\" -Tail 40"');
console.log(log.slice(0, 6000));
