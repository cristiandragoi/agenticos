// Renderer console + body content on #/jarvis.
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
console.log('PAGES ' + pages.map((p) => p.url().slice(0, 80)).join(' | '));
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
const out = await app.evaluate(() => ({
  bodyLen: document.body.innerHTML.length,
  bodySnippet: document.body.innerHTML.slice(0, 300),
  rootChildren: document.getElementById('root') ? document.getElementById('root').children.length : -1,
}));
console.log('BODY ' + JSON.stringify(out, null, 1));
await browser.disconnect();
