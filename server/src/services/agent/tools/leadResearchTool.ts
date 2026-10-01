import { logger } from '../../../utils/logger.js';
import { runLeadResearchWorkflow, LeadResearchInput } from '../../../workflows/lead-research/runWorkflow.js';

export const leadResearchTool = {
  name: 'run_lead_research',
  description: 'Research and qualify prospective business leads in Germany for software/AI development services. Returns discovered companies with buying signals, decision-makers, scoring, and persistence.',
  parameters: [
    { name: 'query', type: 'string', description: 'Search criteria (e.g., "Python/AI companies in Germany")', required: true },
    { name: 'limit', type: 'number', description: 'Maximum qualified leads to return (default: 5)', required: false },
    { name: 'skills', type: 'array', items: { type: 'string' }, description: 'Specific technical skills/technologies', required: false },
    { name: 'location', type: 'string', description: 'Target location (e.g., "Germany", "Remote Europe")', required: false }
  ],
  handler: async (args: Record<string, unknown>): Promise<string> => {
    logger.info(`[run_lead_research] Starting research with query: ${args.query}`);
    
    try {
      const input: LeadResearchInput = {
        query: args.query as string,
        limit: typeof args.limit === 'number' ? args.limit : (Number(args.limit) || 5),
        skills: args.skills ? [(args.skills as any[])[0]] : ['Python', 'FastAPI'],
        location: args.location as string || 'Germany'
      };

      const result = await runLeadResearchWorkflow(input);
      
      logger.info(`[run_lead_research] Completed: ${result.qualifiedLeads.length} leads, ${result.executionTimeMs}ms`);
      
      return JSON.stringify({
        success: true,
        message: `Found ${result.qualifiedLeads.length} qualified leads`,
        status: result.status,
        qualifiedLeadsCount: result.qualifiedLeads.length,
        totalDiscovered: result.totalDiscovered,
        executionTimeMs: result.executionTimeMs,
        errors: result.errors || [],
        sampleLead: result.qualifiedLeads[0]
      });
    } catch (error) {
      logger.error(`[run_lead_research] Error:`, error);
      return JSON.stringify({
        success: false,
        message: 'Lead research failed',
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
};
