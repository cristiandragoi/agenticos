const BASE_URL = import.meta.env.VITE_API_URL || (window.location.protocol === 'file:' ? 'http://localhost:4001/api' : '/api');

import type { RunRecord } from '../types';

export const apiClient = {
  async get(path: string) {
    const res = await fetch(`${BASE_URL.replace('/api', '')}${path}`);
    if (!res.ok) throw new Error(`GET ${path} failed: ${res.statusText}`);
    return res.json();
  },
  async post(path: string, body?: any) {
    const res = await fetch(`${BASE_URL.replace('/api', '')}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) throw new Error(`POST ${path} failed: ${res.statusText}`);
    return res.json();
  },
  async getAgents() {
    const res = await fetch(`${BASE_URL}/agents`);
    if (!res.ok) return [];
    return res.json();
  },
  async getProviders() {
    const res = await fetch(`${BASE_URL}/providers`);
    if (!res.ok) return [];
    return res.json();
  },
  async getRuns(): Promise<RunRecord[]> {
    const res = await fetch(`${BASE_URL}/runs`);
    if (!res.ok) throw new Error('Failed to fetch runs');
    return res.json();
  },

  async vaultRead(filePath: string): Promise<{ content: string }> {
    const res = await fetch(`${BASE_URL}/memory/vault/read?filePath=${encodeURIComponent(filePath)}`);
    if (!res.ok) throw new Error('Failed to read from vault');
    return res.json();
  },
  async getMemoryScopes() {
    const res = await fetch(`${BASE_URL}/memory/scopes`);
    if (!res.ok) return [];
    return res.json();
  },
  async getResearchBriefs() {
    const res = await fetch(`${BASE_URL}/research/briefs`);
    if (!res.ok) return [];
    return res.json();
  },
  async createResearchBrief(data: any) {
    const res = await fetch(`${BASE_URL}/research/brief`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return res.json();
  },
  async approveResearchBrief(id: string) {
    const res = await fetch(`${BASE_URL}/research/brief/${id}/approve`, {
      method: 'POST'
    });
    return res.json();
  },
  async getLeads() {
    const res = await fetch(`${BASE_URL}/sales/leads`);
    if (!res.ok) return { leads: [] };
    return res.json();
  },
  async createLead(data: any) {
    const res = await fetch(`${BASE_URL}/sales/lead`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return res.json();
  },
  async payLead(id: string) {
    const res = await fetch(`${BASE_URL}/sales/lead/${id}/pay`, {
      method: 'POST'
    });
    return res.json();
  },
  async getMemoryEntries() {
    const res = await fetch(`${BASE_URL}/memory/entries`);
    if (!res.ok) return [];
    return res.json();
  },
  async getArtifacts() {
    const res = await fetch(`${BASE_URL}/artifacts`);
    if (!res.ok) return [];
    return res.json();
  },
  async exchangeToken(id: string, token: string) {
    const res = await fetch(`${BASE_URL}/artifacts/${id}/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    if (!res.ok) throw new Error('Unauthorized');
    return res.json();
  },
  async getArtifactSecure(id: string, sessionToken: string) {
    const res = await fetch(`${BASE_URL}/artifacts/secure/${id}`, {
      headers: { 'Authorization': `Bearer ${sessionToken}` }
    });
    if (!res.ok) {
        throw new Error('Unauthorized or not found');
    }
    return res.json();
  },
  async getBoards() {
    const res = await fetch(`${BASE_URL}/boards`);
    if (!res.ok) return [];
    return res.json();
  },
  async getRuntimes() {
    const res = await fetch(`${BASE_URL}/runtimes`);
    if (!res.ok) return [];
    return res.json();
  },
  async getTools() {
    const res = await fetch(`${BASE_URL}/tools`);
    if (!res.ok) return [];
    return res.json();
  },

  async resolveIntent(message: string): Promise<{ agentId: string | null, confidence: number }> {
    const res = await fetch(`${BASE_URL}/chat/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });
    if (!res.ok) return { agentId: null, confidence: 0 };
    return res.json();
  },

  async sendMessage(agentId: string, message: string): Promise<{ runId: string }> {
    const res = await fetch(`${BASE_URL}/chat/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, message })
    });
    return res.json();
  },

  async sendApolloMessage(model: string, message: string) {
    const res = await fetch(`${BASE_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, message })
    });
    const data = await res.json();
    return { data };
  },

  async voiceHealth(): Promise<{ status: string, stt_available: boolean, execution_available: boolean }> {
    const res = await fetch(`${BASE_URL}/voice/health`);
    if (!res.ok) throw new Error('Voice health check failed');
    return res.json();
  },

  async voiceTranscribe(audioBlob: Blob): Promise<{ text: string }> {
    const formData = new FormData();
    formData.append('audio', audioBlob, 'audio.webm');

    const res = await fetch(`${BASE_URL}/voice/transcribe`, {
      method: 'POST',
      body: formData
    });
    if (!res.ok) throw new Error('Transcribe failed');
    return res.json();
  },

  async voiceExecute(text: string, agentId: string, voice?: string) {
    const res = await fetch(`${BASE_URL}/voice/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, agentId, voice })
    });
    if (!res.ok) throw new Error('Execute failed');
    return res.json();
  },

  async saveMemoryEntry(scopeId: string, key: string, content: string) {
    const res = await fetch(`${BASE_URL}/memory/entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scopeId, key, content })
    });
    if (!res.ok) throw new Error('Failed to save memory');
    return res.json();
  },

  async createAgent(data: {
    name: string;
    description?: string;
    slug?: string;
    avatar?: string;
    color?: string;
    capabilities?: string[];
    toolIds?: string[];
    providerIds?: string[];
  }) {
    const res = await fetch(`${BASE_URL}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to create agent');
    return res.json();
  },

  // ── Schedules ──

  async getSchedules() {
    const res = await fetch(`${BASE_URL}/schedules`);
    if (!res.ok) return [];
    return res.json();
  },

  async createSchedule(data: {
    name: string;
    agentId: string;
    interval: string;
    prompt: string;
    type?: string;
  }) {
    const res = await fetch(`${BASE_URL}/schedules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to create schedule');
    return res.json();
  },

  async deleteSchedule(id: string) {
    const res = await fetch(`${BASE_URL}/schedules/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete schedule');
  },

  async runSchedule(id: string) {
    const res = await fetch(`${BASE_URL}/schedules/${id}/run`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to run schedule');
    return res.json();
  },

  // ── Providers & Keys ──

  async createRun(agentId: string, prompt: string, mode: string = 'chat'): Promise<{ runId: string }> {
    const res = await fetch(`${BASE_URL}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, prompt, mode }),
    });
    if (!res.ok) throw new Error('Failed to create run');
    return res.json();
  },

  async createAutonomousRun(agentId: string, goal: string, constraints?: string, mode: string = 'task'): Promise<{ runId: string }> {
    const res = await fetch(`${BASE_URL}/runs/autonomous`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, goal, constraints, mode }),
    });
    if (!res.ok) throw new Error('Failed to create autonomous run');
    return res.json();
  },

  async testProviderConnection(providerId: string): Promise<{
    reachable: boolean;
    latencyMs: number;
    status: string;
    errorMessage?: string;
    hasKey: boolean;
  }> {
    const res = await fetch(`${BASE_URL}/providers/${providerId}/test`, { method: 'POST' });
    return res.json();
  },

  async getAgentModelDefaults(agentId: string) {
    const res = await fetch(`${BASE_URL}/providers/agent-defaults/${agentId}`);
    if (!res.ok) return null;
    return res.json();
  },

  async updateAgentProviderDefaults(agentId: string, providerIds: string[]) {
    const res = await fetch(`${BASE_URL}/providers/agent-defaults/${agentId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerIds }),
    });
    if (!res.ok) throw new Error('Failed to update agent defaults');
    return res.json();
  },

  async updateProvider(id: string, updates: Record<string, any>) {
    const res = await fetch(`${BASE_URL}/providers/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error('Failed to update provider');
    return res.json();
  },

  // ── Key Management (server-side .env persistence) ──

  async getProviderKeyStatus(providerId: string): Promise<{
    providerId: string;
    hasKey: boolean;
    envVar: string | null;
    maskedKey: string | null;
    isLocal: boolean;
  }> {
    const res = await fetch(`${BASE_URL}/providers/${providerId}/key`);
    if (!res.ok) throw new Error('Failed to get key status');
    return res.json();
  },

  async saveProviderKey(providerId: string, keyValue: string): Promise<{
    success: boolean;
    providerId: string;
    envVar: string;
    maskedKey: string;
    message: string;
  }> {
    const res = await fetch(`${BASE_URL}/providers/${providerId}/key`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyValue }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: { message: 'Failed to save key' } }));
      throw new Error(err.error?.message || 'Failed to save key');
    }
    return res.json();
  },

  async deleteProviderKey(providerId: string): Promise<{
    success: boolean;
    providerId: string;
    message: string;
  }> {
    const res = await fetch(`${BASE_URL}/providers/${providerId}/key`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete key');
    return res.json();
  },
};

