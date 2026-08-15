/**
 * Backend lifecycle manager (Electron main-process domain).
 *
 * ONE state machine owns the truth about the AgenticOS backend:
 *
 *   modes    AUTO_MANAGED — Electron starts/adopts/monitors/restarts the backend
 *            EXTERNAL     — Electron expects an independently managed backend
 *                           (dev-clean.ps1 workflow) and never spawns one.
 *   statuses starting → ready ⇄ reconnecting → failed
 *            (EXTERNAL additionally reports offline while waiting)
 *
 * READY means GET /api/health returned success — process existence alone is
 * never enough. The manager never spawns a duplicate: it probes first and
 * ADOPTS an already-healthy backend on the configured port. If the port is
 * occupied by something that is NOT a healthy AgenticOS backend it reports a
 * port-conflict failure instead of spawning blindly.
 *
 * Restart policy (AUTO_MANAGED, owned process only):
 *   - unexpected exit → reconnecting + bounded restarts with backoff
 *   - restart budget: maxRestarts (default 3) per epoch
 *   - crash-loop protection: crashThreshold crashes inside crashWindowMs
 *     (default 3 / 60s) stop all restarting → failed + stderr tail
 *   - user Retry resets the budget; user Restart does not count against it
 *
 * The module has NO electron imports so it runs under vitest (node env) with
 * injected probe/spawn/timer dependencies.
 */
