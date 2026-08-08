/**
 * ONE authoritative execution state machine (coherence milestone).
 *
 * Every operation (Jarvis stream, CodeX goal, Hermes/revenue background task)
 * is represented by ONE ExecutionRecord keyed by operationId. UI surfaces
 * (transcript, execution bar, activity panel, provider/model display) read
 * only this record via GET /api/execution/current + the SSE stream — they
 * never derive their own stage.
 *
 * Status transitions are the ONLY mutators. begin() creates/replaces the
 * current record; update() refreshes it; end() marks a terminal state and
 * moves it to history. The newest non-terminal operation is current; an older
 * active operation that gets superseded is ended as 'superseded'.
 */
import { EventEmitter } from 'node:events';

export type ExecutionWorker = 'jarvis' | 'codex' | 'hermes' | 'revenue' | 'investigate' | 'other';

export const EXECUTION_STATUSES = [
  'IDLE', 'ROUTING', 'PLANNING', 'QUEUED', 'DISPATCHING', 'WAITING_FOR_MODEL',
  'RUNNING', 'TOOL_EXECUTION', 'WAITING_FOR_APPROVAL', 'WAITING_FOR_USER', 'COMPLETING', 'COMPLETED',
  'FAILED', 'CANCELLED', 'STOPPING',
] as const;
export type ExecutionStatus = typeof EXECUTION_STATUSES[number];

const TERMINAL: ReadonlySet<ExecutionStatus> = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

export interface CancelAction {
  kind: 'stream' | 'task' | 'goal';
  id: string;
}

export interface ExecutionRecord {
  operationId: string;
  worker: ExecutionWorker;
  status: ExecutionStatus;
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
  cancel: CancelAction | null;
  /** Revenue-pipeline lead counts (contact-quality milestone). */
  discoveredCount: number | null;
  qualifiedCount: number | null;
  rejectedCount: number | null;
  targetCount: number | null;
  note: string | null;
  /** §8: canonical workspace root the operation resolves files against. */
  workspace: string | null;
}

const HISTORY_LIMIT = 50;
let current: ExecutionRecord | null = null;
const history: ExecutionRecord[] = [];
const emitter = new EventEmitter();
emitter.setMaxListeners(200);

function clone(r: ExecutionRecord): ExecutionRecord {
  return { ...r, cancel: r.cancel ? { ...r.cancel } : null };
}

function publish(): void {
  emitter.emit('change', snapshot());
}

function pushHistory(r: ExecutionRecord): void {
  history.unshift(clone(r));
  if (history.length > HISTORY_LIMIT) history.length = HISTORY_LIMIT;
}

export function snapshot() {
  return {
    current: current ? clone(current) : null,
    history: history.map(clone),
  };
}

export function getCurrent(): ExecutionRecord | null {
  return current ? clone(current) : null;
}

export function get(operationId: string): ExecutionRecord | null {
  if (current?.operationId === operationId) return clone(current);
  const h = history.find((r) => r.operationId === operationId);
  return h ? clone(h) : null;
}

/** Create or re-adopt the current record. If another operation is active it
 *  is superseded (ended, moved to history). */
export function begin(partial: Partial<ExecutionRecord> & { operationId: string; worker: ExecutionWorker }): ExecutionRecord {
  if (current && current.operationId !== partial.operationId && !TERMINAL.has(current.status)) {
    const old = current;
    old.endedAt = Date.now();
    old.note = 'Superseded by a newer operation.';
    pushHistory(old);
  }
  const now = Date.now();
  current = {
    operationId: partial.operationId,
    worker: partial.worker,
    status: partial.status || 'ROUTING',
    currentAction: partial.currentAction ?? null,
    requestedProvider: partial.requestedProvider ?? null,
    requestedModel: partial.requestedModel ?? null,
    resolvedProvider: partial.resolvedProvider ?? null,
    resolvedModel: partial.resolvedModel ?? null,
    fallbackUsed: partial.fallbackUsed ?? false,
    fallbackReason: partial.fallbackReason ?? null,
    startedAt: partial.startedAt ?? now,
    endedAt: null,
    lastActivityAt: now,
    queuePosition: partial.queuePosition ?? null,
    activeCount: partial.activeCount ?? null,
    limit: partial.limit ?? null,
    result: partial.result ?? null,
    cancel: partial.cancel ?? null,
    discoveredCount: partial.discoveredCount ?? null,
    qualifiedCount: partial.qualifiedCount ?? null,
    rejectedCount: partial.rejectedCount ?? null,
    targetCount: partial.targetCount ?? null,
    note: partial.note ?? null,
    workspace: partial.workspace ?? null,
  };
  publish();
  return clone(current);
}

