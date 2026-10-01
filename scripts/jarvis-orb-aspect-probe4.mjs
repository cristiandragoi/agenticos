// Jarvis core aspect-ratio probe (v4) — exact pixel geometry.
// The orb canvas is transparent (alpha:true, clear alpha 0) and sits on the
// app's opaque background, so screenshots cannot be thresholded on alpha and
// the app background dominates luminance. Instead we capture the canvas rect
// twice — visible (A) and with the canvas hidden (B) — and diff them: the
// difference mask isolates exactly what WebGL drew. We then measure the
// contiguous run of drawn pixels through the canvas centre on both axes.
// For a perspective camera whose aspect equals the displayed W/H, the sphere
// must give centreRunX == centreRunY (ratio 1.00). A ratio different from 1 is
// the on-screen oval stretch factor.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = 'D:/AgenticOS/dist';
const PORT = 4404;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json' };

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
await new Promise((r) => setTimeout(r, 5000));

const geom = () => page.evaluate(() => {
  const c = document.querySelector('[data-testid="jarvis-orb-canvas"]');
  if (!c) return null;
  const r = c.getBoundingClientRect();
  const gl = c.getContext('webgl2') || c.getContext('webgl');
  return {
    clip: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
    cssW: +r.width.toFixed(1), cssH: +r.height.toFixed(1),
    attrW: c.width, attrH: c.height,
    bufW: gl ? gl.drawingBufferWidth : null, bufH: gl ? gl.drawingBufferHeight : null,
    dpr: devicePixelRatio,
  };
});

// measure the diff mask of two same-size PNGs (base64)
const diffMeasure = (aB64, bB64) => page.evaluate(async ([pa, pb]) => {
  const load = async (b) => { const i = new Image(); await new Promise((res, rej) => { i.onload = res; i.onerror = rej; i.src = 'data:image/png;base64,' + b; }); return i; };
  const [ia, ib] = [await load(pa), await load(pb)];
  const W = ia.width, H = ia.height;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.drawImage(ia, 0, 0); const da = ctx.getImageData(0, 0, W, H).data;
  ctx.clearRect(0, 0, W, H); ctx.drawImage(ib, 0, 0); const db = ctx.getImageData(0, 0, W, H).data;
  const mask = new Uint8Array(W * H);
  const thr = 6;
  let count = 0;
  for (let p = 0; p < W * H; p++) {
    const d = Math.abs(da[p * 4] - db[p * 4]) + Math.abs(da[p * 4 + 1] - db[p * 4 + 1]) + Math.abs(da[p * 4 + 2] - db[p * 4 + 2]);
    if (d > thr) { mask[p] = 1; count++; }
  }
  const cx = W >> 1, cy = H >> 1;
  const at = (x, y) => (x >= 0 && y >= 0 && x < W && y < H) ? mask[y * W + x] : 0;
  const runX = () => { if (!at(cx, cy)) return 0; let a = cx; while (at(a - 1, cy)) a--; let b = cx; while (at(b + 1, cy)) b++; return b - a + 1; };
  const runY = () => { if (!at(cx, cy)) return 0; let a = cy; while (at(cx, a - 1)) a--; let b = cy; while (at(cx, b + 1)) b++; return b - a + 1; };
  // bounding box of drawn pixels
  let minX = W, maxX = -1, minY = H, maxY = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (mask[y * W + x]) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  // widest row / tallest column inside the central 60% box (isolates the core
  // sphere from the satellite ring and labels)
  const lx = Math.round(W * 0.2), rx = Math.round(W * 0.8), ty = Math.round(H * 0.2), by = Math.round(H * 0.8);
  let maxRowIn = 0, maxColIn = 0;
  for (let y = ty; y < by; y++) { let c = 0, best = 0; for (let x = lx; x < rx; x++) { if (mask[y * W + x]) { c++; if (c > best) best = c; } else c = 0; } if (best > maxRowIn) maxRowIn = best; }
  for (let x = lx; x < rx; x++) { let c = 0, best = 0; for (let y = ty; y < by; y++) { if (mask[y * W + x]) { c++; if (c > best) best = c; } else c = 0; } if (best > maxColIn) maxColIn = best; }
  const sx = runX(), sy = runY();
  return {
    W, H, drawnPixels: count, coverageFrac: +(count / (W * H)).toFixed(4),
    centreRunX: sx, centreRunY: sy,
    centreOvalRatio_XoverY: sy ? +(sx / sy).toFixed(3) : null,
    maxRowSpanInCentreBox: maxRowIn, maxColSpanInCentreBox: maxColIn,
    centreBoxOvalRatio_XoverY: maxColIn ? +(maxRowIn / maxColIn).toFixed(3) : null,
    bbox: { w: maxX - minX + 1, h: maxY - minY + 1 },
  };
}, [aB64, bB64]);

const shoot = async (g, hideCanvas) => {
  await page.evaluate((hide) => {
    const c = document.querySelector('[data-testid="jarvis-orb-canvas"]');
    if (c) c.style.visibility = hide ? 'hidden' : '';
  }, hideCanvas);
  await new Promise((r) => setTimeout(r, 350));
  const buf = await page.screenshot({ clip: g.clip, encoding: 'base64' }).catch(() => null);
  await page.evaluate(() => { const c = document.querySelector('[data-testid="jarvis-orb-canvas"]'); if (c) c.style.visibility = ''; });
  await new Promise((r) => setTimeout(r, 350));
  return buf;
};

const results = {};
for (const [label, w, h] of [['1280x800', 1280, 800], ['1600x900', 1600, 900], ['1920x1080', 1920, 1080], ['900x900', 900, 900]]) {
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await new Promise((r) => setTimeout(r, 4500));
  const g = await geom();
  if (!g) { results[label] = { error: 'no canvas' }; continue; }
  const a = await shoot(g, false);
  const b = await shoot(g, true);
  const m = a && b ? await diffMeasure(a, b).catch((e) => ({ error: String(e) })) : null;
  if (a) fs.writeFileSync(`D:/AgenticOS/probe4-orb-${label}.png`, Buffer.from(a, 'base64'));
  // hypothesis test: a synthetic window resize at the same size, then re-measure
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await new Promise((r) => setTimeout(r, 1500));
  const a2 = await shoot(g, false);
  const b2 = await shoot(g, true);
  const m2 = a2 && b2 ? await diffMeasure(a2, b2).catch((e) => ({ error: String(e) })) : null;
  results[label] = {
    canvas: { cssW: g.cssW, cssH: g.cssH, displayedRatio: +(g.cssW / g.cssH).toFixed(3), attrW: g.attrW, attrH: g.attrH, bufferRatio: g.bufW ? +(g.bufW / g.bufH).toFixed(3) : null, dpr: g.dpr },
    beforeResize: m, afterResize: m2,
  };
}

console.log('ASPECTPROBE4 ' + JSON.stringify({ results, errors: errors.slice(0, 8) }, null, 1));
await browser.close();
server.close();
process.exit(0);
