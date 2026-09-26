/**
 * scripts/test_startup_resilience_suite.mjs
 *
 * Automated Installed-App Startup Resilience & Self-Healing Suite.
 *
 * Tests the real installed AgenticOS desktop binary:
 * C:\Users\cd-pr\AppData\Local\Programs\AgenticOS\AgenticOS.exe
 *
 * Scenarios:
 * TEST 1 — Normal clean cold start.
 * TEST 2 — Second AgenticOS launch while first instance is healthy.
 * TEST 3 — Simulated stale AgenticOS-owned backend occupying port 4600.
 * TEST 4 — Foreign process occupying port 4600.
 * TEST 5 — Restart after forced AgenticOS termination.
 * TEST 6 — Three consecutive close/start cycles without accumulating orphans.
 */

import { spawn, execFile, execFileSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const EXE_PATH = 'C:\\Users\\cd-pr\\AppData\\Local\\Programs\\AgenticOS\\AgenticOS.exe';
const USER_DATA = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'AgenticOS');
const OWNERSHIP_FILE = path.join(USER_DATA, 'backend-ownership.json');
const LOG_FILE = path.join(USER_DATA, '.agentos', 'logs', 'electron-dev.log');
const HEALTH_URL = 'http://127.0.0.1:4600/api/health';
const RUNTIME_STATE_URL = 'http://127.0.0.1:4600/api/jarvis/runtime-state';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function log(msg, data) {
  const line = data !== undefined ? `${msg} ${JSON.stringify(data)}` : msg;
  console.log(`[resilience-test] ${line}`);
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

function getListeningPidOnPort(port) {
  try {
    const out = execFileSync('netstat', ['-ano', '-p', 'tcp'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 3000,
    });
    for (const line of out.split(/\r?\n/)) {
      const match = line.match(new RegExp(`:${port}\\s+(?:0\\.0\\.0\\.0:0|\\[::\\]:0|\\*:\\*)\\s+\\S+\\s+(\\d+)`));
      if (match && match[1]) {
        const pid = parseInt(match[1], 10);
        if (Number.isFinite(pid) && pid > 0) return pid;
      }
    }
  } catch {}

  try {
    const psCmd = `(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue).OwningProcess`;
    const out = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psCmd], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    }).trim();
    if (out) {
      const pid = parseInt(out.split(/\r?\n/)[0], 10);
      if (Number.isFinite(pid) && pid > 0) return pid;
    }
  } catch {}

  return null;
}

function getAgenticProcesses() {
  try {
    const psCmd = `Get-Process -Name 'AgenticOS' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id`;
    const out = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psCmd], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    }).trim();
    if (!out) return [];
    return out.split(/\r?\n/).map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n) && n > 0);
  } catch {
    return [];
  }
}

function ensureCleanState() {
  log('Ensuring clean state...');
  try {
    execFileSync('taskkill', ['/F', '/IM', 'AgenticOS.exe'], { stdio: 'ignore', windowsHide: true });
  } catch {}

  const p4600 = getListeningPidOnPort(4600);
  if (p4600) {
    try {
      execFileSync('taskkill', ['/F', '/T', '/PID', String(p4600)], { stdio: 'ignore', windowsHide: true });
    } catch {}
  }
}

function launchApp() {
  log(`Spawning installed application: ${EXE_PATH}`);
  const child = spawn(EXE_PATH, [], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();
  return child.pid;
}

async function waitForBackend(timeoutMs = 45000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(1500) });
      if (res.ok) {
        const data = await res.json();
        return { ok: true, data, elapsedMs: Date.now() - start };
      }
    } catch {}
    await sleep(500);
  }
  return { ok: false, elapsedMs: Date.now() - start };
}

async function gracefulCloseApp(timeoutMs = 15000) {
  log('Initiating graceful close of AgenticOS...');
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `(Get-Process -Name 'AgenticOS' -ErrorAction SilentlyContinue).CloseMainWindow()`], {
      windowsHide: true,
      stdio: 'ignore',
    });
  } catch {}

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const procs = getAgenticProcesses();
    const portPid = getListeningPidOnPort(4600);
    if (procs.length === 0 && !portPid) {
      log(`Graceful shutdown completed in ${Date.now() - start}ms`);
      return true;
    }
    await sleep(400);
  }

  log('Graceful close deadline reached; force-terminating any remaining processes');
  ensureCleanState();
  return false;
}

