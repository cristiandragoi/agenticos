/**
 * Backend lifecycle renderer coverage (backend lifecycle milestone):
 *   - lifecycle store: Electron IPC source of truth + health-poll fallback
 *   - BackendStatusIndicator: persistent status chip + diagnostics panel
 *     (mode, port, restart count, last error, Retry/Restart semantics)
 *   - Jarvis offline gating: sends answered truthfully, composer disabled
 *   - AppShell startup/error screens fed by the lifecycle state
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import {
  backendLifecycleStore,
  startBackendLifecycleMonitor,
  stopBackendLifecycleMonitor,
  type BackendLifecycleState,
} from '../diagnostics/backendLifecycleStore';
import BackendStatusIndicator from '../components/layout/BackendStatusIndicator';
import { JarvisComposer } from '../components/jarvis/JarvisComposer';
import { AppProvider } from '../store/appStore';
import { CodexProvider } from '../store/codexStore';

// AppShell coherence test needs a loading data store; the mock is hoisted
// and only consumed by the AppShell describe below.
vi.mock('../store/dataStore', async () => {
  const actual = await vi.importActual('../store/dataStore');
  return { ...actual as any, useData: () => ({ isLoading: true, error: null }) };
});

function baseState(overrides: Partial<BackendLifecycleState> = {}): BackendLifecycleState {
  return {
    mode: 'AUTO_MANAGED',
    status: 'starting',
    backendUrl: 'http://127.0.0.1:4000',
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
    source: 'electron',
    ...overrides,
  };
}

/* Fake Electron preload bridge — the renderer's authoritative source. */
type BridgeListener = (state: BackendLifecycleState) => void;
function installBridge(initial: BackendLifecycleState) {
  let listener: BridgeListener | null = null;
  const restart = vi.fn().mockResolvedValue({ ok: true });
  const retry = vi.fn().mockResolvedValue({ ok: true });
  const getState = vi.fn().mockResolvedValue(initial);
  (window as any).backendLifecycle = {
    getState,
    restart,
    retry,
    onState: (cb: BridgeListener) => { listener = cb; return () => { listener = null; }; },
  };
  return {
    restart, retry, getState,
    push(state: BackendLifecycleState) { listener?.(state); },
  };
}

/** Flush effects + pending microtasks without running away on intervals. */
async function settle(ms = 5) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  (globalThis as any).fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
});

afterEach(() => {
  stopBackendLifecycleMonitor();
  delete (window as any).backendLifecycle;
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/* ── Store ─────────────────────────────────────────────────────────── */

describe('backendLifecycleStore', () => {
  it('derives connectivity from the Electron bridge (no independent guessing)', async () => {
    const bridge = installBridge(baseState({ status: 'starting' }));
    const unsub = startBackendLifecycleMonitor();
    await settle();

    expect(backendLifecycleStore.get().status).toBe('starting');
    expect(backendLifecycleStore.get().source).toBe('electron');
    expect(backendLifecycleStore.isReady()).toBe(false);

    act(() => bridge.push(baseState({ status: 'ready', owned: true, pid: 1234, readinessMs: 18000 })));
    expect(backendLifecycleStore.get().status).toBe('ready');
    expect(backendLifecycleStore.isReady()).toBe(true);
    expect(backendLifecycleStore.get().pid).toBe(1234);

    act(() => bridge.push(baseState({ status: 'reconnecting', restartCount: 2, owned: true, pid: 1234 })));
    expect(backendLifecycleStore.get().status).toBe('reconnecting');
    expect(backendLifecycleStore.get().restartCount).toBe(2);

    unsub();
  });

  it('falls back to /api/health polling in browser mode and tracks offline', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('fetch failed'));
    (globalThis as any).fetch = fetchMock;

    const unsub = startBackendLifecycleMonitor();
    await settle();
    expect(backendLifecycleStore.get().source).toBe('health-poll');
    expect(backendLifecycleStore.get().status).toBe('offline');
    expect(backendLifecycleStore.get().lastError).toMatch(/fetch failed/);

    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    await settle(3100); // next poll tick
    expect(backendLifecycleStore.get().status).toBe('ready');
    expect(backendLifecycleStore.get().lastHealthSuccessAt).not.toBeNull();

    unsub();
  });

  it('restart in browser mode explains the backend is externally managed', async () => {
    const res = await backendLifecycleStore.restart();
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/externally/i);
  });
});

