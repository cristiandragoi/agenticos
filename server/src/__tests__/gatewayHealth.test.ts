import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import healthRouter, { setHealthFetchForTesting } from '../routers/health.js';

/**
 * GET /api/health/gateway evaluates the ACTIVE provider stack:
 *   - primary  = OpenRouter (effective cloud provider)
 *   - fallback = Ollama (local)
 *   - OmniRoot = legacy, optional metadata only — NEVER determines global health
 *
 * Status rules:
 *   - OpenRouter reachable                       → online
 *   - OpenRouter down, Ollama reachable          → degraded
 *   - OpenRouter and Ollama both down            → offline
 *   - timeout probes                             → honest degraded/offline, never a hang
 *   - no OpenRouter configured                   → error (not a fake online)
 * A valid health response is always HTTP 200, even when degraded/offline.
 */

const OPENROUTER = 'https://openrouter.ai/api/v1';
const OMNIROOT = 'http://omniroot.test:20128/v1';
const OLLAMA = 'http://ollama.test:11434';

function makeApp() {
  const app = express();
  app.use('/api/health', healthRouter);
  return app;
}

function jsonResponse(payload: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload } as any;
}

function fetchMock(impl: (url: string) => Promise<any> | any) {
  return vi.fn(async (input: any, _init?: any) => impl(String(input))) as any;
}

const TIMEOUT_ERR = () => {
  const err: any = new Error('The operation was aborted due to timeout');
  err.name = 'TimeoutError';
  return err;
};

