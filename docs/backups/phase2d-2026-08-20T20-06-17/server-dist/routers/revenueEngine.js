/**
 * revenueEngine.ts — M5/M6 engine REST surface.
 * Mounted at /api/revenue-engine in index.ts.
 */
import { Router } from 'express';
import { discoverProducts, validateAndScore, decideGoNoGoForExperiment, buildProduct, measureExperiment, nextAction, } from '../services/revenueOperator/digitalProductEngine.js';
import { discoverCompanies, inspectCompany, qualifyCompany, findContact, createOffer, gateOutreach, recordOutreach, recordOutcome, smeNextAction, } from '../services/revenueOperator/germanSmeEngine.js';
import { getDistributionStatus, publishExperiment } from '../services/revenueOperator/distributionService.js';
import { runBoundedE2EMission } from '../services/revenueOperator/revenueMissionRunner.js';
import { getExperiment } from '../services/revenueOperator/operatorService.js';
const router = Router();
function wrap(fn) {
    return (req, res) => {
        Promise.resolve(fn(req, res)).catch((e) => {
            if (!res.headersSent)
                res.status(e?.status || 500).json({ error: e?.message || 'Internal error.' });
        });
    };
}
// ── Digital Products (M5) ───────────────────────────────────────────────────
router.post('/digital-products/discover', wrap(async (req, res) => {
    const { missionId, projectId, count } = req.body || {};
    if (!missionId)
        return res.status(400).json({ error: 'missionId is required.' });
    const result = await discoverProducts(missionId, { projectId, count });
    res.status(201).json(result);
}));
router.post('/experiments/:id/score', wrap(async (req, res) => {
    const score = await validateAndScore(req.params.id, req.body || {});
    res.json({ score });
}));
router.post('/experiments/:id/decide', wrap(async (req, res) => {
    const result = await decideGoNoGoForExperiment(req.params.id, req.body?.threshold);
    res.json(result);
}));
router.post('/experiments/:id/build', wrap(async (req, res) => {
    const result = await buildProduct(req.params.id, { projectId: req.body?.projectId });
    res.json(result);
}));
router.post('/experiments/:id/measure', wrap(async (req, res) => {
    const result = await measureExperiment(req.params.id, req.body || {});
    res.json(result);
}));
// ── German SME (M6) ─────────────────────────────────────────────────────────
router.post('/german-sme/discover', wrap(async (req, res) => {
    const { missionId, projectId, count, sector, market } = req.body || {};
    if (!missionId)
        return res.status(400).json({ error: 'missionId is required.' });
    const result = await discoverCompanies(missionId, { projectId, count, sector, market });
    res.status(201).json(result);
}));
router.post('/experiments/:id/inspect', wrap(async (req, res) => {
    const result = await inspectCompany(req.params.id, req.body?.projectId);
    res.json(result);
}));
router.post('/experiments/:id/qualify', wrap(async (req, res) => {
    const result = await qualifyCompany(req.params.id, req.body?.inputs || {}, req.body?.threshold);
    res.json(result);
}));
router.post('/experiments/:id/find-contact', wrap(async (req, res) => {
    const result = await findContact(req.params.id, req.body?.projectId);
    res.json(result);
}));
router.post('/experiments/:id/create-offer', wrap(async (req, res) => {
    const result = await createOffer(req.params.id, req.body?.projectId);
    res.json(result);
}));
router.post('/experiments/:id/gate-outreach', wrap(async (req, res) => {
    const result = await gateOutreach(req.params.id, req.body?.description);
    res.status(201).json(result);
}));
router.post('/experiments/:id/record-outreach', wrap(async (req, res) => {
    const result = await recordOutreach(req.params.id, req.body || {});
    res.json(result);
}));
router.post('/experiments/:id/record-outcome', wrap(async (req, res) => {
    const { won, amount } = req.body || {};
    if (typeof won !== 'boolean')
        return res.status(400).json({ error: 'won (boolean) is required.' });
    const result = await recordOutcome(req.params.id, { won, amount });
    res.json(result);
}));
// ── Shared next-action ──────────────────────────────────────────────────────
router.get('/experiments/:id/next-action', wrap(async (req, res) => {
    const exp = await getExperiment(req.params.id);
    if (!exp)
        return res.status(404).json({ error: 'Experiment not found.' });
    const action = exp.engine === 'german_sme' ? smeNextAction(exp.status) : nextAction(exp.status);
    res.json({ status: exp.status, engine: exp.engine, nextAction: action });
}));
// ── Distribution / Shopify (M7) ─────────────────────────────────────────────
router.get('/distribution', wrap(async (_req, res) => {
    res.json({ channels: getDistributionStatus() });
}));
router.post('/experiments/:id/publish', wrap(async (req, res) => {
    const result = await publishExperiment(req.params.id, req.body?.channel || 'SHOPIFY');
    res.json(result);
}));
// ── Bounded E2E mission (M15) ───────────────────────────────────────────────
router.post('/e2e/run', wrap(async (_req, res) => {
    const trace = await runBoundedE2EMission();
    res.status(trace.status === 'success' ? 200 : 206).json(trace);
}));
export default router;
