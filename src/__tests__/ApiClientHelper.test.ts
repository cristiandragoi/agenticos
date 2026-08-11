/**
 * API helper tests — canonical renderer API request path.
 *
 * Covers: resolveApiBase (web/dev + file:// production + override),
 * apiUrl normalization (with/without /api, with/without leading slash,
 * query strings, no /api/api doubling, absolute http(s) passthrough,
 * blob/data/file passthrough), apiFetch RequestInit/AbortSignal/headers/body
 * preservation, and streaming response safety (body never consumed).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { apiUrl, apiFetch, resolveApiBase } from '../api/client';

describe('resolveApiBase — canonical backend origin', () => {
  it('http(s) web/dev origin resolves to same-origin /api', () => {
    expect(resolveApiBase('http:')).toBe('/api');
    expect(resolveApiBase('https:')).toBe('/api');
  });

  it('file:// production origin resolves to the backend HTTP origin', () => {
    expect(resolveApiBase('file:')).toBe('http://localhost:4000/api');
  });

  it('VITE_API_URL override wins over protocol detection', () => {
    expect(resolveApiBase('file:', 'https://api.rekruitai.de/api')).toBe('https://api.rekruitai.de/api');
    expect(resolveApiBase('http:', 'https://api.rekruitai.de/api')).toBe('https://api.rekruitai.de/api');
  });
});

describe('apiUrl — canonical backend path resolution (web/dev base /api)', () => {
  it('/api/foo stays /api/foo (no doubling)', () => {
    expect(apiUrl('/api/foo')).toBe('/api/foo');
  });

  it('api/foo (no leading slash) normalizes', () => {
    expect(apiUrl('api/foo')).toBe('/api/foo');
  });

  it('/foo (no /api prefix) normalizes', () => {
    expect(apiUrl('/foo')).toBe('/api/foo');
  });

  it('foo (bare) normalizes', () => {
    expect(apiUrl('foo')).toBe('/api/foo');
  });

  it('absolute http URL passes through unchanged', () => {
    expect(apiUrl('http://localhost:11434/api/generate')).toBe('http://localhost:11434/api/generate');
  });

  it('absolute https URL passes through unchanged', () => {
    expect(apiUrl('https://api.example.com/v1/models')).toBe('https://api.example.com/v1/models');
  });

  it('query strings are preserved', () => {
    expect(apiUrl('/api/providers?limit=10&page=2')).toBe('/api/providers?limit=10&page=2');
    expect(apiUrl('providers?limit=10')).toBe('/api/providers?limit=10');
    expect(apiUrl('/api/memory/vault/read?filePath=a%2Fb&raw=1')).toBe('/api/memory/vault/read?filePath=a%2Fb&raw=1');
  });

  it('no duplicate /api/api/... is ever produced', () => {
    expect(apiUrl('/api/foo')).not.toContain('/api/api');
    expect(apiUrl('api/foo')).not.toContain('/api/api');
    expect(apiUrl('/api/api/foo')).not.toContain('/api/api/api');
  });

  it('fragments are preserved', () => {
    expect(apiUrl('/api/foo#sec')).toBe('/api/foo#sec');
  });

  it('blob/data/file schemes pass through unchanged', () => {
    expect(apiUrl('blob:http://x/abc')).toBe('blob:http://x/abc');
    expect(apiUrl('data:text/plain;base64,SGVsbG8=')).toBe('data:text/plain;base64,SGVsbG8=');
    expect(apiUrl('file:///C:/x')).toBe('file:///C:/x');
  });

  it('empty path resolves to the base itself', () => {
    expect(apiUrl('')).toBe('/api/');
  });
});

describe('apiFetch — RequestInit preservation and streaming safety', () => {
  afterEach(() => vi.restoreAllMocks());

  it('preserves method, headers, body, AbortSignal, credentials', async () => {
    const controller = new AbortController();
    const init: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Custom': 'yes' },
      body: JSON.stringify({ a: 1 }),
      credentials: 'include',
      signal: controller.signal,
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    const res = await apiFetch('/api/foo', init);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, passed] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/foo');
    expect(passed).toMatchObject({
      method: 'POST',
      credentials: 'include',
      signal: controller.signal,
    });
    expect((passed as RequestInit).headers).toEqual({ 'Content-Type': 'application/json', 'X-Custom': 'yes' });
    expect((passed as RequestInit).body).toBe(JSON.stringify({ a: 1 }));
    await res.text();
  });

  it('streaming response is untouched (body not consumed)', async () => {
    const streamBody = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: hello\n\n'));
        controller.close();
      },
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(streamBody, { status: 200 }));
    const res = await apiFetch('/api/stream');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(res.body).toBeInstanceOf(ReadableStream);
    const reader = res.body!.getReader();
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toContain('data: hello');
  });

  it('GET without init works', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]', { status: 200 }));
    await apiFetch('/api/agents');
    expect(fetchSpy).toHaveBeenCalledWith('/api/agents', undefined);
  });

  it('abort signal rejects in-flight request (no hang, no duplicate completion)', async () => {
    const controller = new AbortController();
    // Simulate a long-lived streaming fetch that honors abort.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((_url: unknown, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('The operation was aborted.');
          (err as Error & { name: string }).name = 'AbortError';
          reject(err);
        });
        // Never resolves unless aborted — if abort fails, this test times out.
      })
    );
    const promise = apiFetch('/api/stream', { signal: controller.signal });
    await new Promise((r) => setTimeout(r, 10));
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchSpy).toHaveBeenCalledTimes(1); // exactly one request, no duplicates
  });

  describe('failure classes — apiFetch returns ordinary Responses, callers decide', () => {
    it.each([
      [400, 'Bad Request'],
      [401, 'Unauthorized'],
      [403, 'Forbidden'],
      [404, 'Not Found'],
      [500, 'Internal Server Error'],
    ])('HTTP %i is returned as a normal Response (no throw, no body consumption)', async (status, statusText) => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ error: 'boom' }), { status, statusText })
      );
      const res = await apiFetch('/api/foo');
      expect(res.status).toBe(status);
      expect(res.ok).toBe(false);
      // Caller can still read the body for feature-specific error messages.
      const body = await res.json();
      expect(body.error).toBe('boom');
      // No automatic throw; caller's res.ok check decides.
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('network rejection propagates as TypeError (backend unavailable)', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
      await expect(apiFetch('/api/foo')).rejects.toBeInstanceOf(TypeError);
    });

    it('malformed JSON is surfaced when the CALLER calls response.json()', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>not json</html>', { status: 200 }));
      const res = await apiFetch('/api/foo');
      await expect(res.json()).rejects.toThrow();
    });
  });
});
