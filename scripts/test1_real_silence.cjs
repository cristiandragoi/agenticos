const { chromium } = require('playwright');

async function runTest1() {
  console.log('Connecting to AgenticOS over CDP...');
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const context = browser.contexts()[0];
  const page = context.pages()[0];

  console.log('Connected to page:', page.url());

  const networkEvents = [];
  page.on('request', req => {
    if (req.url().includes('/api/voice')) {
      networkEvents.push({ type: 'req', url: req.url(), method: req.method() });
      console.log('[NET REQ]', req.method(), req.url());
    }
  });
  page.on('response', async res => {
    if (res.url().includes('/api/voice')) {
      let text = '';
      try { text = await res.text(); } catch {}
      networkEvents.push({ type: 'res', url: res.url(), status: res.status(), body: text });
      console.log('[NET RES]', res.status(), res.url(), text);
    }
  });

  page.on('console', msg => {
    const txt = msg.text();
    if (txt.toLowerCase().includes('voice') || txt.toLowerCase().includes('mic') || txt.toLowerCase().includes('transcrib')) {
      console.log('[PAGE LOG]', txt);
    }
  });

  console.log('\n--- EXECUTING TEST 1: REAL SILENCE ---');
  // Count messages before
  const messageSelector = '[data-testid="jarvis-command-line"], [data-testid="jarvis-chat-scroll"] .messageRow';
  const initialCount = await page.locator(messageSelector).count();
  console.log('Initial message count:', initialCount);

  // Find mic button
  const micBtn = page.locator('[data-testid="mission-jarvis-mic"]').first();
  console.log('Clicking push-to-talk mic button...');
  await micBtn.click();

  // Wait 4 seconds for silence detection to trigger
  console.log('Waiting 4 seconds for silence timeout and return to idle...');
  await page.waitForTimeout(4000);

  // Check mic state
  const micTitleAfter = await micBtn.getAttribute('title');
  console.log('Mic button title after 4s:', micTitleAfter);

  // Count messages after
  const afterCount = await page.locator(messageSelector).count();
  console.log('Message count after 4s:', afterCount);

  const deltaMessages = afterCount - initialCount;
  console.log('Delta messages:', deltaMessages);

  console.log('\nNetwork events during silence test:');
  console.log(JSON.stringify(networkEvents, null, 2));

  await browser.close();

  if (deltaMessages === 0) {
    console.log('\n>>> TEST 1 RESULT: PASS (No conversational turns generated on silence)');
  } else {
    console.log('\n>>> TEST 1 RESULT: FAIL (Spurious turn generated on silence)');
  }
}

runTest1().catch(console.error);
