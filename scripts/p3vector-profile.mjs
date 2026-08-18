// Dump the row-width profile of the band (mask rows 22-262) to calibrate.
import fs from 'node:fs';
const raw = JSON.parse(fs.readFileSync('scripts/p3-vector-raw2.json', 'utf8'));
const { MW, MH, mask } = raw;
const B0 = 22, B1 = 262, EL = 8, ER = 248;
const rows = [];
for (let y = B0; y <= B1; y++) {
  let l = -1, r = -1;
  for (let x = EL; x <= ER; x++) if (mask[y * MW + x]) { l = x; break; }
  for (let x = ER; x >= EL; x--) if (mask[y * MW + x]) { r = x; break; }
  rows.push({ y, l, r, w: l >= 0 && r >= 0 ? r - l : 0 });
}
// print every 4th row
let out = '';
for (let i = 0; i < rows.length; i += 4) {
  const { y, l, r, w } = rows[i];
  out += `y=${y} l=${l} r=${r} w=${w}\n`;
}
console.log(out);
