import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import http from 'node:http';

const EXE_PATH = 'C:\\Users\\cd-pr\\AppData\\Local\\Programs\\AgenticOS\\AgenticOS.exe';
const DEBUG_PORT = 9444;
const BACKEND_PORT = 4600;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function httpGet(urlPath, port = BACKEND_PORT) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}${urlPath}`, { timeout: 3000 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: JSON.parse(body) }); }
        catch { resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body }); }
      });
    });
    req.on('error', (err) => resolve({ ok: false, error: err.message }));
  });
}

async function main() {
  console.log('[PROBE] Launching installed executable with CDP flag...');
  const appProc = spawn(EXE_PATH, [`--remote-debugging-port=${DEBUG_PORT}`, '--no-sandbox'], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, NODE_ENV: 'production' },
  });
  console.log(`[PROBE] Spawned PID: ${appProc.pid}`);

  console.log('[PROBE] Waiting for backend readiness at http://127.0.0.1:4600/api/health...');
  let healthy = false;
  let healthData = null;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const res = await httpGet('/api/health');
    if (res.ok && res.body) {
      healthy = true;
      healthData = res.body;
      break;
    }
  }

  if (!healthy) {
    console.error('[PROBE] Backend failed to start');
    try { process.kill(appProc.pid); } catch {}
    process.exit(1);
  }
  console.log('[PROBE] Backend is ONLINE! Status:', healthData.status || 'ok');

  console.log('[PROBE] Connecting to CDP via puppeteer-core on port', DEBUG_PORT);
  let browser = null;
  let page = null;
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    try {
      browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${DEBUG_PORT}`, defaultViewport: null });
      const pages = await browser.pages();
      page = pages.find((p) => p.url().includes('file://') || p.url().includes('4600') || p.url().includes('localhost')) || pages[0];
      if (page) break;
    } catch (e) {
      // waiting
    }
  }

  if (!browser || !page) {
    console.error('[PROBE] Could not connect to CDP / obtain page');
    try { process.kill(appProc.pid); } catch {}
    process.exit(1);
  }

  console.log('[PROBE] CDP Connected successfully! Page URL:', page.url(), '| Title:', await page.title());

  const devices = await page.evaluate(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devs = await navigator.mediaDevices.enumerateDevices();
    return devs.map(d => ({ kind: d.kind, label: d.label, deviceId: d.deviceId }));
  });
  console.log('[PROBE] MediaDevices in renderer:', JSON.stringify(devices, null, 2));

  console.log('[PROBE] Disconnecting CDP and killing process...');
  await browser.disconnect();
  try { process.kill(appProc.pid); } catch {}
  console.log('[PROBE] Done!');
}

main().catch(err => {
  console.error('[PROBE] Fatal error:', err);
  process.exit(1);
});
