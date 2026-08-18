// Visionless structural evidence for the reference-match gate shot.
// Decodes the stage PNG (pure Node) and reports cyan density in the bands
// that prove the reference composition: humanoid head / neck-shoulders /
// chest / platform / module columns. Prints an ASCII grid for eyeballing.
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
  if (interlace !== 0) return { error: 'interlaced', width, height };
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0;
  if (!channels || bitDepth !== 8) return { error: `ct=${colorType} bd=${bitDepth}`, width, height };
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
      out[oi + 2] = channels > 2 ? cur[ci + 2] : cur[ci]; out[oi + 3] = channels > 3 ? cur[ci + 3] : 255;
    }
    prev.set(cur);
  }
  return { width, height, data: out };
}

function stats(img, x0, y0, x1, y1) {
  const { width: W, height: H, data } = img;
  const px0 = Math.max(0, Math.floor(x0 * W)), px1 = Math.min(W, Math.ceil(x1 * W));
  const py0 = Math.max(0, Math.floor(y0 * H)), py1 = Math.min(H, Math.ceil(y1 * H));
  let lumSum = 0, cnt = 0, cyan = 0, brightCyan = 0;
  for (let y = py0; y < py1; y++) {
    for (let x = px0; x < px1; x++) {
      const i = (y * W + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const lum = (r + g + b) / 3;
      lumSum += lum; cnt++;
      const isCyan = b > 60 && b > r + 12 && g >= r - 4;
      if (isCyan) { cyan++; if (lum > 110) brightCyan++; }
    }
  }
  return { lum: +(lumSum / cnt).toFixed(1), cyanPct: +(100 * cyan / cnt).toFixed(2), brightPct: +(100 * brightCyan / cnt).toFixed(2) };
}

function grid(img, cols, rows) {
  const { width: W, height: H, data } = img;
  const out = [];
  for (let gy = 0; gy < rows; gy++) {
    let row = '';
    for (let gx = 0; gx < cols; gx++) {
      let sum = 0, cnt = 0;
      for (let y = Math.floor(gy * H / rows); y < Math.floor((gy + 1) * H / rows); y += 2) {
        for (let x = Math.floor(gx * W / cols); x < Math.floor((gx + 1) * W / cols); x += 2) {
          const i = (y * W + x) * 4;
          const r = data[i], g = data[i + 1], b = data[i + 2];
          sum += (r + g + b) / 3; cnt++;
        }
      }
      const v = Math.round(sum / cnt / 11.25); // 0..22
      row += v >= 19 ? '#' : v >= 14 ? 'O' : v >= 9 ? '+' : v >= 5 ? '.' : ' ';
    }
    out.push(row);
  }
  return out;
}

for (const p of process.argv.slice(2)) {
  try {
    const img = decodePNG(p);
    if (img.error) { console.log(JSON.stringify({ path: p, error: img.error })); continue; }
    const fx = (x) => x / img.width, fy = (y) => y / img.height;
    // NOTE: clip px = DPR; svg occupies first 825 DPR rows (550 CSS), x maps 1000->660.
    // fy fractions below are of the SVG (0..1250 viewBox), not the whole clip.
    const regions = {
      head: stats(img, 0.14, 0.06, 0.86, 0.55),
      brainCore: stats(img, 0.40, 0.08, 0.56, 0.16),
      eyes: stats(img, 0.30, 0.26, 0.70, 0.33),
      face: stats(img, 0.35, 0.35, 0.65, 0.50),
      neckShoulders: stats(img, 0.12, 0.55, 0.88, 0.74),
      chest: stats(img, 0.22, 0.72, 0.78, 0.86),
      chestCore: stats(img, 0.36, 0.70, 0.54, 0.78),
      platform: stats(img, 0.30, 0.87, 0.70, 0.96),
      moduleLeftTop: stats(img, 0.03, 0.12, 0.20, 0.21),
      moduleRightTop: stats(img, 0.80, 0.17, 0.97, 0.26),
      moduleLeftMid: stats(img, 0.03, 0.35, 0.20, 0.44),
      moduleRightMid: stats(img, 0.80, 0.39, 0.97, 0.48),
      moduleBottom: stats(img, 0.42, 0.81, 0.58, 0.88),
    };
    console.log(JSON.stringify({ path: p, W: img.width, H: img.height, regions }));
    console.log('GRID_40x50');
    for (const row of grid(img, 40, 50)) console.log(row);
  } catch (e) {
    console.log(JSON.stringify({ path: p, error: String(e) }));
  }
}
