// Jarvis core aspect probe (v5): multi-threshold silhouette measurement at
// several viewport sizes AND device pixel ratios. Writes JSON to probe5.json.
// Method: capture the canvas rect twice (canvas visible / canvas hidden) and
// diff — the diff mask is exactly what WebGL drew. Thresholds sweep separates
// the solid core body (high threshold) from faint satellite connector lines
// (low threshold). The vertical run through the canvas centre is the core's
// pixel height; the horizontal run through the same point is its pixel width.
// Correct perspective aspect => width == height (ratio 1.00).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = 'D:/AgenticOS/dist';
const PORT = 4405;
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

const geom = () => page.evaluate(() => {
  const c = document.querySelector('[data-testid="jarvis-orb-canvas"]');
  if (!c) return null;
  const r = c.getBoundingClientRect();
  const gl = c.getContext('webgl2') || c.getContext('webgl');
  const shell = document.querySelector('.jarvis-blob1-shell');
  const region = document.querySelector('[data-testid="jarvis-orb-region"]');
  const rr = region ? region.getBoundingClientRect() : null;
  return {
    clip: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
    cssW: +r.width.toFixed(1), cssH: +r.height.toFixed(1),
    attrW: c.width, attrH: c.height,
    bufW: gl ? gl.drawingBufferWidth : null, bufH: gl ? gl.drawingBufferHeight : null,
    dpr: devicePixelRatio,
    shellH: shell ? +shell.getBoundingClientRect().height.toFixed(1) : null,
    shellW: shell ? +shell.getBoundingClientRect().width.toFixed(1) : null,
    regionW: rr ? +rr.width.toFixed(1) : null,
    regionH: rr ? +rr.height.toFixed(1) : null,
    canvasTransform: c.getContext ? getComputedStyle(c).transform : null,
  };
});

const analyse = (aB64, bB64) => page.evaluate(async ([pa, pb]) => {
  const load = async (b) => { const i = new Image(); await new Promise((res, rej) => { i.onload = res; i.onerror = rej; i.src = 'data:image/png;base64,' + b; }); return i; };
  const [ia, ib] = [await load(pa), await load(pb)];
  const W = ia.width, H = ia.height;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.drawImage(ia, 0, 0); const da = ctx.getImageData(0, 0, W, H).data;
  ctx.clearRect(0, 0, W, H); ctx.drawImage(ib, 0, 0); const db = ctx.getImageData(0, 0, W, H).data;
  const diff = new Uint16Array(W * H);
  for (let p = 0; p < W * H; p++) {
    diff[p] = Math.abs(da[p * 4] - db[p * 4]) + Math.abs(da[p * 4 + 1] - db[p * 4 + 1]) + Math.abs(da[p * 4 + 2] - db[p * 4 + 2]);
  }
  const cx = W >> 1, cy = H >> 1;
  const out = { W, H };
  for (const thr of [6, 25, 60, 100]) {
    const on = (x, y) => (x >= 0 && y >= 0 && x < W && y < H) && diff[y * W + x] > thr;
    const runAcc = (dx, dy) => { let n = 0; let x = cx, y = cy; if (!on(x, y)) return 0; while (on(x + dx, y + dy)) { n++; x += dx; y += dy; } x = cx; y = cy; while (on(x - dx, y - dy)) { n++; x -= dx; y -= dy; } return n + 1; };
    const runX = runAcc(1, 0), runY = runAcc(0, 1);
    // solid-body bbox: restrict to the central 70% box and require both axes
    let minX = W, maxX = -1, minY = H, maxY = -1, count = 0;
    const lx = Math.round(W * 0.15), rx = Math.round(W * 0.85), ty = Math.round(H * 0.15), by = Math.round(H * 0.85);
    for (let y = ty; y < by; y++) for (let x = lx; x < rx; x++) if (on(x, y)) { count++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    const bw = maxX >= 0 ? maxX - minX + 1 : 0, bh = maxY >= 0 ? maxY - minY + 1 : 0;
    out['thr' + thr] = {
      drawn: count,
      centreRunX: runX, centreRunY: runY,
      centreOvalRatio_XoverY: runY ? +(runX / runY).toFixed(3) : null,
      centreBoxBbox: { w: bw, h: bh, ratio: bh ? +(bw / bh).toFixed(3) : null },
    };
  }
  return out;
}, [aB64, bB64]);

const shoot = async (g, hide) => {
  await page.evaluate((h) => { const c = document.querySelector('[data-testid="jarvis-orb-canvas"]'); if (c) c.style.visibility = h ? 'hidden' : ''; }, hide);
  await new Promise((r) => setTimeout(r, 400));
  const buf = await page.screenshot({ clip: g.clip, encoding: 'base64' }).catch(() => null);
  await page.evaluate(() => { const c = document.querySelector('[data-testid="jarvis-orb-canvas"]'); if (c) c.style.visibility = ''; });
  await new Promise((r) => setTimeout(r, 400));
  return buf;
};

const cases = [
  ['1600x900 dpr1', 1600, 900, 1],
  ['1600x900 dpr1.25', 1600, 900, 1.25],
  ['1920x1080 dpr1', 1920, 1080, 1],
  ['2560x1440 dpr1', 2560, 1440, 1],
  ['1024x768 dpr1', 1024, 768, 1],
  ['1400x1000 dpr1', 1400, 1000, 1],
];

const results = {};
for (const [label, w, h, dsf] of cases) {
  await page.setViewport({ width: w, height: h, deviceScaleFactor: dsf });
  await new Promise((r) => setTimeout(r, 5000));
  const g = await geom();
  if (!g) { results[label] = { error: 'no canvas' }; continue; }
  const a = await shoot(g, false), b = await shoot(g, true);
  const m = a && b ? await analyse(a, b).catch((e) => ({ error: String(e) })) : null;
  if (a) fs.writeFileSync(`D:/AgenticOS/probe5-orb-${label.replace(/[^\w.-]/g, '_')}.png`, Buffer.from(a, 'base64'));
  results[label] = { geom: g, silhouette: m };
}

fs.writeFileSync('D:/AgenticOS/probe5.json', JSON.stringify({ results, errors }, null, 1));
console.log('ASPECTPROBE5 written', Object.keys(results).join(', '));
await browser.close();
server.close();
process.exit(0);
