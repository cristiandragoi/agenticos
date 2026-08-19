/**
 * Revenue Operator Phase 1 — REST surface.
 * Mounted at /api/revenue-operator in index.ts.
 */
import { Router } from 'express';
import {
  createMission, getMission, listMissions, updateMission, recomputeMissionAggregates,
  createExperiment, getExperiment, listExperiments, transitionExperiment,
  addExperimentEvidence, linkExperimentRun, scoreExperiment,
  recordLedgerEntry, listLedger,
  seedChannels, listChannels, updateChannel,
  createComplianceRecord, listCompliance, updateComplianceRecord,
  createHumanGate, listHumanGates, resolveHumanGate,
  missionObservability,
} from '../services/revenueOperator/operatorService.js';
import {
  traceMission, kpiBreakdown, engineBoard, liveExecution, gateQueue,
  traceExperiment, traceLedgerEntry, type KpiKey,
} from '../services/revenueOperator/traceService.js';

const router = Router();

function wrap(fn: (req: any, res: any) => Promise<void> | void) {
  return (req: any, res: any) => {
    Promise.resolve(fn(req, res)).catch((e: any) => {
      if (!res.headersSent) res.status(e?.status || 500).json({ error: e?.message || 'Internal error.' });
    });
  };
}

// ── Missions ────────────────────────────────────────────────────────────────
router.post('/missions', wrap(async (req, res) => {
  const b = req.body || {};
  const mission = await createMission({
    title: b.title, description: b.description, projectId: b.projectId,
    targetAmount: Number(b.targetAmount) || 0, currency: b.currency, startDate: b.startDate,
    deadline: b.deadline, advertisingBudget: Number(b.advertisingBudget) || 0,
    enabledEngines: b.enabledEngines, availableChannels: b.availableChannels, primaryMarket: b.primaryMarket,
  });
  res.status(201).json({ mission });
}));

router.get('/missions', wrap(async (_req, res) => res.json({ missions: await listMissions() })));
router.get('/missions/:id', wrap(async (req, res) => {
  const m = await getMission(req.params.id);
  if (!m) return res.status(404).json({ error: 'Mission not found.' });
  res.json({ mission: m });
}));

router.patch('/missions/:id', wrap(async (req, res) => {
  const m = await updateMission(req.params.id, req.body || {});
  if (!m) return res.status(404).json({ error: 'Mission not found.' });
  res.json({ mission: m });
}));

router.post('/missions/:id/recompute', wrap(async (req, res) => {
  const agg = recomputeMissionAggregates(req.params.id);
  res.json({ aggregates: agg });
}));

// ── Experiments ─────────────────────────────────────────────────────────────
router.post('/experiments', wrap(async (req, res) => {
  const b = req.body || {};
  const exp = await createExperiment({
    missionId: b.missionId, projectId: b.projectId, opportunityId: b.opportunityId,
    engine: b.engine, hypothesis: b.hypothesis, targetCustomer: b.targetCustomer,
    problem: b.problem, product: b.product, offer: b.offer, price: Number(b.price) || undefined,
    expectedRevenue: Number(b.expectedRevenue) || undefined, estimatedCost: Number(b.estimatedCost) || undefined,
    distributionChannels: b.distributionChannels, confidence: Number(b.confidence) || undefined,
  });
  res.status(201).json({ experiment: exp });
}));

router.get('/experiments', wrap(async (req, res) => {
  const missionId = (req.query.missionId as string) || undefined;
  res.json({ experiments: await listExperiments(missionId) });
}));

router.get('/experiments/:id', wrap(async (req, res) => {
  const e = await getExperiment(req.params.id);
  if (!e) return res.status(404).json({ error: 'Experiment not found.' });
  res.json({ experiment: e });
}));

router.patch('/experiments/:id/status', wrap(async (req, res) => {
  const { status } = req.body || {};
  if (!status) return res.status(400).json({ error: 'status is required.' });
  const e = await transitionExperiment(req.params.id, status);
  res.json({ experiment: e });
}));

router.post('/experiments/:id/evidence', wrap(async (req, res) => {
  const entry = await addExperimentEvidence(req.params.id, req.body || {});
  res.status(201).json({ evidence: entry });
}));