import { spawn as nodeSpawn, execFileSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export type BackendMode = 'AUTO_MANAGED' | 'EXTERNAL';
export type BackendStatus = 'starting' | 'ready' | 'reconnecting' | 'offline' | 'failed';

export interface BackendLifecycleState {
  mode: BackendMode;
  status: BackendStatus;
  backendUrl: string;
  port: number;
  /** PID of the backend process — only when Electron owns (spawned) it. */
  pid: number | null;
  /** True when Electron spawned the currently tracked backend. */
  owned: boolean;
  startedAt: number | null;
  lastHealthSuccessAt: number | null;
  lastHealthFailureAt: number | null;
  restartCount: number;
  lastError: string | null;
  /** Milliseconds from spawn to first healthy probe (last start). */
  readinessMs: number | null;
  /** Redacted tail of backend stdout/stderr (most recent last). */
  recentLog: string[];
}

export interface ProbeResult {
  /** TCP/HTTP contact succeeded (something answered). */
  reachable: boolean;
  /** The AgenticOS health endpoint answered 2xx. */
  healthy: boolean;
  httpStatus?: number;
  error?: string;
}

export interface BackendChild {
  pid: number | undefined;
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  kill: (signal?: NodeJS.Signals | number) => boolean;
  on: (event: 'exit' | 'error', cb: (...args: unknown[]) => void) => void;
}

export interface LifecycleConfig {
  mode: BackendMode;
  host: string;
  port: number;
  /** Absolute path of the backend entry (server/dist/index.js). */
  entry: string;
  /** Working directory for the child (server/). */
  cwd: string;
  /** Node-compatible executable (Electron binary + ELECTRON_RUN_AS_NODE). */
  nodeExec: string;
  env: NodeJS.ProcessEnv;
  healthPath: string;
  healthProbeTimeoutMs: number;
  readinessPollMs: number;
  readyTimeoutMs: number;
  healthIntervalMs: number;
  maxRestarts: number;
  backoffMs: number[];
  crashThreshold: number;
  crashWindowMs: number;
  /** Consecutive health failures before an owned-alive process is recycled. */
  unhealthyTolerance: number;
  logFile: string | null;
}

export interface LifecycleDeps {
  probe: (url: string, timeoutMs: number) => Promise<ProbeResult>;
  spawnBackend: (config: LifecycleConfig) => BackendChild;
  now?: () => number;
  log?: (message: string) => void;
  /** Test hook: schedule a timer (defaults to setTimeout). */
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
}

export interface LifecycleAction {
  restart: () => { ok: boolean; reason?: string };
  retry: () => { ok: boolean; reason?: string };
}

const MAX_LOG_LINES = 80;
const MAX_LINE_CHARS = 500;

/** Redact secret-looking values before any log line is stored or shown. */
export function redactSecrets(line: string): string {
  return line
    // Token-shaped values first (they can sit inside header-style lines)…
    .replace(/\bBearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED_KEY]')
    .replace(/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]+\b/g, '[REDACTED_JWT]')
    // …then header lines whose whole value is secret (values already handled
    // by the Bearer rule keep their 'Bearer [REDACTED]' form)…
    .replace(
      /([A-Za-z0-9_\-]*authorization\b\s*[:=]\s*)([^\n]+)/gi,
      (m, head: string, value: string) => (/^Bearer\s/i.test(value) ? m : `${head}[REDACTED]`)
    )
    // …then ordinary key=value secrets.
    .replace(/([A-Za-z0-9_\-]*(?:api[_-]?key|apikey|access[_-]?key|secret[_-]?key|secret|auth[_-]?token|token|password|passwd|private[_-]?key)\b)(\s*[:=]\s*)([^\s'",]+)/gi, (_m, k: string, sep: string) => `${k}${sep}[REDACTED]`);
}

export function initialState(config: LifecycleConfig): BackendLifecycleState {
  return {
    mode: config.mode,
    status: 'starting',
    backendUrl: `http://${config.host}:${config.port}`,
    port: config.port,
    pid: null,
    owned: false,
    startedAt: null,
    lastHealthSuccessAt: null,
    lastHealthFailureAt: null,
    restartCount: 0,
    lastError: null,
    readinessMs: null,
    recentLog: [],
  };
}

export interface BackendLifecycleManager extends LifecycleAction {
  start: () => Promise<void>;
  shutdown: () => Promise<void>;
  getState: () => BackendLifecycleState;
  onStateChange: (cb: (state: BackendLifecycleState) => void) => () => void;
  /** Visible for tests. */
  readonly config: LifecycleConfig;
}

export function createBackendLifecycleManager(
  config: LifecycleConfig,
  deps: LifecycleDeps
): BackendLifecycleManager {
  const now = deps.now ?? (() => Date.now());
  const setTimeoutFn = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimeoutFn = deps.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const setIntervalFn = deps.setInterval ?? ((fn, ms) => setInterval(fn, ms));
  const clearIntervalFn = deps.clearInterval ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>));
  const logLine = deps.log ?? (() => {});

  let state: BackendLifecycleState = initialState(config);
  const listeners = new Set<(state: BackendLifecycleState) => void>();

  let child: BackendChild | null = null;
  let spawnInFlight = false;
  let shuttingDown = false;
  /** Set when the manager kills a child whose exit must NOT count as a crash. */
  let discardNextExit = false;
  let readinessDeadline: unknown = null;
  let monitorTimer: unknown = null;
  let recoveryTimer: unknown = null;
  let pendingRestartTimer: unknown = null;
  let consecutiveHealthFailures = 0;
  let crashTimestamps: number[] = [];
  let userRestartPending = false;

  const healthUrl = `${state.backendUrl}${config.healthPath}`;

  function emit(patch: Partial<BackendLifecycleState>) {
    state = { ...state, ...patch };
    for (const cb of listeners) {
      try { cb(state); } catch { /* listener errors never break the machine */ }
    }
  }

  function appendLog(raw: string, stream: 'stdout' | 'stderr') {
    for (const piece of raw.split(/\r?\n/)) {
      if (!piece.trim()) continue;
      const line = redactSecrets(piece).slice(0, MAX_LINE_CHARS);
      const recent = [...state.recentLog, `[${stream}] ${line}`].slice(-MAX_LOG_LINES);
      state = { ...state, recentLog: recent };
      try {
        if (config.logFile) {
          fs.mkdirSync(path.dirname(config.logFile), { recursive: true });
          fs.appendFileSync(config.logFile, `${new Date(now()).toISOString()} [backend:${stream}] ${line}\n`, 'utf8');
        }
      } catch { /* log persistence is best-effort */ }
      logLine(`[backend:${stream}] ${line}`);
    }
  }

  function stopMonitor() {
    if (monitorTimer !== null) { clearIntervalFn(monitorTimer); monitorTimer = null; }
    if (recoveryTimer !== null) { clearIntervalFn(recoveryTimer); recoveryTimer = null; }
  }

  function startMonitor() {
    if (recoveryTimer !== null) { clearIntervalFn(recoveryTimer); recoveryTimer = null; }
    if (monitorTimer !== null) return;
    monitorTimer = setIntervalFn(() => { void healthTick(); }, config.healthIntervalMs);
  }

  async function probeOnce(): Promise<ProbeResult> {
    try {
      return await deps.probe(healthUrl, config.healthProbeTimeoutMs);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { reachable: false, healthy: false, error: message };
    }
  }

  function describeProbe(p: ProbeResult): string {
    if (p.healthy) return 'healthy';
    if (p.reachable) return `reachable but unhealthy${p.httpStatus ? ` (HTTP ${p.httpStatus})` : ''}${p.error ? ` — ${p.error}` : ''}`;
    return p.error || 'unreachable';
  }

  function killChild(): void {
    if (!child) return;
    const target = child;
    if (target.pid && process.platform === 'win32') {
      try {
        execFileSync('taskkill', ['/F', '/T', '/PID', String(target.pid)], { windowsHide: true, stdio: 'ignore' });
      } catch { /* already exited */ }
    }
    try { target.kill(); } catch { /* already gone */ }
  }

  function handleChildExit(code: number | null, signal: string | null) {
    const exited = child;
    child = null;
    emit({ pid: null });
    if (shuttingDown) {
      emit({ status: 'offline', lastError: null });
      return;
    }
    if (!exited) return;

    if (discardNextExit) {
      // A deliberate manager-initiated kill (readiness timeout, health
      // recycle, shutdown) — the caller already decided the next step.
      discardNextExit = false;
      return;
    }

    const wasUserRestart = userRestartPending;
    userRestartPending = false;

    // The exit handler owns the next step — cancel any pending readiness
    // deadline from the start that just died so it cannot double-fire.
    if (readinessDeadline !== null) { clearTimeoutFn(readinessDeadline); readinessDeadline = null; }

    appendLog(`process exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`, 'stderr');
    emit({ lastHealthFailureAt: now() });

    if (wasUserRestart) {
      // User-initiated restart: fresh budget, no crash-loop accounting.
      crashTimestamps = [];
      emit({ status: 'reconnecting', restartCount: 0, lastError: null });
      scheduleSpawn(0);
      return;
    }

    crashTimestamps.push(now());
    crashTimestamps = crashTimestamps.filter((t) => now() - t <= config.crashWindowMs);
    if (crashTimestamps.length >= config.crashThreshold) {
      const tail = state.recentLog.slice(-6).join(' | ');
      fail(`Backend crashed ${crashTimestamps.length} times within ${Math.round(config.crashWindowMs / 1000)}s — automatic restart stopped. Last output: ${tail || '(no output captured)'}`);
      return;
    }
    if (state.restartCount >= config.maxRestarts) {
      fail(`Restart budget exhausted (${config.maxRestarts} attempts). Last exit: code=${code ?? 'null'}, signal=${signal ?? 'null'}.`);
      return;
    }
    const nextCount = state.restartCount + 1;
    const delay = config.backoffMs[Math.min(nextCount - 1, config.backoffMs.length - 1)] ?? 1000;
    emit({ status: 'reconnecting', restartCount: nextCount, lastError: `Backend exited unexpectedly (code=${code ?? 'null'}). Restart ${nextCount}/${config.maxRestarts} in ${Math.round(delay / 1000)}s.` });
    scheduleSpawn(delay);
  }

  function fail(reason: string) {
    stopMonitor();
    if (readinessDeadline !== null) { clearTimeoutFn(readinessDeadline); readinessDeadline = null; }
    emit({ status: 'failed', lastError: reason });
    logLine(`[lifecycle] FAILED: ${reason}`);
    // Keep a slow health re-probe so a genuinely-recovered backend is adopted
    // truthfully (see failedRecoveryTick). The slow cadence guarantees the
    // manager never hot-loops while the port is dead.
    if (recoveryTimer === null) {
      recoveryTimer = setIntervalFn(() => { void failedRecoveryTick(); }, config.healthIntervalMs * 5);
    }
  }

  function scheduleSpawn(delayMs: number) {
    if (pendingRestartTimer !== null) clearTimeoutFn(pendingRestartTimer);
    pendingRestartTimer = setTimeoutFn(() => {
      pendingRestartTimer = null;
      void spawnAndWaitForReadiness();
    }, delayMs);
  }

  async function spawnAndWaitForReadiness(): Promise<void> {
    // The spawn act itself is the guarded section — the readiness poll runs
    // afterwards so an exit-driven respawn is never dropped by a stale lock.
    if (spawnInFlight || shuttingDown || child) return;
    spawnInFlight = true;
    let spawned: BackendChild;
    try {
      spawned = deps.spawnBackend(config);
    } catch (err: unknown) {
      spawnInFlight = false;
      const message = err instanceof Error ? err.message : String(err);
      fail(`Could not start the backend process: ${message}`);
      return;
    }
    spawnInFlight = false;
    child = spawned;
    emit({ pid: spawned.pid ?? null, owned: true, startedAt: now(), readinessMs: null });
    if (spawned.stdout) spawned.stdout.on('data', (d: Buffer | string) => appendLog(String(d), 'stdout'));
    if (spawned.stderr) spawned.stderr.on('data', (d: Buffer | string) => appendLog(String(d), 'stderr'));
    spawned.on('exit', (code: unknown, signal: unknown) => {
      if (child === spawned) handleChildExit(code as number | null, signal as string | null);
    });
    spawned.on('error', (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      appendLog(`spawn error: ${message}`, 'stderr');
      if (child === spawned) {
        child = null;
        emit({ pid: null });
        fail(`Could not start the backend process: ${message}`);
      }
    });
    logLine(`[lifecycle] spawned backend pid=${spawned.pid ?? '?'} entry=${config.entry}`);
    await pollReadiness(spawned);
  }

  let readinessGen = 0;

  async function pollReadiness(myChild: BackendChild): Promise<void> {
    const gen = ++readinessGen;
    const startedAt = now();
    let settled = false;
    const done = (patch: Partial<BackendLifecycleState>) => {
      if (settled || gen !== readinessGen) return;
      settled = true;
      if (readinessDeadline !== null) { clearTimeoutFn(readinessDeadline); readinessDeadline = null; }
      emit(patch);
      if (patch.status === 'failed') {
        // Terminal failure: same slow-recovery behavior as fail() — never
        // spawn on our own, but adopt a genuinely healthy backend later.
        if (recoveryTimer === null) {
          recoveryTimer = setIntervalFn(() => { void failedRecoveryTick(); }, config.healthIntervalMs * 5);
        }
      } else {
        startMonitor();
      }
    };
    readinessDeadline = setTimeoutFn(() => {
      if (gen !== readinessGen) return; // superseded by a newer start
      const elapsed = Math.round((now() - startedAt) / 1000);
      discardNextExit = true;
      killChild();
      done({ status: 'failed', lastError: `Backend did not become healthy within ${elapsed}s (readiness timeout).` });
    }, config.readyTimeoutMs);

    while (!settled && !shuttingDown) {
      const probe = await probeOnce();
      if (settled || gen !== readinessGen || child !== myChild) return;
      if (probe.healthy) {
        done({ status: 'ready', lastHealthSuccessAt: now(), readinessMs: now() - startedAt, lastError: null });
        logLine(`[lifecycle] backend READY in ${now() - startedAt}ms`);
        return;
      }
      emit({ lastHealthFailureAt: now() });
      await sleep(config.readinessPollMs);
      if (child !== myChild || gen !== readinessGen) return;
    }
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => { setTimeoutFn(resolve, ms); });
  }

  async function healthTick(): Promise<void> {
    if (shuttingDown || spawnInFlight) return;
    // FAILED is terminal until the user presses Retry/Restart — the monitor
    // must never resurrect a backend whose budget is exhausted.
    if (state.status === 'failed') return;
    const probe = await probeOnce();
    if (shuttingDown) return;

    if (probe.healthy) {
      consecutiveHealthFailures = 0;
      if (state.status !== 'ready') {
        emit({ status: 'ready', lastHealthSuccessAt: now(), lastError: null, ...(state.startedAt ? {} : { startedAt: now() }) });
        logLine('[lifecycle] backend became READY (health recovered)');
      } else {
        emit({ lastHealthSuccessAt: now() });
      }
      return;
    }

    consecutiveHealthFailures += 1;
    emit({ lastHealthFailureAt: now() });

    if (config.mode === 'EXTERNAL') {
      // Never spawn in external mode — report truthfully and keep waiting.
      if (state.status === 'ready') emit({ status: 'reconnecting' });
      if (consecutiveHealthFailures >= config.unhealthyTolerance && state.status !== 'offline') {
        emit({ status: 'offline', lastError: 'Waiting for external backend — AgenticOS does not manage this backend process.' });
      }
      return;
    }

    // AUTO_MANAGED
    if (state.status === 'ready' || state.status === 'starting') emit({ status: 'reconnecting' });
    if (consecutiveHealthFailures < config.unhealthyTolerance) return;
    consecutiveHealthFailures = 0;

    if (child) {
      // Owned process alive but unhealthy — recycle it. The exit is
      // discarded (deliberate kill); the respawn is scheduled explicitly.
      appendLog('health check failed repeatedly while process alive — recycling backend process', 'stderr');
      discardNextExit = true;
      killChild();
      emit({ status: 'reconnecting', owned: true, lastError: 'Backend process alive but unhealthy — restarting it.' });
      scheduleSpawn(200);
      return;
    }
    // No owned process (adopted backend died, or never spawned).
    const portProbe = probe;
    if (portProbe.reachable && !portProbe.healthy) {
      fail(`Port ${config.port} is occupied but the AgenticOS health check failed (${describeProbe(portProbe)}). Another process is bound to the backend port.`);
      return;
    }
    // Port free → start our own backend (adoption ended or first start).
    emit({ owned: false, restartCount: state.restartCount });
    void spawnAndWaitForReadiness();
  }

  /**
   * Slow re-probe after a TERMINAL failure. `failed` means the manager's own
   * restart budget is exhausted — it must never spawn again on its own. But a
   * backend that becomes GENUINELY healthy again on the port (e.g. restarted
   * externally) is adopted truthfully (owned:false, pid:null — the manager
   * does not own or manage it). A dead/unhealthy backend keeps the chip at
   * failed: this never masks a real outage, it just stops lying once health
   * is actually back. This mirrors exactly what the user-facing Retry path
   * does, without requiring a manual click.
   */
  async function failedRecoveryTick(): Promise<void> {
    if (shuttingDown || spawnInFlight || state.status !== 'failed') return;
    const probe = await probeOnce();
    if (shuttingDown) return;
    if (probe.healthy) {
      emit({ status: 'ready', owned: false, pid: null, lastHealthSuccessAt: now(), lastError: null, startedAt: now() });
      logLine('[lifecycle] failed → adopted externally healthy backend (health recovered)');
      stopMonitor();
      startMonitor();
      return;
    }
    // Still unhealthy: remain failed; the next slow tick re-probes.
  }

  async function start(): Promise<void> {
    emit({ mode: config.mode, status: 'starting', lastError: null });
    logLine(`[lifecycle] start (mode=${config.mode}, port=${config.port}, entry=${config.entry})`);
    const probe = await probeOnce();

    if (probe.healthy) {
      // Adopt the already-running backend — never spawn a duplicate.
      emit({ status: 'ready', owned: false, pid: null, lastHealthSuccessAt: now(), lastError: null, startedAt: now() });
      logLine('[lifecycle] adopted existing healthy backend (no duplicate spawned)');
      startMonitor();
      return;
    }

    if (probe.reachable && !probe.healthy) {
      fail(`Port ${config.port} is occupied but the AgenticOS health check failed (${describeProbe(probe)}). Another process is bound to the backend port — AgenticOS will not spawn a second backend.`);
      return;
    }

    if (config.mode === 'EXTERNAL') {
      emit({ status: 'offline', lastError: 'Waiting for external backend — start the backend manually or use dev-clean.ps1.' });
      startMonitor();
      return;
    }

    await spawnAndWaitForReadiness();
  }

  async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    stopMonitor();
    if (readinessDeadline !== null) { clearTimeoutFn(readinessDeadline); readinessDeadline = null; }
    if (pendingRestartTimer !== null) { clearTimeoutFn(pendingRestartTimer); pendingRestartTimer = null; }
    if (child) {
      const target = child;
      child = null;
      logLine(`[lifecycle] shutting down owned backend pid=${target.pid ?? '?'}`);
      if (target.pid && process.platform === 'win32') {
        try {
          execFileSync('taskkill', ['/F', '/T', '/PID', String(target.pid)], { windowsHide: true, stdio: 'ignore' });
        } catch { /* already exited */ }
      }
      try { target.kill('SIGTERM'); } catch { /* already gone */ }
      // On Windows kill() terminates immediately; elsewhere give a brief grace
      // window, then force-kill so no orphan survives the app exit.
      await sleep(100);
      try { target.kill('SIGKILL'); } catch { /* already gone */ }
      emit({ pid: null, status: 'offline', lastError: null });
    }
  }

  function restart(): { ok: boolean; reason?: string } {
    if (config.mode === 'EXTERNAL') {
      return { ok: false, reason: 'Backend mode is EXTERNAL — Electron does not own this backend process. Restart it where it is managed (e.g. your terminal or dev-clean.ps1).' };
    }
    if (!child) {
      if (state.status === 'ready') {
        return { ok: false, reason: 'The running backend was adopted (started outside AgenticOS) — Electron does not own it and will not kill it. Use Retry if it becomes unhealthy.' };
      }
      // Nothing running: start fresh.
      crashTimestamps = [];
      userRestartPending = true;
      emit({ status: 'reconnecting', lastError: null });
      scheduleSpawn(0);
      return { ok: true };
    }
    userRestartPending = true;
    emit({ status: 'reconnecting', lastError: null });
    killChild(); // exit handler sees userRestartPending → immediate respawn
    return { ok: true };
  }

  function retry(): { ok: boolean; reason?: string } {
    crashTimestamps = [];
    emit({ restartCount: 0, lastError: null });
    consecutiveHealthFailures = 0;
    if (shuttingDown) return { ok: false, reason: 'App is shutting down.' };
    if (state.status === 'ready') return { ok: true, reason: 'Backend already healthy.' };
    // Re-run the startup flow (probe → adopt / spawn / port-conflict).
    void (async () => {
      if (recoveryTimer !== null) { clearIntervalFn(recoveryTimer); recoveryTimer = null; }
      if (child) { userRestartPending = true; killChild(); return; }
      emit({ status: 'starting' });
      const probe = await probeOnce();
      if (probe.healthy) {
        emit({ status: 'ready', owned: false, lastHealthSuccessAt: now(), lastError: null, startedAt: now() });
        startMonitor();
        return;
      }
      if (probe.reachable && !probe.healthy) {
        fail(`Port ${config.port} is occupied but the AgenticOS health check failed (${describeProbe(probe)}).`);
        return;
      }
      if (config.mode === 'EXTERNAL') {
        emit({ status: 'offline', lastError: 'Waiting for external backend.' });
        startMonitor();
        return;
      }
      await spawnAndWaitForReadiness();
    })();
    return { ok: true };
  }

  return {
    config,
    start,
    shutdown,
    getState: () => state,
    onStateChange: (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    restart,
    retry,
  };
}

