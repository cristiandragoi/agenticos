import { describe, it, expect, vi, beforeEach } from 'vitest';
import { diagnosticsStore } from '../services/diagnosticsStore.js';

vi.mock('../conversations/service.js', () => ({
  conversationService: { getMessages: vi.fn(async () => []) },
}));
vi.mock('../../services/hermesApiService.js', () => ({
  hermesApiService: { getStatus: vi.fn(async () => ({ reachable: true, detail: 'Hermes API online' })) },
}));
vi.mock('../services/backgroundTasks/manager.js', () => ({
  backgroundTaskManager: { summary: vi.fn(() => ({ active: 0, queued: 0, waitingApproval: 0, failedOrBlocked: 0 })), listTasks: vi.fn(() => []) },
}));
vi.mock('../services/agent/assignments.js', () => ({
  AgentProviderAssignmentService: { getAssignment: vi.fn(async () => ({ enabled: true, providerId: 'prov-openrouter', modelId: 'poolside/laguna-s-2.1:free' })) },
}));

// Probes fail fast in tests (unreachable hosts) — the report still composes.
global.fetch = vi.fn(async () => { throw new Error('ECONNREFUSED'); });

describe('investigateAgenticState — frontend diagnostic bridge', () => {
  beforeEach(() => {
    diagnosticsStore.clear();
    vi.clearAllMocks();
  });

  it('includes the frontend snapshot comparison when the UI has reported one', async () => {
    diagnosticsStore.setUiSnapshot({
      selected: { provider: 'DeepSeek', model: 'deepseek-v4', updatedAt: 2000 },
      gatewayResolved: { provider: 'OpenRouter', model: null, updatedAt: 2000, online: true },
      activeStream: { provider: 'DeepSeek', model: 'deepseek-v4', updatedAt: 3000, operationId: 'op-abc123' },
      frontendBadge: { provider: 'OpenRouter', model: 'Laguna', updatedAt: 1000, messageId: 'msg-xyz' },
      hermes: { provider: null, model: null, updatedAt: 0 },
      version: 3,
      updatedAt: 3000,
    } as any);

    const mod = await import('../domains/jarvis/investigation.js');
    const report = await mod.investigateAgenticState('conv-1', 'It\u2019s not showing the correct model.');

    expect(report).toContain('Frontend display state (reported by the UI, read-only)');
    expect(report).toContain('Selected (AgentRuntimeSelector): DeepSeek / deepseek-v4');
    expect(report).toContain('Frontend ProviderBadge: OpenRouter / Laguna');
    expect(report).toContain('Active stream: DeepSeek / deepseek-v4');
    // Staleness: badge (t=1000) older than the latest stream operation (t=3000).
    expect(report).toContain('The ProviderBadge last updated 2s before the latest stream operation');
    expect(report).toContain('The badge does NOT match the runtime');
  });

  it('says the snapshot is unavailable when the UI has not reported yet', async () => {
    const mod = await import('../domains/jarvis/investigation.js');
    const report = await mod.investigateAgenticState('conv-1', 'The provider badge is wrong.');
    expect(report).toContain('Frontend display state: not yet reported by the UI');
  });
});
