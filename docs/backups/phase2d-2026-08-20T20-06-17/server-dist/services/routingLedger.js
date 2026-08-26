const MAX_LEDGER = 200;
const ledger = [];
const byOperation = new Map();
export const routingLedger = {
    record(rec) {
        byOperation.set(rec.operationId, rec);
        ledger.push(rec);
        if (ledger.length > MAX_LEDGER) {
            const dropped = ledger.splice(0, ledger.length - MAX_LEDGER);
            for (const d of dropped) {
                if (byOperation.get(d.operationId) === d)
                    byOperation.delete(d.operationId);
            }
        }
        return rec;
    },
    end(operationId, endedAt = Date.now()) {
        const rec = byOperation.get(operationId);
        if (rec)
            rec.endedAt = endedAt;
    },
    get(operationId) {
        return byOperation.get(operationId) || null;
    },
    latest(worker, limit = 1) {
        const filtered = worker ? ledger.filter((r) => r.worker === worker) : ledger;
        return filtered.slice(-limit).reverse();
    },
    /** Recent records for a conversation-ish view (by operation prefix). */
    forConversation(operationIdPrefix, limit = 5) {
        return ledger.filter((r) => r.operationId.startsWith(operationIdPrefix)).slice(-limit).reverse();
    },
    clear() {
        ledger.length = 0;
        byOperation.clear();
    },
};