router.post('/experiments/:id/link', wrap(async (req, res) => {
  const { kind, refId } = req.body || {};
  if (!kind || !refId) return res.status(400).json({ error: 'kind and refId are required.' });
  const e = await linkExperimentRun(req.params.id, kind, refId);
  res.json({ experiment: e });
}));

router.post('/experiments/:id/score', wrap(async (req, res) => {
  const s = await scoreExperiment(req.params.id, req.body || {});
  res.json({ score: s });
}));

// ── Ledger ──────────────────────────────────────────────────────────────────
router.post('/ledger', wrap(async (req, res) => {
  const b = req.body || {};
  const entry = await recordLedgerEntry({
    missionId: b.missionId, experimentId: b.experimentId, entryType: b.entryType,
    amount: Number(b.amount) || 0, currency: b.currency, source: b.source,
    evidence: b.evidence, provenance: b.provenance,
  });
  res.status(201).json({ entry });
}));

router.get('/ledger', wrap(async (req, res) => {
  const missionId = (req.query.missionId as string) || undefined;
  res.json({ entries: await listLedger(missionId) });
}));

// ── Distribution channels ───────────────────────────────────────────────────
router.post('/channels/seed', wrap(async (_req, res) => res.json({ channels: await seedChannels() })));
router.get('/channels', wrap(async (_req, res) => res.json({ channels: await listChannels() })));
router.patch('/channels/:id', wrap(async (req, res) => {
  const c = await updateChannel(req.params.id, req.body || {});
  if (!c) return res.status(404).json({ error: 'Channel not found.' });
  res.json({ channel: c });
}));

// ── Compliance ──────────────────────────────────────────────────────────────
router.post('/compliance', wrap(async (req, res) => {
  const c = await createComplianceRecord(req.body || {});
  res.status(201).json({ compliance: c });
}));
router.get('/compliance', wrap(async (req, res) => {
  const experimentId = (req.query.experimentId as string) || undefined;
  res.json({ records: await listCompliance(experimentId) });
}));
router.patch('/compliance/:id', wrap(async (req, res) => {
  const c = await updateComplianceRecord(req.params.id, req.body || {});
  if (!c) return res.status(404).json({ error: 'Compliance record not found.' });
  res.json({ compliance: c });
}));

// ── Human gates ─────────────────────────────────────────────────────────────
router.post('/gates', wrap(async (req, res) => {
  const g = await createHumanGate(req.body || {});
  res.status(201).json({ gate: g });
}));
router.get('/gates', wrap(async (req, res) => {
  const status = (req.query.status as string) || undefined;
  res.json({ gates: await listHumanGates(status) });
}));
router.post('/gates/:id/resolve', wrap(async (req, res) => {
  const g = await resolveHumanGate(req.params.id, req.body?.resolvedBy || 'human');
  if (!g) return res.status(404).json({ error: 'Gate not found.' });
  res.json({ gate: g });
}));

// ── Observability ───────────────────────────────────────────────────────────
router.get('/observability/:missionId', wrap(async (req, res) => {
  res.json(await missionObservability(req.params.missionId));
}));

// ── Traceability (UI drill-down layer — read-only, persisted truth only) ───
router.get('/missions/:id/trace', wrap(async (req, res) => {
  res.json(await traceMission(req.params.id));
}));

router.get('/missions/:id/kpi/:kpi', wrap(async (req, res) => {
  res.json(await kpiBreakdown(req.params.id, req.params.kpi as KpiKey));
}));

router.get('/missions/:id/board/:engine', wrap(async (req, res) => {
  const engine = req.params.engine as 'digital_products' | 'german_sme' | 'pipeline';
  if (!['digital_products', 'german_sme', 'pipeline'].includes(engine)) {
    return res.status(400).json({ error: 'engine must be digital_products | german_sme | pipeline.' });
  }
  res.json(await engineBoard(req.params.id, engine));
}));

router.get('/missions/:id/live-execution', wrap(async (req, res) => {
  res.json(await liveExecution(req.params.id));
}));

router.get('/gates/queue', wrap(async (req, res) => {
  const status = (req.query.status as string) || undefined;
  res.json({ gates: await gateQueue(status) });
}));

router.get('/experiments/:id/trace', wrap(async (req, res) => {
  res.json(await traceExperiment(req.params.id));
}));

router.get('/ledger/:id/trace', wrap(async (req, res) => {
  res.json(await traceLedgerEntry(req.params.id));
}));

export default router;
