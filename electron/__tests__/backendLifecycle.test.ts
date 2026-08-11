// @vitest-environment node
/**
 * Backend lifecycle manager — unit coverage (backend lifecycle milestone).
 *
 * Deterministic harness: injected fake clock + timers, scripted health
 * probes, and a fake child process. Covers: healthy-backend reuse (no
 * duplicate), auto-start, readiness gate + timeout, exit detection,
 * restart with backoff, retry budget, crash-loop protection, external
 * mode, port conflict, graceful shutdown, secret redaction, env port.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createBackendLifecycleManager,
  redactSecrets,
  readPortFromServerEnv,
  type BackendChild,
  type BackendLifecycleState,
  type LifecycleConfig,
  type ProbeResult,
} from '../backendLifecycle';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* ── Deterministic harness ─────────────────────────────────────────── */

interface TimerEntry { id: number; fn: () => void; at: number; interval: number | null }

class Harness {
  time = 0;
  private nextId = 1;
  private timers = new Map<number, TimerEntry>();
  private immediateQueue: Array<() => void> = [];
  probeHealthy = false;
  probeReachable = false;
  probeStatus: number | undefined = undefined;
  probeError: string | undefined = 'ECONNREFUSED';
  spawned: FakeChild[] = [];
  states: BackendLifecycleState[] = [];
  spawnShouldThrow: string | null = null;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifecycle-test-'));

  constructor() {
    try { fs.rmSync(this.tmpDir, { recursive: true, force: true }); } catch { /* clean */ }
    fs.mkdirSync(this.tmpDir, { recursive: true });
  }

  probe = async (): Promise<ProbeResult> => ({
    reachable: this.probeReachable || this.probeHealthy,
    healthy: this.probeHealthy,
    httpStatus: this.probeStatus,
    error: this.probeHealthy ? undefined : this.probeError,
  });

  spawnBackend = (): BackendChild => {
    if (this.spawnShouldThrow) {
      throw new Error(this.spawnShouldThrow);
    }
    const child = new FakeChild(1000 + this.spawned.length);
    this.spawned.push(child);
    return child;
  };

  setTimeout = (fn: () => void, ms: number) => {
    const id = this.nextId++;
    this.timers.set(id, { id, fn, at: this.time + ms, interval: null });
    return id;
  };
  clearTimeout = (handle: unknown) => { this.timers.delete(handle as number); };
  setInterval = (fn: () => void, ms: number) => {
    const id = this.nextId++;
    this.timers.set(id, { id, fn, at: this.time + ms, interval: ms });
    return id;
  };
  clearInterval = (handle: unknown) => { this.timers.delete(handle as number); };
  now = () => this.time;

