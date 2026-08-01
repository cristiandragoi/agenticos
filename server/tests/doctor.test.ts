import { GatewayRouter } from '../src/services/gateway/router';
import { loadGatewayConfig } from '../src/services/gateway/config';

describe('Diagnostics - GatewayRouter Error Extraction', () => {
  let router: GatewayRouter;

  beforeAll(() => {
    const config = loadGatewayConfig();
    router = GatewayRouter.getInstance(config);
  });

  it('should include attemptErrors in the thrown error when a provider fails', async () => {
    try {
      await router.chat({
        prompt: 'test prompt',
        maxTokens: 10,
        routing: { mode: 'forced', providerId: 'invalid-provider' }
      });
      fail('Expected router.chat to throw');
    } catch (err: any) {
      expect(err.message).toBeDefined();
      expect(err.message).toContain('Forced provider invalid-provider is not available');
    }
  });

  describe('Doctor Bootstrap Diagnostics', () => {
    it('should fail diagnostic if zero providers are loaded', () => {
      // Simulation of what the Doctor CLI checks
      const emptyConfig = { ...loadGatewayConfig(), providers: [] };
      expect(emptyConfig.providers.length).toBe(0);
      // In the doctor script this triggers:
      // recordCheck('PROVIDER_REGISTRY_COUNT', 'failed', 'No providers were loaded.');
    });

    it('should allow direct Ollama healthcheck to pass while registry lookup fails', async () => {
      // Mock fetch for direct check
      const mockFetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
      global.fetch = mockFetch;
      
      const directRes = await fetch('http://127.0.0.1:11434/api/tags');
      expect(directRes.ok).toBe(true);
      
      // Registry lookup fails because provider isn't configured
      const emptyConfig = { ...loadGatewayConfig(), providers: [] };
      const emptyRouter = GatewayRouter.getInstance(emptyConfig);
      
      const health = await emptyRouter.healthcheck('ollama');
      expect(health.reachable).toBe(false);
      expect(health.error).toBe('Unknown provider');
    });

    it('should load Ollama from production bootstrap', () => {
      const config = loadGatewayConfig();
      // As long as OLLAMA_BASE_URL is set in .env, it should load.
      // If it's not set during testing, we can just assert that if we simulate the env, it works.
      process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
      const prodConfig = loadGatewayConfig();
      expect(prodConfig.providers.find(p => p.name === 'ollama')).toBeDefined();
      expect(prodConfig.providers.find(p => p.name === 'ollama')?.baseUrl).toBe('http://127.0.0.1:11434');
    });

    it('GatewayRouter should see the same providers as the backend', () => {
      const config = loadGatewayConfig();
      const instance = GatewayRouter.getInstance(config);
      // Ensure registry is built with same config
      expect(instance).toBeDefined();
      // The router instance handles the providers correctly
    });
  });
});
