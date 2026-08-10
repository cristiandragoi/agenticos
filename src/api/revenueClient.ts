import { apiFetch, apiUrl } from './client';

export interface OpportunityEvidence {
  id: string;
  type: string;
  title: string;
  sourcePlatform?: string;
  sourceUrl?: string;
  capturedAt: string;
  summary: string;
  metrics?: { views?: number; likes?: number; comments?: number; sales?: number; reviewCount?: number; rating?: number; price?: number; commissionRate?: number; growthRate?: number; };
  reliability: "verified" | "reported" | "estimated" | "unknown";
  complianceRiskFlags?: string[];
}

export interface OpportunityScoreResult {
  demandScore: number;
  competitionScore: number;
  profitabilityScore: number;
  complianceRiskScore: number;
  evidenceQualityScore: number;
  overallScore: number;
  confidence: "low" | "medium" | "high";
  reasons: string[];
  missingInformation: string[];
  assumptions: string[];
  scoredAt: string;
  scoringVersion: string;
}

export interface RevenueOpportunity {
  id: string;
  title: string;
  description: string;
  opportunityType: string;
  sourcePlatform?: string;
  sourceUrl?: string;
  stage: string;
  researchPayload?: any;
  evidencePayload?: any;
  demandScore?: number;
  competitionScore?: number;
  profitabilityScore?: number;
  complianceRiskScore?: number;
  evidenceQualityScore?: number;
  overallScore?: number;
  scoringConfidence?: "low" | "medium" | "high";
  scoringVersion?: string;
  estimatedRevenue?: number;
  estimatedCost?: number;
  currency?: string;
  ownerAgentId?: string;
  createdByRunId?: string;
  approvalStatus: string;
  approvedBy?: string;
  approvedAt?: string;
  rejectionReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProductionExecutionPlan {
  briefId: string;
  planVersion: string;
  objective: string;
  jobs: Array<{
    id: string;
    agentRole: string;
    taskType: string;
    dependsOn: string[];
    input: Record<string, unknown>;
    expectedOutputSchema: string;
    allowedTools: string[];
    maximumAttempts: number;
    maximumCost?: number;
    requiresHumanApproval: boolean;
  }>;
  totalMaximumCost: number;
  expectedAssets: number;
  warnings: string[];
}

export interface ProductionBrief {
  id: string;
  opportunityId: string;
  version: number;
  status: "draft" | "planning" | "ready_for_generation" | "generating" | "generation_failed" | "awaiting_review" | "changes_requested" | "approved_for_publish" | "cancelled" | "archived";
  objective?: string;
  targetPlatform?: "tiktok" | "youtube_shorts" | "instagram_reels" | "etsy" | "fiverr" | "web" | "other" | string;
  contentType?: "ugc_video" | "product_demo" | "testimonial_style" | "problem_solution" | "image_carousel" | "listing_copy" | "thumbnail" | "software_prototype" | "other" | string;
  targetAudience?: {
    summary: string;
    painPoints: string[];
    desiredOutcomes: string[];
  };
  productSummary?: string;
  valueProposition?: string;
  keyBenefits?: string[];
  approvedClaims?: string[];
  prohibitedClaims?: string[];
  requiredDisclosures?: string[];
  contentAngles?: Array<{
    id: string;
    title: string;
    hook: string;
    rationale: string;
    evidenceIds: string[];
  }>;
  successMetrics?: {
    primaryMetric: string;
    target?: number;
    secondaryMetrics: string[];
  };
  language?: string;
  tone?: string;
  requestedAssetCount?: number;
  estimatedGenerationCost?: number;
  actualGenerationCost?: number;
  executionPlan?: ProductionExecutionPlan;
  createdBy?: string;
  createdByRunId?: string;
  approvedBy?: string;
  approvedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GeneratedAsset {
  id: string;
  briefId: string;
  opportunityId: string;
  jobId?: string;
  assetType: string;
  title: string;
  content?: string;
  fileReference?: string;
  version: number;
  status: "draft" | "validation_failed" | "compliance_flagged" | "ready_for_review" | "changes_requested" | "approved" | "rejected" | "archived";
  validationResult?: any;
  complianceResult?: any;
  metadata?: any;
  createdByAgentId?: string;
  createdByRunId?: string;
  createdAt: string;
  updatedAt: string;
}

const API_BASE = apiUrl('/api/revenue/opportunities');
const BRIEF_API_BASE = apiUrl('/api/revenue/production-briefs');

export const revenueClient = {
  async getOpportunities(params?: { stage?: string; approvalStatus?: string; opportunityType?: string }): Promise<RevenueOpportunity[]> {
    const searchParams = new URLSearchParams();
    if (params?.stage) searchParams.append('stage', params.stage);
    if (params?.approvalStatus) searchParams.append('approvalStatus', params.approvalStatus);
    if (params?.opportunityType) searchParams.append('opportunityType', params.opportunityType);
    
    const qs = searchParams.toString();
    const url = qs ? `${API_BASE}?${qs}` : API_BASE;

    const res = await apiFetch(url);
    if (!res.ok) throw new Error('Failed to fetch opportunities');
    return res.json();
  },

  async getOpportunity(id: string): Promise<RevenueOpportunity> {
    const res = await apiFetch(`${API_BASE}/${id}`);
    if (!res.ok) throw new Error('Failed to fetch opportunity');
    return res.json();
  },

  async getEvents(id: string): Promise<any[]> {
    const res = await apiFetch(`${API_BASE}/${id}/events`);
    if (!res.ok) throw new Error('Failed to fetch opportunity events');
    return res.json();
  },

  async checkDuplicate(sourceUrl?: string, title?: string, sourcePlatform?: string): Promise<{ duplicate: boolean; opportunity?: RevenueOpportunity }> {
    const res = await apiFetch(`${API_BASE}/check-duplicate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceUrl, title, sourcePlatform }),
    });
    if (!res.ok) throw new Error('Failed to check for duplicates');
    return res.json();
  },

  async appendEvidence(id: string, evidence: OpportunityEvidence): Promise<RevenueOpportunity> {
    const res = await apiFetch(`${API_BASE}/${id}/evidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ evidence }),
    });
    if (!res.ok) throw new Error('Failed to append evidence');
    return res.json();
  },

  async scoreOpportunity(id: string): Promise<RevenueOpportunity> {
    const res = await apiFetch(`${API_BASE}/${id}/score`, { method: 'POST' });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to score opportunity');
    }
    return res.json();
  },

  async requestApproval(id: string): Promise<RevenueOpportunity> {
    const res = await apiFetch(`${API_BASE}/${id}/request-approval`, { method: 'POST' });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to request approval');
    }
    return res.json();
  },

  async getMetrics(): Promise<any> {
    const res = await apiFetch('/api/revenue/metrics');
    if (!res.ok) throw new Error('Failed to fetch metrics');
    return res.json();
  },

  async createOpportunity(data: Partial<RevenueOpportunity>): Promise<RevenueOpportunity> {
    const res = await apiFetch(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to create opportunity');
    return res.json();
  },

  async transition(id: string, stage: string): Promise<RevenueOpportunity> {
    const res = await apiFetch(`${API_BASE}/${id}/transition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage }),
    });
    if (!res.ok) throw new Error('Failed to transition opportunity');
    return res.json();
  },

  async approve(id: string): Promise<RevenueOpportunity> {
    const res = await apiFetch(`${API_BASE}/${id}/approve`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to approve opportunity');
    return res.json();
  },

  async reject(id: string, reason: string): Promise<RevenueOpportunity> {
    const res = await apiFetch(`${API_BASE}/${id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    if (!res.ok) throw new Error('Failed to reject opportunity');
    return res.json();
  },

  // Production Brief Methods
  async createProductionBrief(opportunityId: string): Promise<ProductionBrief> {
    const res = await apiFetch(`${API_BASE}/${opportunityId}/create-production-brief`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to create production brief');
    return res.json();
  },

  async getOpportunityBriefs(opportunityId: string): Promise<ProductionBrief[]> {
    const res = await apiFetch(`${API_BASE}/${opportunityId}/production-briefs`);
    if (!res.ok) throw new Error('Failed to fetch opportunity production briefs');
    return res.json();
  },

  async getProductionBrief(briefId: string): Promise<ProductionBrief> {
    const res = await apiFetch(`${BRIEF_API_BASE}/${briefId}`);
    if (!res.ok) throw new Error('Failed to fetch production brief');
    return res.json();
  },

  async generateExecutionPlan(briefId: string): Promise<ProductionBrief> {
    const res = await apiFetch(`${BRIEF_API_BASE}/${briefId}/generate-plan`, { method: 'POST' });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to generate execution plan');
    }
    return res.json();
  },

  async approveExecutionPlan(briefId: string): Promise<ProductionBrief> {
    const res = await apiFetch(`${BRIEF_API_BASE}/${briefId}/approve-plan`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to approve execution plan');
    return res.json();
  },

  async rejectExecutionPlan(briefId: string, reason: string): Promise<ProductionBrief> {
    const res = await apiFetch(`${BRIEF_API_BASE}/${briefId}/reject-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    if (!res.ok) throw new Error('Failed to reject execution plan');
    return res.json();
  },

  async startGeneration(briefId: string): Promise<ProductionBrief> {
    const res = await apiFetch(`${BRIEF_API_BASE}/${briefId}/start-generation`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to start generation');
    return res.json();
  },

  async getBriefTasks(briefId: string): Promise<any[]> {
    const res = await apiFetch(`${BRIEF_API_BASE}/${briefId}/tasks`);
    if (!res.ok) throw new Error('Failed to fetch brief tasks');
    return res.json();
  },

  // Generated Assets
  async getGeneratedAssets(params?: { status?: string; briefId?: string; opportunityId?: string }): Promise<GeneratedAsset[]> {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.append('status', params.status);
    if (params?.briefId) searchParams.append('briefId', params.briefId);
    if (params?.opportunityId) searchParams.append('opportunityId', params.opportunityId);
    
    const qs = searchParams.toString();
    const url = qs ? `/api/revenue/generated-assets?${qs}` : '/api/revenue/generated-assets';

    const res = await apiFetch(url);
    if (!res.ok) throw new Error('Failed to fetch generated assets');
    return res.json();
  },

  async approveGeneratedAsset(assetId: string): Promise<GeneratedAsset> {
    const res = await apiFetch(`/api/revenue/generated-assets/${assetId}/approve`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to approve asset');
    return res.json();
  },

  async rejectGeneratedAsset(assetId: string, reason: string): Promise<GeneratedAsset> {
    const res = await apiFetch(`/api/revenue/generated-assets/${assetId}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    if (!res.ok) throw new Error('Failed to reject asset');
    return res.json();
  },

  // Revenue Intelligence
  async getIntelligenceSummary(): Promise<any> {
    const res = await apiFetch('/api/revenue/intelligence/summary');
    if (!res.ok) throw new Error('Failed to fetch intelligence summary');
    return res.json();
  },

  async getAgentIntelligence(): Promise<any[]> {
    const res = await apiFetch('/api/revenue/intelligence/agents');
    if (!res.ok) throw new Error('Failed to fetch agent intelligence');
    return res.json();
  },

  async getPromptIntelligence(): Promise<any[]> {
    const res = await apiFetch('/api/revenue/intelligence/prompts');
    if (!res.ok) throw new Error('Failed to fetch prompt intelligence');
    return res.json();
  }
};
