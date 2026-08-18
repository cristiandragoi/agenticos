// FINAL vectorizer v3: coarse density grid (68x85) → silhouette + landmarks
// + neural points → emit referenceGeometry.ts (consumed by the SVG).
import fs from 'node:fs';

const raw = JSON.parse(fs.readFileSync('scripts/p3-vector-raw2.json', 'utf8'));
const { W, H, MW, MH, mask, feats } = raw;

const GW = 68, GH = 85; // coarse grid cells (each = 4x4 mask px)
const cell = 4;

// coarse density grid
const dens = [];
for (let gy = 0; gy < GH; gy++) {
  const row = [];
  for (let gx = 0; gx < GW; gx++) {
    let n = 0;
    for (let y = gy * cell; y < Math.min(MH, (gy + 1) * cell); y++) {
      for (let x = gx * cell; x < Math.min(MW, (gx + 1) * cell); x++) n += mask[y * MW + x];
    }
    row.push(n / 16);
  }
  dens.push(row);
}

// left/right cell profile (density >= 0.28 = dense hologram outline, '#'
// band in the debug grids; sparse aura is a separate decorative layer).
// Scan cols 4..62 — excludes the left/right edge artifacts (cols 0-3, 64-67).
const T = 0.28;
const L = [], R = [], Wd = [];
for (let gy = 0; gy < GH; gy++) {
  let l = -1, r = -1;
  for (let gx = 4; gx <= 62; gx++) if (dens[gy][gx] >= T) { l = gx; break; }
  for (let gx = 62; gx >= 4; gx--) if (dens[gy][gx] >= T) { r = gx; break; }
  L.push(l); R.push(r); Wd.push(l >= 0 && r >= 0 ? r - l : -1);
}

// landmarks (coarse rows)
const crownY = (() => { for (let i = 0; i < GH; i++) if (Wd[i] > 8) return i; return 0; })();
const maxTopW = Math.max(...Wd.slice(crownY, crownY + 14).map((w) => (w > 0 ? w : 0)));
// face top = first row after the crown halo where width settles to the head
let faceTop = 20;
for (let i = crownY + 2; i < crownY + 16; i++) { if (Wd[i] > 0 && Wd[i] < 0.72 * maxTopW) { faceTop = i; break; } }
// neck = first sustained narrowing below the face (uses provisional eye-width)
let neck = 55;
for (let i = faceTop + 14; i < GH - 4; i++) {
  const p = 0.55 * Math.max(...Wd.slice(faceTop, faceTop + 18).filter((w) => w > 0));
  if (Wd[i] > 0 && Wd[i] < p && Wd[i + 1] > 0 && Wd[i + 1] < p) { neck = i; break; }
}
let chin = neck;
for (let i = neck; i >= faceTop; i--) {
  const p = 0.7 * Math.max(...Wd.slice(faceTop, faceTop + 18).filter((w) => w > 0));
  if (Wd[i] > p) { chin = i; break; }
}
let shY = neck, shW = 0;
for (let i = neck + 1; i < Math.min(GH, neck + 22); i++) { if (Wd[i] > shW) { shW = Wd[i]; shY = i; } }
let earY = neck, earW = 0;
for (let i = faceTop + 2; i <= chin; i++) { if (i < GH && Wd[i] > earW) { earW = Wd[i]; earY = i; } }
// face width at the EYE row (crown + 0.46*(chin-crown)), median of ±4 rows
const eyeGY = crownY + (chin - crownY) * 0.46;
const eyeSlice = [];
for (let i = Math.max(faceTop, Math.floor(eyeGY) - 4); i <= Math.min(chin, Math.floor(eyeGY) + 4); i++) if (Wd[i] > 0) eyeSlice.push(Wd[i]);
const faceW = eyeSlice.length ? eyeSlice[Math.floor(eyeSlice.length / 2)] : maxTopW;

console.log('crown', crownY, 'faceTop', faceTop, 'chin', chin, 'neck', neck, 'shoulder', shY, 'ear', earY, 'faceW', faceW, 'maxTopW', maxTopW, 'shW', shW);

// eye/nose/mouth: anatomical placement on the MEASURED head
const noseGY = crownY + (chin - crownY) * 0.7;
const mouthGY = crownY + (chin - crownY) * 0.84;
const eyeDX = faceW * 0.21;

// brain + chest centroids (coarse)
let bx = 0, by = 0, bn = 0;
for (let gy = crownY; gy < Math.min(GH, crownY + 7); gy++) for (let gx = 0; gx < GW; gx++) if (dens[gy][gx] >= T) { bx += gx; by += gy; bn++; }
const brain = bn ? { x: bx / bn, y: by / bn } : { x: GW / 2, y: crownY + 3 };
let cx = 0, cy = 0, cn = 0;
for (let gy = shY + 1; gy < Math.min(GH, shY + 10); gy++) for (let gx = 0; gx < GW; gx++) if (dens[gy][gx] >= T) { cx += gx; cy += gy; cn++; }
const chest = cn ? { x: cx / cn, y: cy / cn } : { x: GW / 2, y: shY + 5 };

