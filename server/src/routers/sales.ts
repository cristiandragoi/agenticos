import { Router } from 'express';
import { db } from '../services/db.js';
import { runStore } from '../services/runStore.js';
import { randomUUID as uuidv4 } from 'crypto';
import { executeLeadScoringWorkflow } from '../workflows/leadScoring.js';
import { executeResearchBriefWorkflow } from '../workflows/researchBrief.js';

export const salesRouter = Router();

// GET all leads
salesRouter.get('/leads', async (req, res) => {
  const leads = (await db.leads.list()).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  res.json({ success: true, leads });
});

// POST new lead (Intake)
salesRouter.post('/lead', async (req, res) => {
  const { customerName, customerEmail, company, requestType, budget, goal, cvText, jobDescription } = req.body;

  if (!customerName || !customerEmail || !company || !goal) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }

  const leadId = `lead-${uuidv4()}`;
  const now = new Date().toISOString();

  const newLead = {
    id: leadId,
    customerName,
    customerEmail,
    company,
    requestType: requestType || 'research',
    budget: budget || 'Unknown',
    goal,
    cvText,
    jobDescription,
    status: 'new' as const,
    createdAt: now,
    updatedAt: now
  };

  await db.leads.upsert(newLead);

  // Create a Run for the lead scoring
  const runId = `run-${uuidv4()}`;
  runStore.create({
    id: runId,
    agentId: 'agent-hermes', // Hermes evaluates the lead
    sessionId: 'sess-sales',
    workspaceId: 'ws-default',
    mode: 'workflow',
    status: 'queued',
    input: `Score inbound lead from ${company}`,
    logs: ['Received new lead. Queuing for scoring.'],
    events: [],
    linkedArtifacts: [],
    createdAt: now,
    updatedAt: now
  });

  // Start workflow asynchronously
  executeLeadScoringWorkflow(leadId, runId);

  res.json({ success: true, lead: newLead, runId });
});

// POST simulate payment
salesRouter.post('/lead/:id/pay', async (req, res) => {
  const { id } = req.params;
  const lead = await db.leads.get(id);

  if (!lead) {
    return res.status(404).json({ success: false, error: 'Lead not found' });
  }

  if (lead.status !== 'offered') {
    return res.status(400).json({ success: false, error: 'Lead is not in offered status' });
  }

  lead.status = 'paid';
  lead.updatedAt = new Date().toISOString();
  await db.leads.upsert(lead);

  // Payment successful, now we spawn the Research Brief workflow!
  // 1. Create a Research Brief internally
  const briefId = `brief-${uuidv4()}`;
  const newBrief = {
    id: briefId,
    title: `Research for ${lead.company}`,
    requestType: 'company' as const,
    target: lead.company,
    goal: lead.goal,
    competitors: [],
    priority: 'high' as const,
    outputFormat: 'markdown' as const,
    status: 'intake' as const,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    artifactIds: []
  };
  await db.researchBriefs.upsert(newBrief);

  // Link brief to lead
  lead.briefId = briefId;
  await db.leads.upsert(lead);

  // 2. Create the run for research workflow
  const runId = `run-${uuidv4()}`;
  runStore.create({
    id: runId,
    agentId: 'agent-hermes',
    sessionId: 'sess-research',
    workspaceId: 'ws-default',
    mode: 'workflow',
    status: 'queued',
    input: `Execute paid research brief for ${lead.company}`,
    logs: ['Payment received. Initiating research workflow.'],
    events: [],
    linkedArtifacts: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  // Start research workflow
  executeResearchBriefWorkflow(briefId, runId);

  // Update lead status to in_progress
  lead.status = 'in_progress';
  await db.leads.upsert(lead);

  res.json({ success: true, lead });
});
