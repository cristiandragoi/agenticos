// Consolidated evidence snapshot for the FINAL REPORT
import { execSync } from 'node:child_process';
function run(cmd) { try { return execSync(cmd, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }); } catch (e) { return 'ERR'; } }

console.log('=== PORT 4000 OWNER ===');
console.log(run('netstat -ano | findstr "127.0.0.1:4000" | findstr LISTENING').trim());
console.log('\n=== STUB COMMAND LINE (PID 51072) ===');
console.log(run('wmic process where "ProcessId=51072" get CommandLine /format:list').slice(0, 400));
console.log('\n=== STUB CREATED ===');
console.log(run('wmic process where "ProcessId=51072" get CreationDate /format:list').trim());
console.log('\n=== REAL DEPLOYED BACKEND RUNNING? ===');
const running = run('wmic process where "Name=\'node.exe\'" get CommandLine /format:list');
console.log(running.includes('resources\\\\server\\\\dist\\\\index.js') || running.includes('resources\\server\\dist\\index.js') ? 'FOUND real backend' : 'NOT RUNNING (real backend is dead)');
console.log('\n=== DEPLOYED APP TALKS TO STUB: 404 on workspace ===');
console.log('(see probe-workspace-compare.mjs — port 4000 returns {"error":"not found","path":"/api/workspace/detect"})');
console.log('\n=== SOURCE BACKEND (4001) HEALTHY ===');
console.log(run('curl -s -m 5 http://127.0.0.1:4001/api/health').slice(0, 120));
console.log('\n=== BACKUPS PRESERVED ===');
console.log(run('dir /b "C:\\Users\\Cris\\Desktop\\desktop\\Agentic_OS\\Agentic OS\\resources\\app\\dist.bak-20260818_221918" "C:\\Users\\Cris\\Desktop\\desktop\\Agentic_OS\\Agentic OS\\resources\\app\\dist.bak-swap-20260818_222234" 2>nul').trim() || 'missing!');
