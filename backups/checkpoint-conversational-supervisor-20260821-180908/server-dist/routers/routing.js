/**
 * Routing ledger + Test Routing (PRIORITY 1 + 2).
 *   GET /api/routing/ledger/:operationId — the authoritative routing record.
 *   GET /api/routing/ledger?worker=jarvis&limit=5 — recent records.
 */
import { Router } from 'express';
import { routingLedger } from '../services/routingLedger.js';
export const routingRouter = Router();
routingRouter.get('/ledger/:operationId', (req, res) => {
    const rec = routingLedger.get(req.params.operationId);
    if (!rec) {
        res.status(404).json({ error: 'No routing record for this operation' });
        return;
    }
    res.json(rec);
});
routingRouter.get('/ledger', (req, res) => {
    const worker = req.query.worker;
    const limit = Math.min(parseInt(String(req.query.limit || '5'), 10) || 5, 50);
    res.json(routingLedger.latest(worker, limit));
});
