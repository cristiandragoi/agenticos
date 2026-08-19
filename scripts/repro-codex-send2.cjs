/* Part 2: type a prompt, click SEND, capture network + UI error */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const log = [];
  page.on('request', req => {
    const u = req.url();
    if (u.includes('/api/')) log.push(`REQ ${req.method()} ${u} body=${req.postData() ? req.postData().slice(0, 200) : ''}`);
  });
  page.on('response', async res => {
    const u = res.url();
    if (u.includes('/api/')) {
      let body = '';
      try { body = (await res.text()).slice(0, 200); } catch (e) {}
      log.push(`RES ${res.status()} ${u} body=${body}`);
    }
  });
  page.on('console', msg => {
    const t = msg.text();
    if (t && t.length < 400) log.push(`CONSOLE ${t}`);
  });

  await page.goto('http://127.0.0.1:5174/#/codex', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);

  // Find the chat textarea (not the search box)
  const taCount = await page.locator('textarea').count();
  console.log('TEXTAREAS:', taCount);
  const textareaInfo = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('textarea')).map((t, i) => ({
      i, placeholder: t.placeholder, cls: t.className.slice(0, 80), visible: !!(t.offsetWidth || t.offsetHeight)
    }));
  });
  console.log('TEXTAREA INFO:', JSON.stringify(textareaInfo));

  // Type into the chat textarea (pick the last/visible one)
  const chatTa = page.locator('textarea').last();
  await chatTa.fill('List the files in the repository root. Do not create or modify any files.');
  console.log('TYPED');

  // Find and click the send button (look for send icon / aria-label)
  const clicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const candidates = btns.filter(b => {
      const t = (b.innerText || '').trim().toLowerCase();
      const label = (b.getAttribute('aria-label') || '').toLowerCase();
      const cls = (b.className || '').toLowerCase();
      return t === 'send' || label.includes('send') || cls.includes('send') || t.includes('send');
    });
    if (candidates.length) { candidates[0].click(); return 'clicked:' + (candidates[0].innerText || candidates[0].getAttribute('aria-label') || candidates[0].className).slice(0, 60); }
    return 'NO_SEND_BUTTON_FOUND';
  });
  console.log('SEND CLICK:', clicked);

  await page.waitForTimeout(6000);

  console.log('=== REQUEST/RESPONSE LOG ===');
  log.forEach(l => console.log(l));

  const bodyText = await page.evaluate(() => document.body ? document.body.innerText.slice(-2000) : 'NO BODY');
  console.log('=== BODY TEXT (last 2000) ===');
  console.log(bodyText);

  await page.screenshot({ path: 'scripts/p-codex-after-send.png' });
  await browser.close();
})().catch(err => { console.error('FATAL', err); process.exit(1); });
