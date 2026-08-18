import { logger } from '../utils/logger.js';
import { db } from '../services/db.js';
import { runStore } from '../services/runStore.js';
import { randomUUID as uuidv4 } from 'crypto';
import { ServiceLead, Artifact } from '../types.js';

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function executeLeadScoringWorkflow(leadId: string, runId: string) {
  try {
    const lead = await db.leads.get(leadId);
    if (!lead) throw new Error(`Lead ${leadId} not found`);

    // 1. Scoring
    lead.status = 'scoring';
    await db.leads.upsert(lead);
    runStore.update(runId, { status: 'running' });
    runStore.appendLog(runId, `Started lead scoring for ${lead.company}...`);
    
    await delay(1500);
    
    runStore.appendLog(runId, `Evaluating requirements and budget: ${lead.budget}`);
    
    await delay(1500);

    const budgetValue = parseInt(lead.budget.replace(/[^0-9]/g, '')) || 0;
    
    if (budgetValue < 500 && lead.budget.trim() !== '') {
      // Reject lead
      lead.status = 'rejected';
      await db.leads.upsert(lead);
      runStore.appendLog(runId, `Lead rejected. Budget ${lead.budget} is below minimum threshold.`);
      runStore.update(runId, { status: 'completed' });
      return;
    }

    // Accept lead
    runStore.appendLog(runId, `Lead qualified. Generating proposal...`);
    await delay(1500);

    const proposalMarkdown = `# Recruiter Intelligence Brief Proposal
## Prepared for ${lead.customerName} (${lead.company})

**Target Role / Goal:** ${lead.goal}

### Scope of Work
Our AI research team (Hermes) will conduct a deep-dive analysis on your specified candidate/target. 
You will receive a comprehensive Recruiter Intelligence Brief including:
- Candidate Overview & Assessment
- Role Fit & Gap Analysis
- Market Compensation Estimates
- Competitor Talent Mapping
- Strategic Recommendations

### Pricing
**Total Cost:** $1,500.00
*Based on standard deep-dive tier.*

### Next Steps
Once you submit the payment via the secure link, the research workflow will begin immediately.
`;

    // Create Proposal Artifact
    const proposalArtifact: Artifact = {
      id: `art-prop-${uuidv4()}`,
      type: 'markdown',
      title: `Proposal for ${lead.company}`,
      preview: `Service Proposal for ${lead.customerName}...`,
      content: proposalMarkdown,
      linkedBoardId: 'board-pipeline',
      version: '1.0',
      status: 'review',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await db.artifacts.upsert(proposalArtifact);

    // Update Lead
    lead.status = 'offered';
    lead.proposalArtifactId = proposalArtifact.id;
    await db.leads.upsert(lead);

    // Update Run
    const run = runStore.get(runId);
    if (run) {
      runStore.update(runId, { 
        status: 'completed',
        linkedArtifacts: [...run.linkedArtifacts, proposalArtifact.id]
      });
    }
    runStore.appendLog(runId, `Proposal generated. Redirecting to checkout: /public/checkout/${leadId}`);

  } catch (err: any) {
    logger.error('Lead scoring workflow error:', err);
    runStore.update(runId, { status: 'failed' });
    runStore.appendLog(runId, `Workflow failed: ${err.message}`);
    const lead = await db.leads.get(leadId);
    if (lead) {
      lead.status = 'rejected';
      await db.leads.upsert(lead);
    }
  }
}
