import { execSync } from 'child_process';
import { chromium } from 'playwright';

async function probe() {
  let pid: number | null = null;
  try {
    const raw = execSync('powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 9223 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess"').toString().trim();
    if (raw) {
      pid = parseInt(raw, 10);
    }
  } catch {}
  console.log('Listening PID on 9223:', pid);

  if (!pid) {
    console.log('No Chrome listening on 9223 currently.');
    return;
  }

  // Connect CDP
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const page = browser.contexts()[0]?.pages()[0];
  if (page) {
    const session = await page.context().newCDPSession(page);
    try {
      const win = await session.send('Browser.getWindowForTarget');
      console.log('Browser.getWindowForTarget:', win);
    } catch (e: any) {
      console.log('Browser.getWindowForTarget error:', e.message);
    }
  }
  await browser.close();
}

probe().catch(console.error);