/* ── Production wiring helpers (used by electron/main.ts) ─────────────── */

/** Parse PORT from server/.env (dotenv override:true means .env wins). */
export function readPortFromServerEnv(appRoot: string, fallback: number): number {
  try {
    const envPath = path.join(appRoot, 'server', '.env');
    const text = fs.readFileSync(envPath, 'utf8');
    const match = text.match(/^\s*PORT\s*=\s*(\d+)\s*$/m);
    if (match) return parseInt(match[1], 10);
  } catch { /* missing .env → fallback */ }
  return fallback;
}

/** Default HTTP health probe (Node 18+ fetch). */
export async function httpHealthProbe(url: string, timeoutMs: number): Promise<ProbeResult> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return { reachable: true, healthy: res.ok, httpStatus: res.status };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { reachable: false, healthy: false, error: message };
  }
}

/**
 * Resolve the Node executable used to run the backend.
 *
 * The backend is a PLAIN Node application (no Electron APIs). Running it under
 * Electron's embedded Node (ELECTRON_RUN_AS_NODE) loads native modules against
 * Electron's Node ABI (Electron 34 → Node 20.19 → modules 126), which fails
 * with ERR_DLOPEN_FAILED for modules compiled against the system Node ABI
 * (e.g. better-sqlite3 built for Node 24 → modules 137). Prefer the system
 * `node` on PATH when present — it matches the ABI the native modules were
 * built for — and only fall back to Electron's embedded Node otherwise (the
 * packaged app scenario where no separate node ships).
 */
