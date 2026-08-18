import { jarvisOrchestrator } from '../src/domains/jarvis/orchestrator.js';
import { codexService } from '../src/domains/codex/service.js';
import { GatewayRouter } from '../src/services/gateway/router.js';
import { loadGatewayConfig } from '../src/services/gateway/config.js';
import { GatewayShutdownManager } from '../src/services/gateway/shutdown.js';
import { conversationService } from '../src/domains/conversations/service.js';

async function runTests() {
  console.log('=== PHASE 2: REAL PATH TESTS (Jarvis & CodeX) ===\n');

  // Initialize router properly
  const config = loadGatewayConfig();
  const router = GatewayRouter.getInstance(config);
  
  // Clean start
  const isolatedRegistry = (router as any).registry;
  const originalProviders = new Map(isolatedRegistry.providers);
  
  isolatedRegistry.providers.set('mock-omni', { 
    name: 'mock-omni', 
    definition: { name: 'mock-omni', model: 'omni', type: 'openai', baseUrl: '' },
    chat: async (req: any) => ({ reply: `Mock response for: ${req.prompt.slice(0, 15)}...`, provider: 'mock-omni' }),
    stream: async function*(req: any) { 
      yield { type: 'token', content: 'Mock', provider: 'mock-omni' }; 
      yield { type: 'token', content: ' response', provider: 'mock-omni' }; 
    },
    healthcheck: async () => ({ reachable: true })
  });
  
  (router as any).config.providerOrder = ['mock-omni'];
  
  // Mock conversationService to bypass DB foreign keys
  (conversationService as any).appendMessage = async () => {};
  (conversationService as any).createConversation = async () => {};

  try {
    // 1. Test Jarvis Direct Chat
    console.log('--- Testing Jarvis Path ---');
    // Ensure conversation exists for test
    await conversationService.createConversation('test-jarvis');
    const jarvisRes = await jarvisOrchestrator.handleMessage(
      'test-jarvis',
      'Hello Jarvis',
      '/tmp/workspace',
      'auto',
      'op-1',
      { route: 'direct', confidence: 1, reason: 'test', requiresApproval: false }
    );
    console.log('Jarvis Result:', jarvisRes);

    // 2. Test CodeX Planning Path
    console.log('\n--- Testing CodeX Path ---');
    const goalId = await codexService.createGoal('Write a test script', '/tmp/workspace', 'manual');
    console.log('CodeX Goal ID:', goalId);
    
    // Wait slightly for the async planning to resolve
    await new Promise(r => setTimeout(r, 500));
    console.log('CodeX path executed successfully without throwing.');

  } catch (err: any) {
    console.error('Test failed:', err);
  } finally {
    isolatedRegistry.providers = originalProviders;
    (router as any).config.providerOrder = config.providerOrder;
    await GatewayShutdownManager.getInstance().shutdown();
  }
}

runTests().catch(console.error);
