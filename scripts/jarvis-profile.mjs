// Mapping-free vertical cyan profile of the stage PNG: where is the figure
// actually painted? Splits the image into 25 horizontal bands and reports
// cyan density per band — no viewBox math, no clip assumptions.
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

const img = decodePNG(process.argv[2]);
const { width: W, height: H, data } = img;
const NB = 25;
const out = [];
for (let b = 0; b < NB; b++) {
  const y0 = Math.floor(b * H / NB), y1 = Math.floor((b + 1) * H / NB);
  let cyan = 0, cnt = 0, lumSum = 0;
  for (let y = y0; y < y1; y += 2) {
    for (let x = 0; x < W; x += 2) {
      const i = (y * W + x) * 4;
      const r = data[i], g = data[i + 1], bl = data[i + 2];
      cnt++;
      lumSum += (r + g + bl) / 3;
      if (bl > 55 && bl > r + 10 && g >= r - 4) cyan++;
    }
  }
  out.push({ band: b, pct: Math.round(b / NB * 100), cyanPct: +(100 * cyan / cnt).toFixed(1), lum: +(lumSum / cnt).toFixed(1) });
}
console.log('PROFILE ' + JSON.stringify(out));
