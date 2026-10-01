// Aspect-ratio probe for the Jarvis core: serves the real dist bundle, renders
// the Jarvis route in headless Chrome (SwiftShader WebGL), measures the DOM
// boxes / canvas buffer vs CSS box, and pixel-measures the rendered silhouette.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = 'D:/AgenticOS/dist';
const PORT = 4399;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  let file = path.join(ROOT, url === '/' ? 'index.html' : url);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--window-size=1600,900'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
await page.goto(`http://127.0.0.1:${PORT}/#/jarvis`, { waitUntil: 'networkidle2', timeout: 45000 }).catch((e) => errors.push('goto: ' + e.message));
await new Promise((r) => setTimeout(r, 7000));

const probe = await page.evaluate(() => {
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { w: +r.width.toFixed(1), h: +r.height.toFixed(1), x: +r.x.toFixed(1), y: +r.y.toFixed(1) }; };
  const c = document.querySelector('[data-testid="jarvis-orb-canvas"]');
  const shell = document.querySelector('.jarvis-blob1-shell');
  const core = document.querySelector('[data-testid="jarvis-orb-core"]');
  const region = document.querySelector('[data-testid="jarvis-orb-region"]');
  const stage = document.querySelector('[data-testid="jarvis-stage"]');
  const wrap = document.querySelector('[data-testid="jarvis-dashboard"]');
  const cs = (el) => { if (!el) return null; const s = getComputedStyle(el); return { width: s.width, height: s.height, transform: s.transform, aspectRatio: s.aspectRatio, overflow: s.overflow }; };
  // WebGL: does the drawing buffer match the CSS box (i.e. is aspect handled)?
  let glInfo = null;
  if (c) {
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (gl) glInfo = { drawingBufferWidth: gl.drawingBufferWidth, drawingBufferHeight: gl.drawingBufferHeight, viewport: Array.from(gl.getParameter(gl.VIEWPORT)) };
  }
  return {
    viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
    stage: box(stage), region: box(region), wrap: box(wrap), core: box(core), shell: box(shell),
    canvasBox: box(c), canvasCss: cs(c),
    shellCss: cs(shell), coreCss: cs(core),
    canvasAttr: c ? { width: c.width, height: c.height, clientW: c.clientWidth, clientH: c.clientHeight } : null,
    shellInlineHeight: shell ? shell.style.height : null,
    glInfo,
    hasCanvas: !!c,
  };
});

let shape = null;
const canvasEl = await page.$('[data-testid="jarvis-orb-canvas"]');
if (canvasEl) {
  const png = await canvasEl.screenshot({ encoding: 'base64' }).catch(() => null);
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
      const out = { imgW: W, imgH: H };
      for (const [name, thr] of [['lit', 12], ['solid', 60]]) {
        let top = -1, bottom = -1, left = W, right = -1;
        const rowL = new Array(H).fill(W), rowR = new Array(H).fill(-1);
        let count = 0;
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const a = d[(y * W + x) * 4 + 3];
            if (a > thr) {
              count++;
              if (x < rowL[y]) rowL[y] = x;
              if (x > rowR[y]) rowR[y] = x;
              if (x < left) left = x;
              if (x > right) right = x;
              if (top === -1) top = y;
              bottom = y;
            }
          }
        }
        if (top === -1) { out[name] = { empty: true }; continue; }
        const bw = right - left + 1, bh = bottom - top + 1;
        let maxW = 0, maxRow = 0, maxH = 0, maxCol = 0;
        const colT = new Array(W).fill(H), colB = new Array(W).fill(-1);
        for (let y = 0; y < H; y++) { const v = rowR[y] - rowL[y] + 1; if (v > maxW) { maxW = v; maxRow = y; } }
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (d[(y * W + x) * 4 + 3] > thr) { if (y < colT[x]) colT[x] = y; if (y > colB[x]) colB[x] = y; } }
        for (let x = 0; x < W; x++) { const v = colB[x] - colT[x] + 1; if (v > maxH) { maxH = v; maxCol = x; } }
        out[name] = {
          bboxW: bw, bboxH: bh, bboxAspectWoverH: +(bw / bh).toFixed(3),
          maxRowWidth: maxW, maxColHeight: maxH, widestRowAtFracOfBBox: +(((maxRow - top) / bh)).toFixed(2),
          tallestColAtFracOfBBox: +(((maxCol - left) / bw)).toFixed(2),
          circleMetric_maxRowWidth_over_maxColHeight: +(maxW / maxH).toFixed(3),
          coverageFrac: +(count / (W * H)).toFixed(3),
        };
      }
      return out;
    }, png).catch((e) => ({ error: String(e) }));
  }
}

console.log('PROBE ' + JSON.stringify({ probe, shape, errors }, null, 1));
await browser.close();
server.close();
process.exit(0);