describe('GET /api/health/gateway', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ['OPENROUTER_BASE_URL', 'OPENROUTER_API_KEY', 'OMNIROUTE_BASE_URL', 'OLLAMA_BASE_URL', 'OLLAMA_FALLBACK_MODEL']) {
      savedEnv[key] = process.env[key];
    }
    process.env.OPENROUTER_BASE_URL = OPENROUTER;
    process.env.OMNIROUTE_BASE_URL = OMNIROOT;
    process.env.OLLAMA_BASE_URL = OLLAMA;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OLLAMA_FALLBACK_MODEL;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    setHealthFetchForTesting((...args: Parameters<typeof fetch>) => fetch(...args));
    vi.restoreAllMocks();
  });

  it('OpenRouter online → status online, reachable true, real model count', async () => {
    setHealthFetchForTesting(fetchMock((url) => {
      if (url === `${OPENROUTER}/models`) {
        return jsonResponse({ data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }] });
      }
      if (url === `${OMNIROOT}/models`) throw new Error('fetch failed');
      if (url === `${OLLAMA}/api/tags`) return jsonResponse({ models: [{ name: 'llama3.2:3b' }] });
      throw new Error(`unexpected probe: ${url}`);
    }));

    const res = await request(makeApp()).get('/api/health/gateway');
    expect(res.status).toBe(200);
    expect(res.body.gateway).toBe('OpenRouter');
    expect(res.body.status).toBe('online');
    expect(res.body.reachable).toBe(true);
    expect(res.body.configured).toBe(true);
    expect(res.body.url).toBe(OPENROUTER);
    expect(res.body.models).toBe(4); // counted from the live response, not hardcoded
    expect(typeof res.body.latencyMs).toBe('number');
    expect(res.body.error).toBeUndefined();
    // fallback reachable is reported truthfully even when primary is online
    expect(res.body.fallback).toEqual({ provider: 'ollama', reachable: true, active: false, currentModel: null });
  });

  it('OpenRouter down + Ollama online → degraded with fallback active', async () => {
    setHealthFetchForTesting(fetchMock((url) => {
      if (url === `${OPENROUTER}/models`) throw new Error('fetch failed');
      if (url === `${OMNIROOT}/models`) throw new Error('fetch failed');
      if (url === `${OLLAMA}/api/tags`) return jsonResponse({ models: [{ name: 'llama3.2:3b' }] });
      throw new Error(`unexpected probe: ${url}`);
    }));

    const res = await request(makeApp()).get('/api/health/gateway');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('degraded');
    expect(res.body.reachable).toBe(false);
    expect(res.body.error).toContain('fetch failed');
    expect(res.body.fallback).toEqual({
      provider: 'ollama',
      reachable: true,
      active: true,
      currentModel: 'llama3.2:3b'
    });
  });

  it('both down → offline, fallback inactive', async () => {
    setHealthFetchForTesting(fetchMock(() => {
      throw new Error('fetch failed');
    }));

    const res = await request(makeApp()).get('/api/health/gateway');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('offline');
    expect(res.body.reachable).toBe(false);
    expect(res.body.fallback.reachable).toBe(false);
    expect(res.body.fallback.active).toBe(false);
    expect(res.body.fallback.currentModel).toBeNull();
    expect(res.body.error).toContain('fetch failed');
  });

  it('timeout on all probes → offline without hanging (short timeout honored)', async () => {
    const probeCalls: string[] = [];
    setHealthFetchForTesting(fetchMock((url) => {
      probeCalls.push(url);
      throw TIMEOUT_ERR();
    }));

    const res = await request(makeApp()).get('/api/health/gateway');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('offline');
    expect(res.body.reachable).toBe(false);
    expect(res.body.error).toContain('timeout');
    expect(probeCalls.sort()).toEqual([`${OLLAMA}/api/tags`, `${OMNIROOT}/models`, `${OPENROUTER}/models`]);
  });

  it('timeout on OpenRouter, Ollama reachable → degraded', async () => {
    setHealthFetchForTesting(fetchMock((url) => {
      if (url === `${OLLAMA}/api/tags`) return jsonResponse({ models: [] });
      throw TIMEOUT_ERR();
    }));

    const res = await request(makeApp()).get('/api/health/gateway');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('degraded');
    expect(res.body.reachable).toBe(false);
    expect(res.body.fallback.reachable).toBe(true);
    expect(res.body.fallback.active).toBe(true);
  });

  it('no OpenRouter configured → error status with honest error field', async () => {
    delete process.env.OPENROUTER_BASE_URL;
    delete process.env.OPENROUTER_API_KEY;
    let probed = false;
    setHealthFetchForTesting(fetchMock(() => {
      probed = true;
      return jsonResponse({});
    }));

    const res = await request(makeApp()).get('/api/health/gateway');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('error');
    expect(res.body.reachable).toBe(false);
    expect(res.body.configured).toBe(false);
    expect(res.body.error).toContain('no primary gateway configured');
    expect(probed).toBe(false); // nothing to probe when nothing is configured
  });

  it('OmniRoot unreachable but OpenRouter online → still online (legacy never determines health)', async () => {
    setHealthFetchForTesting(fetchMock((url) => {
      if (url === `${OPENROUTER}/models`) return jsonResponse({ data: [{ id: 'a' }] });
      if (url === `${OMNIROOT}/models`) throw new Error('connect ECONNREFUSED');
      if (url === `${OLLAMA}/api/tags`) return jsonResponse({ models: [] });
      throw new Error(`unexpected probe: ${url}`);
    }));

    const res = await request(makeApp()).get('/api/health/gateway');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('online');
    expect(res.body.reachable).toBe(true);
    expect(res.body.omniroot).toEqual({ configured: true, reachable: false });
    expect(res.body.error).toBeUndefined();
  });

  it('OmniRoot reachable and OpenRouter online → online with omniroot metadata true', async () => {
    setHealthFetchForTesting(fetchMock((url) => {
      if (url === `${OPENROUTER}/models`) return jsonResponse({ data: [{ id: 'a' }] });
      if (url === `${OMNIROOT}/models`) return jsonResponse({ models: [{ id: 'x' }] });
      if (url === `${OLLAMA}/api/tags`) return jsonResponse({ models: [] });
      throw new Error(`unexpected probe: ${url}`);
    }));

    const res = await request(makeApp()).get('/api/health/gateway');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('online');
    expect(res.body.omniroot).toEqual({ configured: true, reachable: true });
  });

  it('OmniRoot not configured → omniroot probe skipped, metadata configured:false', async () => {
    delete process.env.OMNIROUTE_BASE_URL;
    const probeCalls: string[] = [];
    setHealthFetchForTesting(fetchMock((url) => {
      probeCalls.push(url);
      if (url === `${OPENROUTER}/models`) return jsonResponse({ data: [] });
      if (url === `${OLLAMA}/api/tags`) return jsonResponse({ models: [] });
      throw new Error(`unexpected probe: ${url}`);
    }));

    const res = await request(makeApp()).get('/api/health/gateway');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('online');
    expect(res.body.omniroot).toEqual({ configured: false, reachable: false });
    expect(probeCalls.some(u => u.includes('omniroot'))).toBe(false);
  });

  it('non-2xx OpenRouter counts as down → falls through to fallback probe', async () => {
    setHealthFetchForTesting(fetchMock((url) => {
      if (url === `${OPENROUTER}/models`) return jsonResponse({ error: 'rate limited' }, 429);
      if (url === `${OMNIROOT}/models`) throw new Error('fetch failed');
      if (url === `${OLLAMA}/api/tags`) return jsonResponse({ models: [] });
      throw new Error(`unexpected probe: ${url}`);
    }));

    const res = await request(makeApp()).get('/api/health/gateway');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('degraded');
    expect(res.body.error).toContain('429');
  });

  it('does not leak secrets in any response', async () => {
    const SECRET_VALUE = 'sk-super-secret-value-xyz';
    const savedKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = SECRET_VALUE;
    setHealthFetchForTesting(fetchMock(() => {
      throw new Error('fetch failed');
    }));

    try {
      const res = await request(makeApp()).get('/api/health/gateway');
      expect(JSON.stringify(res.body)).not.toContain(SECRET_VALUE);
      expect(res.body.apiKey).toBeUndefined();
    } finally {
      if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = savedKey;
    }
  });
});