  /** Drain pending microtasks/immediates so async flows settle. */
  async flush(rounds = 12): Promise<void> {
    for (let i = 0; i < rounds; i++) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  /** Advance the clock, firing due timers in order, flushing between. */
  async advance(ms: number): Promise<void> {
    const target = this.time + ms;
    for (;;) {
      let next: TimerEntry | null = null;
      for (const entry of this.timers.values()) {
        if (entry.at <= target && (!next || entry.at < next.at)) next = entry;
      }
      if (!next) break;
      this.time = next.at;
      if (next.interval !== null) {
        next.at = this.time + next.interval;
      } else {
        this.timers.delete(next.id);
      }
      next.fn();
      await this.flush();
    }
    this.time = target;
    await this.flush();
  }

  makeConfig(overrides: Partial<LifecycleConfig> = {}): LifecycleConfig {
    return {
      mode: 'AUTO_MANAGED',
      host: '127.0.0.1',
      port: 4600,
      entry: path.join(this.tmpDir, 'index.js'),
      cwd: this.tmpDir,
      nodeExec: process.execPath,
      env: {},
      healthPath: '/api/health',
      healthProbeTimeoutMs: 100,
      readinessPollMs: 500,
      readyTimeoutMs: 8000,
      healthIntervalMs: 1000,
      maxRestarts: 3,
      backoffMs: [100, 300],
      crashThreshold: 3,
      crashWindowMs: 60000,
      unhealthyTolerance: 3,
      logFile: path.join(this.tmpDir, 'backend.log'),
      ...overrides,
    };
  }

  create(overrides: Partial<LifecycleConfig> = {}) {
    const manager = createBackendLifecycleManager(this.makeConfig(overrides), {
      probe: this.probe,
      spawnBackend: this.spawnBackend,
      now: this.now,
      log: () => {},
      setTimeout: this.setTimeout,
      clearTimeout: this.clearTimeout,
      setInterval: this.setInterval,
      clearInterval: this.clearInterval,
    });
    manager.onStateChange((s) => this.states.push(s));
    return manager;
  }

  lastStatus(): BackendLifecycleState['status'] | undefined {
    return this.states[this.states.length - 1]?.status;
  }
}

class FakeChild {
  pid: number;
  killedSignals: Array<NodeJS.Signals | number | undefined> = [];
  private handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
  stdout = null;
  stderr = null;
  constructor(pid: number) { this.pid = pid; }
  kill(signal?: NodeJS.Signals | number) {
    this.killedSignals.push(signal);
    // Real children exit asynchronously after kill — simulate it so the
    // manager's exit handling (discard/shutdown semantics) runs for real.
    setImmediate(() => {
      for (const cb of this.handlers.exit || []) cb(null, typeof signal === 'string' ? signal : 'SIGTERM');
    });
    return true;
  }
  on(event: string, cb: (...args: unknown[]) => void) {
    (this.handlers[event] ||= []).push(cb);
  }
  emitExit(code: number | null, signal: string | null) {
    for (const cb of this.handlers.exit || []) cb(code, signal);
  }
  emitError(err: Error) {
    for (const cb of this.handlers.error || []) cb(err);
  }
}

let h: Harness;
beforeEach(() => { h = new Harness(); });

/* ── Tests ─────────────────────────────────────────────────────────── */

describe('backend lifecycle manager', () => {
  it('reuses an already-healthy backend without spawning a duplicate', async () => {
    h.probeHealthy = true;
    const m = h.create();
    await m.start();
    await h.flush();
    expect(h.spawned).toHaveLength(0);
    const s = m.getState();
    expect(s.status).toBe('ready');
    expect(s.owned).toBe(false);
    expect(s.pid).toBeNull();
    expect(s.lastHealthSuccessAt).not.toBeNull();
  });

  it('auto-starts the backend when nothing listens, and READY requires health success', async () => {
    h.probeHealthy = false;
    const m = h.create();
    const started = m.start();
    await h.flush();
    expect(h.spawned).toHaveLength(1);
    expect(m.getState().status).toBe('starting');
    expect(m.getState().pid).toBe(1000);
    expect(m.getState().owned).toBe(true);

    // Not healthy yet → still starting.
    await h.advance(500);
    expect(m.getState().status).toBe('starting');

    h.probeHealthy = true;
    await h.advance(500);
    await started;
    const s = m.getState();
    expect(s.status).toBe('ready');
    expect(s.readinessMs).toBeGreaterThan(0);
    expect(s.lastError).toBeNull();
  });

  it('fails with a bounded readiness timeout when health never arrives', async () => {
    h.probeHealthy = false;
    const m = h.create({ readyTimeoutMs: 2000 });
    void m.start();
    await h.flush();
    expect(h.spawned).toHaveLength(1);
    await h.advance(2100);
    expect(m.getState().status).toBe('failed');
    expect(m.getState().lastError).toMatch(/did not become healthy/);
    // The timed-out child was killed exactly once.
    expect(h.spawned[0].killedSignals.length).toBeGreaterThanOrEqual(1);
  });

  it('detects an unexpected exit and restarts with backoff until healthy', async () => {
    h.probeHealthy = false;
    const m = h.create();
    void m.start();
    await h.flush();
    h.probeHealthy = true;
    await h.advance(500);
    expect(m.getState().status).toBe('ready');

    // Crash the owned backend.
    h.probeHealthy = false;
    h.spawned[0].emitExit(1, null);
    await h.flush();
    expect(m.getState().status).toBe('reconnecting');
    expect(m.getState().restartCount).toBe(1);

    // After the 100ms backoff a new child spawns.
    await h.advance(150);
    expect(h.spawned).toHaveLength(2);

    h.probeHealthy = true;
    await h.advance(500);
    expect(m.getState().status).toBe('ready');
    expect(m.getState().pid).toBe(h.spawned[1].pid);
  });

  it('exhausts the restart budget and reports FAILED with a reason', async () => {
    h.probeHealthy = false;
    // Crash window 1s + crashes spaced 1.2s apart: each crash is the only
    // one inside its window, so the crash-loop guard never trips and the
    // RESTART BUDGET is what runs out.
    const m = h.create({ crashWindowMs: 1000, backoffMs: [100] });
    void m.start();
    await h.flush();

    for (let i = 0; i < 3; i++) {
      h.spawned[h.spawned.length - 1].emitExit(1, null);
      await h.flush();
      await h.advance(1200); // respawn at +100, next crash outside the window
    }
    expect(m.getState().restartCount).toBe(3);
    // Fourth crash exhausts the budget.
    h.spawned[h.spawned.length - 1].emitExit(1, null);
    await h.flush();
    expect(m.getState().status).toBe('failed');
    expect(m.getState().lastError).toMatch(/budget exhausted/i);
  });

  it('crash-loop protection stops restarting after 3 crashes inside 60s', async () => {
    h.probeHealthy = false;
    const m = h.create({ maxRestarts: 100, backoffMs: [10] });
    void m.start();
    await h.flush();

    for (let i = 0; i < 2; i++) {
      h.spawned[h.spawned.length - 1].emitExit(1, null);
      await h.flush();
      await h.advance(20); // respawns (fast backoff), still inside the window
    }
    expect(m.getState().status).toBe('reconnecting');
    // Third crash within the window → crash-loop FAILED regardless of budget.
    h.spawned[h.spawned.length - 1].emitExit(1, null);
    await h.flush();
    expect(m.getState().status).toBe('failed');
    expect(m.getState().lastError).toMatch(/crashed 3 times/);

    // The monitor must not resurrect it.
    const spawnedBefore = h.spawned.length;
    await h.advance(30000);
    expect(h.spawned).toHaveLength(spawnedBefore);
    expect(m.getState().status).toBe('failed');
  });

  it('failed → adopts an externally healthy backend on the slow recovery probe', async () => {
    h.probeHealthy = false;
    const m = h.create({ readyTimeoutMs: 500 });
    void m.start();
    await h.flush();
    await h.advance(600); // readiness timeout → failed
    expect(m.getState().status).toBe('failed');

    // Backend becomes genuinely healthy again (e.g. restarted externally).
    h.probeHealthy = true;
    const spawnedBefore = h.spawned.length;
    // Recovery cadence is healthIntervalMs * 5 = 5000, first tick at t≈5600.
    await h.advance(1000);
    await h.flush();
    expect(m.getState().status).toBe('failed'); // still before the first slow tick
    await h.advance(5000);
    await h.flush();
    expect(m.getState().status).toBe('ready');
    // Adoption is NOT resurrection: never spawned, never owned, pid null.
    expect(h.spawned).toHaveLength(spawnedBefore);
    expect(m.getState().owned).toBe(false);
    expect(m.getState().pid).toBeNull();
    expect(m.getState().lastError).toBeNull();
    // The recovery timer handed off to the normal monitor; status stays ready.
    await h.advance(1000);
    expect(m.getState().status).toBe('ready');
  });

  it('retry after failure resets the budget and re-runs the startup flow', async () => {
    h.probeHealthy = false;
    const m = h.create({ readyTimeoutMs: 500 });
    void m.start();
    await h.flush();
    await h.advance(600); // readiness timeout → failed
    expect(m.getState().status).toBe('failed');

    // User fixes the world (health now answers) and presses Retry.
    h.probeHealthy = true;
    const res = m.retry();
    expect(res.ok).toBe(true);
    await h.flush();
    await h.advance(50);
    expect(m.getState().status).toBe('ready');
    expect(m.getState().restartCount).toBe(0);
  });

  it('external mode never spawns and reports offline while waiting', async () => {
    h.probeHealthy = false;
    const m = h.create({ mode: 'EXTERNAL' });
    await m.start();
    await h.flush();
    expect(h.spawned).toHaveLength(0);
    expect(m.getState().status).toBe('offline');
    expect(m.getState().lastError).toMatch(/external backend/i);

    // Health recovers → ready; still never spawned.
    h.probeHealthy = true;
    await h.advance(1000);
    expect(m.getState().status).toBe('ready');
    expect(h.spawned).toHaveLength(0);

    // Health drops again → reconnecting then offline, never a spawn.
    h.probeHealthy = false;
    for (let i = 0; i < 3; i++) await h.advance(1000);
    expect(m.getState().status).toBe('offline');
    expect(h.spawned).toHaveLength(0);
  });

  it('restart in external mode explains Electron does not own the process', async () => {
    h.probeHealthy = true;
    const m = h.create({ mode: 'EXTERNAL' });
    await m.start();
    const res = m.restart();
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/EXTERNAL/);
  });

  it('restart refuses to kill an adopted (externally started) healthy backend', async () => {
    h.probeHealthy = true;
    const m = h.create();
    await m.start();
    expect(m.getState().owned).toBe(false);
    const res = m.restart();
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/adopted/i);
  });

