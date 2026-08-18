// Timestamped capture of the 5-turn voice test with blob diagnostics.
import puppeteer from 'puppeteer-core';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
const logs = [];
app.on('console', (m) => {
  logs.push({ t: Date.now(), line: m.type() + ': ' + m.text() });
});

console.log('CAPTURE_STARTED run the 5 voice turns now');
const deadline = Date.now() + 420000; // 7 min
while (Date.now() < deadline) {
  await sleep(3000);
  const done = logs.filter((l) => l.line.includes('[VTurn] done')).length;
  if (done >= 5) { console.log('SAW_5_DONE'); break; }
  const sent = logs.filter((l) => l.line.includes('[VTurn] handleSendMessage')).length;
  if (sent >= 5) { await sleep(25000); break; }
}
await sleep(8000);

console.log('TURN_LOG_DUMP');
for (const l of logs.filter((x) => x.line.includes('[VTurn]') || x.line.includes('[ConvTrace]') || x.line.includes('[BlobCap]'))) {
  console.log('T ' + (l.t - logs[0].t) + 'ms ' + l.line);
}

// Blob diagnostics from temp dir
const dir = pathJoin(os.tmpdir(), 'agenticos_blobs');
function pathJoin(...parts) { return parts.join('\\').replace(/\\+/g, '\\'); }
let blobInfo = [];
if (fs.existsSync(dir)) {
  const files = fs.readdirSync(dir).sort();
  for (const f of files) {
    const p = pathJoin(dir, f);
    const st = fs.statSync(p);
    let probe = null;
    try {
      probe = execSync(`ffprobe -v error -show_entries format=duration:format_tags=encoder -of json "${p}" 2>&1`, { encoding: 'utf8', timeout: 15000 });
    } catch { probe = null; }
    blobInfo.push({ file: f, size: st.size, mtime: st.mtime.toISOString(), probe: probe ? JSON.parse(probe) : null });
  }
}
console.log('BLOB_INFO ' + JSON.stringify(blobInfo, null, 1));

const st = await app.evaluate(() => {
  const rows = Array.from(document.querySelectorAll('[data-testid="jarvis-command-line"]')).map((l) => l.innerText.replace(/\s+/g, ' ').trim()).slice(-14);
  const primary = document.querySelector('[data-testid="jarvis-primary-control"]');
  return { rows, primary: primary ? primary.innerText.trim() : null };
});
console.log('END_STATE ' + JSON.stringify(st, null, 1));
console.log('TURNS_SUBMITTED ' + logs.filter((l) => l.line.includes('[VTurn] handleSendMessage')).length);
console.log('TURNS_DONE ' + logs.filter((l) => l.line.includes('[VTurn] done')).length);
console.log('NOPES ' + (blobInfo.filter((b) => b.file.includes('nope')).length));
await browser.disconnect();
