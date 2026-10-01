import { _electron as electron } from 'playwright';
import { execSync } from 'node:child_process';

const EXE_PATH = 'C:\\Users\\cd-pr\\AppData\\Local\\Programs\\AgenticOS\\AgenticOS.exe';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log('=== STEP 1: VERIFYING CLEAN STATE ===');
  try {
    execSync('powershell.exe -NoProfile -Command "Get-Process -Name AgenticOS, electron, livekit-server -ErrorAction SilentlyContinue | Stop-Process -Force"', { stdio: 'ignore' });
  } catch {}
  await sleep(1000);

  console.log('=== STEP 2: LAUNCHING INSTALLED ELECTRON APP ===');
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
    console.log(`[RENDERER ${msg.type().toUpperCase()}]`, msg.text());
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
    if (url.includes('/api/jarvis-next/') || url.includes(':7880') || url.includes('/health')) {
      console.log(`[NET RES] ${res.status()} ${url}`);
    }
  });

  console.log('Waiting 6 seconds for initial boot...');
  await sleep(6000);

  console.log('\n=== STEP 3: TESTING BACKEND HEALTH DIRECTLY ===');
  try {
    const hRes = await fetch('http://127.0.0.1:4600/api/health');
    console.log(`Backend /health status: ${hRes.status}, ok: ${hRes.ok}`);
    const hJson = await hRes.json();
    console.log('Backend /health response:', JSON.stringify(hJson));
  } catch (err) {
    console.error('Direct /health check failed:', err.message);
  }

  console.log('\n=== STEP 4: TESTING TOKEN ENDPOINT DIRECTLY ===');
  try {
    const t0 = Date.now();
    const tRes = await fetch('http://127.0.0.1:4600/api/jarvis-next/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomName: 'jarvis-next-main',
        identity: 'test-user-direct',
        name: 'Direct Diagnostic User',
      }),
    });
    const dur = Date.now() - t0;
    console.log(`Token endpoint status: ${tRes.status}, ok: ${tRes.ok} (in ${dur}ms)`);
    const tJson = await tRes.json();
    console.log('Token response:', JSON.stringify({
      ...tJson,
      token: tJson.token ? `${tJson.token.slice(0, 30)}...[len=${tJson.token.length}]` : null,
    }));
  } catch (err) {
    console.error('Direct token endpoint check failed:', err.message);
  }

  console.log('\n=== STEP 5: CLICKING START CONVERSATION IN UI ===');
  try {
    // Look for button with Start Conversation or Retry Conversation
    const btn = page.locator('button:has-text("Start Conversation"), button:has-text("Retry Conversation")').first();
    const btnCount = await btn.count();
    console.log(`Found ${btnCount} matching voice buttons in UI`);
    if (btnCount > 0) {
      const btnText = await btn.innerText();
      console.log(`Clicking button: "${btnText}"`);
      await btn.click();
    } else {
      console.log('No Start/Retry button found by text. Searching for buttons with testid or mic icons...');
      const allButtons = await page.locator('button').allInnerTexts();
      console.log('All buttons on page:', allButtons.filter(b => b.trim()));
    }
  } catch (err) {
    console.error('Failed to click voice button:', err.message);
  }

  console.log('\nWaiting 10 seconds to observe connection attempt and logs...');
  await sleep(10000);

  console.log('\n=== STEP 6: CHECKING UI ERROR STATE ===');
  try {
    const errorEl = page.locator('[data-testid="jarvis-voice-error"], .bg-rose-500\\/10');
    const errCount = await errorEl.count();
    console.log(`Error elements count: ${errCount}`);
    for (let i = 0; i < errCount; i++) {
      console.log(`Error text [${i}]:`, await errorEl.nth(i).innerText());
    }
  } catch (e) {
    console.log('Error querying UI errors:', e.message);
  }

  console.log('\nClosing app...');
  await app.close().catch(() => {});
  console.log('Diagnosis completed.');
}

main().catch((err) => {
  console.error('Diagnostic run failed:', err);
  process.exit(1);
});
