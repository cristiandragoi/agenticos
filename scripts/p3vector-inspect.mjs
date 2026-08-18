// Inspect bright-feature density inside the head to locate eyes/nose/mouth,
// and find the humanoid band (cut off bottom text).
import fs from 'node:fs';

const raw = JSON.parse(fs.readFileSync('scripts/p3-vector-raw2.json', 'utf8'));
const { W, H, MW, MH, mask, feats } = raw;

// rows profile of the mask
const rows = [];
for (let y = 0; y < MH; y++) { let n = 0; for (let x = 0; x < MW; x++) n += mask[y * MW + x]; rows.push(n); }

// find the humanoid band: largest contiguous run where rows have mass, from the top
let top = 0;
for (let y = 0; y < MH; y++) { if (rows[y] > 3) { top = y; break; } }
// find where the body ends: after the shoulders the mask thins (text is sparse)
let bottom = MH - 1;
{
  let lastSolid = top;
  for (let y = top; y < MH; y++) {
    if (rows[y] > 20) lastSolid = y;
    else if (y - lastSolid > 6) { bottom = lastSolid; break; }
  }
}
console.log('top', top, 'bottom', bottom, 'of', MH);

// bright-density grid over the head region (full res coords)
const GW = 60, GH = 60;
const gx0 = Math.floor(top * 2 * GW / H), gx1 = Math.floor(bottom * 2 * GH / H) + 1;
const cells = [];
for (let gy = 0; gy < GH; gy++) {
  let row = '';
  for (let gx = 0; gx < GW; gx++) {
    let n = 0;
    for (const f of feats) {
      const fx = Math.floor(f.x / W * GW), fy = Math.floor(f.y / H * GH);
      if (fx === gx && fy === gy) n++;
    }
    row += n > 25 ? '#' : n > 10 ? 'O' : n > 4 ? '+' : n > 1 ? '.' : ' ';
  }
  cells.push(row);
}
console.log(cells.slice(gx0, gx1).join('\n'));
