import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { AgentRuntimeSelector } from '../../src/components/agents/AgentRuntimeSelector';

describe('ARS probe — saving creates assignment', () => {
  let putSpy: any;

  beforeEach(() => {
    putSpy = vi.fn(async (_url: string, _opts?: RequestInit) => ({
      ok: true, status: 200,
      json: async () => ({ agentId: 'agent-hermes', providerId: 'prov-ollama', modelId: 'qwen3.5:4b', routingMode: 'preferred', enabled: true }),
      text: async () => '',
    } as unknown as Response));

    vi.stubGlobal('fetch', vi.fn(async (url: string, opts?: RequestInit) => {
      if (url.includes('agent-provider-assignments/agent-hermes') && opts?.method === 'PUT') return putSpy(url, opts);
      if (url.includes('agent-provider-assignments/agent-hermes')) return { ok: false, status: 404, text: async () => '', json: async () => ({}) } as unknown as Response;
      if (url.includes('/api/providers')) return { ok: true, status: 200, json: async () => [{ id: 'prov-ollama', name: 'Ollama' }], text: async () => '' } as unknown as Response;
      if (url.includes('/models')) return { ok: true, status: 200, json: async () => ({ models: [{ id: 'qwen3.5:4b', name: 'Qwen 3.5 4B' }] }), text: async () => '' } as unknown as Response;
      return { ok: false, status: 404, text: async () => '', json: async () => ({}) } as unknown as Response;
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('probe: steps + button state', async () => {
    const calls: string[] = [];
    const realMock = vi.fn(async (url: string, opts?: RequestInit) => {
      calls.push(`${opts?.method || 'GET'} ${url}`);
      if (url.includes('agent-provider-assignments/agent-hermes') && opts?.method === 'PUT') return putSpy(url, opts);
      if (url.includes('agent-provider-assignments/agent-hermes')) return { ok: false, status: 404, text: async () => '', json: async () => ({}) } as unknown as Response;
      if (url.includes('/api/providers')) return { ok: true, status: 200, json: async () => [{ id: 'prov-ollama', name: 'Ollama' }], text: async () => '' } as unknown as Response;
      if (url.includes('/models')) return { ok: true, status: 200, json: async () => ({ models: [{ id: 'qwen3.5:4b', name: 'Qwen 3.5 4B' }] }), text: async () => '' } as unknown as Response;
      return { ok: false, status: 404, text: async () => '', json: async () => ({}) } as unknown as Response;
    });
    vi.stubGlobal('fetch', realMock);

    render(<AgentRuntimeSelector agentId="agent-hermes" />);
    await waitFor(() => screen.getByText(/Not configured/i));
    const selects0 = screen.getAllByRole('combobox');
    console.log('PROBE selects after mount:', selects0.length, selects0.map(s => (s as HTMLSelectElement).value));

    fireEvent.change(selects0[0], { target: { value: 'preferred' } });
    await waitFor(() => screen.getAllByRole('combobox').length >= 2);
    const selects1 = screen.getAllByRole('combobox');
    console.log('PROBE selects after mode:', selects1.length, selects1.map(s => (s as HTMLSelectElement).value));

    const providerSelect = selects1[1];
    fireEvent.change(providerSelect, { target: { value: 'prov-ollama' } });
    await waitFor(() => screen.getAllByRole('combobox').length >= 3);
    const selects2 = screen.getAllByRole('combobox');
    console.log('PROBE selects after provider:', selects2.length, selects2.map(s => (s as HTMLSelectElement).value));
    console.log('PROBE model options before wait:', Array.from(selects2[2].querySelectorAll('option')).map(o => `${o.value}|${o.disabled ? 'D' : ''}`));

    // Wait for the models OPTION to actually load
    await waitFor(() => {
      const opts = Array.from(screen.getAllByRole('combobox')[2].querySelectorAll('option')).map(o => o.value);
      return opts.includes('qwen3.5:4b');
    });
    const selects2b = screen.getAllByRole('combobox');
    console.log('PROBE model options after wait:', Array.from(selects2b[2].querySelectorAll('option')).map(o => `${o.value}|${o.disabled ? 'D' : ''}`));
    console.log('PROBE fetch calls so far:', JSON.stringify(calls));

    const modelSelect = selects2b[2];
    fireEvent.change(modelSelect, { target: { value: 'qwen3.5:4b' } });
    await waitFor(() => screen.getAllByRole('combobox').length >= 3);
    const selects3 = screen.getAllByRole('combobox');
    console.log('PROBE selects after model:', selects3.length, selects3.map(s => (s as HTMLSelectElement).value));

    const saveBtn = await waitFor(() => screen.getByText('Save').closest('button')!);
    console.log('PROBE Save button disabled:', (saveBtn as HTMLButtonElement).disabled);
    fireEvent.click(saveBtn);
    await new Promise(r => setTimeout(r, 300));
    console.log('PROBE putSpy calls:', putSpy.mock.calls.length);
    expect(true).toBe(true);
  });
});
