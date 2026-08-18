/**
 * RunLedger v1 — REST surface (P17): one inspectable normalized record per
 * run/task, parent/child chains, evidence, active/recent queries.
 */
import { Router } from 'express';
import { runLedger } from '../services/runLedger.js';

export const runLedgerRouter = Router();

// GET /api/run-ledger/runs?projectId=&limit=
runLedgerRouter.get('/runs', (req, res) => {
  try {
    const projectId = (req.query.projectId as string) || null;
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 20));
    res.json({ runs: runLedger.getRecentRuns(projectId, limit) });
  } catch (e: any) {
    res.status(500).json({ error: e?.message });
  }
});

// GET /api/run-ledger/active?projectId=
runLedgerRouter.get('/active', (req, res) => {
  try {
    const projectId = (req.query.projectId as string) || null;
    res.json({ runs: runLedger.getActiveRuns(projectId) });
  } catch (e: any) {
    res.status(500).json({ error: e?.message });
  }
});

// GET /api/run-ledger/runs/last/completed|failed|cancelled?projectId=
runLedgerRouter.get('/runs/last/:kind', (req, res) => {
  try {
    const projectId = (req.query.projectId as string) || null;
    const kind = req.params.kind;
    const entry = kind === 'failed'
      ? runLedger.getLastFailedRun(projectId)
      : kind === 'cancelled'
        ? runLedger.getLastCancelledRun(projectId)
        : runLedger.getLastCompletedRun(projectId);
    if (!entry) return res.status(404).json({ error: 'No matching run.' });
    res.json({ run: entry });
  } catch (e: any) {
    res.status(500).json({ error: e?.message });
  }
});

// GET /api/run-ledger/:id  (run id or task id)
runLedgerRouter.get('/:id', (req, res) => {
  try {
    const entry = runLedger.getRun(req.params.id);
    if (!entry) return res.status(404).json({ error: 'Run not found.' });
    res.json({
      run: entry,
      parent: runLedger.getParent(req.params.id),
      children: runLedger.getChildren(req.params.id),
      evidence: runLedger.getRunEvidence(req.params.id),
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message });
  }
});
