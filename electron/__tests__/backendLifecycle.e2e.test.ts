// @vitest-environment node
/**
 * Backend lifecycle manager — REAL-PROCESS E2E (backend lifecycle milestone).
 *
 * No mocks: the manager runs with its real dependencies (httpHealthProbe +
 * node spawn) against a miniature backend fixture on throwaway ports. These
 * tests exercise the exact code paths the Electron app uses in production:
 * adoption, spawn, readiness, crash recovery, crash-loop protection,
 * port-conflict detection, EXTERNAL semantics, restart, graceful shutdown.
 *
 * Fixture: electron/__tests__/fixtures/mini-backend.mjs
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createBackendLifecycleManager,
  httpHealthProbe,
  readPortFromServerEnv,
  spawnBackendWithElectronNode,
  type BackendLifecycleManager,
  type BackendLifecycleState,
  type LifecycleConfig,
} from '../backendLifecycle';

const FIXTURE = path.join(__dirname, 'fixtures', 'mini-backend.mjs');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lifecycle-e2e-'));

/** Processes the test itself spawned outside the manager (cleanup net). */
const strays: ChildProcess[] = [];
const managers: BackendLifecycleManager[] = [];

afterAll(async () => {
  for (const m of managers) { try { await m.shutdown(); } catch { /* ignore */ } }
  for (const c of strays) { try { c.kill('SIGKILL'); } catch { /* ignore */ } }
  await new Promise((r) => setTimeout(r, 250));
  fs.rmSync(TMP, { recursive: true, force: true });
});

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

interface HarnessOpts {
  port: number;
  fixtureMode: string;
  extraEnv?: Record<string, string>;
  config?: Partial<LifecycleConfig>;
}

function makeManager(o: HarnessOpts): BackendLifecycleManager {
  const config: LifecycleConfig = {
    mode: 'AUTO_MANAGED',
    host: '127.0.0.1',
    port: o.port,
    entry: FIXTURE,
    cwd: TMP,
    nodeExec: process.execPath,
    // NOTE: no PORT here on purpose — this mirrors electron/main.ts which
    // passes process.env as-is. The spawned backend must get its port from
    // the spawnBackendWithElectronNode PORT pin (regression: the lifecycle
    // previously never pinned PORT, so the backend bound server/.env's port
    // while the lifecycle probed config.port).
    env: { ...process.env, E2E_MODE: o.fixtureMode, ...(o.extraEnv || {}) },
    healthPath: '/api/health',
    healthProbeTimeoutMs: 1500,
    readinessPollMs: 100,
    readyTimeoutMs: 8000,
    healthIntervalMs: 400,
    maxRestarts: 3,
    backoffMs: [300, 300, 300],
    crashThreshold: 3,
    crashWindowMs: 60_000,
    unhealthyTolerance: 3,
    logFile: null,
    ...(o.config || {}),
  };
  const manager = createBackendLifecycleManager(config, {
    probe: httpHealthProbe,
    spawnBackend: spawnBackendWithElectronNode,
  });
  managers.push(manager);
  return manager;
}

