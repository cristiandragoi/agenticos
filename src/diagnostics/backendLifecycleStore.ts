/**
 * ONE frontend backend-connection surface (backend lifecycle milestone).
 *
 * Source of truth priority:
 *   1. Electron IPC — `window.backendLifecycle` (preload bridge) pushes the
 *      lifecycle manager's state (AUTO_MANAGED/EXTERNAL, pid, restarts, logs).
 *   2. Health-poll fallback — browser mode (Vite dev without Electron, or a
 *      missing preload) derives the same shape from GET /api/health every 3s.
 *
 * Every UI surface (titlebar chip, diagnostics panel, Jarvis offline gate,
 * AppShell startup screen) reads ONLY this store — components never guess
 * connectivity from their own fetch failures.
 */

import { API_BASE } from '../api/client';

export type BackendMode = 'AUTO_MANAGED' | 'EXTERNAL' | 'UNKNOWN';
export type BackendLifecycleStatus = 'starting' | 'ready' | 'reconnecting' | 'offline' | 'failed';

export interface BackendLifecycleState {
  mode: BackendMode;
  status: BackendLifecycleStatus;
  backendUrl: string;
  port: number;
  pid: number | null;
  owned: boolean;
  startedAt: number | null;
  lastHealthSuccessAt: number | null;
  lastHealthFailureAt: number | null;
  restartCount: number;
  lastError: string | null;
  readinessMs: number | null;
  recentLog: string[];
  /** True when the state comes from the Electron lifecycle manager. */
  source: 'electron' | 'health-poll';
}

const FALLBACK_STATE: BackendLifecycleState = {
  mode: 'UNKNOWN',
  status: 'starting',
  backendUrl: typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:4000',
  port: 4000,
  pid: null,
  owned: false,
  startedAt: null,
  lastHealthSuccessAt: null,
  lastHealthFailureAt: null,
  restartCount: 0,
  lastError: null,
  readinessMs: null,
  recentLog: [],
  source: 'health-poll',
};

let state: BackendLifecycleState = FALLBACK_STATE;
const listeners = new Set<() => void>();
let electronUnsub: (() => void) | null = null;
let electronConnected = false;
let pollTimer: number | null = null;
let refCount = 0;
let consecutivePollFailures = 0;

function publish() {
  for (const fn of listeners) fn();
}

function merge(next: Partial<BackendLifecycleState>) {
  state = { ...state, ...next };
  publish();
}

async function healthPollTick() {
  // Never overwrite authoritative Electron state with a derived poll.
  if (electronConnected) return;
  try {
    const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(2500) });
    if (res.ok) {
      consecutivePollFailures = 0;
      merge({
        source: 'health-poll',
        status: 'ready',
        lastHealthSuccessAt: Date.now(),
        lastError: null,
        backendUrl: window.location.origin,
      });
      return;
    }
    throw new Error(`HTTP ${res.status}`);
  } catch (err: unknown) {
    consecutivePollFailures += 1;
    const message = err instanceof Error ? err.message : String(err);
    merge({
      source: 'health-poll',
      status: 'offline',
      lastHealthFailureAt: Date.now(),
      lastError: `Backend health check failed (${message}). Retrying automatically…`,
    });
  }
}

export const backendLifecycleStore = {
  get(): BackendLifecycleState { return state; },
  getState(): BackendLifecycleState { return state; },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },
  /** Backend is usable (connected). Everything else = not usable. */
  isReady(): boolean { return state.status === 'ready'; },

  async restart(): Promise<{ ok: boolean; reason?: string }> {
    const bridge = (window as any).backendLifecycle;
    if (bridge?.restart) return bridge.restart();
    return { ok: false, reason: 'Not running under AgenticOS Electron — the backend is managed externally.' };
  },

  async retry(): Promise<{ ok: boolean; reason?: string }> {
    const bridge = (window as any).backendLifecycle;
    if (bridge?.retry) return bridge.retry();
    await healthPollTick();
    return { ok: true };
  },
};

/**
 * Refcounted boot: the first subscriber connects (Electron IPC or health
 * poll); the last unsubscriber tears the monitor down so tests and route
 * unmounts leave no timers behind. Returns the unsubscribe function.
 */
export function startBackendLifecycleMonitor(): () => void {
  refCount += 1;
  if (refCount === 1) connect();
  return () => {
    refCount -= 1;
    if (refCount <= 0) stopBackendLifecycleMonitor();
  };
}

function connect(): void {
  const bridge = (window as any).backendLifecycle;
  if (bridge?.onState && bridge?.getState) {
    electronConnected = true;
    electronUnsub = bridge.onState((next: BackendLifecycleState) => {
      if (next && typeof next === 'object') {
        state = { ...next, source: 'electron' };
        publish();
      }
    });
    void bridge.getState().then((initial: BackendLifecycleState | null) => {
      if (initial && typeof initial === 'object') {
        state = { ...initial, source: 'electron' };
        publish();
      }
    }).catch(() => { startPollFallback(); });
    return;
  }
  startPollFallback();
}

function startPollFallback() {
  if (pollTimer !== null) return;
  void healthPollTick();
  pollTimer = window.setInterval(() => { void healthPollTick(); }, 3000);
}

export function stopBackendLifecycleMonitor(): void {
  if (electronUnsub) { electronUnsub(); electronUnsub = null; }
  electronConnected = false;
  if (pollTimer !== null) { window.clearInterval(pollTimer); pollTimer = null; }
  refCount = 0;
  consecutivePollFailures = 0;
}
