import { apiFetch } from './client';

export interface RevenueMission {
  id: string;
  projectId?: string;
  title: string;
  description?: string;
  targetAmount: number;
  currency: string;
  startDate: string;
  deadline: string;
  advertisingBudget: number;
  actualSpend: number;
  enabledEngines: string[];
  availableChannels: string[];
  primaryMarket: string;
  status: 'active' | 'paused' | 'completed' | 'archived';
  realizedRevenue: number;
  verifiedRevenue: number;
  pipelineValue: number;
  actualCost: number;
  netRevenue: number;
  createdAt: string;
  updatedAt: string;
}

export interface RevenueExperiment {
  id: string;
  missionId: string;
  projectId?: string;
  opportunityId?: string;
  engine: 'digital_products' | 'german_sme' | string;
  hypothesis: string;
  targetCustomer?: string;
  problem?: string;
  product?: string;
  offer?: string;
  price?: number;
  evidence?: any[];
  evidenceSources?: string[];
  confidence?: number;
  competitors?: string[];
  distributionChannels?: string[];
  estimatedCost: number;
  actualCost: number;
  expectedRevenue: number;
  actualRevenue: number;
  verifiedRevenue: number;
  buildTime?: string;
  launchDate?: string;
  impressions: number;
  visits: number;
  leads: number;
  responses: number;
  conversions: number;
  sales: number;
  decisionReason?: string;
  status: string;
  goalIds?: string[];
  taskIds?: string[];
  runIds?: string[];
  artifactIds?: string[];
  scorePayload?: any;
  createdAt: string;
  updatedAt: string;
}

export interface RevenueLedgerEntry {
  id: string;
  missionId?: string;
  experimentId?: string;
  entryType: 'PIPELINE_VALUE' | 'PROPOSED_VALUE' | 'ORDER_VALUE' | 'REALIZED_REVENUE' | 'VERIFIED_REVENUE' | 'REFUNDED_REVENUE' | 'ACTUAL_COST' | 'NET_REVENUE';
  amount: number;
  currency: string;
  status: 'recorded' | 'verified';
  evidence?: any[];
  provenance?: any;
  source?: string;
  verifiedAt?: string;
  verifiedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RevenueHumanGate {
  id: string;
  experimentId?: string;
  gateType: string;
  status: 'open' | 'resolved' | 'blocked';
  description?: string;
  branchPaused: boolean;
  resolvedBy?: string;
  resolvedAt?: string;
  metadata?: any;
  createdAt: string;
  updatedAt: string;
}

export interface RevenueComplianceRecord {
  id: string;
  experimentId?: string;
  companyName?: string;
  website?: string;
  contactEmail?: string;
  contactSource?: string;
  businessRelevance?: string;
  purpose?: string;
  outreachHistory?: any[];
  optOut: boolean;
  doNotContact: boolean;
  suppressionState: 'none' | 'opt_out' | 'do_not_contact' | 'legal';
  retentionState: 'active' | 'retention_pending' | 'deleted';
  lawfulBasis?: string;
  complianceReviewState: 'not_required' | 'pending' | 'approved' | 'rejected';
  createdAt: string;
  updatedAt: string;
}

export interface RevenueObservability {
  mission: RevenueMission;
  experimentsByEngine: Record<string, RevenueExperiment[]>;
  whatIsRunning: Array<{ id: string; engine: string; status: string; currentAction: string }>;
  whatIsBlocked: Array<{ gateId: string; gateType: string; description: string; experimentId: string }>;
  nextSuggestedActions: Array<{ action: string; engine: string; rationale: string; priority: number }>;
}

export const revenueOperatorClient = {
  // Missions
  async listMissions(): Promise<RevenueMission[]> {
    const res = await apiFetch('/api/revenue-operator/missions');
    if (!res.ok) throw new Error('Failed to fetch missions');
    const data = await res.json();
    return data.missions || [];
  },

  async getMission(id: string): Promise<RevenueMission> {
    const res = await apiFetch(`/api/revenue-operator/missions/${id}`);
    if (!res.ok) throw new Error('Failed to fetch mission');
    const data = await res.json();
    return data.mission;
  },

  async createMission(payload: Partial<RevenueMission>): Promise<RevenueMission> {
    const res = await apiFetch('/api/revenue-operator/missions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('Failed to create mission');
    const data = await res.json();
    return data.mission;
  },

  // Experiments
  async listExperiments(missionId?: string): Promise<RevenueExperiment[]> {
    const url = missionId ? `/api/revenue-operator/experiments?missionId=${missionId}` : '/api/revenue-operator/experiments';
    const res = await apiFetch(url);
    if (!res.ok) throw new Error('Failed to fetch experiments');
    const data = await res.json();
    return data.experiments || [];
  },

  async createExperiment(payload: Partial<RevenueExperiment>): Promise<RevenueExperiment> {
    const res = await apiFetch('/api/revenue-operator/experiments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('Failed to create experiment');
    const data = await res.json();
    return data.experiment;
  },

  async updateExperimentStatus(id: string, status: string): Promise<RevenueExperiment> {
    const res = await apiFetch(`/api/revenue-operator/experiments/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) throw new Error('Failed to update experiment status');
    const data = await res.json();
    return data.experiment;
  },

  // Ledger
  async listLedger(missionId?: string): Promise<RevenueLedgerEntry[]> {
    const url = missionId ? `/api/revenue-operator/ledger?missionId=${missionId}` : '/api/revenue-operator/ledger';
    const res = await apiFetch(url);
    if (!res.ok) throw new Error('Failed to fetch ledger');
    const data = await res.json();
    return data.entries || [];
  },

  async recordLedgerEntry(payload: Partial<RevenueLedgerEntry>): Promise<RevenueLedgerEntry> {
    const res = await apiFetch('/api/revenue-operator/ledger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to record ledger entry' }));
      throw new Error(err.error || 'Failed to record ledger entry');
    }
    const data = await res.json();
    return data.entry;
  },

  // Gates
  async listGates(status?: string): Promise<RevenueHumanGate[]> {
    const url = status ? `/api/revenue-operator/gates?status=${status}` : '/api/revenue-operator/gates';
    const res = await apiFetch(url);
    if (!res.ok) throw new Error('Failed to fetch gates');
    const data = await res.json();
    return data.gates || [];
  },

  async resolveGate(gateId: string, resolvedBy: string = 'user'): Promise<RevenueHumanGate> {
    const res = await apiFetch(`/api/revenue-operator/gates/${gateId}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolvedBy }),
    });
    if (!res.ok) throw new Error('Failed to resolve gate');
    const data = await res.json();
    return data.gate;
  },

  // Compliance
  async listCompliance(experimentId?: string): Promise<RevenueComplianceRecord[]> {
    const url = experimentId ? `/api/revenue-operator/compliance?experimentId=${experimentId}` : '/api/revenue-operator/compliance';
    const res = await apiFetch(url);
    if (!res.ok) throw new Error('Failed to fetch compliance records');
    const data = await res.json();
    return data.records || [];
  },

  // Observability
  async getObservability(missionId: string): Promise<RevenueObservability> {
    const res = await apiFetch(`/api/revenue-operator/observability/${missionId}`);
    if (!res.ok) throw new Error('Failed to fetch observability');
    return res.json();
  }
};
