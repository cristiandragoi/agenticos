/* Gracefully stop a process by PID (WM_CLOSE via taskkill without /F).
 * Usage: node scripts/graceful-stop.cjs <pid>
 */
const { execFileSync } = require('child_process');
const pid = process.argv[2];
if (!pid) { console.error('usage: graceful-stop.cjs <pid>'); process.exit(2); }
try {
  execFileSync('taskkill', ['/PID', pid], { stdio: 'pipe', windowsHide: true });
  console.log(`taskkill /PID ${pid} sent (graceful)`);
} catch (e) {
  console.log(`taskkill result: ${(e.stderr || e.message || '').toString().trim()}`);
}
