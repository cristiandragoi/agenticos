// Self-Heal REST API Router — Governance-Hardened
import { Router } from 'express';
import { selfHealSupervisor } from '../domains/selfHeal/SelfHealSupervisor.js';
import { failureDetector } from '../domains/selfHeal/FailureDetector.js';
import { repairMemory } from '../domains/selfHeal/RepairMemory.js';
import { auditLog } from '../domains/selfHeal/AuditLog.js';
import { deploymentGate } from '../domains/selfHeal/DeploymentGate.js';
import {
  getSupervisorApprovalVerifier,
  getRuntimeDeploymentIdentity,
  approvalHash,
  type ApprovalBinding,
} from '../domains/securitySupervisor/approvalVerifier.js';

export const selfHealRouter = Router();

// GET /api/self-heal/status
selfHealRouter.get('/status', async (req, res) => {
  try {
    const incidents = await repairMemory.listIncidents(100);
    const activeIncidents = incidents.filter(i =>
      !['COMPLETED', 'BLOCKED_MODEL_UNAVAILABLE', 'BLOCKED_SNAPSHOT_INVALID',
        'BLOCKED_TEST_FAILURE', 'BLOCKED_VERIFIER_UNAVAILABLE', 'BLOCKED_APPROVAL_REQUIRED'
      ].includes(i.status)
    );
    res.json({
      status: 'healthy',
      governance: 'v2-hardened',
      activeIncidentCount: activeIncidents.length,
      activeIncidents: activeIncidents.map(i => ({
        incidentId: i.incidentId,
        status: i.status,
        component: i.component,
      })),
    });
  } catch (error) {
    console.error('[SelfHeal:Router] Error fetching status:', error);
    res.status(500).json({ error: 'Failed to fetch status' });
  }
});

// GET /api/self-heal/incidents
selfHealRouter.get('/incidents', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const incidents = await repairMemory.listIncidents(limit);
    res.json({ incidents });
  } catch (error) {
    console.error('[SelfHeal:Router] Error listing incidents:', error);
    res.status(500).json({ error: 'Failed to list incidents' });
  }
});

// GET /api/self-heal/incidents/:id
selfHealRouter.get('/incidents/:id', async (req, res) => {
  try {
    const history = await repairMemory.getIncidentHistory(req.params.id);
    if (!history) return res.status(404).json({ error: 'Incident not found' });
    const state = selfHealSupervisor.getIncidentState(req.params.id);
    res.json({ ...history, currentState: state });
  } catch (error) {
    console.error(`[SelfHeal:Router] Error fetching incident ${req.params.id}:`, error);
    res.status(500).json({ error: 'Failed to fetch incident' });
  }
});

// POST /api/self-heal/incidents — manually create incident
selfHealRouter.post('/incidents', async (req, res) => {
  try {
    const { component, symptom, failureDomain, priority, metadata } = req.body;
    if (!component || !symptom) {
      return res.status(400).json({ error: 'component and symptom required' });
    }
    const incidentId = await failureDetector.createManualIncident(
      component, symptom, failureDomain || 'unknown', priority || 'medium', metadata,
    );
    res.json({ incidentId, status: 'CREATED' });
  } catch (error) {
    console.error('[SelfHeal:Router] Error creating incident:', error);
    res.status(500).json({ error: 'Failed to create incident' });
  }
});

// POST /api/self-heal/incidents/:id/diagnose
selfHealRouter.post('/incidents/:id/diagnose', async (req, res) => {
  try {
    const { id } = req.params;
    res.json({ incidentId: id, status: 'DIAGNOSING', message: 'Diagnosis started' });
    selfHealSupervisor.diagnoseIncident(id).catch(err => {
      console.error(`[SelfHeal:Router] Diagnosis error for ${id}:`, err);
    });
  } catch (error) {
    console.error(`[SelfHeal:Router] Error initiating diagnosis:`, error);
    res.status(500).json({ error: 'Failed to initiate diagnosis' });
  }
});

