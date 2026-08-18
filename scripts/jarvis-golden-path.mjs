// Drive the GOLDEN-PATH DIAG panel in the real packaged UI via CDP.
// 3 consecutive turns + BLUE ELEPHANT. Captures per-turn timings + answers.
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const page = pages.find((p) => p.url().startsWith('file:')) || pages[0];

// Ensure we are on the Jarvis page where the panel lives
await page.evaluate(() => { location.hash = '#/jarvis'; });
await new Promise((r) => setTimeout(r, 2000));
await page.waitForFunction(() => document.querySelector('[data-testid="golden-path-panel"]'), { timeout: 20000 });
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('[data-testid="golden-path-panel"] button')).find((b) => b.textContent?.includes('GOLDEN PATH DIAG'));
  btn?.click();
});
await page.waitForFunction(() => document.querySelector('[data-testid="golden-path-input"]'), { timeout: 10000 });

const prompts = [
  'What model are you using?',
  'What model are you using?',
  'Are you still responding correctly?',
  'Say exactly: BLUE ELEPHANT',
];

for (const prompt of prompts) {
  // Type into the golden-path input
  await page.evaluate((text) => {
    const el = document.querySelector('[data-testid="golden-path-input"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, prompt);
  // Click RUN
  await page.evaluate(() => {
    document.querySelector('[data-testid="golden-path-send"]')?.click();
  });
  // Wait until the RUN button is re-enabled (stream done), then read the
  // NEWEST entry (entries are prepended — index 0).
  await page.waitForFunction(
    () => {
      const btn = document.querySelector('[data-testid="golden-path-send"]');
      return btn && !btn.disabled;
    },
    { timeout: 90000 },
  );
  await new Promise((r) => setTimeout(r, 300));
  const entry = await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="golden-path-panel"]');
    if (!panel) return '(panel missing)';
    const entries = Array.from(panel.querySelectorAll('div > div'));
    const newest = entries.find((e) => (e.textContent || '').includes('jarvis-diag-'));
    return newest ? (newest.textContent || '').replace(/\n+/g, ' | ').slice(0, 700) : '(no entry)';
  }, prompt);
  console.log('=== TURN:', JSON.stringify(prompt));
  console.log(entry);
}

await browser.disconnect();
