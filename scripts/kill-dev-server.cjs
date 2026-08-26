// kill-dev-server.cjs — gracefully stop the orphaned DEV server on :4001.
const { execSync } = require('child_process');

function findPortOwner(port) {
  try {
    const out = execSync(`netstat -ano`, { encoding: 'utf-8' });
    for (const line of out.split('\n')) {
      if (line.includes(`:${port}`) && line.includes('LISTENING')) {
        const pid = line.trim().split(/\s+/).pop();
        return Number(pid);
      }
    }
  } catch (e) {}
  return null;
}

const pid = findPortOwner(4001);
if (!pid) { console.log('No process on :4001 — nothing to kill.'); process.exit(0); }
console.log('Killing DEV server PID', pid);
try {
  // Graceful: taskkill without /F first (WM_CLOSE for the console tree).
  execSync(`taskkill /PID ${pid} /T`, { encoding: 'utf-8' });
  console.log('taskkill (graceful) sent.');
} catch (e) {
  console.log('graceful taskkill failed:', e.message.trim());
  // Fall back to force for OUR OWN dev server only (not the production app).
  try { execSync(`taskkill /PID ${pid} /T /F`, { encoding: 'utf-8' }); console.log('force taskkill done.'); }
  catch (e2) { console.log('force taskkill failed:', e2.message.trim()); }
}
