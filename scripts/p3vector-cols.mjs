// Column mass profile of the mask band — find the true figure x-extent.
import fs from 'node:fs';
const raw = JSON.parse(fs.readFileSync('scripts/p3-vector-raw2.json', 'utf8'));
const { MW, MH, mask } = raw;
const B0 = 22, B1 = 262;
const cols = [];
for (let x = 0; x < MW; x++) { let n = 0; for (let y = B0; y <= B1; y++) n += mask[y * MW + x]; cols.push(n); }
const bands = [];
for (let g = 0; g < 34; g++) {
  let row = '';
  for (let c = 0; c < 34; c++) {
    let sum = 0;
    for (let x = Math.floor(c * MW / 34); x < Math.floor((c + 1) * MW / 34); x++) sum += cols[x];
    row += sum > 900 ? '#' : sum > 500 ? 'O' : sum > 200 ? '+' : sum > 60 ? '.' : ' ';
  }
  bands.push(row);
}
console.log(bands.join('\n'));
// print raw col masses at the edges + center
console.log('cols[0..8]:', cols.slice(0, 9).join(','));
console.log('cols[255..271]:', cols.slice(255).join(','));
console.log('cols[120..140]:', cols.slice(120, 141).join(','));
