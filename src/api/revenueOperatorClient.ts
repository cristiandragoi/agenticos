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

// ── Traceability types (UI drill-down layer — persisted truth only) ────────

export type RevenueKpiKey = 'target' | 'realized' | 'verified' | 'pipeline' | 'cost' | 'net' | 'adSpend';

export interface RevenueMissionTrace {
  mission: RevenueMission;
  daysRemaining: number;
  kpis: {
    target: { value: number; currency: string; deadline: string; missionState: string; activeExperiments: number; daysRemaining: number };
    realized: { value: number; entries: number };
    verified: { value: number; entries: number };
    pipeline: { value: number; ledgerValue: number; experimentsInPipeline: number };
    cost: { value: number; entries: number };
    net: { value: number; formula: string; realized: number; cost: number };
    adSpend: { value: number; actualSpendField: number; budget: number; hypotheticalSpendExcluded: boolean };
  };
  openGates: number;
  experimentCount: number;
}

export interface RevenueLedgerBreakdownEntry extends RevenueLedgerEntry {
  experimentTitle: string | null;
  experimentEngine: string | null;
  opportunityId: string | null;
  channel: string | null;
  category: string;
  verificationState?: string;
  verifiedAt?: string;
  argusState?: string;
}

export interface RevenueKpiBreakdown {
  kpi: RevenueKpiKey;
  total: number;
  items?: RevenueLedgerBreakdownEntry[];
  realizedItems?: RevenueLedgerBreakdownEntry[];
  costItems?: RevenueLedgerBreakdownEntry[];
  formula?: string;
  realized?: number;
  cost?: number;
  note?: string;
  mission?: { id: string; title: string; state: string; deadline: string; startDate: string; daysRemaining: number };
  activeExperiments?: Array<{ id: string; engine: string; status: string; title: string; nextAction: string | null }>;
  board?: RevenueBoard;
}

export interface RevenueBoardCard {
  id: string;
  status: string;
  engine: string;
  title: string;
  company: string | null;
  product: string | null;
  value: number;
  verifiedRevenue: number;
  source: string;
  nextAction: string | null;
  humanGate: { id: string; gateType: string; description: string } | null;
  argusState: string;
  confidence: number | null;
  updatedAt: string;
}

export interface RevenueBoard {
  engine: 'digital_products' | 'german_sme' | 'pipeline';
  columns: Array<{ key: string; label: string }>;
  cards: Record<string, RevenueBoardCard[]>;
  total: number;
  placed: number;
}

export interface RevenueLiveExecutionRow {
  runId: string;
  task: string;
  taskId: string;
  executor: string;
  provider: string | null;
  model: string | null;
  status: string; // truthful DB status — queued stays queued
  startedAt: string;
  elapsedMs: number | null;
  failureReason: string | null;
  verification: { verdict: string; verifierProvider: string; verifierModel: string; sameProvider: boolean } | null;
  argus: { goalId: string; goalStatus: string; verificationState: string } | null;
  experimentId: string | null;
  nextAction: string | null;
}

export interface RevenueGateQueueItem extends RevenueHumanGate {
  requiredAction: string;
  blockingBranch: { experimentId: string; title: string; status: string; engine: string } | string;
}

export interface RevenueExperimentTrace {
  experiment: RevenueExperiment;
  mission: RevenueMission | null;
  nextAction: string | null;
  argusState: string;
  events: any[];
  ledger: RevenueLedgerEntry[];
  gates: RevenueHumanGate[];
  compliance: any[];
  runs: any[];
  verifications: any[];
  goalStates: any[];
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
  },

  // Traceability (drill-down layer — read-only, persisted truth only)
  async traceMission(missionId: string): Promise<RevenueMissionTrace> {
    const res = await apiFetch(`/api/revenue-operator/missions/${missionId}/trace`);
    if (!res.ok) throw new Error('Failed to fetch mission trace');
    return res.json();
  },

  async kpiBreakdown(missionId: string, kpi: RevenueKpiKey): Promise<RevenueKpiBreakdown> {
    const res = await apiFetch(`/api/revenue-operator/missions/${missionId}/kpi/${kpi}`);
    if (!res.ok) throw new Error('Failed to fetch KPI breakdown');
    return res.json();
  },

  async board(missionId: string, engine: 'digital_products' | 'german_sme' | 'pipeline'): Promise<RevenueBoard> {
    const res = await apiFetch(`/api/revenue-operator/missions/${missionId}/board/${engine}`);
    if (!res.ok) throw new Error('Failed to fetch board');
    return res.json();
  },

  async liveExecution(missionId: string): Promise<{ rows: RevenueLiveExecutionRow[]; note?: string }> {
    const res = await apiFetch(`/api/revenue-operator/missions/${missionId}/live-execution`);
    if (!res.ok) throw new Error('Failed to fetch live execution');
    return res.json();
  },

  async gateQueue(status?: string): Promise<RevenueGateQueueItem[]> {
    const url = status ? `/api/revenue-operator/gates/queue?status=${status}` : '/api/revenue-operator/gates/queue';
    const res = await apiFetch(url);
    if (!res.ok) throw new Error('Failed to fetch gate queue');
    const data = await res.json();
    return data.gates || [];
  },

  async traceExperiment(experimentId: string): Promise<RevenueExperimentTrace> {
    const res = await apiFetch(`/api/revenue-operator/experiments/${experimentId}/trace`);
    if (!res.ok) throw new Error('Failed to fetch experiment trace');
    return res.json();
  },

  async traceLedgerEntry(entryId: string): Promise<any> {
    const res = await apiFetch(`/api/revenue-operator/ledger/${entryId}/trace`);
    if (!res.ok) throw new Error('Failed to fetch ledger trace');
    return res.json();
  }
};
