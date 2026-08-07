import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import { uiDiagnostics } from '../diagnostics/uiSnapshot';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('uiDiagnostics snapshot store (frontend display state)', () => {
  beforeEach(() => {
    uiDiagnostics.reset();
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('startup before component mount: init() publishes configured/selected state from the assignment API', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/agent-provider-assignments/agent-jarvis')) {
        return { ok: true, json: async () => ({ providerId: 'prov-openrouter', modelId: 'poolside/laguna-s-2.1:free' }) };
      }
      if (url.includes('/api/health/gateway')) {
        return { ok: true, json: async () => ({ gateway: 'OpenRouter', model: null, status: 'online' }) };
      }
      throw new Error('unexpected fetch ' + url);
    }));
    uiDiagnostics.init();
    await sleep(50);

    const s = uiDiagnostics.get();
    expect(s.selected).toMatchObject({ provider: 'prov-openrouter', model: 'poolside/laguna-s-2.1:free', source: 'agent-provider-assignments' });
    expect(s.gatewayRendered).toMatchObject({ provider: 'OpenRouter', online: true, source: 'health-gateway-poll' });
    expect(s.stream.active).toBeNull();
    expect(s.stream.lastKnown).toBeNull();
  });

  it('component mount: AgentRuntimeSelector overrides the source', () => {
    uiDiagnostics.setSelected('DeepSeek', 'deepseek-v4', 'agent-runtime-selector');
    expect(uiDiagnostics.get().selected).toMatchObject({ provider: 'DeepSeek', model: 'deepseek-v4', source: 'agent-runtime-selector' });
  });

  it('selected model changes update the selected layer', () => {
    uiDiagnostics.setSelected('OpenRouter', 'poolside/laguna-s-2.1:free', 'agent-runtime-selector');
    uiDiagnostics.setSelected('DeepSeek', 'deepseek-v4', 'agent-runtime-selector');
    const s = uiDiagnostics.get().selected;
    expect(s.provider).toBe('DeepSeek');
    expect(s.model).toBe('deepseek-v4');
    expect(s.updatedAt).toBeGreaterThan(0);
  });

  it('ProviderBadge changes update the rendered layer', () => {
    uiDiagnostics.setFrontendBadge('OpenRouter', 'Laguna', 'msg-1');
    const b = uiDiagnostics.get().rendered.providerBadge;
    expect(b).toMatchObject({ provider: 'OpenRouter', model: 'Laguna', messageId: 'msg-1', componentMounted: true });
    expect(b.renderedAt).toBeGreaterThan(0);
  });

  it('unmount/remount: value is preserved as last-known with componentMounted: false', () => {
    uiDiagnostics.setFrontendBadge('OpenRouter', 'Laguna', 'msg-1');
    uiDiagnostics.setFrontendBadgeUnmounted();
    const b = uiDiagnostics.get().rendered.providerBadge;
    expect(b.componentMounted).toBe(false);
    expect(b.provider).toBe('OpenRouter'); // NOT erased
    expect(b.model).toBe('Laguna');
    // remount: publishes again → mounted
    uiDiagnostics.setFrontendBadge('OpenRouter', 'Laguna', 'msg-1');
    expect(uiDiagnostics.get().rendered.providerBadge.componentMounted).toBe(true);
  });

  it('stream starts: active stream is set with startedAt', () => {
    uiDiagnostics.setStreamActive('DeepSeek', 'deepseek-v4', 'op-1');
    const a = uiDiagnostics.get().stream.active;
    expect(a).toMatchObject({ provider: 'DeepSeek', model: 'deepseek-v4', operationId: 'op-1' });
    expect(a!.startedAt).toBeGreaterThan(0);
    expect(uiDiagnostics.get().stream.lastKnown).toBeNull();
  });

  it('stream ends: active → null and lastKnown preserved with endedAt', () => {
    uiDiagnostics.setStreamActive('DeepSeek', 'deepseek-v4', 'op-1');
    const startedAt = uiDiagnostics.get().stream.active!.startedAt;
    uiDiagnostics.setStreamEnded('op-1');
    const s = uiDiagnostics.get();
    expect(s.stream.active).toBeNull();
    expect(s.stream.lastKnown).toMatchObject({ provider: 'DeepSeek', model: 'deepseek-v4', operationId: 'op-1' });
    expect(s.stream.lastKnown!.endedAt).toBeGreaterThanOrEqual(startedAt);
  });

  it('startedAt is kept for the same operation and reset for a new one', () => {
    uiDiagnostics.setStreamActive('DeepSeek', 'deepseek-v4', 'op-1');
    const first = uiDiagnostics.get().stream.active!.startedAt;
    uiDiagnostics.setStreamActive('DeepSeek', 'deepseek-v4', 'op-1');
    expect(uiDiagnostics.get().stream.active!.startedAt).toBe(first);
    uiDiagnostics.setStreamActive('OpenRouter', 'laguna', 'op-2');
    expect(uiDiagnostics.get().stream.active!.startedAt).toBeGreaterThanOrEqual(first);
  });

  it('no active stream but a last-known stream exists (after a completed stream)', () => {
    uiDiagnostics.setStreamActive('OpenRouter', 'Laguna', 'op-abc');
    uiDiagnostics.setStreamEnded('op-abc');
    const s = uiDiagnostics.get();
    expect(s.stream.active).toBeNull();
    expect(s.stream.lastKnown).toMatchObject({ provider: 'OpenRouter', model: 'Laguna', operationId: 'op-abc' });
  });

  it('diagnostic endpoint unavailable: reporter failures never break the UI', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('backend down'); }));
    expect(() => {
      uiDiagnostics.setSelected('DeepSeek', 'deepseek-v4', 'agent-runtime-selector');
      uiDiagnostics.setStreamActive('DeepSeek', 'deepseek-v4', 'op-1');
    }).not.toThrow();
    await sleep(1200); // debounce + failed POST settles
    expect(uiDiagnostics.get().selected.provider).toBe('DeepSeek');
  });

  it('no fabricated values on a fresh store', () => {
    const s = uiDiagnostics.get();
    expect(s.selected.provider).toBeNull();
    expect(s.rendered.providerBadge.provider).toBeNull();
    expect(s.stream.active).toBeNull();
    expect(s.stream.lastKnown).toBeNull();
    expect(s.version).toBe(0);
  });

  it('subscribers are notified on updates and can unsubscribe', () => {
    let calls = 0;
    const unsub = uiDiagnostics.subscribe(() => calls++);
    uiDiagnostics.setSelected('Ollama', 'llama3.2:3b', 'agent-runtime-selector');
    expect(calls).toBe(1);
    unsub();
    uiDiagnostics.setSelected('Ollama', 'llama3.2:3b', 'agent-runtime-selector');
    expect(calls).toBe(1);
  });
});
