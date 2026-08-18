import { apiFetch, apiUrl } from '../api/client';

/**
 * UI Diagnostic Snapshot — READ-ONLY reporting of what the React UI is
 * currently rendering (and has last rendered).
 *
 * Architectural rules:
 *  - The backend/runtime remains AUTHORITATIVE. This module only answers
 *    "what is the UI currently displaying / what did it last display?"
 *  - No DOM scraping, no screenshot/OCR. Fields are derived from existing
 *    frontend state (API fetches, stores, hooks) or published by components
 *    as render confirmation.
 *  - No diagnostic state may drive runtime routing; no config changes occur
 *    through the diagnostic endpoint.
 *
 * Startup: `initUiDiagnostics()` publishes configured/selected state from
 * the authoritative assignment API as soon as the app starts — before any
 * component that displays it has mounted.
 *
 * Remounts: values persist in module scope for the whole Electron/app
 * session. A component unmount marks its layer's render confirmation as
 * `componentMounted: false` but never erases the last-known value.
 *
 * Truthfulness: nothing is fabricated. A layer with no value reports
 * null/"none"; uncertainty is explicit (source, last-known, age).
 */
export interface UiDiagnosticSnapshot {
  /** Configured/selected frontend state (assignment API + user selection). */
  selected: { provider: string | null; model: string | null; updatedAt: number; source: string | null };
  /** Gateway status the UI renders (health poll / bootstrap). */
  gatewayRendered: { provider: string | null; model: string | null; online: boolean | null; updatedAt: number; source: string | null };
  /** Last rendered transcript ProviderBadge (render confirmation + last-known). */
  rendered: {
    providerBadge: { provider: string | null; model: string | null; renderedAt: number; componentMounted: boolean; messageId: string | null };
  };
  /** Current active stream vs last-known stream (never fabricated). */
  stream: {
    active: { provider: string | null; model: string | null; operationId: string | null; startedAt: number } | null;
    lastKnown: { provider: string | null; model: string | null; operationId: string | null; endedAt: number } | null;
  };
  version: number;
  updatedAt: number;
}

function empty(): UiDiagnosticSnapshot {
  return {
    selected: { provider: null, model: null, updatedAt: 0, source: null },
    gatewayRendered: { provider: null, model: null, online: null, updatedAt: 0, source: null },
    rendered: { providerBadge: { provider: null, model: null, renderedAt: 0, componentMounted: false, messageId: null } },
    stream: { active: null, lastKnown: null },
    version: 0,
    updatedAt: 0,
  };
}

let state = empty();
let reportTimer: ReturnType<typeof setTimeout> | null = null;
let lastSent = '';
const listeners = new Set<() => void>();
let initialized = false;

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
    apiFetch('/api/diagnostics/ui-snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    }).catch(() => { /* diagnostics only — endpoint unavailable must never break the UI */ });
  }, 800);
}

export const uiDiagnostics = {
  get(): UiDiagnosticSnapshot {
    return state;
  },
  /** Startup bootstrap: publish configured/selected state as soon as the
   *  authoritative assignment + gateway status are available — independent of
   *  component mount timing and without waiting for user interaction. */
  init(): void {
    if (initialized) return;
    initialized = true;
    void (async () => {
      try {
        const res = await apiFetch('/api/settings/agent-provider-assignments/agent-jarvis');
        if (res.ok) {
          const a = await res.json();
          if (a?.providerId || a?.modelId) {
            uiDiagnostics.setSelected(a.providerId || null, a.modelId || null, 'agent-provider-assignments');
          }
        }
      } catch { /* diagnostics only */ }
      try {
        const res = await apiFetch('/api/health/gateway');
        if (res.ok) {
          const d = await res.json();
          uiDiagnostics.setGatewayRendered(
            d?.gateway ?? null,
            d?.model ?? null,
            d?.status === 'online' || d?.status === 'degraded',
            'health-gateway-poll'
          );
        }
      } catch { /* diagnostics only */ }
    })();
  },
  setSelected(provider: string | null, model: string | null, source: string | null): void {
    state.selected = { provider, model, updatedAt: Date.now(), source };
    bump();
  },
  setGatewayRendered(provider: string | null, model: string | null, online: boolean | null, source: string | null): void {
    state.gatewayRendered = { provider, model, online, updatedAt: Date.now(), source };
    bump();
  },
  /** Render confirmation for the transcript ProviderBadge. */
  setFrontendBadge(provider: string | null, model: string | null, messageId: string | null): void {
    state.rendered.providerBadge = { provider, model, renderedAt: Date.now(), componentMounted: true, messageId };
    bump();
  },
  /** Component unmount marker — value is preserved as last-known. */
  setFrontendBadgeUnmounted(): void {
    if (state.rendered.providerBadge.componentMounted) {
      state.rendered.providerBadge = { ...state.rendered.providerBadge, componentMounted: false };
      bump();
    }
  },
  /** Current active stream — startedAt is kept for the same operation. */
  setStreamActive(provider: string | null, model: string | null, operationId: string | null): void {
    const prevActive = state.stream.active;
    const sameOp = prevActive?.operationId && operationId && prevActive.operationId === operationId;
    state.stream.active = {
      provider,
      model,
      operationId,
      startedAt: sameOp && prevActive.startedAt ? prevActive.startedAt : Date.now(),
    };
    bump();
  },
  /** Stream end — moves the active stream to lastKnown (never fabricates). */
  setStreamEnded(operationId: string | null): void {
    const active = state.stream.active;
    if (active) {
      state.stream.lastKnown = {
        provider: active.provider,
        model: active.model,
        operationId: active.operationId || operationId,
        endedAt: Date.now(),
      };
      state.stream.active = null;
      bump();
    } else if (operationId && state.stream.lastKnown && state.stream.lastKnown.operationId === operationId) {
      state.stream.lastKnown = { ...state.stream.lastKnown, endedAt: Date.now() };
      bump();
    }
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },
  /** Test helper. */
  reset(): void {
    state = empty();
    lastSent = '';
    initialized = false;
  },
};