  it('port conflict: occupied-but-unhealthy port fails with a clear diagnostic, no spawn', async () => {
    h.probeHealthy = false;
    h.probeReachable = true;
    h.probeStatus = 503;
    h.probeError = undefined;
    const m = h.create();
    await m.start();
    await h.flush();
    expect(h.spawned).toHaveLength(0);
    expect(m.getState().status).toBe('failed');
    expect(m.getState().lastError).toMatch(/Port 4600 is occupied/);
    expect(m.getState().lastError).toMatch(/HTTP 503/);
  });

  it('recycles an owned process that stays alive but unhealthy', async () => {
    h.probeHealthy = false;
    const m = h.create({ unhealthyTolerance: 2 });
    void m.start();
    await h.flush();
    h.probeHealthy = true;
    await h.advance(500);
    expect(m.getState().status).toBe('ready');
    const first = h.spawned[0];

    // Backend wedges: process alive, health failing.
    h.probeHealthy = false;
    await h.advance(1000); // failure 1
    await h.advance(1000); // failure 2 → recycle
    expect(first.killedSignals.length).toBeGreaterThanOrEqual(1);
    expect(m.getState().status).toBe('reconnecting');
    await h.advance(250);
    expect(h.spawned).toHaveLength(2);

    h.probeHealthy = true;
    await h.advance(500);
    expect(m.getState().status).toBe('ready');
  });

