import crypto from 'crypto';
import { db } from '../../db/index.js';
import {
  revenueOpportunities,
  revenueOpportunityEvents,
  revenueMissions,
} from '../../db/schema.js';
import { eq, desc } from 'drizzle-orm';
import { computeOpportunityScore, type ScoringInputs, type ScoreBreakdown } from './scoringEngine.js';

export interface OpportunityCreateInput {
  title: string;
  description: string;
  source: string;
  sourceUrl?: string | null;
  category: string;
  estimatedRevenue: number;
  estimatedCost: number;
  estimatedTimeToRevenueDays: number;
  automationPotential: number; // 0..100
  manualWorkload: number;      // 0..100
  executionDifficulty: number; // 0..100
  riskLevel: number;           // 0..100
  confidence: number;          // 0..100
  evidence?: any[];
  notes?: string | null;
  status?: 'DISCOVERED' | 'EVALUATED' | 'SHORTLISTED' | 'REJECTED' | 'CONVERTED';
}

export interface CanonicalRevenueOpportunity {
  id: string;
  title: string;
  description: string | null;
  source: string;
  sourceUrl: string | null;
  category: string;
  discoveredAt: string;
  estimatedRevenue: number;
  estimatedCost: number;
  estimatedTimeToRevenueDays: number;
  automationPotential: number;
  manualWorkload: number;
  executionDifficulty: number;
  riskLevel: number;
  confidence: number;
  score: number;
  scoreBreakdown: ScoreBreakdown;
  scoreExplanation: string;
  status: 'DISCOVERED' | 'EVALUATED' | 'SHORTLISTED' | 'REJECTED' | 'CONVERTED';
  evidence: any[];
  notes: string | null;
  convertedMissionId: string | null;
  createdAt: string;
  updatedAt: string;
}

