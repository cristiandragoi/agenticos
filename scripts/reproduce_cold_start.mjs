import { _electron as electron } from 'playwright';
import { execSync } from 'node:child_process';
import path from 'node:path';

const EXE_PATH = 'C:\\Users\\cd-pr\\AppData\\Local\\Programs\\AgenticOS\\AgenticOS.exe';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log('=== TASK 1: TRUE COLD START REPRODUCTION ===');

  console.log('1. Verifying no stale AgenticOS processes...');
  try {
    const procs = execSync('powershell.exe -NoProfile -Command "Get-Process -Name AgenticOS, electron -ErrorAction SilentlyContinue | Select-Object Id, ProcessName"', { encoding: 'utf8' });
    console.log('Running procs before launch:\n', procs || '(none)');
  } catch {}

  console.log('2. Launching installed Electron app...');
  const app = await electron.launch({
    executablePath: EXE_PATH,
    args: ['--no-sandbox'],
  });

  const appProc = app.process();
  console.log(`Electron main process PID: ${appProc.pid}`);

  appProc.stdout.on('data', (d) => {
    const s = d.toString().trimEnd();
    console.log('[MAIN STDOUT]', s);
  });
  appProc.stderr.on('data', (d) => {
    const s = d.toString().trimEnd();
    console.error('[MAIN STDERR]', s);
  });

  const page = await app.firstWindow();

  page.on('console', (msg) => {
    console.log(`[RENDERER CONSOLE ${msg.type().toUpperCase()}]`, msg.text());
  });

  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('/api/') || url.includes(':4600') || url.includes(':7880')) {
      console.log(`[NET REQ] ${req.method()} ${url}`);
    }
  });

  page.on('requestfailed', (req) => {
    const url = req.url();
    console.error(`[NET REQ FAILED] ${req.method()} ${url} — ${req.failure()?.errorText || 'unknown error'}`);
  });

  page.on('response', (res) => {
    const url = res.url();
    if (url.includes('/api/') || url.includes(':4600') || url.includes(':7880')) {
      console.log(`[NET RES] ${res.status()} ${url}`);
    }
  });

  console.log('Waiting 15 seconds to observe startup requests, reconnect loops, and error logs...');
  await sleep(15000);

  console.log('\n--- Checking running processes and listening ports ---');
  try {
    const netstat = execSync('powershell.exe -NoProfile -Command "Get-NetTCPConnection -LocalPort 4600, 7880, 8642 -ErrorAction SilentlyContinue | Select-Object LocalPort, State, OwningProcess"', { encoding: 'utf8' });
    console.log('Listening ports:\n', netstat || '(none)');
  } catch (e) {
    console.log('Netstat error:', e.message);
  }

  try {
    const procs = execSync('powershell.exe -NoProfile -Command "Get-Process -Name AgenticOS, electron, livekit-server -ErrorAction SilentlyContinue | Select-Object Id, ProcessName, Path"', { encoding: 'utf8' });
    console.log('App processes:\n', procs || '(none)');
  } catch (e) {
    console.log('Process error:', e.message);
  }

  console.log('\n--- Checking UI visible text / error state ---');
  try {
    const bodyText = await page.evaluate(() => document.body.innerText);
    console.log('UI Body text snippet (first 1000 chars):\n', bodyText.slice(0, 1000));
  } catch (e) {
    console.log('Error evaluating body text:', e.message);
  }

  console.log('\nClosing app...');
  await app.close().catch(() => {});
  console.log('Done reproduction run.');
}

main().catch((err) => {
  console.error('Reproduction failed:', err);
  process.exit(1);
});
