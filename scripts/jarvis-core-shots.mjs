// Jarvis core shape probe — saves the rendered canvas to PNG so the core's
// silhouette can be inspected visually (and cropped to the centre).
// Serves the real D:/AgenticOS/dist bundle with a stubbed /api surface.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = 'D:/AgenticOS/dist';
const PORT = 4411;
const OUT = 'D:/AgenticOS/.tmp-shots';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json' };
fs.mkdirSync(OUT, { recursive: true });

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url.startsWith('/api/')) {
    if (url === '/api/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ status: 'ready', ok: true, uptime: 1, subsystems: {} })); return; }
    if (url.endsWith('/events') || url.endsWith('/stream')) { res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' }); return; }
    if (url.endsWith('/credentials-status')) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); return; }
    if (url.endsWith('/sales/leads')) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, leads: [] })); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('[]'); return;
  }
  let file = path.join(ROOT, url === '/' ? 'index.html' : url);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--hide-scrollbars'],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 180)));
await page.goto(`http://127.0.0.1:${PORT}/#/jarvis`, { waitUntil: 'networkidle2', timeout: 45000 }).catch((e) => errors.push('goto ' + e.message));
await new Promise((r) => setTimeout(r, 6000));

const info = {};
for (const [label, w, h] of [['1600x900', 1600, 900], ['1920x1080', 1920, 1080]]) {
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await new Promise((r) => setTimeout(r, 5000));
  await page.addStyleTag({ content: `html,body{background:#000 !important}
    [data-testid="jarvis-stage"],[data-testid="jarvis-orb-region"],[data-testid="jarvis-dashboard"],
    [data-testid="jarvis-orb-wrapper"],[data-testid="jarvis-orb-core"],[data-testid="jarvis-neural"],
    [data-testid="jarvis-center-scroll"],.jarvis-blob1-shell{background:transparent !important;box-shadow:none !important}` });
  await new Promise((r) => setTimeout(r, 1500));
  const box = await page.evaluate(() => {
    const c = document.querySelector('[data-testid="jarvis-orb-canvas"]');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  if (!box) { info[label] = { error: 'no canvas' }; continue; }
  // Full canvas screenshot (page-level clip keeps the real backdrop black).
  const full = `${OUT}/core-${label}.png`;
  await page.screenshot({ path: full, clip: { x: box.x, y: box.y, width: box.w, height: box.h } });
  // Centre crop, 1:1, tight around the projected core.
  const side = Math.min(box.h, 620);
  const crop = { x: box.x + box.w / 2 - side / 2, y: box.y + box.h / 2 - side / 2, width: side, height: side };
  const centre = `${OUT}/core-${label}-centre.png`;
  await page.screenshot({ path: centre, clip: crop });
  info[label] = { canvasBox: box, full, crop, centre, canvasAspect: +(box.w / box.h).toFixed(3) };
}
console.log('SHOTS ' + JSON.stringify({ info, errors: errors.slice(0, 8) }, null, 1));
await browser.close();
server.close();
process.exit(0);
