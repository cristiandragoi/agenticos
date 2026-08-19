import { execSync } from 'node:child_process';
function run(cmd) { try { return execSync(cmd, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); } catch (e) { return 'ERR: ' + (e.stdout || e.message); } }

// Search the ENTIRE app stdout for backend lifecycle markers with line numbers
console.log('=== lifecycle / EADDRINUSE / spawn / exit / ready markers ===');
const out = run('powershell -NoProfile -Command "Select-String -Path \\"$env:LOCALAPPDATA\\Temp\\agenticos_stdout.txt\\" -Pattern \'lifecycle|EADDRINUSE|spawned|backend READY|Restart|exhausted|failed|crash|exit code|EADDR\' | Select-Object -Last 40 | ForEach-Object { $_.LineNumber.ToString() + \\": \\" + $_.Line }"');
console.log(out.slice(0, 6000));

// When was the file created/modified? How many lines?
console.log('\n=== log file stats ===');
console.log(run('powershell -NoProfile -Command "$f = Get-Item \\"$env:LOCALAPPDATA\\Temp\\agenticos_stdout.txt\\"; \\"size=\\" + $f.Length + \\" lines=\\" + (Get-Content $f.FullName | Measure-Object -Line).Lines + \\" modified=\\" + $f.LastWriteTime"'));
