// Bright-density map over the humanoid band (mask rows 20-260) to locate
// eyes/nose/mouth/brain/chest as local density peaks.
import fs from 'node:fs';
const raw = JSON.parse(fs.readFileSync('scripts/p3-vector-raw2.json', 'utf8'));
const { W, H, MW, MH, mask } = raw;

const y0m = 20, y1m = 260; // mask rows (humanoid band)
const GW = 64, GH = Math.round((y1m - y0m) * 64 / (MW * 0.5)); // ~aspect 0.8
const cellH = (y1m - y0m) / GH, cellW = MW / GW;

// mask density grid + bright (lum>50) density grid
const grid = [], brightGrid = [];
for (let gy = 0; gy < GH; gy++) {
  let row = '', brow = '';
  for (let gx = 0; gx < GW; gx++) {
    let n = 0, tot = 0;
    for (let y = Math.floor(y0m + gy * cellH); y < Math.floor(y0m + (gy + 1) * cellH); y++) {
      for (let x = Math.floor(gx * cellW); x < Math.floor((gx + 1) * cellW); x++) {
        n += mask[y * MW + x]; tot++;
      }
    }
    const v = n / tot;
    row += v > 0.35 ? '#' : v > 0.15 ? 'O' : v > 0.05 ? '+' : v > 0.015 ? '.' : ' ';
  }
  grid.push(row);
}
console.log('MASK DENSITY (head band, rows 20-260):');
console.log(grid.join('\n'));

// bright-only grid (lum>55 feats density) — eyes/mouth should peak
const featsB = raw.feats.filter((f) => f.lum > 55);
const bgrid = [];
for (let gy = 0; gy < GH; gy++) {
  let row = '';
  for (let gx = 0; gx < GW; gx++) {
    let n = 0;
    for (const f of featsB) {
      const fx = Math.floor(f.x / W * GW), fy = Math.floor((f.y - y0m * 2) / ((y1m - y0m) * 2) * GH);
      if (fx === gx && fy === gy) n++;
    }
    row += n > 12 ? '#' : n > 5 ? 'O' : n > 2 ? '+' : n > 0 ? '.' : ' ';
  }
  bgrid.push(row);
}
console.log('\nBRIGHT(lum>55) DENSITY:');
console.log(bgrid.join('\n'));