/* ── Indicator + diagnostics panel ─────────────────────────────────── */

describe('BackendStatusIndicator', () => {
  it('renders the persistent connection state per lifecycle status', async () => {
    const bridge = installBridge(baseState({ status: 'starting' }));
    render(<BackendStatusIndicator />);
    await settle();

    expect(screen.getByTestId('backend-status-chip')).toHaveTextContent(/Starting/i);
    expect(screen.getByTestId('backend-status-chip').getAttribute('data-status')).toBe('starting');

    act(() => bridge.push(baseState({ status: 'ready' })));
    expect(screen.getByTestId('backend-status-chip')).toHaveTextContent(/Connected/);
    expect(screen.getByTestId('backend-status-chip')).toHaveTextContent(':4000');

    act(() => bridge.push(baseState({ status: 'reconnecting', restartCount: 2 })));
    expect(screen.getByTestId('backend-status-chip')).toHaveTextContent(/Reconnecting/);
    expect(screen.getByTestId('backend-status-chip')).toHaveTextContent('attempt 2/3');

    act(() => bridge.push(baseState({ status: 'failed', lastError: 'Restart budget exhausted (3 attempts).' })));
    expect(screen.getByTestId('backend-status-chip')).toHaveTextContent(/Failed/);
  });

  it('diagnostics panel shows mode/port/pid/restarts/last error and drives Retry/Restart', async () => {
    const bridge = installBridge(baseState({
      status: 'failed',
      mode: 'AUTO_MANAGED',
      owned: true,
      pid: 4242,
      restartCount: 3,
      lastError: 'Backend crashed 3 times within 60s.',
      recentLog: ['[stderr] boom', '[stdout] starting'],
      lastHealthSuccessAt: Date.now() - 40_000,
    }));
    render(<BackendStatusIndicator />);
    await settle();

    fireEvent.click(screen.getByTestId('backend-status-chip'));
    const panel = await screen.findByTestId('backend-diagnostics-panel');
    expect(panel).toHaveTextContent('AUTO_MANAGED');
    expect(panel).toHaveTextContent('FAILED');
    expect(panel).toHaveTextContent(':4000');
    expect(panel).toHaveTextContent('4242');
    expect(screen.getByTestId('backend-diagnostics-error')).toHaveTextContent('crashed 3 times');
    expect(screen.getByTestId('backend-diagnostics-log')).toHaveTextContent('[stderr] boom');

    fireEvent.click(screen.getByTestId('backend-diagnostics-retry'));
    await settle();
    expect(bridge.retry).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('backend-diagnostics-restart'));
    await settle();
    expect(bridge.restart).toHaveBeenCalledTimes(1);
  });

  it('restart in EXTERNAL mode surfaces the not-owned explanation', async () => {
    installBridge(baseState({ status: 'offline', mode: 'EXTERNAL' }));
    (window as any).backendLifecycle.restart.mockResolvedValue({
      ok: false,
      reason: 'Backend mode is EXTERNAL — Electron does not own this backend process.',
    });
    render(<BackendStatusIndicator />);
    await settle();

    fireEvent.click(screen.getByTestId('backend-status-chip'));
    fireEvent.click(screen.getByTestId('backend-diagnostics-restart'));
    await settle();
    expect(screen.getByTestId('backend-diagnostics-action-msg')).toHaveTextContent(/EXTERNAL/);
  });
});

