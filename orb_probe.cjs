// Probe the live Jarvis 3D core geometry in a real browser.
// Usage: node orb_probe.cjs
const { chromium } = require('D:/AgenticOS/node_modules/playwright');

const APP = process.env.APP_URL || 'http://127.0.0.1:5199/#/jarvis';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--enable-unsafe-swiftshader',
      '--use-angle=swiftshader',
      '--ignore-gpu-blocklist',
      '--enable-webgl',
    ],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });

  const logs = [];
  page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`.slice(0, 300)));
  page.on('pageerror', (e) => logs.push(`pageerror: ${String(e).slice(0, 300)}`));

  await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // give React + three.js time to mount and render
  await page.waitForTimeout(1200);
  try {
    await page.waitForSelector('[data-testid="jarvis-orb-canvas"]', { timeout: 30000 });
  } catch (e) {
    console.log('CANVAS NOT FOUND');
  }
  await page.waitForTimeout(4000);

  const geo = await page.evaluate(() => {
    const out = {};
    const q = (s) => document.querySelector(s);
    const dump = (el, name) => {
      if (!el) { out[name] = null; return; }
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      out[name] = {
        testid: el.getAttribute('data-testid'),
        cls: el.className && String(el.className).slice(0, 60),
        rect: { w: +r.width.toFixed(2), h: +r.height.toFixed(2), x: +r.x.toFixed(2), y: +r.y.toFixed(2) },
        ratio: +(r.width / r.height).toFixed(4),
        cssW: cs.width, cssH: cs.height, aspectRatio: cs.aspectRatio,
        styleAttr: (el.getAttribute('style') || '').slice(0, 300),
        attrW: el.width, attrH: el.height,
      };
    };
    const canvas = q('[data-testid="jarvis-orb-canvas"]');
    dump(canvas, 'canvas');
    dump(q('.jarvis-blob1-shell'), 'shell');
    dump(q('[data-testid="jarvis-orb-core"]'), 'orbCoreDiv');
    dump(q('[data-testid="jarvis-orb"]'), 'blobRoot');
    dump(q('[data-testid="jarvis-orb-region"]'), 'orbRegion');
    if (canvas) {
      let gl = null;
      try { gl = canvas.getContext('webgl2') || canvas.getContext('webgl'); } catch (e) {}
      out.glContext = gl ? 'present' : 'ABSENT';
      out.glAttrs = gl ? { alpha: gl.getContextAttributes() && gl.getContextAttributes().alpha } : null;
      out.glError = gl ? gl.getError() : null;
    }
    out.dpr = window.devicePixelRatio;
    return out;
  });

  let fill = null;
  const canvasHandle = await page.$('[data-testid="jarvis-orb-canvas"]');
  if (canvasHandle) {
    const buf = await canvasHandle.screenshot({ type: 'png' });
    const b64 = buf.toString('base64');
    fill = await page.evaluate(async (data) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + data;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1, count = 0;
      let sumX = 0, sumY = 0;
      const rowSpan = [];
      for (let y = 0; y < c.height; y++) {
        let rowMin = 1e9, rowMax = -1;
        for (let x = 0; x < c.width; x++) {
          const i = (y * c.width + x) * 4;
          const a = d[i + 3];
          const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          if (a > 12 && lum > 8) {
            count++;
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
            sumX += x; sumY += y;
            if (x < rowMin) rowMin = x; if (x > rowMax) rowMax = x;
          }
        }
        rowSpan.push(rowMax < 0 ? 0 : rowMax - rowMin + 1);
      }
      const w = maxX - minX + 1, h = maxY - minY + 1;
      // widest row and tallest column give the axes of the drawn shape
      let widest = 0, widestRow = -1;
      rowSpan.forEach((s, i) => { if (s > widest) { widest = s; widestRow = i; } });
      return {
        imgW: c.width, imgH: c.height, litPixels: count,
        bbox: { w, h, minX, minY, maxX, maxY },
        bboxRatio: h ? +(w / h).toFixed(4) : null,
        widestRow, widestRowSpan: widest,
        centroid: count ? { x: +(sumX / count).toFixed(2), y: +(sumY / count).toFixed(2) } : null,
        // vertical span at the horizontal centre of the shape
        colSpanAtCentre: (() => {
          const cx = Math.round((minX + maxX) / 2);
          let lo = -1, hi = -1;
          for (let y = 0; y < c.height; y++) {
            const i = (y * c.width + cx) * 4;
            if (d[i + 3] > 12 && (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) > 8) { if (lo < 0) lo = y; hi = y; }
          }
          return lo < 0 ? 0 : hi - lo + 1;
        })(),
      };
    }, b64).catch((e) => ({ error: String(e).slice(0, 200) }));
    require('fs').writeFileSync('D:/AgenticOS/orb-canvas.png', buf);
  }

  await page.screenshot({ path: 'D:/AgenticOS/orb-page.png', fullPage: false });

  console.log(JSON.stringify({ geo, fill, logs: logs.slice(0, 25) }, null, 2));
  await browser.close();
})();
