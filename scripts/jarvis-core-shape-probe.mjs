// Jarvis core SHAPE probe (luma-based).
// The alpha-based probes measured the PAGE background behind the transparent
// canvas (alpha>thr everywhere => aspect == canvas box), so they could not tell
// a circle from an oval. This probe forces a pure black backdrop, screenshots
// the canvas element, then measures the GLOW silhouette by luminance:
//   * bbox + second-moment principal axes (a/b) => circle vs oval
//   * radial extents at 72 angles + least-squares ellipse fit
// Serves the real D:/AgenticOS/dist bundle with a stubbed /api surface.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = 'D:/AgenticOS/dist';
const PORT = 4407;
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
await new Promise((r) => setTimeout(r, 6000));

const analyze = async (b64) => page.evaluate(async (png) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/png;base64,' + png; });
  const cv = document.createElement('canvas');
  cv.width = img.width; cv.height = img.height;
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const W = img.width, H = img.height;
  const d = ctx.getImageData(0, 0, W, H).data;
  const lum = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    lum[i] = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];
  }
  const out = { captureW: W, captureH: H, captureAspect: +(W / H).toFixed(3) };
  for (const [name, thr] of [['glow', 24], ['body', 70], ['core', 140]]) {
    let top = -1, bottom = -1, left = W, right = -1, n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    const rowL = new Int32Array(H).fill(W), rowR = new Int32Array(H).fill(-1);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (lum[y * W + x] > thr) {
          n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
          if (x < rowL[y]) rowL[y] = x;
          if (x > rowR[y]) rowR[y] = x;
          if (x < left) left = x; if (x > right) right = x;
          if (top === -1) top = y;
          bottom = y;
        }
      }
    }
    if (!n) { out[name] = { empty: true }; continue; }
    const mx = sx / n, my = sy / n;
    const cx2 = sxx / n - mx * mx, cy2 = syy / n - my * my, cxy = sxy / n - mx * my;
    // Principal axes of the lit distribution: for a filled ellipse semi-axes
    // are 2*sqrt(eigenvalue), so the eigenvalue ratio IS the (a/b)^2 ratio.
    const tr = cx2 + cy2, det = cx2 * cy2 - cxy * cxy;
    const disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
    const l1 = tr / 2 + disc, l2 = tr / 2 - disc;
    const momentsRatio = +(Math.sqrt(l1) / Math.sqrt(Math.max(l2, 1e-9))).toFixed(3);
    const rot = +(0.5 * Math.atan2(2 * cxy, cx2 - cy2) * 180 / Math.PI).toFixed(1);
    // Radial extents from the centroid -> true silhouette (glow halo included).
    const NANG = 72; const radii = new Array(NANG).fill(0);
    const maxR = Math.ceil(Math.max(W, H));
    for (let a = 0; a < NANG; a++) {
      const th = (a / NANG) * Math.PI * 2, cs = Math.cos(th), sn = Math.sin(th);
      let last = 0;
      for (let r = 1; r < maxR; r++) {
        const x = Math.round(mx + cs * r), y = Math.round(my + sn * r);
        if (x < 0 || y < 0 || x >= W || y >= H) break;
        if (lum[y * W + x] > thr) last = r;
        else if (r - last > 14) break; // allow small gaps inside the body
      }
      radii[a] = last;
    }
    // Least-squares conic fit for the radial points (ellipse centred at centroid)
    let A = 0, B = 0, C = 0, D = 0, E = 0, F = 0, G = 0;
    const pts = [];
    for (let a = 0; a < NANG; a++) {
      const th = (a / NANG) * Math.PI * 2;
      if (radii[a] <= 0) continue;
      const px = Math.cos(th) * radii[a], py = Math.sin(th) * radii[a];
      pts.push([px, py]);
      const x2 = px * px, xy = px * py, y2 = py * py;
      A += x2 * x2; B += x2 * xy; C += x2 * y2; D += xy * xy; E += xy * y2; F += y2 * y2; G += 0;
    }
    // Solve N = [[A,B,C],[B,D,E],[C,E,F]] * [p,q,r] = [1,1,1] via Gaussian elim
    let M = [[A, B, C, 1], [B, D, E, 1], [C, E, F, 1]];
    let fit = null;
    try {
      for (let i = 0; i < 3; i++) {
        let piv = i;
        for (let k = i + 1; k < 3; k++) if (Math.abs(M[k][i]) > Math.abs(M[piv][i])) piv = k;
        const tmp = M[i]; M[i] = M[piv]; M[piv] = tmp;
        if (Math.abs(M[i][i]) < 1e-12) throw new Error('singular');
        for (let k = i + 1; k < 3; k++) {
          const f = M[k][i] / M[i][i];
          for (let j = i; j < 4; j++) M[k][j] -= f * M[i][j];
        }
      }
      const z = [0, 0, 0];
      for (let i = 2; i >= 0; i--) { let s = M[i][3]; for (let j = i + 1; j < 3; j++) s -= M[i][j] * z[j]; z[i] = s / M[i][i]; }
      const [p, q, r] = z; // p x^2 + q xy + r y^2 = 1
      const th2 = Math.atan2(q, p - r) / 2;
      const c = Math.cos(th2), s = Math.sin(th2);
      const a2 = 1 / (p * c * c + q * c * s + r * s * s);
      const b2 = 1 / (p * s * s - q * c * s + r * c * c);
      fit = { semiAxisA: +Math.sqrt(Math.abs(a2)).toFixed(2), semiAxisB: +Math.sqrt(Math.abs(b2)).toFixed(2), ratio: +(Math.sqrt(Math.abs(a2)) / Math.sqrt(Math.abs(b2))).toFixed(3), angleDeg: +(th2 * 180 / Math.PI).toFixed(1), polarity: (a2 > 0 && b2 > 0) ? 'ellipse' : 'hyperbola/saddle' };
    } catch (e) { fit = { error: String(e) }; }
    const centerRow = Math.round(my);
    const centerCol = Math.round(mx);
    let maxRowW = 0; for (let y = 0; y < H; y++) { const v = rowR[y] - rowL[y] + 1; if (v > maxRowW) maxRowW = v; }
    let colTop = H, colBot = -1;
    for (let y = 0; y < H; y++) { if (lum[y * W + centerCol] > thr) { if (y < colTop) colTop = y; colBot = y; } }
    out[name] = {
      litPixels: n, coverageFrac: +(n / (W * H)).toFixed(3),
      centroid: { x: +mx.toFixed(1), y: +my.toFixed(1) },
      bbox: { x: left, y: top, w: right - left + 1, h: bottom - top + 1, wOverH: +((right - left + 1) / (bottom - top + 1)).toFixed(3) },
      moments: { sigmaXoverSigmaY: +(Math.sqrt(cx2) / Math.sqrt(Math.max(cy2, 1e-9))).toFixed(3), principalAxisRatio: momentsRatio, principalAngleDeg: rot },
      silhouetteEllipseFit: fit,
      centerRowWidth: rowR[centerRow] - rowL[centerRow] + 1,
      centerColHeight: colBot - colTop + 1,
      centerRatio_w_over_h: +((rowR[centerRow] - rowL[centerRow] + 1) / Math.max(1, colBot - colTop + 1)).toFixed(3),
      radialMin: Math.min(...radii), radialMax: Math.max(...radii),
    };
  }
  return out;
}, b64);

