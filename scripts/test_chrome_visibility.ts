import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { WindowsBrowserWindowHelper } from '../server/dist/services/browser/browserSession.js';

async function testChromeLaunch() {
  const profileDir = path.join(process.env.TEMP || 'C:\\Temp', 'test-chrome-profile');
  const exe = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const port = 9223;

  console.log('Spawning Chrome...');
  const proc = spawn(
    exe,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--start-maximized',
      'https://www.google.com',
    ],
    { detached: true, stdio: 'ignore' }
  );
  proc.unref();

  await new Promise(r => setTimeout(r, 4000));

  // Find Chrome PID listening on 9223
  console.log('Proc PID:', proc.pid);

  const winNoPid = WindowsBrowserWindowHelper.inspectWindow(undefined, 'Chrome');
  console.log('inspectWindow(undefined, "Chrome"):', winNoPid);

  const winProcPid = WindowsBrowserWindowHelper.inspectWindow(proc.pid, 'Chrome');
  console.log('inspectWindow(proc.pid, "Chrome"):', winProcPid);

  // Now query CDP
  const cdpTargets = await fetch(`http://127.0.0.1:${port}/json`).then(r => r.json()).catch(() => []);
  console.log('CDP targets:', cdpTargets);

  // Navigate to YouTube via CDP
  const pageTarget = cdpTargets.find((t: any) => t.type === 'page');
  if (pageTarget) {
    console.log('Page target ID:', pageTarget.id, 'title:', pageTarget.title, 'url:', pageTarget.url);
  }

  // Let's run diagnose_windows script to see exact window title!
}

testChromeLaunch().catch(console.error);