/* ── Jarvis offline gating ─────────────────────────────────────────── */

describe('Jarvis offline gating', () => {
  it('composer is disabled with a visible gate reason when the backend is offline', () => {
    render(
      <JarvisComposer
        onSendMessage={() => {}}
        isProcessing={false}
        disabledReason="AgenticOS backend is offline. Reconnecting now…"
      />
    );
    expect(screen.getByTestId('jarvis-offline-gate')).toHaveTextContent(/offline/i);
    expect(screen.getByLabelText('Message Input')).toBeDisabled();
    expect(screen.getByLabelText('Send Message')).toBeDisabled();
  });

  it('JarvisChat answers truthfully instead of routing requests when offline (electron source)', async () => {
    installBridge(baseState({ status: 'offline' }));
    const streamFetch = vi.fn().mockImplementation((url: string) => {
      if (String(url).endsWith('/message/stream')) {
        throw new Error('stream must never be called while offline');
      }
      return Promise.resolve({ ok: true, json: async () => (String(url).endsWith('/messages') ? [] : {}) });
    });
    (globalThis as any).fetch = streamFetch;

    const { JarvisChat } = await import('../components/jarvis/JarvisChat');
    const ref = React.createRef<any>();
    render(
      <CodexProvider>
        <JarvisChat ref={ref} conversationId="conv-offline" />
      </CodexProvider>
    );
    await settle();

    expect(screen.getByTestId('jarvis-offline-gate')).toBeInTheDocument();
    expect(screen.getByLabelText('Message Input')).toBeDisabled();

    // The imperative send path (voice auto-submit + typed) must be answered
    // truthfully and NEVER reach the stream endpoint. The gate banner AND
    // the appended reply message both carry the offline text.
    act(() => { ref.current?.sendMessage('hello jarvis', 'typed'); });
    await settle();
    expect(screen.getAllByText(/AgenticOS backend is offline\. Reconnecting now/i).length).toBeGreaterThanOrEqual(2);
    expect(streamFetch.mock.calls.filter(([u]) => String(u).endsWith('/message/stream'))).toHaveLength(0);
  });

  it('browser-mode offline (health-poll source) does NOT gate the composer — AppShell owns the offline screen', async () => {
    // No bridge: store falls back to health-poll; a fetch failure marks
    // 'offline' with source health-poll.
    (globalThis as any).fetch = vi.fn().mockRejectedValue(new Error('fetch failed'));
    const { JarvisChat } = await import('../components/jarvis/JarvisChat');

    render(
      <CodexProvider>
        <JarvisChat conversationId="conv-browser" />
      </CodexProvider>
    );
    await settle();
    expect(backendLifecycleStore.get().source).toBe('health-poll');
    expect(backendLifecycleStore.get().status).toBe('offline');
    // Gate is electron-only → composer stays enabled in browser dev mode.
    expect(screen.getByLabelText('Message Input')).not.toBeDisabled();
    expect(screen.queryByTestId('jarvis-offline-gate')).not.toBeInTheDocument();
  });
});

/* ── AppShell startup/error coherence ──────────────────────────────── */

describe('AppShell backend coherence', () => {
  it('shows the startup screen while the backend is starting, then Backend ready', async () => {
    const bridge = installBridge(baseState({ status: 'starting' }));
    const AppShell = (await import('../components/layout/AppShell')).default;

    render(
      <AppProvider>
        <CodexProvider>
          <MemoryRouter initialEntries={['/mission-control']}>
            <AppShell />
          </MemoryRouter>
        </CodexProvider>
      </AppProvider>
    );
    await settle();
    expect(screen.getByTestId('app-startup-screen')).toHaveTextContent(/Starting AgenticOS backend/i);

    act(() => bridge.push(baseState({ status: 'ready' })));
    await settle();
    expect(screen.getByTestId('app-startup-screen')).toHaveTextContent(/Backend ready/i);
  });
});
