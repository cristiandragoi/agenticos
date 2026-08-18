import { apiFetch, apiUrl } from '../api/client';

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
  /** §8: canonical workspace root the operation resolves files against. */
  workspace: string | null;
}

interface StoreState {
  current: ExecutionRecord | null;
  history: ExecutionRecord[];
}

/** TASK_COMPLETED user-experience event (task-completion milestone). */
export interface CompletionEvent {
  kind: 'TASK_COMPLETED';
  operationId: string;
  worker: string;
  taskType: string;
  status: 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'CANCELLED';
  summary: string;
  resultCount: number | null;
  requestedCount: number | null;
  topResult: string | null;
  durationMs: number;
  completedAt: number;
  resultAvailable: boolean;
  spokenSummary: string;
  conversationId: string | null;
  taskId: string | null;
}

let state: StoreState = { current: null, history: [] };
const listeners = new Set<() => void>();
let stopBusy = false;

/** Completion events per operationId — never overwritten (multi-task safe). */
let completions: Record<string, CompletionEvent> = {};
let completionOrder: string[] = [];

const ACK_KEY = 'jarvis.completionNotifiedAt.v1';

function loadAck(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(ACK_KEY) || '{}'); } catch { return {}; }
}

export function completionNotifiedAt(opId: string): number | null {
  return loadAck()[opId] ?? null;
}

export function acknowledgeCompletion(opId: string): void {
  const ack = loadAck();
  ack[opId] = Date.now();
  try { localStorage.setItem(ACK_KEY, JSON.stringify(ack)); } catch { /* ignore */ }
  publish();
}

function publish() {
  for (const fn of listeners) fn();
}

export const executionStore = {
  get(): StoreState { return state; },
  subscribe(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; },
  replace(next: StoreState): void { state = next; publish(); },
  /** Completion events for ALL finished operations (chronological order). */
  getCompletions(): CompletionEvent[] { return completionOrder.map((op) => completions[op]).filter(Boolean); },
  getCompletion(opId: string): CompletionEvent | null { return completions[opId] ?? null; },
  addCompletion(event: CompletionEvent): boolean {
    // One event per operation; an acknowledged event never replays.
    if (completions[event.operationId]) return false;
    completions[event.operationId] = event;
    completionOrder = [...completionOrder.filter((op) => op !== event.operationId), event.operationId];
    publish();
    return true;
  },
  stop(): boolean {
    if (stopBusy || !state.current) return false;
    stopBusy = true;
    void apiFetch('/api/execution/cancel', {
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
  // Hydrate completions that happened while the app was closed/reloading —
  // the SSE only delivers LIVE events (task-completion milestone).
  void apiFetch('/api/execution/completions')
    .then((r) => (r.ok ? r.json() : []))
    .then((events: CompletionEvent[]) => {
      for (const evt of events) if (evt?.operationId) executionStore.addCompletion(evt);
    })
    .catch(() => {});
  if (es) return;
  try {
    es = new EventSource(apiUrl('/api/execution/stream'));
    const apply = (data: StoreState) => {
      if (data && Array.isArray(data.history)) { state = data; publish(); }
    };
    es.addEventListener('snapshot', (e) => apply(JSON.parse((e as MessageEvent).data)));
    es.addEventListener('change', (e) => apply(JSON.parse((e as MessageEvent).data)));
    es.addEventListener('task_completed', (e) => {
      try {
        const evt = JSON.parse((e as MessageEvent).data) as CompletionEvent;
        if (evt && evt.operationId) executionStore.addCompletion(evt);
      } catch { /* malformed event */ }
    });
    es.onerror = () => {
      // SSE dropped — fall back to polling until it reconnects.
      if (!pollTimer) {
        pollTimer = window.setInterval(async () => {
          try {
            const res = await apiFetch('/api/execution/current');
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
        const res = await apiFetch('/api/execution/current');
        if (res.ok) { state = await res.json(); publish(); }
      } catch { /* keep last state */ }
    }, 3000);
  }
}
