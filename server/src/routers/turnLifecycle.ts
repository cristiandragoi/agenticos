/**
 * Read-only views of the authoritative turn lifecycle and the runtime release identity.
 *   GET /api/turn-lifecycle/turns?since=<iso>&conversationId=<id>&limit=<n>
 *   GET /api/turn-lifecycle/turns/:requestId        (record + stage events)
 *   GET /api/turn-lifecycle/runtime                 (build/deployment identity of THIS process)
 */
import { Router } from 'express';
import { getTurn, listEvents, listTurns } from '../domains/turnLifecycle/index.js';
import { getBootIdentity } from '../services/deploymentIdentity.js';

const router = Router();

function decode(row: any) {
  if (!row) return row;
  const out: any = { ...row };
  for (const k of Object.keys(out)) {
    if (k.endsWith('_json') && typeof out[k] === 'string') {
      try { out[k.replace(/_json$/, '')] = JSON.parse(out[k]); delete out[k]; } catch { /* keep raw */ }
    }
  }
  return out;
}

router.get('/turns', (req, res) => {
  const rows = listTurns({
    since: typeof req.query.since === 'string' ? req.query.since : undefined,
    conversationId: typeof req.query.conversationId === 'string' ? req.query.conversationId : undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
  });
  res.json(rows.map(decode));
});

router.get('/turns/:requestId', (req, res) => {
  const row = getTurn(req.params.requestId);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json({ turn: decode(row), events: listEvents(req.params.requestId).map(decode) });
});

router.get('/runtime', (_req, res) => {
  res.json(getBootIdentity());
});

export default router;
