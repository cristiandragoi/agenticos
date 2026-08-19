/* Runtime reproduction: drive CodeX Studio UI, click SEND, capture responses.
 * Targets the live dev UI at 5174 (proxies /api -> backend 4000).
 * Non-destructive: creates one manual-approval goal (same as user would).
 */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const reqLog = [];
  page.on('request', req => {
    const u = req.url();
    if (u.includes('/api/')) reqLog.push(`REQ ${req.method()} ${u}`);
  });
  page.on('response', res => {
    const u = res.url();
    if (u.includes('/api/')) reqLog.push(`RES ${res.status()} ${u}`);
  });
  page.on('console', msg => {
    const t = msg.text();
    if (t && t.length < 500) reqLog.push(`CONSOLE ${t}`);
  });

  console.log('== navigating to CodeX Studio ==');
  await page.goto('http://127.0.0.1:5174/#/codex', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);

  const title = await page.title();
  console.log('PAGE TITLE:', title);

  // Dump visible text to find the input and any error state
  const bodyText = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 1500) : 'NO BODY');
  console.log('BODY TEXT (first 1500):');
  console.log(bodyText);

  // Find a textarea
  const textareas = await page.locator('textarea').count();
  console.log('TEXTAREAS:', textareas);
  const inputs = await page.locator('input[type="text"], input:not([type])').count();
  console.log('TEXT INPUTS:', inputs);

  const sendBtnInfo = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    return btns.map((b, i) => `${i}:${(b.innerText || '').trim().slice(0, 40)}|${b.className.slice(0, 60)}`).slice(0, 60);
  });
  console.log('BUTTONS:', JSON.stringify(sendBtnInfo, null, 1));

  await browser.close();
})().catch(err => { console.error('FATAL', err); process.exit(1); });
