import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { AgentRuntimeSelector } from '../components/agents/AgentRuntimeSelector';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeFetch(handlers: Record<string, { status: number; body: any }>) {
  return vi.fn(async (url: string, opts?: RequestInit) => {
    const signal = opts?.signal as AbortSignal | undefined;
    if (signal?.aborted) throw Object.assign(new Error('AbortError'), { name: 'AbortError' });

    const key = Object.keys(handlers).find(k => url.includes(k));
    if (!key) return { ok: false, status: 404, text: async () => 'Not found', json: async () => ({}) } as Response;

    const { status, body } = handlers[key];
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
      json: async () => body,
    } as unknown as Response;
  });
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('AgentRuntimeSelector', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders "Not configured" on 404 and does NOT call console.error', async () => {
    vi.stubGlobal('fetch', makeFetch({
      'agent-provider-assignments/agent-hermes': { status: 404, body: 'Not Found' },
      '/api/providers': { status: 200, body: [] },
    }));

    render(<AgentRuntimeSelector agentId="agent-hermes" />);

    await waitFor(() => {
      expect(screen.getByText(/Not configured/i)).toBeTruthy();
    });

    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('renders error on 500', async () => {
    vi.stubGlobal('fetch', makeFetch({
      'agent-provider-assignments/agent-hermes': { status: 500, body: 'Internal Server Error' },
      '/api/providers': { status: 200, body: [] },
    }));

    render(<AgentRuntimeSelector agentId="agent-hermes" />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
      expect(screen.getByRole('alert').textContent).toMatch(/HTTP 500/);
    });
  });

  it('does NOT render duplicate visible errors under React StrictMode', async () => {
    vi.stubGlobal('fetch', makeFetch({
      'agent-provider-assignments/agent-hermes': { status: 500, body: 'Server Error' },
      '/api/providers': { status: 200, body: [] },
    }));

    render(
      <React.StrictMode>
        <AgentRuntimeSelector agentId="agent-hermes" />
      </React.StrictMode>
    );

    await waitFor(() => {
      const alerts = screen.queryAllByRole('alert');
      expect(alerts.length).toBe(1);
    });
  });

  it('renders loaded assignment when 200', async () => {
    vi.stubGlobal('fetch', makeFetch({
      'agent-provider-assignments/agent-jarvis': {
        status: 200,
        body: {
          agentId: 'agent-jarvis',
          providerId: 'prov-ollama',
          modelId: 'qwen3.5:4b',
          routingMode: 'preferred',
          enabled: true,
        },
      },
      '/api/providers': { status: 200, body: [{ id: 'prov-ollama', name: 'Ollama' }] },
    }));

    render(<AgentRuntimeSelector agentId="agent-jarvis" />);

    await waitFor(() => {
      expect(screen.queryByText(/Not configured/i)).toBeNull();
    });
  });

  it('saving creates the agent-hermes assignment via PUT', async () => {
    const putSpy = vi.fn(async (_url: string, _opts?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({
        agentId: 'agent-hermes',
        providerId: 'prov-ollama',
        modelId: 'qwen3.5:4b',
        routingMode: 'preferred',
        enabled: true,
      }),
      text: async () => '',
    } as unknown as Response));

    vi.stubGlobal('fetch', vi.fn(async (url: string, opts?: RequestInit) => {
      if (url.includes('agent-provider-assignments/agent-hermes') && opts?.method === 'PUT') {
        return putSpy(url, opts);
      }
      if (url.includes('agent-provider-assignments/agent-hermes')) {
        return { ok: false, status: 404, text: async () => '', json: async () => ({}) } as unknown as Response;
      }
      if (url.endsWith('/api/providers')) {
        return {
          ok: true, status: 200,
          json: async () => [{ id: 'prov-ollama', name: 'Ollama' }],
          text: async () => '',
        } as unknown as Response;
      }
      if (url.includes('/models')) {
        return {
          ok: true, status: 200,
          json: async () => ({ models: [{ id: 'qwen3.5:4b', name: 'Qwen 3.5 4B' }] }),
          text: async () => '',
        } as unknown as Response;
      }
      return { ok: false, status: 404, text: async () => '', json: async () => ({}) } as unknown as Response;
    }));

    render(<AgentRuntimeSelector agentId="agent-hermes" />);

    await waitFor(() => screen.getByText(/Not configured/i));

    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'preferred' } });

    await waitFor(() => screen.getAllByRole('combobox').length >= 2);
    const providerSelect = screen.getAllByRole('combobox')[1];
    fireEvent.change(providerSelect, { target: { value: 'prov-ollama' } });

    await waitFor(() => screen.getAllByRole('combobox').length >= 3);
    const modelSelect = screen.getAllByRole('combobox')[2];
    fireEvent.change(modelSelect, { target: { value: 'qwen3.5:4b' } });

    const saveBtn = await waitFor(() => screen.getByText('Save').closest('button')!);
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(putSpy).toHaveBeenCalledOnce();
      const callArgs = putSpy.mock.calls[0];
      const body = JSON.parse(callArgs[1]?.body as string);
      expect(body.providerId).toBe('prov-ollama');
      expect(body.modelId).toBe('qwen3.5:4b');
      expect(body.routingMode).toBe('preferred');
    });
  });
});
