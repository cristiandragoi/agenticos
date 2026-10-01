import { chromium } from 'playwright';
import { spawn } from 'child_process';
import path from 'path';

async function testCdpWindow() {
  const profileDir = path.join(process.env.TEMP || 'C:\\Temp', 'test-cdp-win');
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

  await new Promise(r => setTimeout(r, 3000));

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  const page = context.pages()[0];

  console.log('Page URL:', page.url());

  // 1. CDP Session
  const session = await context.newCDPSession(page);
  
  // 2. Query targets
  const targets = await session.send('Target.getTargets');
  console.log('Targets:', targets.targetInfos.map((t: any) => ({ id: t.targetId, type: t.type, title: t.title, url: t.url })));

  const pageTarget = targets.targetInfos.find((t: any) => t.type === 'page');
  
  // 3. Browser.getWindowForTarget
  try {
    const winForTarget = await session.send('Browser.getWindowForTarget', {
      targetId: pageTarget.targetId,
    });
    console.log('Browser.getWindowForTarget:', winForTarget);
  } catch (err: any) {
    console.log('Browser.getWindowForTarget error:', err.message);
  }

  // 4. Browser.getWindowBounds
  try {
    const bounds = await session.send('Browser.getWindowBounds', { windowId: 1 });
    console.log('Browser.getWindowBounds:', bounds);
  } catch (err: any) {
    console.log('Browser.getWindowBounds error:', err.message);
  }

  // 5. Does CDP have window handle?
  // Let's check session.send('Browser.getVersion')
  const ver = await session.send('Browser.getVersion');
  console.log('Browser.getVersion:', ver);

  await browser.close();
}

testCdpWindow().catch(console.error);
