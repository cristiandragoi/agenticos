import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Hermes live-run adapter regression tests:
 *  - default run payload uses the gateway profile model and NO provider
 *    (the previously hardcoded 'qwen3-coder-plus' provider is unknown to the
 *    installed gateway and fails at run start)
 *  - upstream `run.failed` reconciles the AgenticOS record to failed with the
 *    upstream error captured (previously the record stayed 'queued' forever)
 */

const mockFetch = vi.fn();
global.fetch = mockFetch;

// A minimal ReadableStream that yields SSE frames then closes.
function sseStream(frames: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const f of frames) controller.enqueue(encoder.encode(f));
      controller.close();
    },
  });
}

async function importService() {
  const mod = await import('../services/hermesApiService.js');
  return mod.hermesApiService;
}

describe('HermesApiService — run payload + run.failed reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.HERMES_API_URL = 'http://127.0.0.1:9999';
    process.env.HERMES_API_KEY = 'test-key';
    delete process.env.HERMES_RUN_PROVIDER;
    delete process.env.HERMES_RUN_MODEL;
  });
  afterEach(() => {
    delete process.env.HERMES_API_URL;
    delete process.env.HERMES_API_KEY;
  });

  it('default run payload uses the gateway profile model with NO provider (fix: unknown provider name)', async () => {
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/v1/runs') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        // The regression: provider 'qwen3-coder-plus' was hardcoded and the
        // gateway rejects it ("Unknown provider"). The fixed default omits
        // provider and uses the profile id as the model.
        expect(body.provider).toBeUndefined();
        expect(body.model).toBe('backend-engineer');
        expect(body.input).toBe('inspect the file');
        return { ok: true, status: 202, json: async () => ({ run_id: 'run_test123', id: 'run_test123', model: 'backend-engineer' }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    const service = await importService();
    const record = await service.createRun({ prompt: 'inspect the file' });
    expect(record.model).toBe('backend-engineer');
    const body = JSON.parse(String(mockFetch.mock.calls.find((c) => c[1]?.method === 'POST')?.[1]?.body));
    expect(body.provider).toBeUndefined();
  });

  it('explicit HERMES_RUN_PROVIDER is still honored when set', async () => {
    process.env.HERMES_RUN_PROVIDER = 'deepseek';
    process.env.HERMES_RUN_MODEL = 'deepseek-v4-flash';
    vi.resetModules(); // re-evaluate module-level env defaults
    const mod = await import('../services/hermesApiService.js');
    const svc = (mod as any).hermesApiService;
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/v1/runs') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        expect(body.provider).toBe('deepseek');
        expect(body.model).toBe('deepseek-v4-flash');
        return { ok: true, status: 202, json: async () => ({ run_id: 'run_test456', id: 'run_test456', model: 'deepseek-v4-flash' }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });
    const record = await svc.createRun({ prompt: 'inspect the file' });
    expect(record.provider).toBe('deepseek');
  });

  it('upstream run.failed reconciles the record to failed with the error captured', async () => {
    const upstreamError = "⚠️ Provider authentication failed: Unknown provider 'qwen3-coder-plus'.";
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/v1/runs') && init?.method === 'POST') {
        return {
          ok: true, status: 202,
          json: async () => ({ run_id: 'run_fail1', id: 'run_fail1', model: 'backend-engineer' }),
        };
      }
      if (url.includes('/events')) {
        const frames = [
          `data: {"event":"run.failed","run_id":"run_fail1","timestamp":1786095229.8,"error":"${upstreamError}"}\n\n`,
        ];
        return { ok: true, status: 200, body: sseStream(frames) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    const service = await importService();
    const record = await service.createRun({ prompt: 'inspect the file' });
    // Attach the SSE consumer + await the failure reconciliation.
    const deadline = Date.now() + 5000;
    let cur = service.getRun(record.id);
    while (cur?.status !== 'failed' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
      cur = service.getRun(record.id);
    }
    expect(cur?.status).toBe('failed');
    expect(cur?.errorMessage).toContain('Unknown provider');
    const failedEvent = cur?.events.find((e) => e.summary.includes('run.failed'));
    expect(failedEvent).toBeTruthy();
  });
});
