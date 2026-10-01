import { AgentProviderAssignmentService } from '../server/src/services/agent/assignments.js';

async function updateDb() {
  await AgentProviderAssignmentService.saveAssignment({
    agentId: 'agent-jarvis',
    providerId: 'prov-openrouter',
    modelId: 'xiaomi/mimo-v2.6-flash',
    routingMode: 'preferred',
    enabled: true,
    updatedAt: new Date().toISOString()
  });
  console.log('Saved agent-jarvis assignment:', await AgentProviderAssignmentService.getAssignment('agent-jarvis'));
  console.log('Hermes assignment unchanged:', await AgentProviderAssignmentService.getAssignment('agent-hermes'));
}

updateDb().catch(console.error);
