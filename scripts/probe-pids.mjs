import { execSync } from 'node:child_process';
function run(cmd) { try { return execSync(cmd, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); } catch (e) { return 'ERR: ' + (e.stdout || e.message); } }

// What are PIDs 6532 (5173), 45348 (5174), 58224 (22:44 Agentic child)
for (const pid of [6532, 45348, 58224, 12136, 25648]) {
  console.log('=== PID', pid, '===');
  console.log(run(`wmic process where "ProcessId=${pid}" get Name,CommandLine,CreationDate,ParentProcessId /format:list`).slice(0, 700));
}

// tail of agenticos_stdout for the CURRENT run (after 22:27 relaunch)
console.log('\n=== agenticos_stdout tail (last 50 lines) ===');
console.log(run('powershell -NoProfile -Command "Get-Content \\"$env:LOCALAPPDATA\\Temp\\agenticos_stdout.txt\\" -Tail 50"').slice(0, 5000));

// Any process running the DEPLOYED server entry?
console.log('\n=== deployed server entry processes ===');
console.log(run('wmic process where "Name=\'node.exe\'" get ProcessId,CommandLine /format:list').split('\n').filter(l => /resources\\server/i.test(l)).join('\n') || '(none running)');
