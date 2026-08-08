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
      selected: { provider: 'DeepSeek', model: 'deepseek-v4', updatedAt: Date.now() - 5000, source: 'agent-provider-assignments' },
      gatewayRendered: { provider: 'OpenRouter', model: null, online: true, updatedAt: Date.now() - 5000, source: 'health-gateway-poll' },
      rendered: { providerBadge: { provider: 'OpenRouter', model: 'Laguna', renderedAt: Date.now() - 42000, componentMounted: false, messageId: 'msg-xyz' } },
      stream: {
        active: null,
        lastKnown: { provider: 'OpenRouter', model: 'Laguna', operationId: 'op-abc123', endedAt: Date.now() - 3000 },
      },
      version: 3,
      updatedAt: Date.now(),
    } as any);

    const mod = await import('../domains/jarvis/investigation.js');
    const report = await mod.investigateAgenticState('conv-1', 'It\u2019s not showing the correct model.');

    expect(report).toContain('Frontend display state (reported by the UI, read-only)');
    expect(report).toContain('Selected frontend model: DeepSeek / deepseek-v4 (source: agent-provider-assignments');
    expect(report).toContain('Gateway status rendered: OpenRouter (source: health-gateway-poll');
    // Last-known badge with explicit mount/age markers — never "(not reported)".
    expect(report).toMatch(/ProviderBadge last rendered: OpenRouter \/ Laguna \(component currently unmounted; last render \d+s ago/);
    // No active stream, but a last-known stream exists.
    expect(report).toContain('Active stream: none');
    expect(report).toContain('Last stream: OpenRouter / Laguna (operation op-abc123; ended');
    // Stale badge vs newer runtime operation: the badge (42s ago) predates the
    // last stream (3s ago).
    expect(report).toMatch(/The ProviderBadge last rendered \d+s ago \(\d+s before the latest stream operation\)/);
    expect(report).toContain('The badge does NOT match the runtime');
  }, 20000);

  it('says the snapshot is unavailable when the UI has not reported yet', async () => {
    const mod = await import('../domains/jarvis/investigation.js');
    const report = await mod.investigateAgenticState('conv-1', 'The provider badge is wrong.');
    expect(report).toContain('Frontend display state: not yet reported by the UI');
  });

  it('never fabricates values: fresh snapshot shows none/(not reported)', async () => {
    diagnosticsStore.setUiSnapshot({
      selected: { provider: null, model: null, updatedAt: 0, source: null },
      gatewayRendered: { provider: null, model: null, online: null, updatedAt: 0, source: null },
      rendered: { providerBadge: { provider: null, model: null, renderedAt: 0, componentMounted: false, messageId: null } },
      stream: { active: null, lastKnown: null },
      version: 0,
      updatedAt: 0,
    } as any);
    const mod = await import('../domains/jarvis/investigation.js');
    const report = await mod.investigateAgenticState('conv-1', 'The provider badge is wrong.');
    expect(report).toContain('Selected frontend model: (not reported)');
    expect(report).toContain('ProviderBadge last rendered: (not reported)');
    expect(report).toContain('Active stream: none');
    expect(report).toContain('Last stream: none');
  });
});
