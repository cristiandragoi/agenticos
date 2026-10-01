// Jarvis core aspect-ratio probe (v2).
// Serves the real dist bundle with a stubbed /api surface (no real backend is
// started, no DB is touched), renders #/jarvis in headless Chrome with
// SwiftShader WebGL, then measures at three window sizes:
//   * the CSS box of the orb region / core / blob shell / canvas
//   * canvas drawing-buffer vs CSS box (WebGL aspect handling)
//   * the rendered silhouette's pixel bounding box (circle vs oval)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = 'D:/AgenticOS/dist';
const PORT = 4402;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url.startsWith('/api/')) {
    if (url === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ready', ok: true, uptime: 1, subsystems: {} }));
      return;
    }
    if (url.endsWith('/events') || url.endsWith('/stream')) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      return; // left open on purpose — no fabricated events
    }
    // dataStore's boot fan-out expects JSON arrays for most registry routes and
    // plain objects for the two non-list routes.
    if (url.endsWith('/credentials-status')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
      return;
    }
    if (url.endsWith('/sales/leads')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, leads: [] }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('[]');
    return;
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

const measure = () => page.evaluate(() => {
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { w: +r.width.toFixed(1), h: +r.height.toFixed(1) }; };
  const c = document.querySelector('[data-testid="jarvis-orb-canvas"]');
  const shell = document.querySelector('.jarvis-blob1-shell');
  const core = document.querySelector('[data-testid="jarvis-orb-core"]');
  const region = document.querySelector('[data-testid="jarvis-orb-region"]');
  const stage = document.querySelector('[data-testid="jarvis-stage"]');
  let glInfo = null;
  if (c) {
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (gl) glInfo = { bufW: gl.drawingBufferWidth, bufH: gl.drawingBufferHeight };
  }
  const rects = { stage: box(stage), region: box(region), core: box(core), shell: box(shell), canvas: box(c) };
  return {
    viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
    rects,
    aspect: {
      coreBox: rects.core ? +(rects.core.w / rects.core.h).toFixed(3) : null,
      shellBox: rects.shell ? +(rects.shell.w / rects.shell.h).toFixed(3) : null,
      canvasBox: rects.canvas ? +(rects.canvas.w / rects.canvas.h).toFixed(3) : null,
      canvasBuffer: glInfo ? +(glInfo.bufW / glInfo.bufH).toFixed(3) : null,
    },
    canvasAttr: c ? { width: c.width, height: c.height, clientW: c.clientWidth, clientH: c.clientHeight } : null,
    shellInline: shell ? { height: shell.style.height, width: shell.style.width } : null,
    coreInline: core ? { height: core.style.height, width: core.style.width } : null,
    hasCanvas: !!c,
    screen: document.querySelector('[data-testid="app-backend-error-screen"]') ? 'backend-error' : (c ? 'jarvis-mounted' : 'unknown'),
  };
});

const shapes = {};
for (const [label, w, h] of [['1600x900', 1600, 900], ['1280x800', 1280, 800], ['1920x1080', 1920, 1080]]) {
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await new Promise((r) => setTimeout(r, 4000));
  const m = await measure();
  const el = await page.$('[data-testid="jarvis-orb-canvas"]');
  let shape = null;
  if (el) {
    const png = await el.screenshot({ encoding: 'base64' }).catch(() => null);
    if (png) {
      shape = await page.evaluate(async (b64) => {
        const img = new Image();
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/png;base64,' + b64; });
        const cv = document.createElement('canvas');
        cv.width = img.width; cv.height = img.height;
        const ctx = cv.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, img.width, img.height).data;
        const W = img.width, H = img.height;
        const r = { captureW: W, captureH: H };
        for (const [name, thr] of [['lit', 12], ['solid', 60]]) {
          let top = -1, bottom = -1, left = W, right = -1, count = 0;
          const rowL = new Array(H).fill(W), rowR = new Array(H).fill(-1);
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            if (d[(y * W + x) * 4 + 3] > thr) {
              count++;
              if (x < rowL[y]) rowL[y] = x;
              if (x > rowR[y]) rowR[y] = x;
              if (x < left) left = x;
              if (x > right) right = x;
              if (top === -1) top = y;
              bottom = y;
            }
          }
          if (top === -1) { r[name] = { empty: true }; continue; }
          const bw = right - left + 1, bh = bottom - top + 1;
          let maxW = 0, maxRow = 0, maxH = 0, maxCol = 0;
          const colT = new Array(W).fill(H), colB = new Array(W).fill(-1);
          for (let y = 0; y < H; y++) { const v = rowR[y] - rowL[y] + 1; if (v > maxW) { maxW = v; maxRow = y; } }
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] > thr) { if (y < colT[x]) colT[x] = y; if (y > colB[x]) colB[x] = y; }
          for (let x = 0; x < W; x++) { const v = colB[x] - colT[x] + 1; if (v > maxH) { maxH = v; maxCol = x; } }
          r[name] = {
            bboxW: bw, bboxH: bh, bboxWoverH: +(bw / bh).toFixed(3),
            maxRowWidth: maxW, maxColHeight: maxH,
            circleCheck_maxRowWidth_over_maxColHeight: +(maxW / maxH).toFixed(3),
            widestRowAtFrac: +((maxRow - top) / bh).toFixed(2),
            tallestColAtFrac: +((maxCol - left) / bw).toFixed(2),
            coverageFrac: +(count / (W * H)).toFixed(3),
          };
        }
        return r;
      }, png).catch((e) => ({ error: String(e) }));
    }
  }
  shapes[label] = { measure: m, shape };
}

console.log('ASPECTPROBE ' + JSON.stringify({ shapes, errors: errors.slice(0, 8) }, null, 1));
await browser.close();
server.close();
process.exit(0);
