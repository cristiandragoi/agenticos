import { AgentProviderAssignmentService } from '../server/src/services/agent/assignments.js';
import { getAgentModelPolicy, resolveCandidateRoutes } from '../server/src/services/gateway/agentModelPolicy.js';
import { secretStore } from '../server/src/services/gateway/secretStore.js';
import { loadGatewayConfig } from '../server/src/services/gateway/config.js';
import { GatewayRouter } from '../server/src/services/gateway/router.js';
import { llmChat } from '../server/src/services/llmGateway.js';

async function main() {
  console.log('=== PART 1: EXACT MODEL & RUNTIME CONFIGURATION ===');
  
  const jarvisAssignment = await AgentProviderAssignmentService.getAssignment('agent-jarvis');
  const hermesAssignment = await AgentProviderAssignmentService.getAssignment('agent-hermes');
  
  console.log('JARVIS_DB_ASSIGNMENT:', JSON.stringify(jarvisAssignment, null, 2));
  console.log('HERMES_DB_ASSIGNMENT:', JSON.stringify(hermesAssignment, null, 2));
  
  const jarvisPolicy = getAgentModelPolicy('jarvis');
  const hermesPolicy = getAgentModelPolicy('hermes');
  
  console.log('JARVIS_AGENT_POLICY:', JSON.stringify(jarvisPolicy, null, 2));
  console.log('HERMES_AGENT_POLICY:', JSON.stringify(hermesPolicy, null, 2));
  
  const jarvisRoutes = resolveCandidateRoutes('jarvis');
  const hermesRoutes = resolveCandidateRoutes('hermes');
  
  console.log('JARVIS_RESOLVED_CANDIDATE_ROUTES:', JSON.stringify(jarvisRoutes, null, 2));
  console.log('HERMES_RESOLVED_CANDIDATE_ROUTES:', JSON.stringify(hermesRoutes, null, 2));
  
  const gatewayConfig = loadGatewayConfig();
  console.log('CONFIGURED_PROVIDERS:', gatewayConfig.providers.map(p => ({
    name: p.name,
    model: p.model,
    baseUrl: p.baseUrl,
    hasApiKey: Boolean(p.apiKey),
    tags: p.tags
  })));
  console.log('PROVIDER_ORDER:', gatewayConfig.providerOrder);
  
  const openrouterKey = secretStore.getSync('openrouter') || process.env.OPENROUTER_API_KEY;
  const deepgramKey = secretStore.getSync('deepgram') || process.env.DEEPGRAM_API_KEY;
  const deepseekKey = secretStore.getSync('deepseek') || process.env.DEEPSEEK_API_KEY;
  
  console.log('SECRETS_STATUS:', {
    openrouter: Boolean(openrouterKey),
    deepgram: Boolean(deepgramKey),
    deepseek: Boolean(deepseekKey),
    ollamaBase: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
    omnirouteBase: process.env.OMNIROUTE_BASE_URL || 'http://127.0.0.1:20128/v1',
    codexBase: process.env.CODEX_BASE_URL || 'http://127.0.0.1:20130/v1',
  });
  
  console.log('\n--- TESTING ACTUAL LLM CALL FOR JARVIS ---');
  try {
    const jarvisRes = await llmChat({
      prompt: 'Respond in 5 words or fewer: What model are you?',
      agentId: 'agent-jarvis',
      timeoutMs: 15000,
    });
    console.log('JARVIS_LLM_RESULT:', {
      provider: jarvisRes.provider,
      model: jarvisRes.model,
      offline: jarvisRes.offline,
      reply: jarvisRes.reply,
      error: jarvisRes.error,
    });
  } catch (err: any) {
    console.error('JARVIS_LLM_ERROR:', err?.message || err);
  }

  console.log('\n--- TESTING ACTUAL LLM CALL FOR HERMES ---');
  try {
    const hermesRes = await llmChat({
      prompt: 'Respond in 5 words or fewer: What model are you?',
      agentId: 'agent-hermes',
      timeoutMs: 15000,
    });
    console.log('HERMES_LLM_RESULT:', {
      provider: hermesRes.provider,
      model: hermesRes.model,
      offline: hermesRes.offline,
      reply: hermesRes.reply,
      error: hermesRes.error,
    });
  } catch (err: any) {
    console.error('HERMES_LLM_ERROR:', err?.message || err);
  }
}

main().catch(console.error);
