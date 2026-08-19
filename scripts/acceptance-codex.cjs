/* ACCEPTANCE TEST: exact mission prompt through real Codex UI.
 * "Inspect the current Agentic OS repository root. Return: CODEX_RUNTIME_OK plus the repository path you inspected."
 * Waits for terminal state and captures the final answer. */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const log = [];
  page.on('request', req => {
    const u = req.url();
    if (u.includes('/api/chat/agents/goal')) log.push(`REQ ${req.method()} ${u}`);
  });
  page.on('response', async res => {
    const u = res.url();
    if (u.includes('/api/chat/agents/goal')) {
      let body = '';
      try { body = (await res.text()).slice(0, 250); } catch (e) {}
      log.push(`RES ${res.status()} ${u} body=${body}`);
    }
  });

  await page.goto('http://127.0.0.1:5174/#/codex', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(6000);

  // New Task to start clean
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const t = btns.find(b => (b.innerText || '').trim().toLowerCase().includes('new task'));
    if (t) t.click();
  });
  await page.waitForTimeout(1500);

  const ta = page.locator('textarea[aria-label="What should CodeX do?"]');
  const prompt = 'Inspect the current Agentic OS repository root. Return: CODEX_RUNTIME_OK plus the repository path you inspected.';
  await ta.fill(prompt);
  console.log('SENT ACCEPTANCE PROMPT');
  await ta.press('Enter');

  // Poll for terminal state (completed/failed) up to 90s
  let goalId = null;
  let finalBody = '';
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(3000);
    const body = await page.evaluate(() => document.body ? document.body.innerText : '');
    finalBody = body;
    const m = body.match(/goal-[a-f0-9]+-?/);
    if (m && !goalId) goalId = m[0];
    if (/COMPLETED|FAILED|STOPPED|CANCELLED|Error|failed/i.test(body.slice(-3000))) break;
  }

  console.log('=== GOAL LOG ===');
  log.forEach(l => console.log(l));
  console.log('GOAL ID CANDIDATE:', goalId);

  // Fetch final goal state
  if (goalId) {
    const res = await fetch(`http://127.0.0.1:4000/api/chat/agents/goal/${goalId}`);
    const g = await res.json();
    console.log('FINAL STATUS:', g.status);
    const events = g.history || [];
    console.log('EVENTS:', events.length);
    events.slice(-6).forEach(e => console.log(`  [${e.state}] ${(e.message || '').slice(0, 220)}`));
    console.log('RUN SUMMARY:', JSON.stringify(g.runSummary || null).slice(0, 500));
  }

  // Extract the visible chat tail
  const tail = finalBody.slice(-2000);
  console.log('=== UI BODY TAIL ===');
  console.log(tail);
  await page.screenshot({ path: 'scripts/p-codex-acceptance.png' });
  await browser.close();
})().catch(err => { console.error('FATAL', err); process.exit(1); });
