/* Part 4: USER EXACT SCENARIO — no New Task, stuck goal auto-selected, type + Enter */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const log = [];
  page.on('request', req => {
    const u = req.url();
    if (u.includes('/api/chat/agents/goal')) log.push(`REQ ${req.method()} ${u} body=${req.postData() || ''}`);
  });
  page.on('response', async res => {
    const u = res.url();
    if (u.includes('/api/chat/agents/goal')) {
      let body = '';
      try { body = (await res.text()).slice(0, 400); } catch (e) {}
      log.push(`RES ${res.status()} ${u} body=${body}`);
    }
  });

  await page.goto('http://127.0.0.1:5174/#/codex', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(7000);

  // DO NOT click New Task — reproduce the auto-hydrated stuck-goal state
  const ta = page.locator('textarea[aria-label="What should CodeX do?"]');
  const taCount = await ta.count();
  console.log('TEXTAREA COUNT:', taCount);
  const disabled = taCount ? await ta.isDisabled() : 'N/A';
  console.log('TEXTAREA DISABLED:', disabled);

  const sendBtn = page.locator('button:has-text("Send")');
  const sendCount = await sendBtn.count();
  console.log('SEND BUTTON COUNT:', sendCount);
  if (sendCount) console.log('SEND DISABLED:', await sendBtn.first().isDisabled());

  if (taCount) {
    await ta.fill('Tell me the current git branch. Do not modify anything.');
    console.log('TYPED, pressing Enter');
    await ta.press('Enter');
  }

  await page.waitForTimeout(8000);

  console.log('=== GOAL LOG ===');
  log.forEach(l => console.log(l));

  const bodyText = await page.evaluate(() => document.body ? document.body.innerText.slice(-1200) : 'NO BODY');
  console.log('=== BODY (last 1200) ===');
  console.log(bodyText);

  await page.screenshot({ path: 'scripts/p-codex-stuck.png' });
  await browser.close();
})().catch(err => { console.error('FATAL', err); process.exit(1); });