const report = {};
for (const [label, w, h] of [['1600x900', 1600, 900], ['1920x1080', 1920, 1080]]) {
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await new Promise((r) => setTimeout(r, 4500));
  // Pure black backdrop so the canvas glow is the only lit thing on screen.
  await page.addStyleTag({ content: `html,body{background:#000 !important}
    [data-testid="jarvis-stage"],[data-testid="jarvis-orb-region"],[data-testid="jarvis-dashboard"],
    [data-testid="jarvis-orb-wrapper"],[data-testid="jarvis-orb-core"],[data-testid="jarvis-neural"],
    [data-testid="jarvis-center-scroll"],.jarvis-blob1-shell{background:transparent !important;box-shadow:none !important}
    [data-testid="jarvis-orb-caption"],[data-testid="jarvis-orb-status-label"]{visibility:hidden !important}` });
  await new Promise((r) => setTimeout(r, 1200));
  const dom = await page.evaluate(() => {
    const b = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { w: +r.width.toFixed(1), h: +r.height.toFixed(1) }; };
    const c = document.querySelector('[data-testid="jarvis-orb-canvas"]');
    const gl = c ? (c.getContext('webgl2') || c.getContext('webgl')) : null;
    return {
      stage: b(document.querySelector('[data-testid="jarvis-stage"]')),
      region: b(document.querySelector('[data-testid="jarvis-orb-region"]')),
      shell: b(document.querySelector('.jarvis-blob1-shell')),
      canvas: b(c),
      canvasAttr: c ? { width: c.width, height: c.height, clientW: c.clientWidth, clientH: c.clientHeight, cssW: getComputedStyle(c).width, cssH: getComputedStyle(c).height } : null,
      glBuffer: gl ? { w: gl.drawingBufferWidth, h: gl.drawingBufferHeight } : null,
      dpr: devicePixelRatio,
    };
  });
  const el = await page.$('[data-testid="jarvis-orb-canvas"]');
  let shape = null;
  if (el) {
    const png = await el.screenshot({ encoding: 'base64' }).catch((e) => { errors.push('shot ' + e.message); return null; });
    if (png) shape = await analyze(png).catch((e) => ({ error: String(e) }));
  }
  report[label] = { dom, shape };
}

console.log('CARESHAPE ' + JSON.stringify({ report, errors: errors.slice(0, 8) }, null, 1));
await browser.close();
server.close();
process.exit(0);