/** Update the record (by operationId) if it is the current one. */
export function update(operationId: string, patch: Partial<Omit<ExecutionRecord, 'operationId' | 'startedAt'>>): ExecutionRecord | null {
  if (!current || current.operationId !== operationId) {
    // A non-current record (task adopted under a different id) — ignore; the
    // canonical record owns the current slot only.
    return get(operationId);
  }
  // A user-initiated STOP is sticky: no non-terminal status patch (e.g. a
  // late COMPLETING from the racing stream) may overwrite STOPPING.
  if (current.status === 'STOPPING' && patch.status && patch.status !== 'STOPPING') {
    return clone(current);
  }
  current = { ...current, ...patch, lastActivityAt: Date.now() };
  publish();
  return clone(current);
}

/**
 * Update a record by id whether it is CURRENT or in HISTORY (memory/count
 * milestone). Task-backed operations can be superseded in the current slot
 * by another stream (e.g. a chat reply) while their progress still lands —
 * the counts must reach the operation's own record, not only the current one.
 */
export function updateRecord(operationId: string, patch: Partial<Omit<ExecutionRecord, 'operationId' | 'startedAt'>>): ExecutionRecord | null {
  if (current && current.operationId === operationId) return update(operationId, patch);
  const h = history.find((r) => r.operationId === operationId);
  if (h) {
    Object.assign(h, patch, { lastActivityAt: Date.now() });
    publish();
    return clone(h);
  }
  return null;
}

/** Terminal end: moves the record to history and clears the current slot. */
export function end(operationId: string, status: 'COMPLETED' | 'FAILED' | 'CANCELLED', result?: string | null, note?: string | null): ExecutionRecord | null {
  if (current && current.operationId === operationId) {
    // A stopped operation can only end CANCELLED — a late stream completion
    // must never overwrite the user's stop.
    if (current.status === 'STOPPING' && status !== 'CANCELLED') {
      status = 'CANCELLED';
    }
    current.status = status;
    current.endedAt = Date.now();
    current.lastActivityAt = Date.now();
    if (result !== undefined) current.result = result;
    if (note !== undefined) current.note = note;
    pushHistory(current);
    current = null;
    publish();
    return clone(history[0]);
  }
  const h = history.find((r) => r.operationId === operationId);
  if (h) {
    h.status = status;
    h.endedAt = Date.now();
    if (result !== undefined) h.result = result;
    if (note !== undefined) h.note = note;
  }
  return h ? clone(h) : null;
}

/** Explicit STOPPING (P6): user clicked Stop — dispatch the cancel action. */
export async function cancel(operationId: string, dispatchCancel: (c: CancelAction) => Promise<void> | void): Promise<ExecutionRecord | null> {
  const rec = current && current.operationId === operationId ? current : get(operationId);
  if (!rec) return null;
  if (current && current.operationId === operationId) {
    current.status = 'STOPPING';
    current.currentAction = 'Stopping…';
    current.lastActivityAt = Date.now();
    publish();
  }
  if (rec.cancel) {
    try { await dispatchCancel(rec.cancel); } catch { /* cancel best-effort */ }
  }
  return clone(rec);
}

/** Reset (tests + boot). */
export function clearExecutions(): void {
  current = null;
  history.length = 0;
}

export function onExecutionChange(fn: (s: ReturnType<typeof snapshot>) => void): () => void {
  emitter.on('change', fn);
  return () => { emitter.off('change', fn); };
}
