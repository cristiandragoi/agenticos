// Analyze each saved voice blob: duration + per-window RMS profile.
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
  // duration via decode
  const durOut = run(`ffprobe -v error -select_streams a:0 -show_entries stream=duration -of csv=p=0 "${p}"`);
  console.log('duration=' + durOut.trim());
  // RMS profile: 20 windows per second of 50ms
  const wav = path.join(os.tmpdir(), 'probe.wav');
  run(`ffmpeg -y -v error -i "${p}" -ac 1 -ar 16000 "${wav}"`);
  const st = fs.statSync(wav);
  console.log('wavBytes=' + st.size);
  const buf = fs.readFileSync(wav);
  // parse WAV: skip 44-byte header, 16-bit mono
  const samples = new Int16Array(buf.buffer, 44, (buf.length - 44) / 2);
  const win = 800; // 50ms at 16k
  const profile = [];
  for (let i = 0; i + win <= samples.length; i += win) {
    let sum = 0;
    for (let j = i; j < i + win; j++) {
      const v = samples[j] / 32768;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / win);
    const db = 20 * Math.log10(rms + 1e-9);
    profile.push(db.toFixed(1));
  }
  // print coarse: 10 buckets
  const bucket = Math.ceil(profile.length / 12);
  const coarse = [];
  for (let i = 0; i < profile.length; i += bucket) {
    coarse.push(profile.slice(i, i + bucket).join(','));
  }
  console.log('rms50ms(dB): ' + coarse.join(' | '));
  // speech-like: count windows above -30dB
  const loud = profile.filter((x) => parseFloat(x) > -30).length;
  console.log('windowsAbove-30dB=' + loud + ' of ' + profile.length);
  console.log('mean=' + (profile.reduce((a, b) => a + parseFloat(b), 0) / profile.length).toFixed(1) + 'dB');
}
