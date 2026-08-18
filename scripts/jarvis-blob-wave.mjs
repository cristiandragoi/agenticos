// Fine-grained waveform shape of the first 500ms of each blob.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = path.join(os.tmpdir(), 'agenticos_blobs');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.webm')).sort();

function run(cmd) {
  try { return execSync(cmd, { encoding: 'utf8', timeout: 20000, maxBuffer: 64 * 1024 * 1024 }); }
  catch (e) { return 'ERR ' + e.message; }
}

for (const f of files) {
  const p = path.join(dir, f);
  console.log('===== ' + f);
  const wav = path.join(os.tmpdir(), 'probe_' + Date.now() + '.wav');
  run(`ffmpeg -y -v error -i "${p}" -ac 1 -ar 16000 "${wav}"`);
  const buf = fs.readFileSync(wav);
  const samples = new Int16Array(buf.buffer, 44, (buf.length - 44) / 2);
  const win = 160; // 10ms at 16k
  const profile = [];
  for (let i = 0; i + win <= samples.length; i += win) {
    let sum = 0;
    for (let j = i; j < i + win; j++) {
      const v = samples[j] / 32768;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / win);
    profile.push(20 * Math.log10(rms + 1e-9));
  }
  // print first 60 windows (600ms) as dB, and count total
  console.log('first600ms: ' + profile.slice(0, 60).map((x) => x.toFixed(0)).join(','));
  console.log('totalWindows=' + profile.length + ' totalSec=' + (profile.length * 0.01).toFixed(2));
  // count how many windows exceed -34dB (VAD threshold) and -26dB
  console.log('above-34dB=' + profile.filter((x) => x > -34).length + ' above-26dB=' + profile.filter((x) => x > -26).length);
}
