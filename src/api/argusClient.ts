/**
 * ARGUS API client — independent verification system observability.
 * Thin typed wrapper over the canonical backend ARGUS REST surface.
 */
import { apiUrl } from './client';

export interface ArgusCheck {
  type: 'file-exists' | 'file-content' | 'command';
  path?: string;
  contains?: string;
  exact?: string;
  command?: string;
  args?: string[];
  timeoutMs?: number;
  expectExit?: number;
  evidenceLevel?: string;
}

export interface ArgusContract {
  id: string;
  goalId: string;
  workspacePath: string;
  title: string;
  originalSpec: string;
  acceptanceCriteria: ArgusCheck[];
  specHash: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface ArgusVerdictCheck {
  name: string;
  passed: boolean;
  evidence: string;
  level: string;
}

export interface ArgusVerdict {
  passed: boolean;
  summary: string;
  checks: ArgusVerdictCheck[];
  blockingIssues: string[];
  recommendedFixes: string[];
}

export interface ArgusVerification {
  id: string;
  contractId: string;
  goalId: string;
  attempt: number;
  status: string;
  evidenceLevel: string;
  verdict: ArgusVerdict;
  provider: string | null;
  model: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface ArgusDefect {
  id: string;
  verificationId: string;
  contractId: string;
  goalId: string;
  severity: string;
  description: string;
  reproduction: string | null;
  expected: string | null;
  actual: string | null;
  fixSuggestion: string | null;
  status: string;
  correctionGoalId: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface ArgusGoalStatus {
  id: string;
  status: string;
  verificationState: string;
  contractId?: string;
}

export const argusClient = {
  async listContracts(): Promise<ArgusContract[]> {
    const res = await fetch(apiUrl('/api/argus/contracts'));
    if (!res.ok) throw new Error(`ARGUS contracts ${res.status}`);
    const body = await res.json();
    return body.contracts || [];
  },

  async getContract(id: string): Promise<{ contract: ArgusContract; goal: ArgusGoalStatus | null; verifications: ArgusVerification[]; defects: ArgusDefect[] }> {
    const res = await fetch(apiUrl(`/api/argus/contracts/${encodeURIComponent(id)}`));
    if (!res.ok) throw new Error(`ARGUS contract ${res.status}`);
    return res.json();
  },

  async getGoalStatus(goalId: string): Promise<{ goal: ArgusGoalStatus; contracts: ArgusContract[]; verifications: ArgusVerification[] }> {
    const res = await fetch(apiUrl(`/api/argus/goals/${encodeURIComponent(goalId)}`));
    if (!res.ok) throw new Error(`ARGUS goal ${res.status}`);
    return res.json();
  },

  async createContract(goalId: string, acceptanceCriteria?: ArgusCheck[], title?: string): Promise<ArgusContract> {
    const res = await fetch(apiUrl('/api/argus/contracts'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goalId, acceptanceCriteria, title }),
    });
    if (!res.ok) throw new Error(`ARGUS create contract ${res.status}`);
    const body = await res.json();
    return body.contract;
  },

  async verifyGoal(goalId: string): Promise<{ verification: unknown }> {
    const res = await fetch(apiUrl('/api/argus/verify'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goalId }),
    });
    if (!res.ok) throw new Error(`ARGUS verify ${res.status}`);
    return res.json();
  },

  async listDefects(): Promise<ArgusDefect[]> {
    const res = await fetch(apiUrl('/api/argus/defects'));
    if (!res.ok) throw new Error(`ARGUS defects ${res.status}`);
    const body = await res.json();
    return body.defects || [];
  },

  async getAssignment(): Promise<{ providerId: string; modelId: string | null; routingMode: string } | null> {
    const res = await fetch(apiUrl('/api/argus/assignment'));
    if (!res.ok) return null;
    const body = await res.json();
    return body.assignment || null;
  },
};
