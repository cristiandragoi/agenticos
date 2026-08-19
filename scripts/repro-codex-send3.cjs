/* Part 3: EXACT user flow — type prompt, press Enter (SEND), capture POST + error */
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
      try { body = (await res.text()).slice(0, 500); } catch (e) {}
      log.push(`RES ${res.status()} ${u} body=${body}`);
    }
  });
  page.on('console', msg => {
    const t = msg.text();
    if (t && t.length < 400) log.push(`CONSOLE ${t}`);
  });

  await page.goto('http://127.0.0.1:5174/#/codex', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(6000);

  // Click "New Task" to reset activeGoalId (this is what a user does to start fresh)
  const newTaskClicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const target = btns.find(b => (b.innerText || '').trim().toLowerCase().includes('new task'));
    if (target) { target.click(); return true; }
    return false;
  });
  console.log('NEW TASK CLICKED:', newTaskClicked);
  await page.waitForTimeout(2000);

  const ta = page.locator('textarea[aria-label="What should CodeX do?"]');
  const taCount = await ta.count();
  console.log('TEXTAREA COUNT:', taCount);
  if (taCount) {
    await ta.fill('List the files in the repository root. Do not create or modify any files.');
    console.log('TYPED, pressing Enter');
    await ta.press('Enter');
  } else {
    // fallback: any textarea
    const anyTa = page.locator('textarea').first();
    await anyTa.fill('List the files in the repository root. Do not create or modify any files.');
    console.log('FALLBACK TYPED, pressing Enter');
    await anyTa.press('Enter');
  }

  await page.waitForTimeout(8000);

  console.log('=== GOAL REQUEST/RESPONSE LOG ===');
  log.forEach(l => console.log(l));

  const bodyText = await page.evaluate(() => document.body ? document.body.innerText.slice(-1500) : 'NO BODY');
  console.log('=== BODY TEXT (last 1500) ===');
  console.log(bodyText);

  await page.screenshot({ path: 'scripts/p-codex-enter.png' });
  await browser.close();
})().catch(err => { console.error('FATAL', err); process.exit(1); });
