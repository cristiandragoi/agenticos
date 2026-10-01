/** Lead Research Workflow Runner - Direct sequential execution */
import { runAgentLoop } from '../../services/agent/agentLoop.js';

export interface LeadResearchInput {
  query: string;
  limit?: number;
  skills?: string[];
  location?: string;
}

export interface LeadResearchResult {
  status: 'complete' | 'partial' | 'failed';
  qualifiedLeads: Lead[];
  totalDiscovered: number;
  errors?: string[];
  executionTimeMs: number;
}

export interface Lead {
  id: string;
  company_name: string;
  website: string;
  city?: string;
  industry?: string;
  buying_signal?: string;
  decision_maker_name?: string;
  decision_maker_title?: string;
  phone?: string;
  email?: string;
  lead_score?: number;
  recommended_service?: string;
  sources?: string[];
}

export async function runLeadResearchWorkflow(
  input: LeadResearchInput
): Promise<LeadResearchResult> {
  const startTime = Date.now();
  const limit = input.limit || 5;
  const errors: string[] = [];

  // STAGE 1: Lead Scout - discover companies
  const scoutPrompt = `You are a Lead Scout research agent. Find German companies matching the criteria.
  
CRITERIA: ${input.query}
Skills needed: ${(input.skills || ['Python', 'FastAPI', 'AWS']).join(', ')}
Location: ${input.location || 'Germany/Remote Europe'}

Return EXACTLY 5-10 companies in this JSON format ONLY (no other text):
{
  "companies": [
    {
      "company_name": "Company GmbH",
      "website": "https://...",
      "city": "...",
      "industry": "...",
      "reason_relevant": "Why they need external dev help"
    }
  ]
}`;

  const scoutResult = await runAgentLoop(
    scoutPrompt,
    input.query,
    5, // max iterations
    'lead-scout'
  );

  if (scoutResult.failureReason) {
    errors.push(`Lead Scout failed: ${scoutResult.failureReason}`);
    return {
      status: 'failed',
      qualifiedLeads: [],
      totalDiscovered: 0,
      errors,
      executionTimeMs: Date.now() - startTime
    };
  }

  // Parse scout results (simplified - in production use proper JSON parsing)
  const discoveredCompanies: Lead[] = [];
  // For now return stub to verify runtime works
  
  return {
    status: 'complete',
    qualifiedLeads: [],
    totalDiscovered: 0,
    executionTimeMs: Date.now() - startTime
  };
}

export default runLeadResearchWorkflow;
