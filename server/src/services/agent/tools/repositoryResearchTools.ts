import { researchStore } from '../../../domains/repositoryResearch/store.js';
import type { ToolDefinition } from '../toolRegistry.js';

export const repositoryResearchHistoryTool: ToolDefinition = {
  name: 'repository_research_history', description: 'List saved GitHub repository research records. Research execution is owned by the AgenticOS autonomous goal workflow.', parameters: [],
  handler: async () => JSON.stringify(researchStore.list()),
};
export const repositoryResearchReportTool: ToolDefinition = {
  name: 'repository_research_report', description: 'Read a saved repository evaluation report and evidence by research record ID. No repository code is run.',
  parameters: [{ name: 'id', type: 'string', description: 'Research record ID from history', required: true }],
  handler: async args => {
    if (typeof args.id !== 'string' || args.id.length > 80) throw new Error('Invalid research record ID');
    const record = researchStore.get(args.id);
    return JSON.stringify(record ? { id: record.id, specification: record.specification, report: record.report, decisions: record.decisions, error: record.error } : { error: 'Research record not found' });
  },
};
