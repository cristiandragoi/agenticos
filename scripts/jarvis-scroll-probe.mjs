// GUI transcript freshness: find the scrollable transcript container, report
// scroll metrics + rendered message tail, scroll to bottom, re-report.
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const page = pages.find(p => p.url().includes('/jarvis')) || pages[0];
const report = await page.evaluate(() => {
  const findScrollables = () => {
    const out = [];
    document.querySelectorAll('*').forEach((el) => {
      if (el.scrollHeight > el.clientHeight + 50 && el.clientHeight > 200) {
        const t = (el.innerText || '').replace(/\n+/g, ' | ').slice(0, 160);
        out.push({ cls: (el.className || '').toString().slice(0, 80), sh: el.scrollHeight, ch: el.clientHeight, st: el.scrollTop, text: t });
      }
    });
    return out.slice(0, 8);
  };
  const before = findScrollables();
  // try scrolling every scrollable to bottom
  document.querySelectorAll('*').forEach((el) => { if (el.scrollHeight > el.clientHeight + 50 && el.clientHeight > 200) el.scrollTop = el.scrollHeight; });
  return new Promise((resolve) => setTimeout(() => resolve({ before, after: findScrollables() }), 400));
});
console.log('SCROLLABLE CONTAINERS (before → after scroll-to-bottom):');
for (let i = 0; i < report.before.length; i++) {
  console.log(`#${i}`, JSON.stringify(report.before[i]));
  console.log('   →', JSON.stringify(report.after[i] || null));
}
await browser.disconnect();
