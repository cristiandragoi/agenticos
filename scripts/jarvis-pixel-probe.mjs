// Probe exact pixels in the stage screenshot at viewBox-anchored positions.
// viewBox (0..1000, 0..1250) maps onto the 660x851 clip: svg occupies the
// first 825 DPR rows (550 CSS * 1.5), clip x 0 = viewBox x 0.
import fs from 'node:fs';
import zlib from 'node:zlib';

function decodePNG(path) {
  const buf = fs.readFileSync(path);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not png');
  let off = 8, width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (type === 'IHDR') {
      width = buf.readUInt32BE(off + 8); height = buf.readUInt32BE(off + 12);
      bitDepth = buf[off + 16]; colorType = buf[off + 17]; interlace = buf[off + 20];
    } else if (type === 'IDAT') idat.push(buf.subarray(off + 8, off + 8 + len));
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);
  const prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = row[x];
      if (filter === 1) v = (v + a) & 255;
      else if (filter === 2) v = (v + b) & 255;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
      cur[x] = v;
    }
    for (let x = 0; x < width; x++) {
      const ci = x * channels, oi = (y * width + x) * 4;
      out[oi] = cur[ci]; out[oi + 1] = channels > 1 ? cur[ci + 1] : cur[ci];
      out[oi + 2] = channels > 2 ? cur[ci + 2] : cur[ci]; out[oi + 3] = 255;
    }
    prev.set(cur);
  }
  return { width, height, data: out };
}

const p = process.argv[2];
const img = decodePNG(p);
const W = img.width, H = img.height;
// svg occupies first 825 DPR rows (550 CSS); clip width maps 1000 units -> 660px
const px = (vx, vy) => {
  const x = Math.round(vx / 1000 * W);
  const y = Math.round(vy / 1250 * (H - 26)); // exclude label row
  return { x, y };
};
const at = (vx, vy) => {
  const { x, y } = px(vx, vy);
  const i = (y * W + x) * 4;
  return { vx, vy, x, y, rgb: [img.data[i], img.data[i + 1], img.data[i + 2]] };
};
const probe = [
  [483, 144, 'brainCore'],
  [500, 400, 'headCenter'],
  [445, 976, 'chestCore'],
  [500, 1194, 'platform'],
  [500, 1090, 'runsModule'],
  [104, 200, 'memoryModule'],
  [896, 268, 'visionModule'],
  [500, 580, 'mouth'],
  // ring/stroke samples (module ring at r=32, chest core ring at r=13/38/56)
  [500 - 32, 1090, 'runsRingLeft'],
  [500 + 32, 1090, 'runsRingRight'],
  [445 - 13, 976, 'chestCoreRing13'],
  [445 + 13, 976, 'chestCoreRing13R'],
  [445 - 56, 976, 'chestCoreRing56'],
  [500, 1194 - 22, 'platformRingTop'],
  [500 - 150, 1194, 'platformRingLeft'],
  [104 - 32, 200, 'memoryRingLeft'],
  [896 + 32, 268, 'visionRingRight'],
  [500, 976 + 60, 'lowerStreamTop'],
];
console.log('PROBE ' + JSON.stringify({ W, H, samples: probe.map(([vx, vy, name]) => ({ ...at(vx, vy), name })) }));
