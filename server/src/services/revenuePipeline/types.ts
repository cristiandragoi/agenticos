/**
 * Canonical Revenue Pipeline contract (Milestone: Local Business Revenue Pipeline V1).
 *
 * Pipeline: LOCAL BUSINESS WEBSITE AUDIT → REBUILD CONCEPT → PROPOSAL.
 * One canonical prospect record. One persistent background task + one Board
 * card per run. Every finding is labelled verified | inferred | unavailable.
 * No fabricated business facts, prices, reviews, rankings, traffic, revenue,
 * or contact details — fixture data is always explicitly labelled.
 */

export type PipelineStatus =
  | 'queued'
  | 'discovering'
  | 'inspecting'
  | 'auditing'
  | 'scoring'
  | 'selecting'
  | 'planning'
  | 'concept'
  | 'building'
  | 'proposal'
  | 'verifying'
  | 'awaiting_approval'
  | 'review'
  | 'completed'
  | 'blocked'
  | 'failed';

/** Truthful stage labels surfaced in the Jarvis task panel (no fake percentages). */
export const PIPELINE_STAGE_LABELS = [
  'DISCOVERING PROSPECTS',
  'INSPECTING WEBSITE',
  'AUDITING',
  'SCORING OPPORTUNITY',
  'BUILDING REBUILD PLAN',
  'GENERATING SITE CONCEPT',
  'RUNNING BUILD',
  'PREPARING PROPOSAL',
  'VERIFYING',
  'AWAITING APPROVAL',
  'COMPLETED',
  'BLOCKED',
  'FAILED',
] as const;

export type PipelineStageLabel = (typeof PIPELINE_STAGE_LABELS)[number];

export interface PipelineConfig {
  niche: string;
  city: string;
  serviceKeywords: string[];
  prospectCount: number;
  /** Optional specific public business URL to audit. */
  specificUrl: string | null;
  /** Per-run research budget in USD. null = no explicit budget. */
  maxResearchBudgetUsd: number | null;
  /** Dry-run: fixtures only, no real contact, no publish. Default true. */
  dryRun: boolean;
  /** Whether the staged concept is actually built (npm install + build + verify). */
  runBuild: boolean;
  /** Whether CodeX runs the bounded site-implementation task (worker routing). */
  useCodex: boolean;
  /** Whether to attempt LLM-assisted proposal drafting (default false in V1). */
  useLlm: boolean;
  rawRequest: string;
  /** Where artifacts (proposal package, site concept) are written. */
  workspacePath: string;
}

export type EvidenceLabel = 'verified' | 'inferred' | 'unavailable';

export type FindingSeverity = 'positive' | 'neutral' | 'weakness';

export interface AuditFinding {
  /** Category from the milestone audit list (homepage_clarity, …). */
  category: string;
  label: EvidenceLabel;
  summary: string;
  /** Quote / URL / measurement supporting the finding (may be a fixture label). */
  evidence?: string;
  severity: FindingSeverity;
}

export type ProspectStatus =
  | 'discovered'
  | 'audited'
  | 'scored'
  | 'selected'
  | 'concept_ready'
  | 'proposal_ready'
  | 'approved'
  | 'rejected'
  | 'blocked';

export interface ProspectRecord {
  prospectId: string;
  businessName: string;
  niche: string;
  city: string;
  websiteUrl: string;
  publicContactUrl: string | null;
  discoverySource: 'fixture' | 'user-url' | 'live-search';
  /** Clearly-labelled sample data — never presented as a real business. */
  fixture: boolean;
  verifiedFacts: string[];
  unverifiedObservations: string[];
  auditFindings: AuditFinding[];
  auditScore: number | null;
  opportunityScore: number | null;
  scoringCriteria: Record<string, { score: number; reason: string }> | null;
  confidence: 'low' | 'medium' | 'high';
  status: ProspectStatus;
  linkedTaskId: string | null;
  linkedBoardCardId: string | null;
  workspacePath: string | null;
  selectedForBuild: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CostLedgerEntry {
  provider: string;
  model: string;
  requestCount: number;
  /** null = cost not available from the gateway (never fabricated). */
  costUsd: number | null;
  elapsedMs: number;
  failures: number;
  fallbacks: number;
  note?: string;
}

export interface PipelineRunRecord {
  runId: string;
  taskId: string;
  config: PipelineConfig;
  status: PipelineStatus;
  currentStage: PipelineStageLabel | string;
  prospects: ProspectRecord[];
  selectedProspectId: string | null;
  auditReportPath: string | null;
  blueprintPath: string | null;
  conceptPath: string | null;
  proposalDirPath: string | null;
  runSummaryPath: string | null;
  buildState: 'idle' | 'running' | 'passed' | 'failed' | 'skipped';
  testState: 'idle' | 'running' | 'passed' | 'failed' | 'skipped';
  verificationState: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
  approvalState: 'none' | 'pending' | 'allowed' | 'denied';
  costLedger: CostLedgerEntry[];
  totalElapsedMs: number;
  blocker: string | null;
  lastError: string | null;
  /** True only after a human approved the outreach step (V1: no actual outreach). */
  outreachApproved: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

/** Audit categories mandated by the milestone. */
export const AUDIT_CATEGORIES = [
  'homepage_clarity',
  'mobile_presentation',
  'navigation',
  'service_page_depth',
  'location_page_depth',
  'cta_visibility',
  'contact_visibility',
  'trust_proof',
  'sitemap_availability',
  'title_meta',
  'internal_linking',
  'broken_placeholder',
  'stale_unrelated',
  'accessibility',
  'performance',
] as const;

/** Scoring criteria (transparent weights, documented in scoring.ts). */
export const SCORING_CRITERIA = [
  'visibleWebsiteWeakness',
  'businessLegitimacyEvidence',
  'likelyValueOfRebuild',
  'abilityToDemonstrateImprovement',
  'recurringServicePotential',
  'factualConfidence',
  'implementationComplexity',
] as const;

/** Words that MUST NOT appear in verified facts unless explicitly labelled. */
export const FABRICATION_BANLIST = [
  /(monthly|annual|yearly|total|gross|net)\s+revenue/i,
  /\brevenue (of|is|was|reached|grew|:)/i,
  /turnover/i,
  /#1\b/i,
  /no\.?\s*1\b/i,
  /profit/i,
  /sales figures/i,
  /earnings/i,
  /monthly (clients|customers|sales)/i,
  /rank(ed)?\s+#?\d/i,
];
