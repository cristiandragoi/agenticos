// Read the WebGL2 drawing buffer of the Jarvis orb canvas and analyze pixels:
// prove the universe actually RENDERS (non-blank, locked-palette colors present).
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];

const result = await app.evaluate(() => {
  const canvas = document.querySelector('[data-testid="jarvis-orb-canvas"]');
  if (!canvas) return { error: 'no orb canvas' };
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  if (!gl) return { error: 'no webgl context' };
  const w = gl.drawingBufferWidth;
  const h = gl.drawingBufferHeight;
  const buf = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  // locked palette (rgb)
  const palette = {
    turquoise: [20, 184, 166], yellow: [250, 204, 21], orange: [249, 115, 22],
    pink: [236, 72, 153], purple: [168, 85, 247], red: [239, 68, 68],
  };
  const counts = { turquoise: 0, yellow: 0, orange: 0, pink: 0, purple: 0, red: 0, dark: 0, other: 0 };
  let lit = 0, nonTransparent = 0;
  const step = 3; // sample every 3rd pixel
  for (let i = 0; i < buf.length; i += 4 * step) {
    const r = buf[i], g = buf[i + 1], b = buf[i + 2], a = buf[i + 3];
    if (a > 10) nonTransparent++;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (lum < 28) { counts.dark++; continue; }
    lit++;
    let best = 'other', bestD = Infinity;
    for (const [name, [pr, pg, pb]] of Object.entries(palette)) {
      const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
      if (d < bestD) { bestD = d; best = name; }
    }
    if (bestD < 6000) counts[best]++; else counts.other++;
  }
  return {
    drawingBuffer: `${w}x${h}`,
    sampled: Math.floor(buf.length / 4 / step),
    nonTransparentPx: nonTransparent * step,
    litPx: lit * step,
    counts: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v * step])),
    contextLost: gl.isContextLost(),
    redAbsent: counts.red === 0,
    rendersContent: lit > 500,
  };
});

console.log('PIXEL_ANALYSIS', JSON.stringify(result, null, 2));
await browser.disconnect();
