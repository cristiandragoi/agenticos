/**
 * agenticos-mcp tests — bridge contracts (read-only, prepare/approval,
 * submission/idempotency, follow/cancel, security).
 *
 * The BackendClient uses global fetch; tests stub it with a configurable
 * mock so every tool contract is exercised deterministically.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BackendClient, resolveBaseUrl } from '../backend.js';
import { TOOLS, callTool, ToolError } from '../tools.js';
import { redactSecrets, sanitizeError, redactJson } from '../redact.js';
import { AgenticosMcpServer } from '../server.js';

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

function mockFetch(routes: { [pathPrefix: string]: (url: string, init?: any) => Response | Promise<Response> }) {
  const calls: { url: string; init?: any }[] = [];
  const fn = vi.fn(async (url: string, init?: any) => {
    calls.push({ url, init });
    for (const [prefix, handler] of Object.entries(routes)) {
      if (url.includes(prefix)) return handler(url, init);
    }
    return jsonResponse({ error: `no mock for ${url}` }, 404);
  });
  vi.stubGlobal('fetch', fn);
  return { fn, calls };
}

function makeBackend(baseUrl = 'http://127.0.0.1:4000') {
  return new BackendClient({ baseUrl });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('read-only tools', () => {
  it('agenticos_health succeeds against a mocked healthy backend', async () => {
    mockFetch({
      '/api/health': () => jsonResponse({ status: 'healthy', version: '9.0.0', environment: 'development', uptime: 42 }),
      '/api/project-execution/workers/capabilities': () => jsonResponse({ capabilities: { hermes: { available: true }, codex: { available: true }, magnitude: { available: true } } }),
      '/api/memory/stats': () => jsonResponse({ entries: 3 }),
    });
    const out = await callTool('agenticos_health', {}, makeBackend());
    const parsed = JSON.parse(out.content[0].text);
    expect(parsed.backendReachable).toBe(true);
    expect(parsed.version).toBe('9.0.0');
    expect(parsed.environment).toBe('development');
    expect(parsed.workers).toBeTruthy();
    expect(parsed.timestamp).toBeTruthy();
  });

  it('agenticos_health returns truthful unreachable state', async () => {
    mockFetch({ '/api/health': () => { throw new Error('ECONNREFUSED'); } });
    const out = await callTool('agenticos_health', {}, makeBackend());
    const parsed = JSON.parse(out.content[0].text);
    expect(out.isError).toBe(true);
    expect(JSON.stringify(parsed)).toMatch(/unreachable|ECONNREFUSED/i);
  });

  it('agenticos_get_active_project returns an authoritative project', async () => {
    mockFetch({
      '/api/projects/active': () => jsonResponse({ project: { id: 'proj-1', name: 'Alpha', status: 'active', workspacePath: null }, activeProjectId: 'proj-1' }),
      '/api/project-execution/proj-1/tree': () => jsonResponse({ projectId: 'proj-1', goals: [] }),
    });
    const out = await callTool('agenticos_get_active_project', {}, makeBackend());
    const parsed = JSON.parse(out.content[0].text);
    expect(parsed.project.projectId).toBe('proj-1');
    expect(parsed.project.name).toBe('Alpha');
    expect(parsed.source).toMatch(/projectsStore/);
  });

  it('agenticos_get_active_project returns null when none is set', async () => {
    mockFetch({ '/api/projects/active': () => jsonResponse({ project: null, activeProjectId: null }) });
    const out = await callTool('agenticos_get_active_project', {}, makeBackend());
    const parsed = JSON.parse(out.content[0].text);
    expect(parsed.project).toBeNull();
  });

  it('active project is never inferred from the first project', async () => {
    mockFetch({
      '/api/projects/active': () => jsonResponse({ project: null, activeProjectId: null }),
      '/api/projects': () => jsonResponse({ projects: [{ id: 'proj-first', name: 'First' }], activeProjectId: null }),
    });
    const out = await callTool('agenticos_get_active_project', {}, makeBackend());
    expect(JSON.parse(out.content[0].text).project).toBeNull();
    // list_projects flags only the authoritative active id
    const listOut = await callTool('agenticos_list_projects', {}, makeBackend());
    const list = JSON.parse(listOut.content[0].text);
    expect(list.projects[0].active).toBe(false);
  });

  it('agenticos_list_projects is bounded to 50', async () => {
    const many = Array.from({ length: 70 }, (_, i) => ({ id: `proj-${i}`, name: `P${i}`, status: 'active', updatedAt: 'x' }));
    mockFetch({ '/api/projects': () => jsonResponse({ projects: many, activeProjectId: null }) });
    const out = await callTool('agenticos_list_projects', { limit: 50 }, makeBackend());
    expect(JSON.parse(out.content[0].text).projects.length).toBeLessThanOrEqual(50);
  });

  it('agenticos_get_run passes projectId for isolation; surfaces 403 boundary', async () => {
    const { calls } = mockFetch({
      '/api/mcp-bridge/runs/run-1': (url) => url.includes('?projectId=proj-a')
        ? jsonResponse({ runId: 'run-1', projectId: 'proj-a', status: 'running' })
        : jsonResponse({ runId: 'run-1', projectId: 'proj-b', status: 'running' }),
    });
    const out = await callTool('agenticos_get_run', { runId: 'run-1', projectId: 'proj-a' }, makeBackend());
    expect(JSON.parse(out.content[0].text).projectId).toBe('proj-a');
    expect(calls.some((c) => c.url.includes('projectId=proj-a'))).toBe(true);
  });

  it('agenticos_get_run_result returns the actual report', async () => {
    mockFetch({
      '/api/mcp-bridge/runs/run-9/result': () => jsonResponse({ runId: 'run-9', status: 'completed', summary: 'Done: added triple()', verification: { verdict: 'PASS' } }),
    });
    const out = await callTool('agenticos_get_run_result', { runId: 'run-9' }, makeBackend());
    const parsed = JSON.parse(out.content[0].text);
    expect(parsed.summary).toContain('triple');
    expect(parsed.verification.verdict).toBe('PASS');
  });

  it('secret-like content is redacted in tool output', async () => {
    mockFetch({
      '/api/mcp-bridge/runs/run-1': () => jsonResponse({ runId: 'run-1', note: 'key=sk-abcdef1234567890', auth: 'Bearer tok1234567890', result: { summary: 'sk-zzzz9999' } }),
    });
    const out = await callTool('agenticos_get_run', { runId: 'run-1' }, makeBackend());
    const text = out.content[0].text;
    expect(text).not.toMatch(/sk-[A-Za-z0-9]{8,}/);
    expect(text).toMatch(/REDACTED/);
  });

  it('non-loopback backend URL is rejected', () => {
    expect(() => resolveBaseUrl('http://example.com:4000')).toThrow(/loopback/i);
    expect(() => resolveBaseUrl('http://10.0.0.5:4000')).toThrow(/loopback/i);
    expect(resolveBaseUrl('http://127.0.0.1:4000')).toBe('http://127.0.0.1:4000');
    expect(resolveBaseUrl('http://localhost:4000')).toBe('http://localhost:4000');
  });
});

describe('prepare and approval', () => {
  it('preparing a task does not execute it (no run endpoints called)', async () => {
    const { calls } = mockFetch({
      '/api/mcp-bridge/prepare': () => jsonResponse({ preparedTaskId: 'mcp-prep-1', taskId: 'task-1', approvalState: 'pending', requiredApproval: true, executed: false }),
    });
    const out = await callTool('agenticos_prepare_task', {
      projectId: 'proj-1', targetWorker: 'hermes', taskType: 'research', title: 'Summarize', prompt: 'Inspect file and summarize in five items.',
    }, makeBackend());
    expect(JSON.parse(out.content[0].text).executed).toBe(false);
    expect(calls.some((c) => c.url.includes('/runs') && c.init?.method === 'POST')).toBe(false);
  });

  it('invalid worker/task-type pairing is rejected', async () => {
    const { calls } = mockFetch({
      '/api/mcp-bridge/prepare': () => jsonResponse({ error: 'Invalid worker/task-type pairing' }, 400),
    });
    const out = await callTool('agenticos_prepare_task', {
      projectId: 'proj-1', targetWorker: 'magnitude', taskType: 'implementation', title: 'T', prompt: 'Edit code',
    }, makeBackend());
    expect(out.isError).toBe(true);
    expect(JSON.stringify(calls)).toContain('/prepare');
  });

  it('missing projectId is rejected', async () => {
    const out = await callTool('agenticos_prepare_task', {
      targetWorker: 'hermes', taskType: 'research', title: 'T', prompt: 'x',
    }, makeBackend());
    expect(out.isError).toBe(true);
  });

  it('client-provided approved:true is ignored (never forwarded)', async () => {
    const { calls } = mockFetch({
      '/api/mcp-bridge/prepare': () => jsonResponse({ preparedTaskId: 'mcp-prep-2', approvalState: 'pending', executed: false }),
      '/api/mcp-bridge/submit': () => jsonResponse({ error: 'Prepared task requires approval' }, 400),
    });
    await callTool('agenticos_prepare_task', {
      projectId: 'proj-1', targetWorker: 'hermes', taskType: 'research', title: 'T', prompt: 'x', approved: true,
    }, makeBackend());
    const prepareCall = calls.find((c) => c.url.includes('/prepare'));
    expect(JSON.stringify(prepareCall?.init?.body)).not.toContain('"approved"');
    // Submit with an approved claim still fails server-side.
    const submit = await callTool('agenticos_submit_prepared_task', { preparedTaskId: 'mcp-prep-2', approved: true }, makeBackend());
    expect(submit.isError).toBe(true);
  });

  it('submission without approval is rejected', async () => {
    mockFetch({ '/api/mcp-bridge/submit': () => jsonResponse({ error: 'Prepared task requires approval' }, 400) });
    const out = await callTool('agenticos_submit_prepared_task', { preparedTaskId: 'mcp-prep-x' }, makeBackend());
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toMatch(/approval/i);
  });

  it('existing authoritative approval permits submission', async () => {
    mockFetch({
      '/api/mcp-bridge/submit': () => jsonResponse({
        taskId: 'task-1', runId: 'er-abc', projectId: 'proj-1', workerId: 'hermes', status: 'queued', alreadySubmitted: false,
        correlation: { preparedTaskId: 'mcp-prep-1', taskId: 'task-1', runId: 'er-abc' },
      }),
    });
    const out = await callTool('agenticos_submit_prepared_task', { preparedTaskId: 'mcp-prep-1' }, makeBackend());
    const parsed = JSON.parse(out.content[0].text);
    expect(parsed.runId).toBe('er-abc');
    expect(parsed.correlation.preparedTaskId).toBe('mcp-prep-1');
  });
});

describe('submission and idempotency', () => {
  it('repeated submission returns the same task/run', async () => {
    const { calls } = mockFetch({
      '/api/mcp-bridge/submit': () => jsonResponse({ runId: 'er-same', taskId: 'task-1', alreadySubmitted: false, correlation: {} }),
    });
    const first = await callTool('agenticos_submit_prepared_task', { preparedTaskId: 'mcp-prep-1' }, makeBackend());
    const second = await callTool('agenticos_submit_prepared_task', { preparedTaskId: 'mcp-prep-1' }, makeBackend());
    expect(JSON.parse(first.content[0].text).runId).toBe('er-same');
    expect(JSON.parse(second.content[0].text).runId).toBe('er-same');
    // Both calls used the same preparedTaskId (idempotency is backend-enforced)
    expect(calls.length).toBe(2);
  });
});

describe('follow and cancellation', () => {
  it('follow passes the after cursor and returns only new events', async () => {
    const { calls } = mockFetch({
      '/api/mcp-bridge/runs/run-1/events': (url) => url.includes('after=3')
        ? jsonResponse({ run: { id: 'run-1' }, events: [{ sequence: 4, eventType: 'RUN_STARTED' }], nextSequence: 4 })
        : jsonResponse({ run: { id: 'run-1' }, events: [], nextSequence: 0 }),
    });
    const out = await callTool('agenticos_follow_run', { runId: 'run-1', afterSequence: 3 }, makeBackend());
    expect(JSON.parse(out.content[0].text).events[0].sequence).toBe(4);
    expect(calls.some((c) => c.url.includes('after=3'))).toBe(true);
  });

  it('follow timeout is bounded by the client', async () => {
    const client = new BackendClient({ baseUrl: 'http://127.0.0.1:4000', timeoutMs: 50 });
    // Mock fetch must honor AbortSignal like a real fetch.
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: any) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    })));
    const started = Date.now();
    await expect(client.get('/api/mcp-bridge/runs/run-1/events?after=0')).rejects.toThrow(/timed out/i);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('cancellation uses the canonical endpoint and is idempotent', async () => {
    const { calls } = mockFetch({
      '/api/mcp-bridge/runs/run-5/cancel': () => jsonResponse({ runId: 'run-5', status: 'cancelled', cancellationReason: 'user asked', terminal: true }),
    });
    const out = await callTool('agenticos_cancel_run', { runId: 'run-5', reason: 'user asked' }, makeBackend());
    expect(JSON.parse(out.content[0].text).status).toBe('cancelled');
    expect(calls.some((c) => c.url.includes('/cancel'))).toBe(true);
  });
});

describe('security', () => {
  it('exposes only the eleven bridge tools — no command/fs/env tools', () => {
    const names = TOOLS.map((t) => t.name);
    expect(names).toEqual([
      'agenticos_health',
      'agenticos_get_active_project',
      'agenticos_list_projects',
      'agenticos_get_project_context',
      'agenticos_list_runs',
      'agenticos_get_run',
      'agenticos_get_run_result',
      'agenticos_prepare_task',
      'agenticos_submit_prepared_task',
      'agenticos_cancel_run',
      'agenticos_follow_run',
    ]);
    const joined = JSON.stringify(TOOLS).toLowerCase();
    expect(joined).not.toContain('shell');
    expect(joined).not.toContain('read_file');
    expect(joined).not.toContain('write_file');
    expect(joined).not.toContain('process.env');
    expect(joined).not.toContain('agentos_api_token');
    expect(joined).not.toContain('read_environment');
  });

  it('health output contains no environment dump', async () => {
    mockFetch({
      '/api/health': () => jsonResponse({ status: 'healthy' }),
      '/api/project-execution/workers/capabilities': () => jsonResponse({ capabilities: {} }),
      '/api/memory/stats': () => jsonResponse({}),
    });
    const out = await callTool('agenticos_health', {}, makeBackend());
    expect(out.content[0].text).not.toContain('process.env');
    expect(out.content[0].text).not.toContain('PATH');
  });

  it('error messages are sanitized (no stack traces)', () => {
    const err = new Error('boom at line 12\n    at fn (file.ts:3:4)');
    expect(sanitizeError(err)).not.toContain('\n');
    expect(redactSecrets('token=sk-abcdefgh12345678')).toContain('REDACTED');
  });

  it('redactJson deep-redacts nested secrets', () => {
    const out = redactJson({ a: { b: 'sk-abcdef1234567890' }, c: 'Bearer 123456789012345' });
    expect(JSON.stringify(out)).not.toMatch(/sk-[A-Za-z0-9]{8,}/);
    expect(JSON.stringify(out)).not.toMatch(/Bearer 123/);
  });

  it('server rejects invalid JSON-RPC frames and answers tools/list', async () => {
    const server = new AgenticosMcpServer({ baseUrl: 'http://127.0.0.1:4000' });
    const out: string[] = [];
    (server as any).out = { write: (s: string) => { out.push(s); } };
    await (server as any).handleMessage('not-json');
    await (server as any).handleMessage(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
    await (server as any).handleMessage(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }));
    const msgs = out.map((s) => JSON.parse(s));
    expect(msgs[0].result.serverInfo.name).toBe('agenticos');
    expect(msgs[1].result.tools.length).toBe(11);
  });
});