// map coarse -> viewBox 1000x1250 (coarse cell = 4 mask px)
const figTop = crownY, figBot = shY + 8;
const figH = figBot - figTop;
const figW = Math.max(faceW, shW);
const scale = Math.min(900 / (figH * 4), 940 / (figW * 4));
const ox = 500 - (GW / 2) * scale * 4;
const oy = 100 - figTop * scale * 4;
const MX = (x) => ox + x * scale * 4;
const MY = (y) => oy + y * scale * 4;

// silhouette path: right profile down, left up (Catmull-Rom → cubic)
function smooth(arr, win = 2) {
  const o = [];
  for (let i = 0; i < arr.length; i++) { let s = 0, n = 0; for (let j = Math.max(0, i - win); j <= Math.min(arr.length - 1, i + win); j++) if (arr[j] >= 0) { s += arr[j]; n++; } o.push(n ? s / n : -1); }
  return o;
}
function toCubic(pts) {
  if (pts.length < 4) return '';
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1];
    d += ` C ${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)} ${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)}, ${(p1[0] - (p2[0] - p0[0]) / 6).toFixed(1)} ${(p1[1] - (p2[1] - p0[1]) / 6).toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}
const lS = smooth(L, 2), rS = smooth(R, 2);
const rp = [], lp = [];
for (let gy = figTop; gy <= figBot; gy++) { if (rS[gy] >= 0 && lS[gy] >= 0) rp.push([MX(rS[gy]), MY(gy)]); }
for (let gy = figBot; gy >= figTop; gy--) { if (rS[gy] >= 0 && lS[gy] >= 0) lp.push([MX(lS[gy]), MY(gy)]); }
const silhouettePath = toCubic(rp) + ' ' + toCubic(lp.slice(1)) + ' Z';

// neural points: cluster bright feats (real reference positions)
const pts = [];
const cands = feats.slice().sort((a, b) => b.lum - a.lum);
for (const f of cands) {
  const gx = Math.floor(f.x / W * GW), gy = Math.floor(f.y / H * GH);
  if (gy < figTop - 2 || gy > figBot + 4) continue;
  let ok = true;
  for (const p of pts) { const dx = f.x - p.x, dy = f.y - p.y; if (dx * dx + dy * dy < 7 * 7) { ok = false; break; } }
  if (ok) pts.push({ x: f.x, y: f.y, lum: f.lum });
  if (pts.length >= 150) break;
}
// split into head + body sets by measured neck
const neckG = neck;
const headPts = pts.filter((p) => Math.floor(p.y / H * GH) < neckG).slice(0, 110);
const bodyPts = pts.filter((p) => Math.floor(p.y / H * GH) >= neckG).slice(0, 60);

// emit
const G = {
  bbox: { w: figW, h: figH },
  silhouettePath,
  head: { crownY: +MY(crownY).toFixed(1), chinY: +MY(chin).toFixed(1), width: +(faceW * 4 * scale).toFixed(1) },
  eyes: { left: { x: +MX(GW / 2 - eyeDX).toFixed(1), y: +MY(eyeGY).toFixed(1) }, right: { x: +MX(GW / 2 + eyeDX).toFixed(1), y: +MY(eyeGY).toFixed(1) }, ry: +Math.min(14, 5 * scale).toFixed(1) },
  nose: { x: 500, y: +MY(noseGY).toFixed(1) },
  mouth: { x: 500, y: +MY(mouthGY).toFixed(1) },
  ears: { y: +MY(earY).toFixed(1), extent: +((earW - faceW) * 4 * scale / 2).toFixed(1) },
  neck: { y: +MY(neck).toFixed(1) },
  shoulders: { y: +MY(shY).toFixed(1) },
  chestCore: { x: +MX(chest.x).toFixed(1), y: +MY(chest.y).toFixed(1) },
  brainCore: { x: +MX(brain.x).toFixed(1), y: +MY(brain.y).toFixed(1) },
  headNeurons: headPts.map((p) => ({ x: +MX(p.x / W * GW).toFixed(1), y: +MY(p.y / H * GH).toFixed(1), lum: p.lum })),
  bodyNeurons: bodyPts.map((p) => ({ x: +MX(p.x / W * GW).toFixed(1), y: +MY(p.y / H * GH).toFixed(1), lum: p.lum })),
};
fs.writeFileSync('src/components/jarvis-visualization-v2/referenceGeometry.ts',
  '// GENERATED from B:/AgenticOS/Humanoid-JARVIS/jarvis-reference.jpeg by scripts/p3vector-build2.mjs\n' +
  '// Reference-derived geometry — the silhouette/ears/neck/shoulders/brain/chest/neural points\n' +
  '// are traced from the reference image. Eyes/nose/mouth are anatomically placed on the\n' +
  '// measured head (face interior is uniform hologram density, not pixel-separable).\n' +
  'export const REF = ' + JSON.stringify(G, null, 2) + ' as const;\n');
console.log('EMITTED referenceGeometry.ts: neural head ' + headPts.length + ' body ' + bodyPts.length + ' silhouette ' + silhouettePath.length + ' chars');
