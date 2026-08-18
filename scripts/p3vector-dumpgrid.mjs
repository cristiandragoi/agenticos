// Dump coarse density grid with the profile's threshold marking.
import fs from 'node:fs';
const raw = JSON.parse(fs.readFileSync('scripts/p3-vector-raw2.json', 'utf8'));
const { MW, MH, mask } = raw;
const GW = 68, GH = 85, cell = 4, T = 0.28;
const rows = [];
for (let gy = 0; gy < GH; gy++) {
  let row = '';
  for (let gx = 0; gx < GW; gx++) {
    let n = 0;
    for (let y = gy * cell; y < Math.min(MH, (gy + 1) * cell); y++) for (let x = gx * cell; x < Math.min(MW, (gx + 1) * cell); x++) n += mask[y * MW + x];
    const v = n / 16;
    row += v >= T ? '#' : v >= 0.12 ? 'O' : v >= 0.045 ? '+' : '.';
  }
  rows.push(row);
}
console.log(rows.join('\n'));
