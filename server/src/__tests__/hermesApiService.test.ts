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

describe('HermesApiService — api_server /v1/runs event schema normalization', () => {
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

  function frame(obj: Record<string, unknown>): string {
    return `data: ${JSON.stringify(obj)}\n\n`;
  }

  it('tool.started reads the real `tool` + `preview` fields and flips queued→running', async () => {
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/v1/runs') && init?.method === 'POST') {
        return { ok: true, status: 202, json: async () => ({ run_id: 'run_t1', id: 'run_t1', model: 'backend-engineer' }) };
      }
      if (url.includes('/events')) {
        return {
          ok: true, status: 200,
          body: sseStream([
            frame({ event: 'tool.started', run_id: 'run_t1', timestamp: 1, tool: 'read_file', preview: 'path/to/file.ts' }),
            frame({ event: 'tool.completed', run_id: 'run_t1', timestamp: 2, tool: 'read_file', duration: 0.2, error: false }),
            frame({ event: 'run.completed', run_id: 'run_t1', timestamp: 3, output: 'done', usage: { total_tokens: 42 } }),
          ]),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    const service = await importService();
    const record = await service.createRun({ prompt: 'inspect the file' });
    const deadline = Date.now() + 5000;
    let cur = service.getRun(record.id);
    while (cur?.status !== 'completed' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
      cur = service.getRun(record.id);
    }
    expect(cur?.status).toBe('completed');
    const started = cur?.events.find((e) => e.kind === 'tool.started');
    // Regression: the tool NAME must survive (previously always "tool").
    expect((started?.detail as any)?.tool).toBe('read_file');
    expect((started?.detail as any)?.preview).toBe('path/to/file.ts');
    // Regression: no phantom structured `args` field from the wrong schema.
    expect((started?.detail as any)?.args).toBeUndefined();
  });

  it('message.delta flips queued→running even without a run.started event (api_server never emits it)', async () => {
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/v1/runs') && init?.method === 'POST') {
        return { ok: true, status: 202, json: async () => ({ run_id: 'run_t2', id: 'run_t2', model: 'backend-engineer' }) };
      }
      if (url.includes('/events')) {
        return {
          ok: true, status: 200,
          body: sseStream([
            frame({ event: 'message.delta', run_id: 'run_t2', timestamp: 1, delta: 'hello' }),
          ]),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    const service = await importService();
    const record = await service.createRun({ prompt: 'inspect the file' });
    const deadline = Date.now() + 5000;
    let cur = service.getRun(record.id);
    while (cur?.status !== 'running' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
      cur = service.getRun(record.id);
    }
    // api_server never emits run.started — first activity must move off queued.
    expect(cur?.status).toBe('running');
  });

  it('reasoning.available and subagent.* events are normalized, not dropped', async () => {
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/v1/runs') && init?.method === 'POST') {
        return { ok: true, status: 202, json: async () => ({ run_id: 'run_t3', id: 'run_t3', model: 'backend-engineer' }) };
      }
      if (url.includes('/events')) {
        return {
          ok: true, status: 200,
          body: sseStream([
            frame({ event: 'reasoning.available', run_id: 'run_t3', timestamp: 1, text: 'thinking…' }),
            frame({ event: 'subagent.start', run_id: 'run_t3', timestamp: 2, subagent_id: 'sub-1' }),
            frame({ event: 'subagent.complete', run_id: 'run_t3', timestamp: 3, status: 'completed', summary: 'inspected 2 files' }),
            frame({ event: 'run.completed', run_id: 'run_t3', timestamp: 4, output: 'done', usage: {} }),
          ]),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    const service = await importService();
    const record = await service.createRun({ prompt: 'inspect the file' });
    const deadline = Date.now() + 5000;
    let cur = service.getRun(record.id);
    while (cur?.status !== 'completed' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
      cur = service.getRun(record.id);
    }
    const kinds = (cur?.events || []).map((e) => e.kind);
    expect(cur?.status).toBe('completed');
    // reasoning.available → status.changed with text
    const reasoning = cur?.events.find((e) => (e.detail as any)?.text === 'thinking…');
    expect(reasoning).toBeTruthy();
    // subagent lifecycle events survive as status.changed (not dropped)
    expect(cur?.events.some((e) => e.summary.includes('Subagent completed'))).toBe(true);
    expect(cur?.events.some((e) => e.summary.includes('Subagent started'))).toBe(true);
  });

  it('run.cancelled reconciles to cancelled (not stuck running)', async () => {
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/v1/runs') && init?.method === 'POST') {
        return { ok: true, status: 202, json: async () => ({ run_id: 'run_t4', id: 'run_t4', model: 'backend-engineer' }) };
      }
      if (url.includes('/events')) {
        return {
          ok: true, status: 200,
          body: sseStream([
            frame({ event: 'run.cancelled', run_id: 'run_t4', timestamp: 1 }),
          ]),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    const service = await importService();
    const record = await service.createRun({ prompt: 'inspect the file' });
    const deadline = Date.now() + 5000;
    let cur = service.getRun(record.id);
    while (cur?.status !== 'cancelled' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
      cur = service.getRun(record.id);
    }
    expect(cur?.status).toBe('cancelled');
  });

  it('resolves model to available model exposed by /v1/models (e.g. hermes-agent) when profile model is not in gateway', async () => {
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/v1/models')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            object: 'list',
            data: [{ id: 'hermes-agent', object: 'model', owned_by: 'hermes' }],
          }),
        };
      }
      if (url.includes('/v1/runs') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        expect(body.model).toBe('hermes-agent');
        return { ok: true, status: 202, json: async () => ({ run_id: 'run_m1', id: 'run_m1', model: 'hermes-agent' }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    const service = await importService();
    const record = await service.createRun({ prompt: 'check status', model: 'backend-engineer' });
    expect(record.model).toBe('hermes-agent');
  });
});
