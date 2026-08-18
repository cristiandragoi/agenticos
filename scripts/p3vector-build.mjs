// Vectorize the reference: derive silhouette, features, and neural points
// from the extracted mask + feature data; emit referenceGeometry.ts.
import fs from 'node:fs';

const raw = JSON.parse(fs.readFileSync('scripts/p3-vector-raw.json', 'utf8'));
const { W, H, MW, MH, mask, rows, cols, feats } = raw;

// ── 1. figure bbox from mask ──
let minX = MW, minY = MH, maxX = 0, maxY = 0;
for (let y = 0; y < MH; y++) {
  for (let x = 0; x < MW; x++) {
    if (mask[y * MW + x]) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
}
const bbox = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
console.log('bbox', JSON.stringify(bbox), 'rows', rows.length, 'cols', cols.length);

// map mask coords -> viewBox 1000x1250 (keep aspect, center)
const scale = Math.min(860 / bbox.w, 1130 / bbox.h);
const ox = (1000 - bbox.w * scale) / 2 - bbox.x * scale;
const oy = 60 - bbox.y * scale;
const mx = (x) => ox + x * scale;
const my = (y) => oy + y * scale;

// ── 2. left/right silhouette profiles (per row, smoothed) ──
function profileSide(side) {
  const prof = [];
  for (let y = minY; y <= maxY; y++) {
    let found = -1;
    for (let x = side === 'left' ? minX : maxX; side === 'left' ? x <= maxX : x >= minX; side === 'left' ? x++ : x--) {
      if (mask[y * MW + x]) { found = x; break; }
    }
    prof.push(found);
  }
  return prof;
}
const leftProf = profileSide('left');
const rightProf = profileSide('right');

// detect the neck gap: rows where the width narrows sharply (find the head bottom)
let headBottomY = minY, neckRow = minY;
let minWidth = 1e9;
for (let y = minY + Math.round(bbox.h * 0.3); y <= minY + bbox.h * 0.8; y++) {
  const l = leftProf[y - minY], r = rightProf[y - minY];
  if (l < 0 || r < 0) continue;
  const w = r - l;
  if (w < minWidth) { minWidth = w; neckRow = y; }
}
headBottomY = neckRow; // narrowest = neck; head bottom ~ neck top
console.log('neckRow', neckRow, 'headBottom', headBottomY);

// ── 3. feature clusters from bright pixels ──
const inBand = (f, y0, y1) => f.y / H >= y0 && f.y / H <= y1;
const bright = feats.filter((f) => f.lum > 55);
const eyeBand = bright.filter((f) => inBand(f, 0.30, 0.47));
const mouthBand = bright.filter((f) => inBand(f, 0.47, 0.60));
const noseBand = bright.filter((f) => inBand(f, 0.36, 0.50) && Math.abs(f.x / W - 0.5) < 0.08);

// eyes: cluster eyeBand by x into left/right
const byX = (arr) => arr.sort((a, b) => a.x - b.x);
const eyeSorted = byX(eyeBand);
let leftEye = [], rightEye = [];
const midX = W / 2;
for (const f of eyeSorted) (f.x < midX ? leftEye : rightEye).push(f);
const clusterCenter = (arr) => {
  if (!arr.length) return null;
  const cx = arr.reduce((s, f) => s + f.x, 0) / arr.length;
  const cy = arr.reduce((s, f) => s + f.y, 0) / arr.length;
  let rx = 0, ry = 0;
  for (const f of arr) { rx = Math.max(rx, Math.abs(f.x - cx)); ry = Math.max(ry, Math.abs(f.y - cy)); }
  return { x: cx, y: cy, rx: Math.max(6, rx), ry: Math.max(4, ry), n: arr.length };
};
const L = clusterCenter(leftEye), R = clusterCenter(rightEye);
const nose = clusterCenter(noseBand);
const mouth = clusterCenter(mouthBand);

// ears: local max of profile width in the ear band
const earBandY0 = minY + bbox.h * 0.34, earBandY1 = minY + bbox.h * 0.5;
let earMaxW = 0, earY = neckRow;
for (let y = Math.round(earBandY0); y <= earBandY1; y++) {
  const l = leftProf[y - minY], r = rightProf[y - minY];
  if (l < 0 || r < 0) continue;
  const w = r - l;
  if (w > earMaxW) { earMaxW = w; earY = y; }
}
console.log('eyes', JSON.stringify(L), JSON.stringify(R), 'nose', JSON.stringify(nose), 'mouth', JSON.stringify(mouth), 'earRow', earY);

// ── 4. neural points: cluster bright feats to ~150 ──
const target = 150;
const minDist = 5;
const pts = [];
const candidates = feats.slice().sort((a, b) => b.lum - a.lum);
for (const f of candidates) {
  let ok = true;
  for (const p of pts) {
    const dx = f.x - p.x, dy = f.y - p.y;
    if (dx * dx + dy * dy < minDist * minDist) { ok = false; break; }
  }
  if (ok) pts.push({ x: f.x, y: f.y, lum: f.lum });
  if (pts.length >= target) break;
}
console.log('neural pts', pts.length);

// ── 5. build the silhouette path (smooth + Catmull-Rom → cubic) ──
function smooth(arr, win = 4) {
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    let s = 0, n = 0;
    for (let j = Math.max(0, i - win); j <= Math.min(arr.length - 1, i + win); j++) {
      if (arr[j] >= 0) { s += arr[j]; n++; }
    }
    out.push(n ? s / n : -1);
  }
  return out;
}
function toCubic(ptsArr) {
  if (ptsArr.length < 4) return '';
  let d = `M ${ptsArr[0][0].toFixed(1)} ${ptsArr[0][1].toFixed(1)}`;
  for (let i = 1; i < ptsArr.length - 1; i++) {
    const p0 = ptsArr[i - 1], p1 = ptsArr[i], p2 = ptsArr[i + 1];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p1[0] - (p2[0] - p0[0]) / 6, c2y = p1[1] - (p2[1] - p0[1]) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}
const lS = smooth(leftProf, 5);
const rS = smooth(rightProf, 5);
// sample every 2nd row for the path
const rightPts = [], leftPts = [];
for (let y = minY; y <= maxY; y += 2) {
  const i = y - minY;
  if (rS[i] >= 0 && lS[i] >= 0) rightPts.push([mx(rS[i]), my(y)]);
}
for (let y = maxY; y >= minY; y -= 2) {
  const i = y - minY;
  if (rS[i] >= 0 && lS[i] >= 0) leftPts.push([mx(lS[i]), my(y)]);
}
const silhouettePath = toCubic(rightPts) + ' ' + toCubic(leftPts.slice(1)) + ' Z';

// ── 6. emit geometry module ──
const G = {
  bbox: { x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h },
  scale,
  ox,
  oy,
  silhouettePath,
  eyes: {
    left: L ? { x: mx(L.x), y: my(L.y), rx: L.rx * scale, ry: L.ry * scale } : null,
    right: R ? { x: mx(R.x), y: my(R.y), rx: R.rx * scale, ry: R.ry * scale } : null,
  },
  nose: nose ? { x: mx(nose.x), y: my(nose.y) } : null,
  mouth: mouth ? { x: mx(mouth.x), y: my(mouth.y) } : null,
  neckRow: my(neckRow),
  earRow: my(earY),
  earExtent: earMaxW * scale,
  neural: pts.map((p) => ({ x: mx(p.x), y: my(p.y), lum: p.lum })),
};
fs.writeFileSync('scripts/p3-vector-geometry.json', JSON.stringify(G, null, 1));
console.log('GEOMETRY OK: eyes', JSON.stringify(G.eyes), 'nose', JSON.stringify(G.nose), 'mouth', JSON.stringify(G.mouth), 'neck', G.neckRow, 'silhouette len', silhouettePath.length);
