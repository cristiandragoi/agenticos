// Jarvis core aspect-ratio probe (v3).
// Difference vs v2: the element screenshot is taken with a TRANSPARENT page
// background (CDP Emulation.setDefaultBackgroundColorOverride + omitBackground),
// so the alpha channel actually shows what WebGL drew. Measures the contiguous
// lit run through the drawn shape's centre on both axes: for a correct
// perspective projection of a sphere that ratio must be ~1.00, and it equals
// (displayed W/H) / camera.aspect when they disagree.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = 'D:/AgenticOS/dist';
const PORT = 4403;
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
      return;
    }
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
const cdp = await page.target().createCDPSession();
await cdp.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } }).catch(() => {});

await page.goto(`http://127.0.0.1:${PORT}/#/jarvis`, { waitUntil: 'networkidle2', timeout: 45000 }).catch((e) => errors.push('goto ' + e.message));
await new Promise((r) => setTimeout(r, 5000));

const measure = () => page.evaluate(() => {
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { w: +r.width.toFixed(1), h: +r.height.toFixed(1) }; };
  const c = document.querySelector('[data-testid="jarvis-orb-canvas"]');
  const shell = document.querySelector('.jarvis-blob1-shell');
  const core = document.querySelector('[data-testid="jarvis-orb-core"]');
  let glInfo = null;
  if (c) { const gl = c.getContext('webgl2') || c.getContext('webgl'); if (gl) glInfo = { bufW: gl.drawingBufferWidth, bufH: gl.drawingBufferHeight }; }
  const rects = { core: box(core), shell: box(shell), canvas: box(c) };
  const cs = shell ? getComputedStyle(shell) : null;
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
    shellStyle: cs ? { height: cs.height, width: cs.width, aspectRatio: cs.aspectRatio, transform: cs.transform } : null,
    hasCanvas: !!c,
    screen: document.querySelector('[data-testid="app-backend-error-screen"]') ? 'backend-error' : (c ? 'jarvis-mounted' : 'unknown'),
  };
});

// Contiguous lit run through the drawn shape's centre, both axes, plus the
// alpha bounding box. thr = alpha cut. Runs are taken through the centroid.
const silhouette = (b64) => page.evaluate(async (data) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/png;base64,' + data; });
  const cv = document.createElement('canvas');
  cv.width = img.width; cv.height = img.height;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, img.width, img.height);
  ctx.drawImage(img, 0, 0);
  const W = img.width, H = img.height;
  const d = ctx.getImageData(0, 0, W, H).data;
  const out = { captureW: W, captureH: H };
  const run = (get, len, start) => { let a = start; while (a >= 0 && get(a)) a--; let b = start; while (b < len && get(b)) b++; return b - a - 1; };
  for (const [name, thr] of [['a12', 12], ['a40', 40]]) {
    const lit = (x, y) => d[(y * W + x) * 4 + 3] > thr;
    let minX = W, maxX = -1, minY = H, maxY = -1, count = 0, sx = 0, sy = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (lit(x, y)) { count++; sx += x; sy += y; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    if (!count) { out[name] = { empty: true }; continue; }
    const cx = Math.round(sx / count), cy = Math.round(sy / count);
    const spanX = run((x) => lit(x, cy), W, cx);
    const spanY = run((y) => lit(cx, y), H, cy);
    // widest row / tallest column anywhere (catches a stretched halo)
    let maxRow = 0, rowAt = -1, maxCol = 0, colAt = -1;
    for (let y = 0; y < H; y++) { let l = -1, r = -1; for (let x = 0; x < W; x++) if (lit(x, y)) { if (l < 0) l = x; r = x; } if (l >= 0 && r - l + 1 > maxRow) { maxRow = r - l + 1; rowAt = y; } }
    for (let x = 0; x < W; x++) { let t = -1, b = -1; for (let y = 0; y < H; y++) if (lit(x, y)) { if (t < 0) t = y; b = y; } if (t >= 0 && b - t + 1 > maxCol) { maxCol = b - t + 1; colAt = x; } }
    out[name] = {
      litPixels: count, coverageFrac: +(count / (W * H)).toFixed(3),
      bbox: { w: maxX - minX + 1, h: maxY - minY + 1 },
      centroid: { x: cx, y: cy },
      centreSpanX: spanX, centreSpanY: spanY,
      centreOvalRatio_XoverY: spanY ? +(spanX / spanY).toFixed(3) : null,
      maxRowSpan: maxRow, maxColSpan: maxCol,
      maxSpanRatio_XoverY: maxCol ? +(maxRow / maxCol).toFixed(3) : null,
    };
  }
  return out;
}, b64);

const results = {};
for (const [label, w, h] of [['1600x900', 1600, 900], ['1280x800', 1280, 800], ['1920x1080', 1920, 1080]]) {
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await new Promise((r) => setTimeout(r, 4500));
  const m = await measure();
  const el = await page.$('[data-testid="jarvis-orb-canvas"]');
  let shape = null;
  let png = null;
  if (el) {
    png = await el.screenshot({ encoding: 'base64', omitBackground: true }).catch(() => null);
    if (png) {
      shape = await silhouette(png).catch((e) => ({ error: String(e) }));
      fs.writeFileSync(`D:/AgenticOS/probe3-orb-${label}.png`, Buffer.from(png, 'base64'));
    }
  }
  // hypothesis test: force a window resize at the SAME size and re-measure.
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await new Promise((r) => setTimeout(r, 1500));
  const afterResize = png ? await (async () => {
    const el2 = await page.$('[data-testid="jarvis-orb-canvas"]');
    const p2 = await el2.screenshot({ encoding: 'base64', omitBackground: true }).catch(() => null);
    return p2 ? await silhouette(p2).catch((e) => ({ error: String(e) })) : null;
  })() : null;
  results[label] = { measure: m, silhouette: shape, afterResize: afterResize };
}

console.log('ASPECTPROBE3 ' + JSON.stringify({ results, errors: errors.slice(0, 8) }, null, 1));
await browser.close();
server.close();
process.exit(0);
