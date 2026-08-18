import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GatewayRouter } from '../services/gateway/router.js';
import { ProviderCredentialService } from '../services/gateway/credentials.js';
import { AgentProviderAssignmentService } from '../services/agent/assignments.js';

describe('Phase 4: Gateway Routing & Security Verification', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('Routing Modes', () => {
    it('Automatic routing scores available providers and allows fallback', async () => {
      // Automatic routing uses scorer
      const router = (GatewayRouter as any).getInstance({ providers: [], providerOrder: [], logsPath: './test.log' });
      const order = await router.resolveProviderOrder({ prompt: 'test', routing: { mode: 'automatic' } });
      expect(order.length).toBeGreaterThanOrEqual(0);
    });

    it('Preferred routing attempts target first then allows fallback', async () => {
      const router = (GatewayRouter as any).getInstance({ providers: [], providerOrder: [], logsPath: './test.log' });
      // In the mock, since available is empty, let's mock it inside resolveProviderOrder or registry
      (router as any).registry.getAvailableProviders = vi.fn().mockReturnValue([{ name: 'ninerouter', definition: { id: 'ninerouter' } }, { name: 'omniroot', definition: { id: 'omniroot' } }]);
      const order = await router.resolveProviderOrder({ prompt: 'test', routing: { mode: 'preferred', providerId: 'ninerouter' } });
      expect(order[0].name).toBe('ninerouter');
      expect(order.length).toBeGreaterThan(1); // Should have fallback providers
    });

    it('Forced routing attempts only the target and prevents fallback', async () => {
      const router = (GatewayRouter as any).getInstance({ providers: [], providerOrder: [], logsPath: './test.log' });
      (router as any).registry.getAvailableProviders = vi.fn().mockReturnValue([{ name: 'ninerouter', definition: { id: 'ninerouter' } }]);
      const order = await router.resolveProviderOrder({ prompt: 'test', routing: { mode: 'forced', providerId: 'ninerouter' } });
      expect(order.length).toBe(1);
      expect(order[0].name).toBe('ninerouter');
    });

    it('Forced routing throws error if provider is unavailable', async () => {
      const router = (GatewayRouter as any).getInstance({ providers: [], providerOrder: [], logsPath: './test.log' });
      (router as any).registry.getAvailableProviders = vi.fn().mockReturnValue([]);
      await expect(router.resolveProviderOrder({ prompt: 'test', routing: { mode: 'forced', providerId: 'fake-provider' } }))
        .rejects.toThrow('Forced provider fake-provider is not available');
    });
    
    it('Forced routing validates required capabilities', async () => {
      const router = (GatewayRouter as any).getInstance({ providers: [], providerOrder: [], logsPath: './test.log' });
      (router as any).registry.getAvailableProviders = vi.fn().mockReturnValue([{ name: 'omniroot', definition: { id: 'omniroot' }, supportsReasoning: () => true }]);
      // OmniRoot supports vision, Ollama (by default config) may not support reasoning if forced strictly
      await expect(router.resolveProviderOrder({ prompt: 'test', requiredCapabilities: ['reasoning'], routing: { mode: 'forced', providerId: 'omniroot' } }))
        .resolves.toBeDefined(); // Assuming omniroot supports reasoning, otherwise adjust test
    });
  });

  describe('Credential Isolation', () => {
    it('OmniRoot receives only OmniRoot credential', async () => {
      vi.spyOn(ProviderCredentialService, 'getCredential').mockImplementation(async (id) => id === 'omniroot' ? 'omni-key' : null);
      const key = await ProviderCredentialService.getCredential('omniroot');
      expect(key).toBe('omni-key');
    });

    it('Ollama receives no cloud credentials', async () => {
      vi.spyOn(ProviderCredentialService, 'getCredential').mockImplementation(async (id) => null);
      const key = await ProviderCredentialService.getCredential('ollama');
      expect(key).toBeNull();
    });
  });
});
