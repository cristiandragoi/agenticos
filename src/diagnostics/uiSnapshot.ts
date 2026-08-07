/**
 * UI Diagnostic Snapshot — READ-ONLY reporting of what the React UI is
 * currently rendering.
 *
 * The backend/runtime remains the AUTHORITATIVE source of truth. This module
 * only answers the question "what is the UI currently displaying?" — the
 * frontend's selected runtime, the gateway status it renders, the active
 * stream provider/model, and the most recent transcript ProviderBadge — so
 * Jarvis INVESTIGATE can compare layers and pinpoint stale UI state.
 *
 * The snapshot is pushed to the backend through the existing Vite proxy via
 * POST /api/diagnostics/ui-snapshot (debounced, no secrets, no side effects).
 */
export interface UiSnapshotPart {
  provider: string | null;
  model: string | null;
  updatedAt: number;
}

export interface UiDiagnosticSnapshot {
  /** User-selected provider/model (AgentRuntimeSelector). */
  selected: UiSnapshotPart;
  /** Gateway status the UI renders (health/gateway poll). */
  gatewayResolved: UiSnapshotPart & { online: boolean | null };
  /** Last active stream provider/model + operationId (JarvisChat status). */
  activeStream: UiSnapshotPart & { operationId: string | null };
  /** Most recent transcript ProviderBadge value. */
  frontendBadge: UiSnapshotPart & { messageId: string | null };
  /** Hermes runtime provider/model where applicable. */
  hermes: UiSnapshotPart;
  version: number;
  updatedAt: number;
}

function empty(): UiDiagnosticSnapshot {
  return {
    selected: { provider: null, model: null, updatedAt: 0 },
    gatewayResolved: { provider: null, model: null, updatedAt: 0, online: null },
    activeStream: { provider: null, model: null, updatedAt: 0, operationId: null },
    frontendBadge: { provider: null, model: null, updatedAt: 0, messageId: null },
    hermes: { provider: null, model: null, updatedAt: 0 },
    version: 0,
    updatedAt: 0,
  };
}

let state = empty();
let reportTimer: ReturnType<typeof setTimeout> | null = null;
let lastSent = '';
const listeners = new Set<() => void>();

function bump(): void {
  state.version += 1;
  state.updatedAt = Date.now();
  for (const fn of listeners) fn();
  scheduleReport();
}

/** POST the snapshot to the backend (debounced, skip when unchanged). */
function scheduleReport(): void {
  if (reportTimer) return;
  reportTimer = setTimeout(() => {
    reportTimer = null;
    const payload = JSON.stringify(state);
    if (payload === lastSent) return;
    lastSent = payload;
    fetch('/api/diagnostics/ui-snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    }).catch(() => { /* diagnostics only — never break the UI */ });
  }, 800);
}

export const uiDiagnostics = {
  get(): UiDiagnosticSnapshot {
    return state;
  },
  setSelected(provider: string | null, model: string | null): void {
    state.selected = { provider, model, updatedAt: Date.now() };
    bump();
  },
  setGatewayResolved(provider: string | null, model: string | null, online: boolean | null): void {
    state.gatewayResolved = { provider, model, online, updatedAt: Date.now() };
    bump();
  },
  setActiveStream(provider: string | null, model: string | null, operationId: string | null): void {
    if (!provider && !model && !operationId) return; // idle statuses don't clobber the last real stream
    state.activeStream = { provider, model, operationId, updatedAt: Date.now() };
    bump();
  },
  setFrontendBadge(provider: string | null, model: string | null, messageId: string | null): void {
    state.frontendBadge = { provider, model, messageId, updatedAt: Date.now() };
    bump();
  },
  setHermes(provider: string | null, model: string | null): void {
    state.hermes = { provider, model, updatedAt: Date.now() };
    bump();
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },
  /** Test helper. */
  reset(): void {
    state = empty();
    lastSent = '';
  },
};
