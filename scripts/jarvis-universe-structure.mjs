// Structural analysis of the universe canvas over CDP: connected components,
// satellite ring geometry, radial-line detection, label presence.
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const url = await app.evaluate(() => location.href);
if (!url.includes('#/jarvis')) {
  await app.evaluate(() => { location.hash = '#/jarvis'; });
  await sleep(9000);
}
const urlAfter = await app.evaluate(() => location.href);

const result = await app.evaluate(() => {
  const canvas = document.querySelector('[data-testid="jarvis-orb-canvas"]');
  const currentUrl = location.href;
  if (!canvas) return { error: 'no canvas' };
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;

  // Downsample 4x for component analysis.
  const G = 4;
  const gw = Math.floor(width / G), gh = Math.floor(height / G);
  const lit = new Uint8Array(gw * gh);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const i = ((y * G) * width + x * G) * 4;
      const a = data[i + 3];
      const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      lit[y * gw + x] = (a > 40 && lum > 30) ? 1 : 0;
    }
  }

  // Connected components (4-neighbour BFS) over lit mask.
  const seen = new Uint8Array(gw * gh);
  const comps = [];
  const cx = gw / 2, cy = gh / 2;
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const idx = y * gw + x;
      if (!lit[idx] || seen[idx]) continue;
      const stack = [idx]; seen[idx] = 1;
      let count = 0, sx = 0, sy = 0, minX = gw, maxX = 0, minY = gh, maxY = 0;
      while (stack.length) {
        const cur = stack.pop();
        const cxx = cur % gw, cyy = Math.floor(cur / gw);
        count++; sx += cxx; sy += cyy;
        if (cxx < minX) minX = cxx; if (cxx > maxX) maxX = cxx;
        if (cyy < minY) minY = cyy; if (cyy > maxY) maxY = cyy;
        const n = [
          cyy > 0 ? cur - gw : -1,
          cyy < gh - 1 ? cur + gw : -1,
          cxx > 0 ? cur - 1 : -1,
          cxx < gw - 1 ? cur + 1 : -1,
        ];
        for (const ni of n) {
          if (ni >= 0 && lit[ni] && !seen[ni]) { seen[ni] = 1; stack.push(ni); }
        }
      }
      const meanX = sx / count, meanY = sy / count;
      const dist = Math.hypot(meanX - cx, meanY - cy) / (gw / 2); // 0..1 normalized
      comps.push({
        pixels: count,
        centroid: [Math.round(meanX * G), Math.round(meanY * G)],
        bbox: [minX * G, minY * G, maxX * G, maxY * G],
        width: (maxX - minX + 1) * G,
        height: (maxY - minY + 1) * G,
        normDist: +dist.toFixed(3),
      });
    }
  }
  comps.sort((a, b) => b.pixels - a.pixels);

  // Classify: core = largest component near center; satellites = small
  // compact components at ring distance; lines = elongated components.
  const core = comps[0] || null;
  const satellites = comps.filter((c) =>
    c.pixels >= 4 && c.pixels <= 4000 &&
    c.width < gw * 1.2 && c.height < gw * 1.2 &&
    c.normDist > 0.2 && c.normDist < 0.6
  );
  const elongated = comps.filter((c) => {
    const w = c.width, h = c.height;
    const aspect = Math.max(w, h) / Math.max(1, Math.min(w, h));
    return aspect > 2.2 && c.pixels > 20 && c.normDist < 0.55;
  });

  // Text labels are dim gray pixels — count lit pixels in the outer band
  // (beyond the orbit) which is where labels sit.
  let labelBand = 0;
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const dx = (x - cx) / (gw / 2), dy = (y - cy) / (gh / 2);
      const d = Math.hypot(dx, dy);
      if (d > 0.62 && d < 1.0 && lit[y * gw + x]) labelBand++;
    }
  }

  return {
    urlAfter: currentUrl,
    width, height,
    componentCount: comps.length,
    core: core ? { pixels: core.pixels, centroid: core.centroid, bbox: core.bbox } : null,
    satellites: satellites.map((s) => ({ centroid: s.centroid, pixels: s.pixels, normDist: s.normDist, bbox: s.bbox })),
    elongatedLines: elongated.map((e) => ({ centroid: e.centroid, bbox: e.bbox, pixels: e.pixels, width: e.width, height: e.height })),
    labelBandLitPixels: labelBand,
  };
});

console.log('STRUCTURE ' + JSON.stringify(result, null, 2));
await browser.disconnect();
