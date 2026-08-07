import { describe, expect, it, beforeEach } from 'vitest';
import { uiDiagnostics } from '../diagnostics/uiSnapshot';

describe('uiDiagnostics snapshot store (frontend display state)', () => {
  beforeEach(() => {
    uiDiagnostics.reset();
  });

  it('reports what the UI is rendering per layer', () => {
    uiDiagnostics.setSelected('DeepSeek', 'deepseek-v4');
    uiDiagnostics.setGatewayResolved('OpenRouter', null, true);
    uiDiagnostics.setActiveStream('DeepSeek', 'deepseek-v4', 'op-abc123');
    uiDiagnostics.setFrontendBadge('OpenRouter', 'Laguna', 'msg-xyz');
    uiDiagnostics.setHermes(null, null);

    const s = uiDiagnostics.get();
    expect(s.selected).toMatchObject({ provider: 'DeepSeek', model: 'deepseek-v4' });
    expect(s.gatewayResolved).toMatchObject({ provider: 'OpenRouter', online: true });
    expect(s.activeStream).toMatchObject({ provider: 'DeepSeek', operationId: 'op-abc123' });
    expect(s.frontendBadge).toMatchObject({ provider: 'OpenRouter', model: 'Laguna', messageId: 'msg-xyz' });
    expect(s.version).toBeGreaterThan(0);
    expect(s.updatedAt).toBeGreaterThan(0);
  });

  it('idle stream statuses do not clobber the last real active stream', () => {
    uiDiagnostics.setActiveStream('DeepSeek', 'deepseek-v4', 'op-1');
    uiDiagnostics.setActiveStream(null, null, null); // idle
    expect(uiDiagnostics.get().activeStream.provider).toBe('DeepSeek');
  });

  it('subscribers are notified on updates and can unsubscribe', () => {
    let calls = 0;
    const unsub = uiDiagnostics.subscribe(() => calls++);
    uiDiagnostics.setSelected('Ollama', 'llama3.2:3b');
    expect(calls).toBe(1);
    unsub();
    uiDiagnostics.setSelected('Ollama', 'llama3.2:3b');
    expect(calls).toBe(1);
  });
});
