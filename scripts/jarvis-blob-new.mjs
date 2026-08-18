// Analyze the two NEWEST blobs (ok + nope from 11:05) with fine RMS + spectral.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = path.join(os.tmpdir(), 'agenticos_blobs');
const targets = ['1786698325203-33195B-ok.webm', '1786698356833-20577B-nope.webm', '1786698310364-4819565B-ok.webm'];

function run(cmd) {
  try { return execSync(cmd, { encoding: 'utf8', timeout: 30000, maxBuffer: 64 * 1024 * 1024 }); }
  catch (e) { return 'ERR ' + e.message; }
}

for (const f of targets) {
  const p = path.join(dir, f);
  if (!fs.existsSync(p)) { console.log('MISSING ' + f); continue; }
  const wav = path.join(os.tmpdir(), 'n_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) + '.wav');
  run(`ffmpeg -y -v error -i "${p}" -ac 1 -ar 16000 "${wav}"`);
  const buf = fs.readFileSync(wav);
  const samples = new Int16Array(buf.buffer, 44, (buf.length - 44) / 2);
  const win = 160;
  const profile = [];
  for (let i = 0; i + win <= samples.length; i += win) {
    let sum = 0;
    for (let j = i; j < i + win; j++) { const v = samples[j] / 32768; sum += v * v; }
    profile.push(20 * Math.log10(Math.sqrt(sum / win) + 1e-9));
  }
  console.log('===== ' + f + '  len=' + (profile.length * 0.01).toFixed(2) + 's');
  // speech windows: > -30dB
  const speech = profile.filter((x) => x > -30).length;
  const weak = profile.filter((x) => x > -38 && x <= -30).length;
  const silence = profile.filter((x) => x <= -38).length;
  console.log('  >-30dB=' + speech + '  -38..-30=' + weak + '  <=-38=' + silence + '  (of ' + profile.length + ')');
  // print profile every 5th window (50ms steps) for first 200 windows
  console.log('  prof10ms: ' + profile.slice(0, 200).map((x, i) => (i % 2 === 0 ? x.toFixed(0) : '')).join(','));
}
