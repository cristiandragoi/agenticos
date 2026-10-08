/**
 * qa/human-simulator/launcher.ts
 *
 * Launches and manages the installed AgenticOS application with CDP connection.
 */

import puppeteer, { Browser, Page } from 'puppeteer-core';
import { spawn, ChildProcess, execSync } from 'node:child_process';
import http from 'node:http';

export const EXE_PATH = 'C:\\Users\\cd-pr\\AppData\\Local\\Programs\\AgenticOS\\AgenticOS.exe';
export const DEBUG_PORT = 9444;
export const BACKEND_PORT = 4600;

export interface SimulatorAppSession {
  process: ChildProcess;
  browser: Browser;
  page: Page;
  backendUrl: string;
  debugPort: number;
  stop: () => Promise<void>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function httpGet(urlPath: string, port = BACKEND_PORT): Promise<{ ok: boolean; status?: number; body?: any; error?: string }> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}${urlPath}`, { timeout: 3000 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve({ ok: res.statusCode! >= 200 && res.statusCode! < 300, status: res.statusCode, body: JSON.parse(body) }); }
        catch { resolve({ ok: res.statusCode! >= 200 && res.statusCode! < 300, status: res.statusCode, body }); }
      });
    });
    req.on('error', (err) => resolve({ ok: false, error: err.message }));
  });
}

export function cleanupStaleProcesses(): void {
  try {
    execSync('powershell -NoProfile -Command "Get-Process -Name \'AgenticOS\',\'electron\' -ErrorAction SilentlyContinue | Stop-Process -Force"', {
      stdio: 'ignore',
    });
  } catch {}
}

export async function launchAgenticOS(debugPort = DEBUG_PORT): Promise<SimulatorAppSession> {
  console.log(`[Launcher] Cleaning up any stale AgenticOS processes...`);
  cleanupStaleProcesses();
  await sleep(1000);

  console.log(`[Launcher] Launching installed executable: ${EXE_PATH}`);
  const appProc = spawn(EXE_PATH, [`--remote-debugging-port=${debugPort}`, '--no-sandbox'], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, NODE_ENV: 'production' },
  });

  console.log(`[Launcher] Spawned PID: ${appProc.pid}`);

  console.log(`[Launcher] Waiting for backend readiness at http://127.0.0.1:${BACKEND_PORT}/api/health...`);
  let healthy = false;
  let healthInfo = null;
  for (let i = 0; i < 40; i++) {
    await sleep(750);
    const res = await httpGet('/api/health');
    if (res.ok && res.body) {
      healthy = true;
      healthInfo = res.body;
      break;
    }
  }

  if (!healthy) {
    try { process.kill(appProc.pid!); } catch {}
    throw new Error(`[Launcher] Installed application backend failed to become healthy on port ${BACKEND_PORT} within 30s.`);
  }

  console.log(`[Launcher] Backend is ONLINE! Build: ${JSON.stringify(healthInfo.build?.buildId || healthInfo)}`);

  console.log(`[Launcher] Connecting to Electron via Chrome DevTools Protocol (port ${debugPort})...`);
  let browser: Browser | null = null;
  let page: Page | null = null;

  for (let i = 0; i < 30; i++) {
    await sleep(600);
    try {
      browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${debugPort}`, defaultViewport: null });
      const pages = await browser.pages();
      page = pages.find((p) => p.url().includes('index.html') || p.url().includes('4600') || p.url().includes('jarvis')) || pages[0];
      if (page) break;
    } catch {}
  }

  if (!browser || !page) {
    try { process.kill(appProc.pid!); } catch {}
    throw new Error(`[Launcher] Could not connect to Electron window via CDP on port ${debugPort}.`);
  }

  console.log(`[Launcher] Connected to Page: ${page.url()} | Title: ${await page.title()}`);
  await page.evaluateOnNewDocument('window.__name = function(fn, name) { return fn; };');
  await page.evaluate('window.__name = function(fn, name) { return fn; };');

  // Ensure conversation mode is active so Jarvis is actively listening
  await page.evaluate(() => {
    try {
      sessionStorage.setItem('jarvis-canonical-mode', 'conversation');
      localStorage.setItem('jarvis-canonical-mode', 'conversation');
    } catch {}
  });

  // Navigate to /jarvis if not already there
  const currentUrl = page.url();
  if (!currentUrl.includes('#/jarvis')) {
    console.log(`[Launcher] Navigating window to #/jarvis...`);
    await page.evaluate(() => {
      window.location.hash = '#/jarvis';
    });
    await sleep(1500);
  }

  // Ensure window is in focus
  await page.bringToFront();
  await sleep(1000);


  const stop = async () => {
    console.log(`[Launcher] Stopping application session...`);
    try {
      if (browser && browser.isConnected()) {
        await browser.disconnect();
      }
    } catch {}
    try {
      if (appProc.pid) {
        process.kill(appProc.pid);
      }
    } catch {}
    cleanupStaleProcesses();
    console.log(`[Launcher] Application session stopped.`);
  };

  return {
    process: appProc,
    browser,
    page,
    backendUrl: `http://127.0.0.1:${BACKEND_PORT}`,
    debugPort,
    stop,
  };
}

export async function armConversation(page: Page): Promise<boolean> {
  console.log('[Launcher] Arming conversation mode via jarvis-primary-control...');
  return await page.evaluate(async () => {
    try {
      sessionStorage.setItem('jarvis-canonical-mode', 'conversation');
      localStorage.setItem('jarvis-canonical-mode', 'conversation');
    } catch {}

    const btn = document.querySelector('[data-testid="jarvis-primary-control"]') as HTMLButtonElement;
    if (btn && btn.textContent?.includes('START CONVERSATION')) {
      console.log('[Launcher] Clicking START CONVERSATION...');
      btn.click();
      return true;
    }
    return false;
  });
}

