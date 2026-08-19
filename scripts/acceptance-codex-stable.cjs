/* FINAL ACCEPTANCE: exact mission prompt through real Codex UI.
 * Prompt: "Create no files and modify nothing. Inspect B:\AgenticOS. Return exactly: CODEX_STABLE_OK"
 * Verifies: UI opens, no zombie blocks SEND, provider/model resolved, prompt submits,
 * real executor runs, result persists, result renders. */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const log = [];
  page.on('request', req => {
    const u = req.url();
    if (u.includes('/api/chat/agents/goal') || u.includes('agent-provider-assignments')) log.push(`REQ ${req.method()} ${u}`);
  });
  page.on('response', async res => {
    const u = res.url();
    if (u.includes('/api/chat/agents/goal') || u.includes('agent-provider-assignments')) {
      let body = '';
      try { body = (await res.text()).slice(0, 250); } catch (e) {}
      log.push(`RES ${res.status()} ${u} body=${body}`);
    }
  });
  page.on('console', msg => {
    const t = msg.text();
    if (t && t.length < 300) log.push(`CONSOLE ${t}`);
  });

  await page.goto('http://127.0.0.1:5174/#/codex', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(7000);

  // 1. No zombie auto-selected: SEND must be available (no active goal)
  const ta = page.locator('textarea[aria-label="What should CodeX do?"]');
  const taCount = await ta.count();
  console.log('TEXTAREA COUNT:', taCount);
  const sendBtn = page.locator('button:has-text("Send")');
  const sendCount = await sendBtn.count();
  console.log('SEND BUTTON COUNT:', sendCount, '(must be >0 — no zombie block)');
  const bodyBefore = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 1200) : '');
  console.log('=== BODY (first 1200) ===');
  console.log(bodyBefore);
  const runSettingsText = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="codex-run-settings"]');
    return el ? el.innerText.slice(0, 300) : 'NO RUN SETTINGS';
  });
  console.log('RUN SETTINGS SUMMARY:', runSettingsText);

  // 2. Type acceptance prompt and send
  if (taCount) {
    await ta.fill('Create no files and modify nothing. Inspect B:\\AgenticOS. Return exactly: CODEX_STABLE_OK');
    console.log('TYPED ACCEPTANCE PROMPT');
    if (sendCount) await sendBtn.first().click();
    else await ta.press('Enter');
  }

  // 3. Poll for terminal state
  let finalBody = '';
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(3000);
    finalBody = await page.evaluate(() => document.body ? document.body.innerText : '');
    if (/COMPLETED|FAILED|STOPPED|CANCELLED|CODEX_STABLE_OK|Error/i.test(finalBody.slice(-3500))) break;
  }

  console.log('=== GOAL/ASSIGNMENT LOG ===');
  log.forEach(l => console.log(l));

  // 4. Find goal id from POST response and fetch persisted state
  const postMatch = log.find(l => l.startsWith('RES 200') && l.includes('/api/chat/agents/goal body'));
  const goalId = postMatch ? (postMatch.match(/goal-[a-f0-9]+-?/) || [null])[0] : null;
  console.log('GOAL ID:', goalId);
  if (goalId) {
    const res = await fetch(`http://127.0.0.1:4000/api/chat/agents/goal/${goalId}`);
    const g = await res.json();
    console.log('PERSISTED STATUS:', g.status);
    const events = g.history || [];
    console.log('EVENTS:', events.length);
    events.slice(-4).forEach(e => console.log(`  [${e.state}] ${(e.message || '').slice(0, 200)}`));
    console.log('RUN SUMMARY:', JSON.stringify(g.runSummary || null).slice(0, 400));
  }

  const tail = finalBody.slice(-2200);
  console.log('=== UI BODY TAIL ===');
  console.log(tail);
  await page.screenshot({ path: 'scripts/p-codex-stable.png' });
  await browser.close();
})().catch(err => { console.error('FATAL', err); process.exit(1); });
