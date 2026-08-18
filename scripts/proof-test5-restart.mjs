// Gracefully close the packaged Agentic OS app (WM_CLOSE → before-quit → backend shutdown),
// wait for port release, then relaunch. TEST 5 restart persistence.
import { execSync, spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const APP = 'C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/Agentic OS.exe';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  // 1. Graceful close via taskkill without /F (sends WM_CLOSE).
  try {
    execSync('taskkill /IM "Agentic OS.exe"', { stdio: 'pipe' });
    console.log('CLOSE SIGNAL SENT (WM_CLOSE)');
  } catch (e) {
    console.log('close err', String(e).slice(0, 120));
  }
  await sleep(3000);
  // 2. Verify port released.
  let port = '';
  try { port = execSync('netstat -ano | findstr :4000 | findstr LISTENING', { encoding: 'utf8' }).trim(); } catch { port = ''; }
  console.log('PORT-4000-AFTER-CLOSE:', port || 'RELEASED');
  // 3. Relaunch.
  const logPath = path.join(os.tmpdir(), 'agenticos_stdout_proof.txt');
  const child = spawn(APP, [], {
    detached: true,
    stdio: ['ignore', fs.openSync(logPath, 'a'), fs.openSync(logPath, 'a')],
    env: { ...process.env, AGENTICOS_ELECTRON_REMOTE_DEBUGGING_PORT: '9223' },
  });
  child.unref();
  console.log('RELAUNCHED pid', child.pid, 'log', logPath);
  // 4. Wait for health.
  for (let i = 0; i < 20; i++) {
    await sleep(2000);
    try {
      const res = await fetch('http://127.0.0.1:4000/api/health', { signal: AbortSignal.timeout(3000) });
      if (res.ok) { console.log('HEALTH OK', await res.text()); return; }
    } catch { /* not up yet */ }
  }
  console.log('HEALTH TIMEOUT');
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