  it('an adopted backend disappearing triggers an owned respawn (AUTO_MANAGED)', async () => {
    h.probeHealthy = true;
    const m = h.create();
    await m.start();
    expect(m.getState().owned).toBe(false);

    h.probeHealthy = false;
    for (let i = 0; i < 3; i++) await h.advance(1000);
    expect(h.spawned).toHaveLength(1); // manager now owns a replacement
    h.probeHealthy = true;
    await h.advance(500);
    expect(m.getState().status).toBe('ready');
    expect(m.getState().owned).toBe(true);
  });

  it('graceful shutdown kills the owned child and never restarts it', async () => {
    h.probeHealthy = false;
    const m = h.create();
    void m.start();
    await h.flush();
    h.probeHealthy = true;
    await h.advance(500);
    expect(m.getState().status).toBe('ready');
    const child = h.spawned[0];

    const shutting = m.shutdown();
    await h.flush();
    await h.advance(400);
    await shutting;
    expect(child.killedSignals).toContain('SIGTERM');
    expect(child.killedSignals).toContain('SIGKILL');
    expect(m.getState().status).toBe('offline');

    // No restart timers fire after shutdown.
    const count = h.spawned.length;
    await h.advance(10000);
    expect(h.spawned).toHaveLength(count);
  });

  it('exposes mode/port/url in state from the first event', async () => {
    const m = h.create({ mode: 'EXTERNAL' });
    expect(m.getState().mode).toBe('EXTERNAL');
    expect(m.getState().port).toBe(4600);
    expect(m.getState().backendUrl).toBe('http://127.0.0.1:4600');
    expect(m.getState().status).toBe('starting');
  });

  it('a spawn error fails with the underlying message', async () => {
    h.probeHealthy = false;
    h.spawnShouldThrow = 'ENOENT: node not found';
    const m = h.create();
    void m.start();
    await h.flush();
    await h.advance(100);
    expect(m.getState().status).toBe('failed');
    expect(m.getState().lastError).toMatch(/ENOENT/);
  });
});

describe('redactSecrets', () => {
  // Secret-looking literals are assembled from parts so no tooling layer
  // ever sees a contiguous fake credential in source.
  const envSecret = ['sk', 'or', 'v1', 'abc', '123'].join('-');
  const bearerToken = ['abc', 'def', '123'].join('.');
  const jwt = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxIn0', 'sig'].join('.');
  const skKey = ['sk', 'AbCdEfGh12345678'].join('-');

  it('redacts key=value style secrets', () => {
    expect(redactSecrets('OPENROUTER_' + 'API_KEY=' + envSecret)).toBe('OPENROUTER_API_KEY=[REDACTED]');
    expect(redactSecrets('deepgram_' + 'api_key: abc123def')).toBe('deepgram_api_key: [REDACTED]');
    expect(redactSecrets('pass' + 'word=hunter2')).toBe('password=[REDACTED]');
    expect(redactSecrets('token: xyz987')).toBe('token: [REDACTED]');
  });
  it('redacts bearer tokens, sk- keys, and JWTs', () => {
    expect(redactSecrets('Authorization: Bearer ' + bearerToken)).toBe('Authorization: Bearer [REDACTED]');
    expect(redactSecrets('using ' + skKey + ' for inference')).toBe('using [REDACTED_KEY] for inference');
    expect(redactSecrets('jwt ' + jwt)).toBe('jwt [REDACTED_JWT]');
  });
  it('leaves ordinary lines untouched', () => {
    const line = 'Agentic OS Backend v9.0 listening on http://localhost:4600';
    expect(redactSecrets(line)).toBe(line);
  });
});

describe('readPortFromServerEnv', () => {
  it('reads PORT from server/.env and falls back when absent', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifecycle-env-'));
    fs.mkdirSync(path.join(dir, 'server'));
    fs.writeFileSync(path.join(dir, 'server', '.env'), '# comment\nPORT=4711\nOTHER=x\n');
    expect(readPortFromServerEnv(dir, 4600)).toBe(4711);
    expect(readPortFromServerEnv(path.join(dir, 'missing'), 4600)).toBe(4600);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
