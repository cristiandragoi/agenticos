import { GatewayRouter } from '../src/services/gateway/router.js';
import { ModelGateway, ChatStreamChunk, ProviderDefinition } from '../src/services/gateway/types.js';
import { loadGatewayConfig } from '../src/services/gateway/config.js';
import { GatewayShutdownManager } from '../src/services/gateway/shutdown.js';

class MockStreamingProvider implements ModelGateway {
  name: string;
  definition: ProviderDefinition;
  behavior: (req: any) => AsyncGenerator<ChatStreamChunk>;

  constructor(name: string, behavior: (req: any) => AsyncGenerator<ChatStreamChunk>) {
    this.name = name;
    this.definition = { name, type: 'mock', model: 'mock', baseUrl: '' };
    this.behavior = behavior;
  }
  
  async healthcheck() { return { reachable: true }; }
  async chat() { return { reply: '', provider: this.name, model: 'mock', offline: false }; }
  stream(req: any) { return this.behavior(req); }
  
  supportsTools() { return false; }
  supportsVision() { return false; }
  supportsReasoning() { return false; }
  supportsStreaming() { return true; }
  maxContext() { return 8192; }
}

async function runStreamingTests() {
  console.log('=== PHASE 2: STREAMING MATRIX TESTS ===\n');
  
  const config = loadGatewayConfig();
  // Override thresholds for easy testing
  config.streamBufferTokens = 5;
  config.streamBufferMilliseconds = 500;
  
  const router = GatewayRouter.getInstance(config);
  
  // Inject mock providers into the router's registry
  const registry = (router as any).registry;
  
  // Helper to run a test scenario
  async function runScenario(scenarioId: number, name: string, providers: ModelGateway[]) {
    console.log(`\nScenario ${scenarioId}: ${name}`);
    registry.providers = new Map(providers.map(p => [p.name, p]));
    (router as any).config.providerOrder = providers.map(p => p.name);
    
    let result = '';
    let events: any[] = [];
    
    const listener = (ev: any) => events.push(ev);
    router.onEvent(listener);
    
    try {
      const stream = router.stream({ prompt: 'test' });
      for await (const chunk of stream) {
        if (chunk.type === 'token') result += chunk.content;
        else if (chunk.type === 'error') result += `[ERROR: ${chunk.error}]`;
      }
    } catch (err: any) {
      result += `[FATAL: ${err.message}]`;
    }
    
    const fallbackCount = events.filter(e => e.type === 'gateway.fallback').length;
    const abortedCount = events.filter(e => e.type === 'gateway.stream_aborted').length;
    
    console.log(`Result: ${result}`);
    console.log(`Events: fallbacks=${fallbackCount}, aborts=${abortedCount}`);
    
    // Cleanup listener
    (router as any).eventListeners = (router as any).eventListeners.filter((l: any) => l !== listener);
  }

  // Scenarios
  
  // 1. Failure before token and time thresholds.
  await runScenario(1, 'Failure before threshold (Fallback transparently)', [
    new MockStreamingProvider('p1', async function*() {
      yield { type: 'token', content: 'A', provider: 'p1' };
      throw new Error('Network Drop');
    }),
    new MockStreamingProvider('p2', async function*() {
      yield { type: 'token', content: 'B', provider: 'p2' };
    })
  ]);

  // 2. Failure after token threshold.
  await runScenario(2, 'Failure after token threshold (No concatenation, Abort)', [
    new MockStreamingProvider('p1', async function*() {
      for(let i=0; i<6; i++) yield { type: 'token', content: 'A', provider: 'p1' };
      throw new Error('Network Drop');
    }),
    new MockStreamingProvider('p2', async function*() {
      yield { type: 'token', content: 'B', provider: 'p2' };
    })
  ]);

  // 3. Failure after time threshold.
  await runScenario(3, 'Failure after time threshold (No concatenation, Abort)', [
    new MockStreamingProvider('p1', async function*() {
      yield { type: 'token', content: 'A', provider: 'p1' };
      await new Promise(r => setTimeout(r, 600)); // crosses 500ms
      yield { type: 'token', content: 'A', provider: 'p1' };
      throw new Error('Network Drop');
    }),
    new MockStreamingProvider('p2', async function*() {
      yield { type: 'token', content: 'B', provider: 'p2' };
    })
  ]);

  // 16. No output from two providers is ever concatenated.
  await runScenario(16, 'No output from two providers is ever concatenated', [
    new MockStreamingProvider('p1', async function*() {
      for(let i=0; i<6; i++) yield { type: 'token', content: 'A', provider: 'p1' };
      throw new Error('Network Drop');
    }),
    new MockStreamingProvider('p2', async function*() {
      yield { type: 'token', content: 'B', provider: 'p2' };
    })
  ]);

  console.log('\n=== MATRIX COMPLETE ===');
  await GatewayShutdownManager.getInstance().shutdown();
}

runStreamingTests().catch(console.error);
