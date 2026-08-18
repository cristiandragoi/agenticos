// Pure-Node PNG analyzer (no deps): decode RGBA, then palette + band + grid.
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
      width = buf.readUInt32BE(off + 8);
      height = buf.readUInt32BE(off + 12);
      bitDepth = buf[off + 16]; colorType = buf[off + 17]; interlace = buf[off + 20];
    } else if (type === 'IDAT') {
      idat.push(buf.subarray(off + 8, off + 8 + len));
    } else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (interlace !== 0) return { error: 'interlaced', width, height };
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0;
  if (!channels || bitDepth !== 8) return { error: `unsupported ct=${colorType} bd=${bitDepth}`, width, height };
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
      const ci = x * channels;
      const oi = (y * width + x) * 4;
      out[oi] = cur[ci];
      out[oi + 1] = channels > 1 ? cur[ci + 1] : cur[ci];
      out[oi + 2] = channels > 2 ? cur[ci + 2] : cur[ci];
      out[oi + 3] = channels > 3 ? cur[ci + 3] : 255;
    }
    prev.set(cur);
  }
  return { width, height, data: out };
}

function analyze(path) {
  const img = decodePNG(path);
  if (img.error) return { error: img.error, path };
  const { width: W, height: H, data } = img;
  const buckets = new Map();
  for (let i = 0; i < data.length; i += 8) { // every 2nd px
    const r = data[i] >> 5 << 5, g = data[i + 1] >> 5 << 5, b = data[i + 2] >> 5 << 5;
    const key = `${r},${g},${b}`;
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  const total = data.length / 8;
  const palette = [...buckets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([k, n]) => ({ rgb: k, pct: +(100 * n / total).toFixed(1) }));

  const NB = 25, bands = [];
  for (let b = 0; b < NB; b++) {
    const y0 = Math.floor(b * H / NB), y1 = Math.floor((b + 1) * H / NB);
    let sum = 0, cnt = 0, cyan = 0;
    for (let y = y0; y < y1; y += 2) {
      for (let x = 0; x < W; x += 2) {
        const i = (y * W + x) * 4;
        const r = data[i], g = data[i + 1], bl = data[i + 2];
        sum += (r + g + bl) / 3; cnt++;
        if (bl > 100 && bl > r + 15) cyan++;
      }
    }
    bands.push({ pct: Math.round(b / NB * 100), lum: Math.round(sum / cnt), cyanPct: +(100 * cyan / cnt).toFixed(1) });
  }

  const grid = [];
  for (let gy = 0; gy < 24; gy++) {
    let row = '';
    for (let gx = 0; gx < 24; gx++) {
      let sum = 0, cnt = 0;
      for (let y = Math.floor(gy * H / 24); y < Math.floor((gy + 1) * H / 24); y += 3) {
        for (let x = Math.floor(gx * W / 24); x < Math.floor((gx + 1) * W / 24); x += 3) {
          const i = (y * W + x) * 4;
          sum += (data[i] + data[i + 1] + data[i + 2]) / 3; cnt++;
        }
      }
      const v = Math.round(sum / cnt / 12.75); // 0..20
      row += v >= 18 ? '#' : v >= 13 ? 'O' : v >= 8 ? '+' : v >= 4 ? '.' : ' ';
    }
    grid.push(row);
  }
  return { path, W, H, palette, bands, grid };
}

for (const p of process.argv.slice(2)) {
  try { console.log(JSON.stringify(analyze(p))); } catch (e) { console.log(JSON.stringify({ path: p, error: String(e) })); }
}
