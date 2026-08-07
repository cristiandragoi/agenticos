/**
 * ONE frontend execution surface (coherence milestone).
 *
 * Subscribes to the backend's canonical execution stream
 * (GET /api/execution/stream) + polls GET /api/execution/current as a
 * fallback. Every component (ExecutionBar, activity panel, transcript) reads
 * the SAME { current, history } record — no component derives its own stage.
 */
export interface ExecutionRecord {
  operationId: string;
  worker: 'jarvis' | 'codex' | 'hermes' | 'revenue' | 'investigate' | 'other';
  status: string;
  currentAction: string | null;
  requestedProvider: string | null;
  requestedModel: string | null;
  resolvedProvider: string | null;
  resolvedModel: string | null;
  fallbackUsed: boolean;
  fallbackReason: string | null;
  startedAt: number;
  endedAt: number | null;
  lastActivityAt: number;
  queuePosition: number | null;
  activeCount: number | null;
  limit: number | null;
  result: string | null;
  cancel: { kind: 'stream' | 'task' | 'goal'; id: string } | null;
  discoveredCount: number | null;
  qualifiedCount: number | null;
  rejectedCount: number | null;
  targetCount: number | null;
  note: string | null;
}

interface StoreState {
  current: ExecutionRecord | null;
  history: ExecutionRecord[];
}

let state: StoreState = { current: null, history: [] };
const listeners = new Set<() => void>();
let stopBusy = false;

function publish() {
  for (const fn of listeners) fn();
}

export const executionStore = {
  get(): StoreState { return state; },
  subscribe(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; },
  replace(next: StoreState): void { state = next; publish(); },
  stop(): boolean {
    if (stopBusy || !state.current) return false;
    stopBusy = true;
    void fetch('/api/execution/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operationId: state.current.operationId }),
    })
      .catch(() => {})
      .finally(() => { stopBusy = false; });
    return true;
  },
};

let es: EventSource | null = null;
let pollTimer: number | null = null;

export function startExecutionStream(): void {
  if (es) return;
  try {
    es = new EventSource('/api/execution/stream');
    const apply = (data: StoreState) => {
      if (data && Array.isArray(data.history)) { state = data; publish(); }
    };
    es.addEventListener('snapshot', (e) => apply(JSON.parse((e as MessageEvent).data)));
    es.addEventListener('change', (e) => apply(JSON.parse((e as MessageEvent).data)));
    es.onerror = () => {
      // SSE dropped — fall back to polling until it reconnects.
      if (!pollTimer) {
        pollTimer = window.setInterval(async () => {
          try {
            const res = await fetch('/api/execution/current');
            if (res.ok) { state = await res.json(); publish(); }
          } catch { /* keep last state */ }
        }, 3000);
      }
    };
    es.onopen = () => {
      if (pollTimer) { window.clearInterval(pollTimer); pollTimer = null; }
    };
  } catch {
    // No SSE support — poll.
    pollTimer = window.setInterval(async () => {
      try {
        const res = await fetch('/api/execution/current');
        if (res.ok) { state = await res.json(); publish(); }
      } catch { /* keep last state */ }
    }, 3000);
  }
}