const now = () => new Date().toISOString();
const uid = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 9)}`;

function mapDbRowToCanonical(row: any): CanonicalRevenueOpportunity {
  const research = row.researchPayload || {};
  const evidencePayload = row.evidencePayload || {};

  const scoringInputs: ScoringInputs = {
    estimatedRevenue: row.estimatedRevenue ?? research.estimatedRevenue ?? 0,
    estimatedCost: row.estimatedCost ?? research.estimatedCost ?? 0,
    estimatedTimeToRevenueDays: research.estimatedTimeToRevenueDays ?? 14,
    automationPotential: research.automationPotential ?? 50,
    manualWorkload: research.manualWorkload ?? 50,
    executionDifficulty: research.executionDifficulty ?? 50,
    riskLevel: row.complianceRiskScore != null ? row.complianceRiskScore * 100 : (research.riskLevel ?? 30),
    confidence: row.evidenceQualityScore != null ? row.evidenceQualityScore * 100 : (research.confidence ?? 80),
  };

  const scoreBreakdown = computeOpportunityScore(scoringInputs);

  let status: 'DISCOVERED' | 'EVALUATED' | 'SHORTLISTED' | 'REJECTED' | 'CONVERTED' = 'DISCOVERED';
  const rawStage = String(row.stage || '').toUpperCase();
  if (rawStage === 'CONVERTED') status = 'CONVERTED';
  else if (rawStage === 'SHORTLISTED') status = 'SHORTLISTED';
  else if (rawStage === 'REJECTED') status = 'REJECTED';
  else if (rawStage === 'EVALUATED' || row.overallScore != null) status = 'EVALUATED';

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    source: row.sourcePlatform || 'sample_seed',
    sourceUrl: row.sourceUrl || null,
    category: row.opportunityType || 'general',
    discoveredAt: row.createdAt,
    estimatedRevenue: scoringInputs.estimatedRevenue,
    estimatedCost: scoringInputs.estimatedCost,
    estimatedTimeToRevenueDays: scoringInputs.estimatedTimeToRevenueDays,
    automationPotential: scoringInputs.automationPotential,
    manualWorkload: scoringInputs.manualWorkload,
    executionDifficulty: scoringInputs.executionDifficulty,
    riskLevel: scoringInputs.riskLevel,
    confidence: scoringInputs.confidence,
    score: scoreBreakdown.totalScore,
    scoreBreakdown,
    scoreExplanation: scoreBreakdown.explanation,
    status,
    evidence: Array.isArray(evidencePayload.evidence) ? evidencePayload.evidence : (Array.isArray(evidencePayload) ? evidencePayload : []),
    notes: research.notes || null,
    convertedMissionId: research.convertedMissionId || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listOpportunities(): Promise<CanonicalRevenueOpportunity[]> {
  const rows = db.select().from(revenueOpportunities).orderBy(desc(revenueOpportunities.createdAt)).all();
  const opportunities = rows.map(mapDbRowToCanonical);
  return opportunities.sort((a, b) => b.score - a.score);
}

export async function getOpportunity(id: string): Promise<CanonicalRevenueOpportunity | null> {
  const row = db.select().from(revenueOpportunities).where(eq(revenueOpportunities.id, id)).get();
  if (!row) return null;
  return mapDbRowToCanonical(row);
}

export async function createOpportunity(input: OpportunityCreateInput): Promise<CanonicalRevenueOpportunity> {
  const id = uid('opp');
  const t = now();

  const scoringInputs: ScoringInputs = {
    estimatedRevenue: input.estimatedRevenue,
    estimatedCost: input.estimatedCost,
    estimatedTimeToRevenueDays: input.estimatedTimeToRevenueDays,
    automationPotential: input.automationPotential,
    manualWorkload: input.manualWorkload,
    executionDifficulty: input.executionDifficulty,
    riskLevel: input.riskLevel,
    confidence: input.confidence,
  };
  const scoreBreakdown = computeOpportunityScore(scoringInputs);

  const researchPayload = {
    estimatedRevenue: input.estimatedRevenue,
    estimatedCost: input.estimatedCost,
    estimatedTimeToRevenueDays: input.estimatedTimeToRevenueDays,
    automationPotential: input.automationPotential,
    manualWorkload: input.manualWorkload,
    executionDifficulty: input.executionDifficulty,
    riskLevel: input.riskLevel,
    confidence: input.confidence,
    notes: input.notes || null,
  };

  const evidencePayload = {
    evidence: input.evidence || [],
  };

  await db.insert(revenueOpportunities).values({
    id,
    title: input.title,
    description: input.description,
    opportunityType: input.category,
    sourcePlatform: input.source,
    sourceUrl: input.sourceUrl || null,
    stage: input.status ? input.status.toLowerCase() : 'evaluated',
    researchPayload,
    evidencePayload,
    demandScore: scoreBreakdown.revenuePotentialPts / 25,
    competitionScore: (100 - input.riskLevel) / 100,
    profitabilityScore: scoreBreakdown.lowCapitalPts / 15,
    complianceRiskScore: input.riskLevel / 100,
    evidenceQualityScore: input.confidence / 100,
    overallScore: scoreBreakdown.totalScore,
    scoringConfidence: input.confidence >= 80 ? 'high' : (input.confidence >= 60 ? 'medium' : 'low'),
    scoringVersion: 'deterministic-v1',
    estimatedRevenue: input.estimatedRevenue,
    estimatedCost: input.estimatedCost,
    currency: 'EUR',
    approvalStatus: 'not_required',
    createdAt: t,
    updatedAt: t,
  });

  await db.insert(revenueOpportunityEvents).values({
    id: uid('oppe'),
    opportunityId: id,
    eventType: 'opportunity_created',
    previousStage: null,
    nextStage: input.status || 'EVALUATED',
    actorType: 'system',
    actorId: 'system',
    metadata: { score: scoreBreakdown.totalScore },
    createdAt: t,
  });

  const created = await getOpportunity(id);
  return created!;
}

export async function updateOpportunity(id: string, patch: Partial<OpportunityCreateInput>): Promise<CanonicalRevenueOpportunity | null> {
  const existing = await getOpportunity(id);
  if (!existing) return null;

  const mergedInputs: ScoringInputs = {
    estimatedRevenue: patch.estimatedRevenue ?? existing.estimatedRevenue,
    estimatedCost: patch.estimatedCost ?? existing.estimatedCost,
    estimatedTimeToRevenueDays: patch.estimatedTimeToRevenueDays ?? existing.estimatedTimeToRevenueDays,
    automationPotential: patch.automationPotential ?? existing.automationPotential,
    manualWorkload: patch.manualWorkload ?? existing.manualWorkload,
    executionDifficulty: patch.executionDifficulty ?? existing.executionDifficulty,
    riskLevel: patch.riskLevel ?? existing.riskLevel,
    confidence: patch.confidence ?? existing.confidence,
  };
  const scoreBreakdown = computeOpportunityScore(mergedInputs);

  const t = now();
  const researchPayload = {
    ...mergedInputs,
    notes: patch.notes !== undefined ? patch.notes : existing.notes,
    convertedMissionId: existing.convertedMissionId,
  };

  await db.update(revenueOpportunities).set({
    title: patch.title ?? existing.title,
    description: patch.description ?? existing.description,
    opportunityType: patch.category ?? existing.category,
    sourcePlatform: patch.source ?? existing.source,
    sourceUrl: patch.sourceUrl !== undefined ? patch.sourceUrl : existing.sourceUrl,
    stage: patch.status ? patch.status.toLowerCase() : existing.status.toLowerCase(),
    researchPayload,
    overallScore: scoreBreakdown.totalScore,
    estimatedRevenue: mergedInputs.estimatedRevenue,
    estimatedCost: mergedInputs.estimatedCost,
    updatedAt: t,
  }).where(eq(revenueOpportunities.id, id)).run();

  return getOpportunity(id);
}

export async function convertOpportunityToMission(opportunityId: string, options: {
  deadlineDays?: number;
  budgetLimit?: number;
  strategy?: string;
} = {}): Promise<{ opportunity: CanonicalRevenueOpportunity; mission: any }> {
  const opp = await getOpportunity(opportunityId);
  if (!opp) throw new Error(`Opportunity ${opportunityId} not found.`);

  const t = now();
  const deadlineDays = options.deadlineDays || opp.estimatedTimeToRevenueDays || 14;
  const deadlineDate = new Date(Date.now() + deadlineDays * 24 * 60 * 60 * 1000).toISOString();
  const budgetLimit = options.budgetLimit ?? opp.estimatedCost ?? 0;
  const missionId = uid('mission');

  const defaultStrategy = options.strategy || `Execute high-automation revenue opportunity '${opp.title}' targeting €${opp.estimatedRevenue} with budget cap €${budgetLimit}.`;

  const steps = [
    {
      id: uid('step'),
      title: 'Decompose and Plan Operational Milestones',
      assignedAgent: 'hermes',
      status: 'completed',
      output: `Decomposition completed for ${opp.category} pipeline. Target revenue: €${opp.estimatedRevenue}.`
    },
    {
      id: uid('step'),
      title: 'Build Automation and Delivery Artifacts',
      assignedAgent: 'codex',
      status: 'in_progress',
      output: `Generating automation scripts and client deliverables for ${opp.title}.`
    },
    {
      id: uid('step'),
      title: 'Approval Gate: Outbound Outreach / Spending Verification',
      assignedAgent: 'jarvis',
      status: 'waiting_for_approval',
      output: `Budget limit €${budgetLimit} verified. Requires explicit user approval before publishing or spending.`
    },
    {
      id: uid('step'),
      title: 'Deliverable Verification & Revenue Reconciliation',
      assignedAgent: 'argus',
      status: 'pending',
      output: 'Awaiting completion of delivery and customer transaction settlement.'
    }
  ];

  await db.insert(revenueMissions).values({
    id: missionId,
    projectId: null,
    title: `Mission: ${opp.title}`,
    description: `${opp.description || ''}\nStrategy: ${defaultStrategy}`,
    targetAmount: opp.estimatedRevenue,
    currency: 'EUR',
    startDate: t,
    deadline: deadlineDate,
    advertisingBudget: budgetLimit,
    actualSpend: 0,
    enabledEngines: [opp.category],
    availableChannels: [opp.source],
    primaryMarket: 'Direct / Online',
    status: 'active',
    realizedRevenue: 0,
    verifiedRevenue: 0,
    pipelineValue: opp.estimatedRevenue,
    actualCost: 0,
    netRevenue: 0,
    createdAt: t,
    updatedAt: t,
  });

  const existingResearch = (db.select().from(revenueOpportunities).where(eq(revenueOpportunities.id, opportunityId)).get() as any)?.researchPayload || {};
  await db.update(revenueOpportunities).set({
    stage: 'converted',
    researchPayload: { ...existingResearch, convertedMissionId: missionId },
    updatedAt: t,
  }).where(eq(revenueOpportunities.id, opportunityId)).run();

  await db.insert(revenueOpportunityEvents).values({
    id: uid('oppe'),
    opportunityId: opp.id,
    eventType: 'opportunity_converted_to_mission',
    previousStage: opp.status,
    nextStage: 'CONVERTED',
    actorType: 'user',
    actorId: 'operator',
    metadata: { missionId, targetRevenue: opp.estimatedRevenue, budgetLimit },
    createdAt: t,
  });

  const updatedOpp = await getOpportunity(opportunityId);
  const createdMission = db.select().from(revenueMissions).where(eq(revenueMissions.id, missionId)).get();

  return {
    opportunity: updatedOpp!,
    mission: {
      ...createdMission,
      strategy: defaultStrategy,
      steps,
      assignedAgents: ['jarvis', 'hermes', 'codex', 'argus'],
      approvalsRequired: budgetLimit > 0 ? ['budget_spend'] : ['outbound_action'],
    }
  };
}

export async function seedCanonicalOpportunities(): Promise<CanonicalRevenueOpportunity[]> {
  const existing = await listOpportunities();
  if (existing.length >= 5) {
    return existing;
  }

  const seedData: OpportunityCreateInput[] = [
    {
      title: 'Local Business AI Workflow Automation & Zapier Integration Contract',
      description: 'Done-for-you workflow automation connecting CRM, Stripe invoices, and automated client notifications for regional trades/services.',
      source: 'sample_seed',
      sourceUrl: 'https://sample.agenticos.local/contracts/local-ai-automation',
      category: 'freelance_contract',
      estimatedRevenue: 1200,
      estimatedCost: 0,
      estimatedTimeToRevenueDays: 5,
      automationPotential: 75,
      manualWorkload: 30,
      executionDifficulty: 20,
      riskLevel: 20,
      confidence: 90,
      evidence: [
        { type: 'market_demand', detail: 'High demand for non-technical small business automation contracts.' },
        { type: 'cost_structure', detail: 'Zero upfront software cost using client-provided accounts.' }
      ],
      notes: 'SAMPLE/SEED DATA: Immediate turnaround, zero capital required, high contract close probability.',
      status: 'EVALUATED'
    },
    {
      title: 'Automated Invoice & PDF Parsing System for Accounting Firm',
      description: 'Lightweight local python tool to extract, categorize, and validate line items from supplier PDF invoices into standard CSV/Excel format.',
      source: 'sample_seed',
      sourceUrl: 'https://sample.agenticos.local/services/accounting-parser',
      category: 'sme_ai_automation',
      estimatedRevenue: 2500,
      estimatedCost: 50,
      estimatedTimeToRevenueDays: 10,
      automationPotential: 85,
      manualWorkload: 25,
      executionDifficulty: 25,
      riskLevel: 25,
      confidence: 85,
      evidence: [
        { type: 'sme_need', detail: 'Local tax advisors spend 15+ hours/week on manual data entry.' }
      ],
      notes: 'SAMPLE/SEED DATA: High-ticket B2B service opportunity with high retention.',
      status: 'EVALUATED'
    },
    {
      title: 'Offline Desktop PDF Redaction & Form Filling Utility',
      description: 'Privacy-focused Electron/Node utility for legal and medical offices to redact sensitive PII locally without cloud data transfer.',
      source: 'sample_seed',
      sourceUrl: 'https://sample.agenticos.local/products/pdf-redactor',
      category: 'utility_apps',
      estimatedRevenue: 450,
      estimatedCost: 0,
      estimatedTimeToRevenueDays: 3,
      automationPotential: 90,
      manualWorkload: 15,
      executionDifficulty: 15,
      riskLevel: 15,
      confidence: 80,
      evidence: [
        { type: 'privacy_demand', detail: 'Strict GDPR compliance creates willingness to pay for local-only tools.' }
      ],
      notes: 'SAMPLE/SEED DATA: Fast development turnaround using existing AgenticOS PDF components.',
      status: 'EVALUATED'
    },
    {
      title: 'Niche Notion & Agentic Workflow Template Pack for Solopreneurs',
      description: 'Digital asset bundle containing proven client management dashboards, prompt systems, and project trackers sold directly on Gumroad/Shopify.',
      source: 'sample_seed',
      sourceUrl: 'https://sample.agenticos.local/products/solopreneur-pack',
      category: 'digital_products',
      estimatedRevenue: 800,
      estimatedCost: 20,
      estimatedTimeToRevenueDays: 7,
      automationPotential: 95,
      manualWorkload: 10,
      executionDifficulty: 10,
      riskLevel: 10,
      confidence: 75,
      evidence: [
        { type: 'ecom_volume', detail: 'High margin digital product with automated checkout delivery.' }
      ],
      notes: 'SAMPLE/SEED DATA: Near 100% automation after initial template creation.',
      status: 'EVALUATED'
    },
    {
      title: 'Real Estate Property Listing Enrichment & Cold Lead Engine',
      description: 'Automated data scraping and qualification system connecting off-market commercial property records with active investor buyer criteria.',
      source: 'sample_seed',
      sourceUrl: 'https://sample.agenticos.local/leads/real-estate-enrichment',
      category: 'lead_generation',
      estimatedRevenue: 1800,
      estimatedCost: 40,
      estimatedTimeToRevenueDays: 12,
      automationPotential: 80,
      manualWorkload: 35,
      executionDifficulty: 30,
      riskLevel: 30,
      confidence: 70,
      evidence: [
        { type: 'broker_budget', detail: 'Commercial brokers pay €500-€2000 per qualified target lead list.' }
      ],
      notes: 'SAMPLE/SEED DATA: High value per transaction with moderate manual outreach verification.',
      status: 'EVALUATED'
    }
  ];

  for (const item of seedData) {
    await createOpportunity(item);
  }

  return listOpportunities();
}
