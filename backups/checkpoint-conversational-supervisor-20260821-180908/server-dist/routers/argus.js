/**
 * ARGUS REST surface — contracts, verifications, defects, auto-verify.
 */
import { Router } from 'express';
import { createContract, verifyGoal, listContracts, getContractById, listDefects, listVerifications, getArgusAssignment, } from '../services/argus/argusService.js';
import { goalStore } from '../services/goalStore.js';
export const argusRouter = Router();
// GET /api/argus/contracts
argusRouter.get('/contracts', (_req, res) => {
    try {
        res.json({ contracts: listContracts(100) });
    }
    catch (e) {
        res.status(500).json({ error: e?.message });
    }
});
// GET /api/argus/contracts/:id  (contract detail + verifications + goal state)
argusRouter.get('/contracts/:id', (req, res) => {
    try {
        const contract = getContractById(req.params.id);
        if (!contract)
            return res.status(404).json({ error: 'Contract not found.' });
        const goal = goalStore.get(contract.goalId);
        res.json({
            contract,
            goal: goal ? { id: goal.id, status: goal.status, verificationState: goal.verificationState, runSummary: goal.runSummary } : null,
            verifications: listVerifications(contract.id, 20),
            defects: listDefects(100).filter((d) => d.contractId === contract.id),
        });
    }
    catch (e) {
        res.status(500).json({ error: e?.message });
    }
});
// POST /api/argus/contracts  { goalId, acceptanceCriteria?, title? }
argusRouter.post('/contracts', async (req, res) => {
    try {
        const { goalId, acceptanceCriteria, title } = req.body || {};
        if (!goalId)
            return res.status(400).json({ error: 'goalId is required.' });
        const contract = await createContract(goalId, { acceptanceCriteria, title });
        res.status(201).json({ contract });
    }
    catch (e) {
        res.status(e?.status || 500).json({ error: e?.message });
    }
});
// POST /api/argus/verify  { goalId }  → runs verification (await + poll)
argusRouter.post('/verify', async (req, res) => {
    try {
        const { goalId } = req.body || {};
        if (!goalId)
            return res.status(400).json({ error: 'goalId is required.' });
        const result = await verifyGoal(goalId);
        res.json({ verification: result });
    }
    catch (e) {
        res.status(e?.status || 500).json({ error: e?.message });
    }
});
// GET /api/argus/verifications?contractId=
argusRouter.get('/verifications', (req, res) => {
    try {
        const contractId = req.query.contractId || undefined;
        res.json({ verifications: listVerifications(contractId, 100) });
    }
    catch (e) {
        res.status(500).json({ error: e?.message });
    }
});
// GET /api/argus/defects
argusRouter.get('/defects', (req, res) => {
    try {
        res.json({ defects: listDefects(100) });
    }
    catch (e) {
        res.status(500).json({ error: e?.message });
    }
});
// GET /api/argus/goals/:goalId  (contract status for a goal — UI widget)
argusRouter.get('/goals/:goalId', (req, res) => {
    try {
        const goal = goalStore.get(req.params.goalId);
        if (!goal)
            return res.status(404).json({ error: 'Goal not found.' });
        const contracts = listContracts(100).filter((c) => c.goalId === goal.id);
        res.json({
            goal: { id: goal.id, status: goal.status, verificationState: goal.verificationState, contractId: goal.contractId },
            contracts,
            verifications: listVerifications(undefined, 100).filter((v) => v.goalId === goal.id),
        });
    }
    catch (e) {
        res.status(500).json({ error: e?.message });
    }
});
// GET /api/argus/assignment  (requirement 4 — observable provider/model)
argusRouter.get('/assignment', async (_req, res) => {
    try {
        const assignment = await getArgusAssignment();
        res.json({ assignment });
    }
    catch (e) {
        res.status(500).json({ error: e?.message });
    }
});