export function resolveBackendNodeExec(fallback: string): string {
  try {
    // execFileSync is statically imported (not the runtime require shim), so
    // it resolves correctly inside the bundled Electron ESM main context.
    const systemNode = execFileSync('node', ['--version'], { encoding: 'utf8', timeout: 5000, windowsHide: true }).trim();
    if (/^v\d+\.\d+\.\d+$/.test(systemNode)) {
      return 'node';
    }
  } catch {
    // system node not on PATH — fall through to the provided executable
  }
  return fallback;
}

/** Spawn the backend with the Electron binary running as plain Node. */
export function spawnBackendWithElectronNode(config: LifecycleConfig): BackendChild {
  const nodeExec = resolveBackendNodeExec(config.nodeExec);
  const usingElectronNode = nodeExec === config.nodeExec;
  const childProc: ChildProcess = nodeSpawn(nodeExec, [config.entry], {
    cwd: config.cwd,
    // Only ELECTRON_RUN_AS_NODE when we are actually using the Electron
    // binary as Node. A system `node` must NOT get ELECTRON_RUN_AS_NODE.
    // Pin PORT explicitly so the spawned backend binds the lifecycle's
    // configured port (the backend's index.ts re-applies an explicit PORT
    // after dotenv's override:true — see server/src/index.ts explicitPort).
    env: usingElectronNode
      ? { ...config.env, PORT: String(config.port), ELECTRON_RUN_AS_NODE: '1' }
      : { ...config.env, PORT: String(config.port), ELECTRON_RUN_AS_NODE: undefined },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  return childProc as unknown as BackendChild;
}
