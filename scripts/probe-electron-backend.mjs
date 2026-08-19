import { execSync } from 'node:child_process';

function run(cmd) {
  try { return execSync(cmd, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); }
  catch (e) { return 'ERR: ' + (e.stdout || e.message); }
}

// Agentic OS.exe process times
console.log('=== Agentic OS.exe processes (pid, created) ===');
console.log(run('wmic process where "Name=\'Agentic OS.exe\'" get ProcessId,CreationDate /format:list'));

// Electron backend lifecycle lines from the app stdout — first 60 lines
console.log('\n=== agenticos_stdout.txt HEAD (first 80 lines) ===');
const log = run('powershell -NoProfile -Command "Get-Content \\"$env:LOCALAPPDATA\\Temp\\agenticos_stdout.txt\\" -TotalCount 80"');
console.log(log);

// Look for EADDRINUSE / backend lifecycle errors anywhere in the log
console.log('\n=== EADDRINUSE / lifecycle / spawn lines ===');
console.log(run('powershell -NoProfile -Command "Select-String -Path \\"$env:LOCALAPPDATA\\Temp\\agenticos_stdout.txt\\" -Pattern \'EADDRINUSE|lifecycle|Backend mode|spawn|exit|restart|port 4000|4000.*use\' | Select-Object -Last 30"'));
