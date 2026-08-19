import { execSync } from 'node:child_process';

function run(cmd) {
  try { return execSync(cmd, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); }
  catch (e) { return 'ERR: ' + (e.stdout || e.message); }
}

// All LISTENING ports with PIDs
console.log('=== ALL LISTENING ports (with PIDs) ===');
console.log(run('netstat -ano | findstr "LISTENING"').split('\n').filter(l => /127\.0\.0\.1|0\.0\.0\.0/.test(l)).slice(0, 40).join('\n'));

// What is PID 6532 (5173 listener)?
console.log('\n=== PID 6532 (5173) ===');
console.log(run('wmic process where "ProcessId=6532" get Name,CommandLine,CreationDate /format:list').slice(0, 1200));

// Find real backend node processes (index.js / server)
console.log('\n=== node processes with index.js / server in cmdline ===');
const procs = run('wmic process where "Name=\'node.exe\'" get ProcessId,CommandLine /format:list');
const entries = [];
let cur = {};
for (const l of procs.split('\n')) {
  const m = /^([^=]+)=(.*)$/.exec(l.trim());
  if (m) cur[m[1].trim()] = m[2];
  if (l.trim() === '') {
    if (cur.ProcessId) entries.push({ pid: cur.ProcessId.trim(), cmd: cur.CommandLine || '' });
    cur = {};
  }
}
entries.filter(e => /index\.js|server/i.test(e.cmd) || /4000|4001/.test(e.cmd)).forEach(e => console.log(e.pid, '|', e.cmd.slice(0, 180)));

// Agentic OS process tree — which node are children of Agentic OS.exe?
console.log('\n=== Agentic OS.exe PIDs + their children ===');
const agentic = run('wmic process where "Name=\'Agentic OS.exe\'" get ProcessId,ParentProcessId /format:list').split('\n').filter(l => /ProcessId|ParentProcessId/.test(l));
console.log(agentic.join('\n'));
