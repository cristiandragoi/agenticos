// Hook live orb inputLevel events (VAD's view) + record/stop markers + blob outcome.
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];

await app.evaluate(() => {
  if (window.__rmsHook) return;
  window.__rmsHook = { events: [] };
  window.addEventListener('jarvis:input-level', (e) => {
    const level = e.detail?.level ?? null;
    if (typeof level === 'number') {
      window.__rmsHook.events.push({ t: Date.now(), level: Math.round(level * 1000) / 1000 });
    }
  });
  console.error('[RmsHook] input-level listener installed');
});

const logs = [];
app.on('console', (m) => logs.push({ t: Date.now(), line: m.type() + ': ' + m.text() }));
console.log('CAPTURE2_STARTED say each turn clearly');
const deadline = Date.now() + 360000; // 6 min
while (Date.now() < deadline) {
  await sleep(3000);
  const done = logs.filter((l) => l.line.includes('[VTurn] done')).length;
  const sent = logs.filter((l) => l.line.includes('[VTurn] handleSendMessage')).length;
  if (sent >= 5) { await sleep(20000); break; }
}
await sleep(5000);
// dump summary: per recording window, count input-level events above threshold
const summary = await app.evaluate(() => {
  const ev = window.__rmsHook.events;
  // bucket by 100ms
  const buckets = [];
  const byBucket = new Map();
  for (const e of ev) {
    const b = Math.floor(e.t / 100);
    if (!byBucket.has(b)) byBucket.set(b, []);
    byBucket.get(b).push(e.level);
  }
  for (const [b, arr] of byBucket) {
    const max = Math.max(...arr);
    const n = arr.length;
    buckets.push({ b, max, n, above: arr.filter((x) => x > 0.02).length });
  }
  buckets.sort((a, b) => a.b - b.b);
  return { count: ev.length, firstT: ev[0] ? ev[0].t : null, lastT: ev[ev.length - 1] ? ev[ev.length - 1].t : null, buckets: buckets.slice(-160) };
});
console.log('RMS_SUMMARY ' + JSON.stringify(summary, null, 1));
console.log('VTURN_TAIL');
for (const l of logs.filter((x) => x.line.includes('[VTurn]') || x.line.includes('[ConvTrace]') || x.line.includes('[RmsHook]'))) {
  console.log('T ' + (l.t - logs[0].t) + 'ms ' + l.line);
}
await browser.disconnect();