async function waitFor(
  manager: BackendLifecycleManager,
  predicate: (s: BackendLifecycleState) => boolean,
  timeoutMs = 15_000
): Promise<BackendLifecycleState> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const state = manager.getState();
    if (predicate(state)) return state;
    if (Date.now() > deadline) {
      throw new Error(`waitFor timed out. Last state: ${JSON.stringify(state)}`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

function spawnFixture(port: number, mode: string, extraEnv: Record<string, string> = {}): ChildProcess {
  const child = spawn(process.execPath, [FIXTURE], {
    cwd: TMP,
    env: { ...process.env, PORT: String(port), E2E_MODE: mode, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  strays.push(child);
  return child;
}

async function probe(port: number) {
  return httpHealthProbe(`http://127.0.0.1:${port}/api/health`, 1500);
}

/* ── Scenario 21: normal start from nothing listening ──────────────── */

describe('E2E real-process lifecycle', () => {
  it('spawns the backend when nothing listens, becomes READY on health, shuts down clean', async () => {
    const port = await freePort();
    const manager = makeManager({ port, fixtureMode: 'healthy' });

    await manager.start();
    const ready = await waitFor(manager, (s) => s.status === 'ready');
    expect(ready.owned).toBe(true);
    expect(ready.pid).toBeTypeOf('number');
    expect(ready.readinessMs).toBeTypeOf('number');
    expect(ready.restartCount).toBe(0);

    // The health endpoint really answers (independent verification).
    const real = await probe(port);
    expect(real.healthy).toBe(true);

    // Graceful shutdown kills the owned backend — no orphan listener.
    await manager.shutdown();
    await new Promise((r) => setTimeout(r, 300));
    const after = await probe(port);
    expect(after.healthy).toBe(false);
    expect(after.reachable).toBe(false);
    expect(manager.getState().status).toBe('offline');
  }, 30_000);

  /* ── Scenario 22: already-running backend is adopted, never duplicated ── */

  it('adopts a healthy existing backend and does not kill it on shutdown', async () => {
    const port = await freePort();
    const external = spawnFixture(port, 'healthy');
    await waitForProbeHealthy(port);

    const manager = makeManager({ port, fixtureMode: 'healthy' });
    await manager.start();
    const ready = await waitFor(manager, (s) => s.status === 'ready');
    expect(ready.owned).toBe(false);
    expect(ready.pid).toBeNull();

    // Shutdown must leave the adopted backend untouched.
    await manager.shutdown();
    await new Promise((r) => setTimeout(r, 300));
    const after = await probe(port);
    expect(after.healthy).toBe(true);
    external.kill('SIGKILL');
  }, 30_000);

  /* ── Scenario 23: crash recovery (crash once → auto-restart → READY) ── */

  it('recovers from a crash: reconnecting → bounded restart → READY', async () => {
    const port = await freePort();
    const marker = path.join(TMP, `crash-marker-${port}`);
    const manager = makeManager({
      port,
      fixtureMode: 'exit-once',
      extraEnv: { E2E_STATE_FILE: marker },
    });

    const seenReconnecting = new Promise<void>((resolve) => {
      const off = manager.onStateChange((s) => {
        if (s.status === 'reconnecting') { resolve(); off(); }
      });
    });

    await manager.start();
    await seenReconnecting; // first spawn crashed, manager entered reconnecting
    const ready = await waitFor(manager, (s) => s.status === 'ready', 20_000);
    expect(ready.restartCount).toBe(1);
    expect(ready.owned).toBe(true);
    expect((await probe(port)).healthy).toBe(true);
    await manager.shutdown();
  }, 40_000);

  /* ── Scenario 24: crash-loop protection stops auto-restart ─────────── */

  it('crash-loop protection: repeated immediate crashes → FAILED with stderr tail', async () => {
    const port = await freePort();
    const manager = makeManager({
      port,
      fixtureMode: 'exit-fast',
      config: { crashThreshold: 3, backoffMs: [200, 200, 200], maxRestarts: 5 },
    });

    await manager.start();
    const failed = await waitFor(manager, (s) => s.status === 'failed', 20_000);
    expect(failed.lastError).toMatch(/crashed 3 times/i);
    // stderr captured AND redacted (fixture prints a fake api_key line).
    expect(failed.recentLog.join('\n')).toMatch(/simulated startup crash/);
    expect(failed.recentLog.join('\n')).toContain('api_key=[REDACTED]');
    expect(failed.recentLog.join('\n')).not.toMatch(/abcd123/);

    // FAILED is terminal: the monitor never resurrects it.
    await new Promise((r) => setTimeout(r, 1500));
    expect(manager.getState().status).toBe('failed');

    // User Retry resets the budget (still crashes → fails again, proving the
    // retry path re-armed the machine rather than being a no-op).
    const retry = manager.retry();
    expect(retry.ok).toBe(true);
    await waitFor(manager, (s) => s.status === 'failed', 20_000);
    expect(manager.getState().status).toBe('failed');
  }, 60_000);

  /* ── Scenario 25: port conflict (occupied, not healthy) → FAILED ───── */

  it('port conflict: reachable-but-unhealthy occupant → FAILED, no second spawn', async () => {
    const port = await freePort();
    const squatter = spawnFixture(port, 'unhealthy');
    await new Promise((r) => setTimeout(r, 500)); // listener up

    const manager = makeManager({ port, fixtureMode: 'healthy' });
    await manager.start();
    const failed = await waitFor(manager, (s) => s.status === 'failed');
    expect(failed.lastError).toMatch(/occupied/i);
    expect(failed.owned).toBe(false);
    expect(failed.pid).toBeNull();
    // Nothing else bound the port behind our back.
    squatter.kill('SIGKILL');
  }, 30_000);

  /* ── Scenario 26: EXTERNAL mode never spawns, reports truthfully ───── */

  it('EXTERNAL mode: offline while absent, never spawns, flips READY when backend appears', async () => {
    const port = await freePort();
    const manager = makeManager({ port, fixtureMode: 'healthy', config: { mode: 'EXTERNAL' } });

    await manager.start();
    const offline = await waitFor(manager, (s) => s.status === 'offline');
    expect(offline.lastError).toMatch(/external/i);

    const restart = manager.restart();
    expect(restart.ok).toBe(false);
    expect(restart.reason).toMatch(/EXTERNAL/);

    // Backend appears externally → monitor flips to READY without spawning.
    const external = spawnFixture(port, 'healthy');
    const ready = await waitFor(manager, (s) => s.status === 'ready', 10_000);
    expect(ready.owned).toBe(false);
    expect(ready.pid).toBeNull();

    await manager.shutdown(); // must NOT kill the external process
    await new Promise((r) => setTimeout(r, 300));
    expect((await probe(port)).healthy).toBe(true);
    external.kill('SIGKILL');
  }, 40_000);

  /* ── Scenario 27: readiness timeout kills a hung backend ───────────── */

  it('readiness timeout: alive-but-never-listening → FAILED and process killed', async () => {
    const port = await freePort();
    const manager = makeManager({
      port,
      fixtureMode: 'never-ready',
      config: { readyTimeoutMs: 2000, readinessPollMs: 150 },
    });

    await manager.start();
    const failed = await waitFor(manager, (s) => s.status === 'failed', 10_000);
    expect(failed.lastError).toMatch(/did not become healthy/i);
    // The hung fixture was killed by the manager (port stays free).
    await new Promise((r) => setTimeout(r, 400));
    expect((await probe(port)).reachable).toBe(false);
  }, 30_000);

  /* ── restart(): owned recycle with fresh PID, adopted refusal ──────── */

  it('restart() recycles an owned backend (new PID, fresh budget) and refuses for adopted', async () => {
    const port = await freePort();
    const manager = makeManager({ port, fixtureMode: 'healthy' });
    await manager.start();
    const first = await waitFor(manager, (s) => s.status === 'ready');
    expect(first.owned).toBe(true);

    const res = manager.restart();
    expect(res.ok).toBe(true);
    const second = await waitFor(manager, (s) => s.status === 'ready' && s.pid !== first.pid, 15_000);
    expect(second.restartCount).toBe(0); // user restart resets the budget
    expect((await probe(port)).healthy).toBe(true);
    await manager.shutdown();
  }, 40_000);

  /* ── config helper sanity ─────────────────────────────────────────── */

  it('readPortFromServerEnv honors server/.env PORT', () => {
    // The helper must reflect whatever server/.env actually pins. The
    // canonical port is 4000: renderer file: fallback (src/api/client.ts),
    // server index.ts fallback, and electron/main.ts default all agree.
    const repoRoot = path.resolve(__dirname, '..', '..');
    const envPath = path.join(repoRoot, 'server', '.env');
    let expected = 4000;
    try {
      const text = fs.readFileSync(envPath, 'utf8');
      const m = text.match(/^\s*PORT\s*=\s*(\d+)\s*$/m);
      if (m) expected = parseInt(m[1], 10);
    } catch { /* missing .env → fallback */ }
    expect(readPortFromServerEnv(repoRoot, 4000)).toBe(expected);
    expect(readPortFromServerEnv(path.join(TMP, 'no-such-dir'), 4000)).toBe(4000);
  });

  it('Electron lifecycle and the production renderer resolve the SAME endpoint (canonical 4000)', () => {
    // The renderer (src/api/client.ts) falls back to http://localhost:4000/api
    // under the file: protocol. The lifecycle must resolve the same port from
    // the real server/.env — otherwise Electron starts the backend on a port
    // the renderer never polls ("Backend Disconnected").
    const repoRoot = path.resolve(__dirname, '..', '..');
    const envPath = path.join(repoRoot, 'server', '.env');
    const text = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    const m = text.match(/^PORT\s*=\s*(\d+)\s*$/m);
    const envPort = m ? parseInt(m[1], 10) : 4000;
    expect(envPort).toBe(4000);
    expect(readPortFromServerEnv(repoRoot, 4000)).toBe(4000);
  });
});

async function waitForProbeHealthy(port: number): Promise<void> {
  const deadline = Date.now() + 8000;
  for (;;) {
    const p = await probe(port);
    if (p.healthy) return;
    if (Date.now() > deadline) throw new Error('fixture backend did not become healthy');
    await new Promise((r) => setTimeout(r, 100));
  }
}
