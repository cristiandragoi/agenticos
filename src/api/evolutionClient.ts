import { apiFetch, apiUrl } from './client';
const API_URL = apiUrl('/api/evolution');

export interface PromptVersion {
  id: string;
  agentId: string;
  versionNumber: number;
  prompt: string;
  status: string;
  author: string;
  reasonForChange: string;
  createdAt: string;
}

export interface AgentExecution {
  id: string;
  agentId: string;
  promptVersionId?: string;
  model: string;
  provider: string;
  input: any;
  output: any;
  executionTimeMs?: number;
  success: boolean;
  primaryFailureCategory?: string;
  createdAt: string;
}

export interface RunEvaluation {
  id: string;
  executionId: string;
  taskCompletionScore: number;
  outputQualityScore: number;
  complianceScore: number;
  correctnessScore: number;
  overallScore: number;
}

export const evolutionClient = {
  getLeaderboard: async () => {
    const res = await apiFetch(`${API_URL}/leaderboard`);
    if (!res.ok) throw new Error('Failed to fetch leaderboard');
    return res.json();
  },

  getExecutions: async (agentId?: string) => {
    const url = agentId ? `${API_URL}/executions?agentId=${agentId}` : `${API_URL}/executions`;
    const res = await apiFetch(url);
    if (!res.ok) throw new Error('Failed to fetch executions');
    return res.json();
  },

  getAgentVersions: async (agentId: string): Promise<PromptVersion[]> => {
    const res = await apiFetch(`${API_URL}/agents/${agentId}/versions`);
    if (!res.ok) throw new Error('Failed to fetch versions');
    return res.json();
  },

  createChallenger: async (agentId: string, author: string) => {
    const res = await apiFetch(`${API_URL}/agents/${agentId}/challenger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ author })
    });
    if (!res.ok) throw new Error('Failed to create challenger');
    return res.json();
  },

  promoteVersion: async (versionId: string, author: string, reason: string) => {
    const res = await apiFetch(`${API_URL}/versions/${versionId}/promote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ author, reason })
    });
    if (!res.ok) throw new Error('Failed to promote version');
    return res.json();
  },

  rollbackVersion: async (versionId: string, author: string, reason: string) => {
    const res = await apiFetch(`${API_URL}/versions/${versionId}/rollback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ author, reason })
    });
    if (!res.ok) throw new Error('Failed to rollback version');
    return res.json();
  }
};
