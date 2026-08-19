// REPRODUCE: tiny bounded Codex prompt through the real UI/API, capture full trace.
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const log = [];
  page.on('response', async res => {
    const u = res.url();
    if (u.includes('/api/chat/agents/goal')) {
      let body = '';
      try { body = (await res.text()).slice(0, 200); } catch (e) {}
      log.push(`RES ${res.status()} ${u} body=${body}`);
    }
  });
  page.on('console', msg => {
    const t = msg.text();
    if (t && t.length < 300) log.push(`CONSOLE ${t}`);
  });

  await page.goto('http://127.0.0.1:5174/#/codex', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(6000);
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const t = btns.find(b => (b.innerText || '').trim().toLowerCase().includes('new task'));
    if (t) t.click();
  });
  await page.waitForTimeout(1500);
  const ta = page.locator('textarea[aria-label="What should CodeX do?"]');
  await ta.fill('Return exactly: PROVIDER_TEST_OK');
  await ta.press('Enter');

  // Poll for terminal state
  let finalBody = '';
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(3000);
    finalBody = await page.evaluate(() => document.body ? document.body.innerText : '');
    if (/COMPLETED|FAILED|STOPPED|PROVIDER_TEST_OK|Error/i.test(finalBody.slice(-3000))) break;
  }
  console.log('=== LOG ===');
  log.forEach(l => console.log(l));

  // Find the goal id and dump full events
  const postMatch = log.find(l => l.startsWith('RES 200') && l.includes('/api/chat/agents/goal body'));
  const goalId = postMatch ? (postMatch.match(/goal-[a-f0-9]+-?/) || [null])[0] : null;
  console.log('GOAL ID:', goalId);
  if (goalId) {
    const res = await fetch(`http://127.0.0.1:4000/api/chat/agents/goal/${goalId}`);
    const g = await res.json();
    console.log('STATUS:', g.status);
    console.log('EXECUTION OPTIONS:', JSON.stringify(g.executionOptions));
    for (const e of (g.history || [])) {
      console.log(`[${e.state}] eventType=${e.eventType} provider=${e.provider} model=${e.model} errorCode=${e.errorCode || ''}`);
      console.log('   msg:', String(e.message || '').slice(0, 300));
      if (e.error) console.log('   err:', String(e.error).slice(0, 300));
      if (e.errorDetails) console.log('   errDetails:', String(e.errorDetails).slice(0, 300));
    }
  }
  await browser.close();
})().catch(err => { console.error('FATAL', err); process.exit(1); });