// POST /api/self-heal/incidents/:id/repair
selfHealRouter.post('/incidents/:id/repair', async (req, res) => {
  try {
    const { id } = req.params;
    res.json({ incidentId: id, status: 'REPAIRING', message: 'Repair pipeline started' });
    selfHealSupervisor.repairIncident(id).catch(err => {
      console.error(`[SelfHeal:Router] Repair error for ${id}:`, err);
    });
  } catch (error) {
    console.error(`[SelfHeal:Router] Error initiating repair:`, error);
    res.status(500).json({ error: 'Failed to initiate repair' });
  }
});

// POST /api/self-heal/incidents/:id/approve — EXPLICIT HUMAN APPROVAL
// Requires verified signed envelope from out-of-process issuer; plain JSON fails closed.
selfHealRouter.post('/incidents/:id/approve', async (req, res) => {
  const { envelope, payload, signature } = req.body || {};
  const approvalPayload = envelope?.payload || payload;
  const approvalSig = envelope?.signature || signature;

  if (!approvalPayload || !approvalSig) {
    return res.status(503).json({
      error: 'APPROVAL_ISSUER_UNAVAILABLE',
      message: "Plain client JSON ({approver}) cannot grant approval; out-of-process issuer envelope required",
    });
  }

  try {
    const incidentId = req.params.id;
    const expectedBinding: ApprovalBinding = {
      goalId: incidentId,
      graphId: 'self-heal',
      nodeId: incidentId,
      workerId: 'selfHealSupervisor',
      operation: 'SELF_HEAL_APPROVE',
      attempt: 1,
      tool: 'selfHeal.approveRepair',
      scopeHash: approvalHash({ incidentId }),
      argumentHash: approvalHash({ incidentId }),
      previewHash: approvalHash(`Self-heal repair approval for incident ${incidentId}`),
      runtimeIncarnation: getRuntimeDeploymentIdentity().incarnation,
      bootTimestamp: getRuntimeDeploymentIdentity().bootTimestamp,
    };

    getSupervisorApprovalVerifier().consume(approvalPayload, approvalSig, expectedBinding);
    const approved = await selfHealSupervisor.approveIncident(incidentId, 'operator');
    return res.json({ success: approved, incidentId, status: 'APPROVED' });
  } catch (err: any) {
    return res.status(403).json({
      error: 'APPROVAL_VERIFICATION_FAILED',
      message: err?.message || String(err),
    });
  }
});

// POST /api/self-heal/incidents/:id/reject
selfHealRouter.post('/incidents/:id/reject', async (req, res) => {
  try {
    const { reason = 'Rejected by human' } = req.body;
    auditLog.appendEntry({
      incidentId: req.params.id,
      fromState: selfHealSupervisor.getIncidentState(req.params.id) ?? null,
      toState: 'BLOCKED_APPROVAL_REQUIRED' as any,
      timestamp: new Date().toISOString(),
      actor: 'human_api',
      reason,
    });
    res.json({ incidentId: req.params.id, status: 'rejected' });
  } catch (error) {
    console.error(`[SelfHeal:Router] Error rejecting repair:`, error);
    res.status(500).json({ error: 'Failed to reject repair' });
  }
});

// GET /api/self-heal/budget/:id
selfHealRouter.get('/budget/:id', async (req, res) => {
  try {
    const budget = selfHealSupervisor.getBudgetStatus(req.params.id);
    if (!budget) return res.status(404).json({ error: 'No active budget for this incident' });
    res.json({ incidentId: req.params.id, budget });
  } catch (error) {
    console.error(`[SelfHeal:Router] Error fetching budget:`, error);
    res.status(500).json({ error: 'Failed to fetch budget' });
  }
});

// GET /api/self-heal/audit/:id — audit trail for an incident
selfHealRouter.get('/audit/:id', async (req, res) => {
  try {
    const entries = auditLog.getEntries(req.params.id);
    res.json({ incidentId: req.params.id, entries });
  } catch (error) {
    console.error(`[SelfHeal:Router] Error fetching audit log:`, error);
    res.status(500).json({ error: 'Failed to fetch audit log' });
  }
});

// GET /api/self-heal/audit — full audit trail
selfHealRouter.get('/audit', async (req, res) => {
  try {
    const entries = auditLog.getAllEntries();
    res.json({ entries });
  } catch (error) {
    console.error(`[SelfHeal:Router] Error fetching full audit log:`, error);
    res.status(500).json({ error: 'Failed to fetch full audit log' });
  }
});
