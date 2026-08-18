// Verify the running Electron renderer loaded the Phase-15 bundle.
import p from 'puppeteer-core';
const browser = await p.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const pg = pages.find((x) => x.url().includes('index.html')) || pages[0];
await new Promise((r) => setTimeout(r, 3000));
const r = await pg.evaluate(() => {
  const s = document.querySelectorAll('script[src]');
  return Array.from(s).map((x) => x.src).join('\n');
});
console.log('SCRIPT_SRC', r);
// Prove the Phase-15 markers are live in the loaded runtime.
const markers = await pg.evaluate(() => {
  const has = (fn) => typeof window[fn] === 'function';
  return {
    voiceTimeline: has('__voiceTimelineGet'),
    synthesisLog: has('__voiceSynthesisLog'),
    distinctVoices: has('__voiceDistinctVoices'),
  };
});
console.log('PROBES', JSON.stringify(markers));
await browser.disconnect();