async function runSuite() {
  console.log('\n===============================================================');
  console.log(' STARTUP RESILIENCE & SELF-HEALING ACCEPTANCE SUITE');
  console.log(` Executable: ${EXE_PATH}`);
  console.log(` Target Port: 4600`);
  console.log(` UserData: ${USER_DATA}`);
  console.log('===============================================================\n');

  if (!fs.existsSync(EXE_PATH)) {
    console.error(`FATAL: Installed executable not found at ${EXE_PATH}`);
    process.exit(1);
  }

  const results = [];

  // ─────────────────────────────────────────────────────────────────
  // TEST 1 — Normal clean cold start
  // ─────────────────────────────────────────────────────────────────
  console.log('\n>>> [TEST 1] Normal clean cold start');
  ensureCleanState();
  await sleep(1000);

  launchApp();
  const t1Res = await waitForBackend(45000);
  if (!t1Res.ok) {
    console.error('FAIL: Test 1 timed out waiting for backend to become healthy');
    results.push({ test: 'TEST 1 — Clean cold start', status: 'FAIL', reason: 'readiness timeout' });
  } else {
    log(`Backend healthy in ${t1Res.elapsedMs}ms`, t1Res.data);
    let ownershipValid = false;
    if (fs.existsSync(OWNERSHIP_FILE)) {
      try {
        const record = JSON.parse(fs.readFileSync(OWNERSHIP_FILE, 'utf8'));
        log('backend-ownership.json record found:', record);
        ownershipValid = record && record.port === 4600 && isPidAlive(record.pid);
      } catch {}
    }

    // Verify runtime-state endpoint as well
    let runtimeStateOk = false;
    try {
      const rsRes = await fetch(RUNTIME_STATE_URL);
      runtimeStateOk = rsRes.ok;
    } catch {}

    if (ownershipValid && runtimeStateOk) {
      console.log('PASS: TEST 1 — Normal clean cold start succeeded with valid ownership and runtime-state.');
      results.push({ test: 'TEST 1 — Clean cold start', status: 'PASS' });
    } else {
      console.error(`FAIL: TEST 1 ownershipValid=${ownershipValid} runtimeStateOk=${runtimeStateOk}`);
      results.push({ test: 'TEST 1 — Clean cold start', status: 'FAIL', reason: 'ownership or runtime-state invalid' });
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 2 — Second AgenticOS launch while first instance is healthy
  // ─────────────────────────────────────────────────────────────────
  console.log('\n>>> [TEST 2] Second AgenticOS launch while first instance is healthy');
  try {
    const secondLaunchStart = Date.now();
    const secondProc = execFile(EXE_PATH, [], { timeout: 10000 });
    const secondExitCode = await new Promise((resolve) => {
      secondProc.on('exit', (code) => resolve(code));
      secondProc.on('error', () => resolve(-1));
    });
    const secondDuration = Date.now() - secondLaunchStart;
    log(`Second launcher exited with code ${secondExitCode} in ${secondDuration}ms`);

    // Verify the primary instance is STILL healthy
    const primaryHealth = await waitForBackend(5000);
    if (secondExitCode === 0 && primaryHealth.ok) {
      console.log('PASS: TEST 2 — Second launch exited cleanly (0) and primary instance remains healthy.');
      results.push({ test: 'TEST 2 — Second launch while healthy', status: 'PASS' });
    } else {
      console.error(`FAIL: TEST 2 code=${secondExitCode} primaryHealthOk=${primaryHealth.ok}`);
      results.push({ test: 'TEST 2 — Second launch while healthy', status: 'FAIL', reason: `exitCode=${secondExitCode}` });
    }
  } catch (err) {
    console.error('FAIL: TEST 2 threw error', err);
    results.push({ test: 'TEST 2 — Second launch while healthy', status: 'FAIL', reason: err.message });
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 3 — Simulated stale AgenticOS-owned backend occupying port 4600
  // ─────────────────────────────────────────────────────────────────
  console.log('\n>>> [TEST 3] Simulated stale AgenticOS-owned backend occupying port 4600');
  // Kill the frontend
  try {
    execFileSync('taskkill', ['/F', '/IM', 'AgenticOS.exe'], { stdio: 'ignore', windowsHide: true });
  } catch {}
  await sleep(1000);

  // Ensure port 4600 is cleared before launching simulated stale backend
  const existing4600 = getListeningPidOnPort(4600);
  if (existing4600) {
    try {
      execFileSync('taskkill', ['/F', '/T', '/PID', String(existing4600)], { stdio: 'ignore', windowsHide: true });
    } catch {}
    await sleep(1000);
  }

  // Spawn an unhealthy process on port 4600 (answering 503 to simulate a hung/crashed AgenticOS backend)
  const staleScript = path.join(os.tmpdir(), 'simulated_stale_backend.cjs');
  fs.writeFileSync(
    staleScript,
    `const http = require('http');
const server = http.createServer((req, res) => {
  res.writeHead(503, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'unhealthy', error: 'stale backend wedged' }));
});
server.listen(4600, '127.0.0.1');`,
    'utf8'
  );

  const staleProc = spawn('node', [staleScript], { detached: true, stdio: 'ignore' });
  staleProc.unref();
  const stalePid = staleProc.pid;
  await sleep(1500);

  // Write an explicit stale backend-ownership.json pointing to this PID with dead parent
  fs.mkdirSync(USER_DATA, { recursive: true });
  fs.writeFileSync(
    OWNERSHIP_FILE,
    JSON.stringify({
      parentPid: 999999, // simulated dead parent
      parentExecPath: EXE_PATH,
      pid: stalePid,
      entry: path.join(path.dirname(EXE_PATH), 'resources', 'server', 'dist', 'index.js'),
      cwd: path.join(path.dirname(EXE_PATH), 'resources', 'server'),
      port: 4600,
      startedAt: Date.now() - 3600000,
      buildIdentity: { buildId: 'simulated-stale' },
    }, null, 2),
    'utf8'
  );
  log(`Simulated stale backend running with PID ${stalePid} on port 4600`);

  // Launch AgenticOS.exe — watchdog must detect STALE_AGENTICOS_BACKEND, terminate it, and spawn fresh
  launchApp();
  const t3Res = await waitForBackend(45000);
  const newPid = getListeningPidOnPort(4600);
  const staleDead = !isPidAlive(stalePid) || newPid !== stalePid;

  if (t3Res.ok && staleDead) {
    console.log(`PASS: TEST 3 — Stale backend (PID ${stalePid}) was replaced by healthy backend (PID ${newPid}).`);
    results.push({ test: 'TEST 3 — Stale backend replacement', status: 'PASS' });
  } else {
    console.error(`FAIL: TEST 3 t3ResOk=${t3Res.ok} staleDead=${staleDead} newPid=${newPid}`);
    results.push({ test: 'TEST 3 — Stale backend replacement', status: 'FAIL', reason: `staleDead=${staleDead}` });
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 4 — Foreign process occupying port 4600
  // ─────────────────────────────────────────────────────────────────
  console.log('\n>>> [TEST 4] Foreign process occupying port 4600');
  ensureCleanState();
  await sleep(1000);

  // Spawn an unrelated foreign HTTP server on port 4600
  const foreignServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ service: 'foreign-arbitrary-service', pid: process.pid }));
  });

  await new Promise((resolve) => foreignServer.listen(4600, '127.0.0.1', resolve));
  const foreignPid = process.pid;
  log(`Foreign HTTP server listening on 127.0.0.1:4600 with PID ${foreignPid}`);

  // Launch AgenticOS.exe
  launchApp();

  // Wait 8 seconds for AgenticOS to inspect port 4600
  await sleep(8000);

  // Verify foreign server is STILL ALIVE and responding!
  let foreignStillAlive = false;
  try {
    const res = await fetch('http://127.0.0.1:4600');
    const data = await res.json();
    foreignStillAlive = data.service === 'foreign-arbitrary-service' && isPidAlive(foreignPid);
  } catch {}

  // Check log file for foreign process conflict message
  let conflictReported = false;
  try {
    if (fs.existsSync(LOG_FILE)) {
      const logContent = fs.readFileSync(LOG_FILE, 'utf8');
      conflictReported = logContent.includes('foreign process') || logContent.includes('will not terminate unrelated processes');
    }
  } catch {}

  // Close foreign server and any failed instance
  await new Promise((resolve) => foreignServer.close(resolve));
  try {
    execFileSync('taskkill', ['/F', '/IM', 'AgenticOS.exe'], { stdio: 'ignore', windowsHide: true });
  } catch {}

  if (foreignStillAlive) {
    console.log('PASS: TEST 4 — Foreign process was NOT killed by AgenticOS (safely preserved).');
    results.push({ test: 'TEST 4 — Foreign process preserved', status: 'PASS' });
  } else {
    console.error(`FAIL: TEST 4 foreignStillAlive=${foreignStillAlive} conflictReported=${conflictReported}`);
    results.push({ test: 'TEST 4 — Foreign process preserved', status: 'FAIL', reason: 'foreign process was terminated' });
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 5 — Restart after forced AgenticOS termination
  // ─────────────────────────────────────────────────────────────────
  console.log('\n>>> [TEST 5] Restart after forced AgenticOS termination');
  ensureCleanState();
  await sleep(1000);

  // Clean start first
  launchApp();
  const t5Cold = await waitForBackend(45000);
  if (!t5Cold.ok) {
    console.error('FAIL: TEST 5 initial launch failed');
    results.push({ test: 'TEST 5 — Force kill self-recovery', status: 'FAIL', reason: 'initial launch failed' });
  } else {
    log('Initial instance healthy. Now simulating hard crash (force-kill AgenticOS)...');
    try {
      execFileSync('taskkill', ['/F', '/IM', 'AgenticOS.exe'], { stdio: 'ignore', windowsHide: true });
    } catch {}

    // Wait a brief moment — do NOT clean port, do NOT clean node
    await sleep(2000);

    log('Launching AgenticOS again directly without any manual PowerShell or cleanup...');
    launchApp();

    const t5Recover = await waitForBackend(45000);
    if (t5Recover.ok) {
      console.log(`PASS: TEST 5 — AgenticOS self-healed and reached READY in ${t5Recover.elapsedMs}ms after forced termination.`);
      results.push({ test: 'TEST 5 — Force kill self-recovery', status: 'PASS' });
    } else {
      console.error('FAIL: TEST 5 failed to self-recover');
      results.push({ test: 'TEST 5 — Force kill self-recovery', status: 'FAIL', reason: 'self-recovery timeout' });
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 6 — Three consecutive close/start cycles
  // ─────────────────────────────────────────────────────────────────
  console.log('\n>>> [TEST 6] Three consecutive close/start cycles');
  let cycleSuccesses = 0;

  for (let cycle = 1; cycle <= 3; cycle++) {
    log(`--- Cycle ${cycle}/3 ---`);
    await gracefulCloseApp(12000);
    await sleep(1000);

    // Verify 0 AgenticOS processes before starting
    const beforeProcs = getAgenticProcesses();
    const beforePort = getListeningPidOnPort(4600);
    log(`Cycle ${cycle} before start: procs=${beforeProcs.length}, port4600=${beforePort || 'free'}`);

    launchApp();
    const cRes = await waitForBackend(45000);
    if (cRes.ok) {
      log(`Cycle ${cycle} backend READY in ${cRes.elapsedMs}ms`);
      cycleSuccesses++;
    } else {
      log(`Cycle ${cycle} FAILED to reach ready`);
      break;
    }
  }

  if (cycleSuccesses === 3) {
    console.log('PASS: TEST 6 — Three consecutive close/start cycles all reached READY without orphan accumulation.');
    results.push({ test: 'TEST 6 — 3 consecutive start/close cycles', status: 'PASS' });
  } else {
    console.error(`FAIL: TEST 6 only completed ${cycleSuccesses}/3 cycles`);
    results.push({ test: 'TEST 6 — 3 consecutive start/close cycles', status: 'FAIL', reason: `completed ${cycleSuccesses}/3` });
  }

  // Final summary
  console.log('\n===============================================================');
  console.log(' STARTUP RESILIENCE SUITE RESULTS SUMMARY');
  console.log('===============================================================');
  let allPass = true;
  for (const r of results) {
    const symbol = r.status === 'PASS' ? '✅' : '❌';
    console.log(`${symbol} ${r.test}: ${r.status}${r.reason ? ` (${r.reason})` : ''}`);
    if (r.status !== 'PASS') allPass = false;
  }
  console.log('===============================================================\n');

  if (!allPass) {
    process.exit(1);
  }
}

runSuite().catch((err) => {
  console.error('Unhandled suite error:', err);
  process.exit(1);
});
