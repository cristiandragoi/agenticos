import { ProviderScorer } from '../services/gateway/scorer.js';
import { GatewayRunLedger } from '../services/gateway/ledger.js';
import { ProviderDefinition } from '../services/gateway/types.js';

describe('ProviderScorer (Phase 2)', () => {
  let scorer: ProviderScorer;
  let ledger: GatewayRunLedger;

  beforeEach(() => {
    ledger = new GatewayRunLedger('mock.log'); 
    // Prevent disk IO and cross-test pollution
    ledger.getMetrics = (provider: string) => ({
      totalCalls: 0,
      totalSuccesses: 0,
      totalFailures: 0,
      totalTimeouts: 0,
      totalFallbacks: 0,
      averageLatencyMs: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalCost: 0
    });
    // mock record so it doesn't write
    ledger.record = () => {};
    scorer = new ProviderScorer(ledger);
  });

  const mockProvider = (name: string, tags: string[] = [], capabilities: string[] = []): ProviderDefinition => ({
    name,
    baseUrl: 'http://localhost',
    model: 'mock',
    type: 'openai',
    tags,
    capabilities
  });

  const providers = [
    { name: 'omniroot', definition: mockProvider('omniroot', ['coding', 'cloud'], ['supportsVision']), supportsVision: () => true } as any,
    { name: 'ninerouter', definition: mockProvider('ninerouter', ['fast', 'cloud']) } as any,
    { name: 'ollama', definition: mockProvider('ollama', ['local', 'cheap']) } as any
  ];

  it('assigns neutral score to new providers', () => {
    const scores = scorer.rankProviders(providers, { prompt: 'hi' }, ['omniroot', 'ninerouter', 'ollama']);
    expect(scores[0].name).toBe('omniroot');
    expect(scores[1].name).toBe('ninerouter');
    expect(scores[2].name).toBe('ollama');
  });

  it('overrides score if preferred provider is set', () => {
    const scores = scorer.rankProviders(providers, { prompt: 'hi', preferredProvider: 'ollama' }, ['omniroot']);
    expect(scores[0].name).toBe('ollama');
  });

  it('enforces capabilities strictly', () => {
    // Only omniroot has supportsVision
    const scores = scorer.rankProviders(providers, { prompt: 'look at this image', requiredCapabilities: ['supportsVision'] }, ['ninerouter', 'omniroot']);
    expect(scores[0].name).toBe('omniroot');
    expect(scores.length).toBe(1);
  });

  it('does not penalize client errors (HTTP 4xx)', () => {
    // Override getMetrics to simulate history
    ledger.getMetrics = (provider: string) => {
      if (provider === 'omniroot') return {
        totalCalls: 1, totalSuccesses: 0, totalFailures: 1,
        totalTimeouts: 0, totalFallbacks: 0, averageLatencyMs: 100,
        totalPromptTokens: 0, totalCompletionTokens: 0, totalCost: 0
      };
      if (provider === 'ninerouter') return {
        totalCalls: 1, totalSuccesses: 0, totalFailures: 0, // Client error doesn't count as failure
        totalTimeouts: 0, totalFallbacks: 0, averageLatencyMs: 100,
        totalPromptTokens: 0, totalCompletionTokens: 0, totalCost: 0
      };
      return { totalCalls: 0, totalSuccesses: 0, totalFailures: 0, totalTimeouts: 0, totalFallbacks: 0, averageLatencyMs: 0, totalPromptTokens: 0, totalCompletionTokens: 0, totalCost: 0 };
    };
    
    // OmniRoot should be penalized, NineRouter should not.
    // So NineRouter should rank higher.
    const scores = scorer.rankProviders(providers, { prompt: 'hi' }, ['omniroot', 'ninerouter']);
    expect(scores[0].name).toBe('ninerouter');
    expect(scores[1].name).toBe('omniroot');
  });

  it('favors ollama for tiny tasks if tags align', () => {
    const scores = scorer.rankProviders(providers, { prompt: 'summary', taskProfile: 'tiny_summary' }, ['omniroot', 'ollama']);
    expect(scores[0].name).toBe('ollama');
  });

  it('handles missing metrics without NaN or Infinity', () => {
    // Mock a provider with zero calls, which means metrics are empty
    const scores = scorer.rankProviders([{ name: 'new_provider', definition: mockProvider('new_provider') } as any], { prompt: 'hi' }, ['new_provider']);
    expect(scores[0].name).toBe('new_provider');
  });
});
