// Live GUI ground truth: current page, transcript tail, jarvis status/stage
// panel, banners, composer state, fetch-hook records. CDP via 9223.
import puppeteer from 'puppeteer-core';

const CDP = 'http://127.0.0.1:9223';
const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const pages = await browser.pages();
const page = pages.find(p => p.url().includes('/jarvis')) || pages[0];
console.log('URL:', page.url());

const out = await page.evaluate(() => {
  const txt = (el) => (el ? el.innerText.replace(/\n+/g, ' | ').slice(0, 300) : null);
  const result = {};
  // transcript bubbles: try common selectors
  const candidates = [];
  document.querySelectorAll('[class*="message"], [class*="bubble"], [class*="chat"]').forEach((el, i) => {
    if (i < 60 && el.children.length <= 3) candidates.push(txt(el));
  });
  result.transcriptCandidates = candidates.slice(-18);
  // jarvis status / stage text: search for known labels
  const bodyText = document.body ? document.body.innerText : '';
  const grab = (label) => {
    const i = bodyText.indexOf(label);
    return i >= 0 ? bodyText.slice(i, i + 220).replace(/\n+/g, ' | ') : null;
  };
  result.ACTIVE_WORK = grab('ACTIVE WORK');
  result.LIVE_WORK = grab('LIVE WORK');
  result.LISTENING = bodyText.includes('Listening') || null;
  result.VOICE_ON = bodyText.includes('VOICE ON') || null;
  result.clarifBanner = grab('Clarification');
  result.codexBanner = grab('CodeX');
  result.approvalBanner = grab('approval');
  // composer
  const ta = document.querySelector('textarea');
  result.composerDisabled = ta ? ta.disabled : 'no-textarea';
  result.composerPlaceholder = ta ? ta.placeholder : null;
  // fetch hook records (transcribe)
  result.vtFetch = window.__vtFetch ? window.__vtFetch.slice(-8).map(r => ({
    url: r.url, blobSize: r.blobSize, blobType: r.blobType, status: r.status, body: (r.body || '').slice(0, 120)
  })) : 'NO_HOOK';
  // hidden state (rAF pause check)
  result.documentHidden = document.hidden;
  result.hasFocus = document.hasFocus();
  return result;
});
console.log(JSON.stringify(out, null, 1));
await browser.disconnect();
