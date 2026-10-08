import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiFetch, apiClient, setCachedApiToken, getApiToken } from '../api/client';

describe('API Client Token Plumbing (Step 3A)', () => {
  const originalFetch = globalThis.fetch;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setCachedApiToken(null);
    delete (process.env as any).AGENTOS_API_TOKEN;
    delete (window as any).backendLifecycle;

    fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    globalThis.fetch = fetchSpy as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    setCachedApiToken(null);
    delete (process.env as any).AGENTOS_API_TOKEN;
  });

  it('attaches Authorization: Bearer <token> from environment when present', async () => {
    process.env.AGENTOS_API_TOKEN = 'test-token-step3a-12345';
    const res = await apiFetch('/api/test-endpoint');
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledOnce();

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/test-endpoint');
    expect(init?.headers).toBeInstanceOf(Headers);
    expect(init.headers.get('Authorization')).toBe('Bearer test-token-step3a-12345');
  });

  it('attaches Authorization header from Electron IPC contextBridge getter', async () => {
    (window as any).backendLifecycle = {
      getApiToken: vi.fn().mockResolvedValue('ipc-token-secret-67890'),
    };

    const token = await getApiToken();
    expect(token).toBe('ipc-token-secret-67890');

    await apiFetch('/api/protected/action', { method: 'POST' });
    const [, init] = fetchSpy.mock.calls[0];
    expect(init.headers.get('Authorization')).toBe('Bearer ipc-token-secret-67890');
  });

  it('does not overwrite existing Authorization header if explicitly provided', async () => {
    process.env.AGENTOS_API_TOKEN = 'default-token';
    await apiFetch('/api/override', {
      headers: { Authorization: 'Bearer custom-token-override' },
    });

    const [, init] = fetchSpy.mock.calls[0];
    expect(init.headers.get('Authorization')).toBe('Bearer custom-token-override');
  });

  it('apiClient methods (get, post) pass Authorization header through apiFetch', async () => {
    process.env.AGENTOS_API_TOKEN = 'client-token-999';
    await apiClient.post('/api/dispatch', { task: 'test' });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/dispatch');
    expect(init.method).toBe('POST');
    expect(init.headers.get('Authorization')).toBe('Bearer client-token-999');
  });
});
