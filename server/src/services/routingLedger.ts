/**
 * Authoritative provider/model routing ledger (PRIORITY 1).
 *
 * ONE source of truth for what a given execution actually routed to. Every
 * execution (Jarvis stream, CodeX goal, Hermes run, revenue run,
 * investigation) records a RoutingRecord so "What model are you using?" is
 * answered from runtime execution metadata — never from the LLM's knowledge.
 *
 * The ledger is the record; the assignment service + gateway remain the
 * config. fallbackUsed/fallbackReason capture when the resolved provider
 * differs from the requested one.
 */
export interface RoutingRecord {
  operationId: string;
  worker: 'jarvis' | 'codex' | 'hermes' | 'revenue' | 'investigate' | 'other';
  routingMode: 'auto' | 'manual';
  requestedProvider: string | null;
  requestedModel: string | null;
  resolvedProvider: string | null;
  resolvedModel: string | null;
  fallbackUsed: boolean;
  fallbackReason: string | null;
  startedAt: number;
  endedAt: number | null;
}

const MAX_LEDGER = 200;
const ledger: RoutingRecord[] = [];
const byOperation = new Map<string, RoutingRecord>();

export const routingLedger = {
  record(rec: RoutingRecord): RoutingRecord {
    byOperation.set(rec.operationId, rec);
    ledger.push(rec);
    if (ledger.length > MAX_LEDGER) {
      const dropped = ledger.splice(0, ledger.length - MAX_LEDGER);
      for (const d of dropped) {
        if (byOperation.get(d.operationId) === d) byOperation.delete(d.operationId);
      }
    }
    return rec;
  },
  end(operationId: string, endedAt = Date.now()): void {
    const rec = byOperation.get(operationId);
    if (rec) rec.endedAt = endedAt;
  },
  get(operationId: string): RoutingRecord | null {
    return byOperation.get(operationId) || null;
  },
  latest(worker?: RoutingRecord['worker'], limit = 1): RoutingRecord[] {
    const filtered = worker ? ledger.filter((r) => r.worker === worker) : ledger;
    return filtered.slice(-limit).reverse();
  },
  /** Recent records for a conversation-ish view (by operation prefix). */
  forConversation(operationIdPrefix: string, limit = 5): RoutingRecord[] {
    return ledger.filter((r) => r.operationId.startsWith(operationIdPrefix)).slice(-limit).reverse();
  },
  clear(): void {
    ledger.length = 0;
    byOperation.clear();
  },
};
