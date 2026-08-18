// Spectral characterization: is each blob speech-like (harmonic, formants) or noise-like (flat)?
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = path.join(os.tmpdir(), 'agenticos_blobs');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.webm')).sort();

function run(cmd) {
  try { return execSync(cmd, { encoding: 'utf8', timeout: 30000, maxBuffer: 64 * 1024 * 1024 }); }
  catch (e) { return 'ERR ' + e.message; }
}

for (const f of files) {
  const p = path.join(dir, f);
  const wav = path.join(os.tmpdir(), 'spec_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) + '.wav');
  run(`ffmpeg -y -v error -i "${p}" -ac 1 -ar 16000 "${wav}"`);
  const buf = fs.readFileSync(wav);
  const samples = new Int16Array(buf.buffer, 44, (buf.length - 44) / 2);
  // Analyze the loudest 2s segment: find window (200ms) with max energy, then do spectral stats
  const win = 3200; // 200ms at 16k
  let bestStart = 0, bestE = -Infinity;
  for (let i = 0; i + win <= samples.length; i += win) {
    let e = 0;
    for (let j = i; j < i + win; j++) { const v = samples[j] / 32768; e += v * v; }
    if (e > bestE) { bestE = e; bestStart = i; }
  }
  // zero-crossing rate + spectral flatness proxy on that segment
  let zcr = 0;
  for (let j = bestStart + 1; j < bestStart + win; j++) {
    const s0 = samples[j - 1], s1 = samples[j];
    if ((s0 < 0 && s1 >= 0) || (s0 >= 0 && s1 < 0)) zcr++;
  }
  const zcrRate = zcr / win;
  // rough spectral flatness via FFT (Goertzel-free simple DFT bins)
  const N = 512;
  let startBin = bestStart + 1600 - N / 2; // center 100ms
  if (startBin < 0) startBin = 0;
  const bins = [];
  for (let k = 0; k < 24; k++) {
    const freq = 125 + k * 250; // 125Hz..5875Hz
    const w = 2 * Math.PI * freq / 16000;
    let re = 0, im = 0;
    for (let n = 0; n < N; n++) {
      const v = samples[startBin + n] / 32768;
      re += v * Math.cos(w * n);
      im -= v * Math.sin(w * n);
    }
    bins.push(Math.sqrt(re * re + im * im));
  }
  const sum = bins.reduce((a, b) => a + b, 0);
  const geomean = Math.exp(bins.map((x) => Math.log(x + 1e-12)).reduce((a, b) => a + b, 0) / bins.length);
  const flatness = geomean / (sum / bins.length + 1e-12);
  console.log('===== ' + f);
  console.log('  loudestSeg= ' + (bestStart / 16000).toFixed(2) + 's  zcrRate=' + zcrRate.toFixed(3) + '  flatness=' + flatness.toFixed(4));
  console.log('  bins=' + bins.map((x) => x.toFixed(0)).join(','));
}
