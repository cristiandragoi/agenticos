// Jarvis core visual probe (v3): mounts the real dist bundle on a stubbed API,
// screenshots the orb region, reads the WebGL framebuffer alpha directly
// (silhouette bbox → circle test), and scans the live DOM for shapes that can
// only render as an ellipse (non-square boxes with 50% radius, SVG ellipses,
// radial-gradient masks).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = 'D:/AgenticOS/dist';
const PORT = 4403;
const OUT = 'D:/AgenticOS/.hermes/tmp';
fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url.startsWith('/api/')) {
    if (url === '/api/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ status: 'ready', ok: true })); return; }
    if (url.endsWith('/credentials-status')) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); return; }
    if (url.endsWith('/sales/leads')) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, leads: [] })); return; }
    if (url.endsWith('/events') || url.endsWith('/stream')) { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); return; }
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
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
await page.goto(`http://127.0.0.1:${PORT}/#/jarvis`, { waitUntil: 'networkidle2', timeout: 45000 }).catch((e) => errors.push('goto ' + e.message));
await new Promise((r) => setTimeout(r, 6000));

const report = {};
for (const [label, w, h] of [['1920x1080', 1920, 1080], ['1366x768', 1366, 768]]) {
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await new Promise((r) => setTimeout(r, 5000));

  // 1. WebGL framebuffer truth (read inside rAF so three's frame is still in the buffer).
  const gl = await page.evaluate(() => new Promise((resolve) => {
    const c = document.querySelector('[data-testid="jarvis-orb-canvas"]');
    if (!c) return resolve({ error: 'no canvas' });
    const ctx = c.getContext('webgl2') || c.getContext('webgl');
    if (!ctx) return resolve({ error: 'no webgl ctx' });
    requestAnimationFrame(() => {
      const W = ctx.drawingBufferWidth, H = ctx.drawingBufferHeight;
      const px = new Uint8Array(W * H * 4);
      ctx.readPixels(0, 0, W, H, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
      const r = { bufW: W, bufH: H, cssW: c.clientWidth, cssH: c.clientHeight, dpr: devicePixelRatio };
      for (const [name, thr] of [['any', 8], ['body', 90]]) {
        const rowL = new Int32Array(H).fill(W), rowR = new Int32Array(H).fill(-1);
        let top = -1, bottom = -1, left = W, right = -1, count = 0;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          if (px[(y * W + x) * 4 + 3] > thr) {
            count++;
            if (x < rowL[y]) rowL[y] = x;
            if (x > rowR[y]) rowR[y] = x;
            if (x < left) left = x; if (x > right) right = x;
            if (top === -1) top = y; bottom = y;
          }
        }
        if (top === -1) { r[name] = { empty: true }; continue; }
        const bw = right - left + 1, bh = bottom - top + 1;
        let maxW = 0, maxRow = 0, maxH = 0, maxCol = 0;
        for (let y = 0; y < H; y++) { const v = rowR[y] - rowL[y] + 1; if (v > maxW) { maxW = v; maxRow = y; } }
        const colT = new Int32Array(W).fill(H), colB = new Int32Array(W).fill(-1);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (px[(y * W + x) * 4 + 3] > thr) { if (y < colT[x]) colT[x] = y; if (y > colB[x]) colB[x] = y; }
        for (let x = 0; x < W; x++) { const v = colB[x] - colT[x] + 1; if (v > maxH) { maxH = v; maxCol = x; } }
        r[name] = {
          bboxW: bw, bboxH: bh, bboxWoverH: +(bw / bh).toFixed(3),
          maxRowWidth: maxW, maxColHeight: maxH, ovalness_maxRowWidth_over_maxColHeight: +(maxW / maxH).toFixed(3),
          widestRowAtFracOfBBox: +((maxRow - top) / bh).toFixed(2), tallestColAtFracOfBBox: +((maxCol - left) / bw).toFixed(2),
          litFracOfBuffer: +(count / (W * H)).toFixed(3),
        };
      }
      resolve(r);
    });
  })).catch((e) => ({ error: String(e) }));
  report[label] = { framebuffer: gl };

  // 2. DOM scan for elements that can only paint as an ellipse.
  report[label].ellipseRisk = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('#root *')) {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (r.width < 24 || r.height < 24) continue;
      const rad = parseFloat(s.borderTopLeftRadius) || 0;
      const radPct = s.borderTopLeftRadius.includes('%') ? parseFloat(s.borderTopLeftRadius) : null;
      const isRound = (radPct !== null && radPct >= 45) || rad >= Math.min(r.width, r.height) / 2 - 1;
      const ar = +(r.width / r.height).toFixed(2);
      const tag = el.tagName.toLowerCase();
      const id = el.getAttribute('data-testid') || el.className?.toString?.().slice(0, 60) || '';
      if (isRound && Math.abs(ar - 1) > 0.12) out.push({ kind: 'rounded-box', el: `${tag}.${id}`, w: +r.width.toFixed(1), h: +r.height.toFixed(1), ar, radius: s.borderTopLeftRadius, testid: el.getAttribute('data-testid') });
      if (s.maskImage && s.maskImage !== 'none' && Math.abs(ar - 1) > 0.12) out.push({ kind: 'mask', el: `${tag}.${id}`, ar, mask: s.maskImage.slice(0, 90) });
    }
    for (const e of document.querySelectorAll('#root svg ellipse')) {
      const rx = parseFloat(e.getAttribute('rx') || '0'), ry = parseFloat(e.getAttribute('ry') || '0');
      if (rx && ry && Math.abs(rx / ry - 1) > 0.08) {
        const rr = e.getBoundingClientRect();
        out.push({ kind: 'svg-ellipse', el: e.getAttribute('class') || e.id || 'ellipse', rx, ry, ratio: +(rx / ry).toFixed(3), screenW: +rr.width.toFixed(1), screenH: +rr.height.toFixed(1) });
      }
    }
    for (const el of document.querySelectorAll('#root [data-testid]')) {
      const s = getComputedStyle(el); const r = el.getBoundingClientRect();
      if (/gradient\(.*ellipse/i.test(s.maskImage + ' ' + s.backgroundImage) && Math.abs(r.width / r.height - 1) > 0.12) {
        out.push({ kind: 'ellipse-gradient', el: el.getAttribute('data-testid'), ar: +(r.width / r.height).toFixed(2) });
      }
    }
    return out.slice(0, 25);
  });

  // 3. What the user actually sees: clip the orb region and the shell.
  const core = await page.$('[data-testid="jarvis-orb-core"]');
  const stage = await page.$('[data-testid="jarvis-orb-region"]');
  if (core) await core.screenshot({ path: path.join(OUT, `jarvis-orb-core-${label}.png`) }).catch(() => {});
  if (stage) await stage.screenshot({ path: path.join(OUT, `jarvis-orb-region-${label}.png`) }).catch(() => {});
  report[label].shots = [`${OUT}/jarvis-orb-core-${label}.png`, `${OUT}/jarvis-orb-region-${label}.png`];
}

console.log('VISPROBE ' + JSON.stringify({ report, errors: errors.slice(0, 6) }, null, 1));
await browser.close();
server.close();
process.exit(0);
