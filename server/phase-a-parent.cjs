const { execSync } = require('child_process');
function sh(cmd) { try { return execSync(cmd, { encoding: 'utf8', windowsHide: true }).trim(); } catch (e) { return 'ERR: ' + (e.message || '').slice(0, 200); } }

console.log('=== parent of 17668 (PID 30844) ===');
console.log(sh('wmic process where "ProcessId=30844" get Name,CommandLine,ProcessId /format:list'));

console.log('\n=== parent of 30844 (grandparent) ===');
console.log(sh('wmic process where "ProcessId=30844" get ParentProcessId /format:list'));

console.log('\n=== is 17668 attached to a console? (SessionName) ===');
console.log(sh('tasklist /fi "PID eq 17668" /v /fo list'));
