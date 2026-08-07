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
  /** Dry-run: no real contact, no publish, no spend. Default true. */
  dryRun: boolean;
  /**
   * TRUE only for tests/demo: discovery uses labelled sample fixtures.
   * Production runs (and the live acceptance) set FALSE and use REAL
   * public-business discovery — fixtures are never substituted silently.
   */
  fixturesOnly: boolean;
  /** Whether the staged concept is actually built (npm install + build + verify). */
  runBuild: boolean;
  /** Whether CodeX runs the bounded site-implementation task (worker routing). */
  useCodex: boolean;
  /** Whether to attempt LLM-assisted proposal drafting (default false in V1). */
  useLlm: boolean;
  rawRequest: string;
  /** Where artifacts (proposal package, site concept) are written. */
  workspacePath: string;
  /**
   * Discovery headroom (contact-quality milestone): discovery requests
   * prospectCount × this multiplier candidates so that qualification
   * rejections can be replaced WITHOUT a second discovery round. Default 2.
   */
  discoveryHeadroomMultiplier?: number;
  /** Hard cap on how many candidates a single discovery pass may return. */
  discoveryCap?: number;
  /** Bounded retry budget per discovery source (default 3). */
  discoveryMaxAttemptsPerSource?: number;
  /** Bounded retry budget across ALL discovery sources (default 6). */
  discoveryMaxTotalAttempts?: number;
  /** Discovery time budget in ms (default 120000). */
  discoveryTimeBudgetMs?: number;
  /** Backoff base in ms for transient retries (default 500; tests use 1). */
  discoveryBackoffBaseMs?: number;
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

/**
 * Public discovery-source contract: WHERE a prospect came from and WHY it is
 * believed to be a real business. Every real (non-fixture) prospect carries
 * one; the reviewer refuses non-fixture prospects without it.
 */
export interface DiscoverySourceRecord {
  /** Machine kind, e.g. 'osm-overpass' (OpenStreetMap Overpass API). */
  sourceType: string;
  /** Public URL that can be opened to verify the source (OSM element page, …). */
  sourceUrl: string;
  /** ISO timestamp of retrieval. */
  retrievedAt: string;
  /** Human-readable evidence chain (name, website tag, address, area). */
  evidence: string;
  confidence: 'high' | 'medium' | 'low';
  /** Other discovery sources that corroborated the SAME business (by domain). */
  corroboratedBy?: string[];
}

/** Why discovery stopped (source-resilience milestone). */
export type DiscoveryStopReason =
  | 'TARGET_REACHED'
  | 'SOURCE_EXHAUSTED'
  | 'TIME_EXHAUSTED'
  | 'RATE_LIMITED'
  | 'INVALID_RESPONSE'
  | 'NO_RESULTS';

/** One attempt against one discovery source (retry/fallback log). */
export interface DiscoverySourceAttempt {
  source: string;
  attempt: number;
  status: 'ok' | 'transient_failure' | 'rate_limited' | 'invalid_response' | 'no_results';
  error: string | null;
  latencyMs: number | null;
}

/**
 * Publicly accessible contact information (multi-lead contract).
 * A lead qualifies only when at least one of these methods is actually
 * observed on the public website. Values are extracted, never invented.
 */
export interface PublicContactInfo {
  phone: string[];
  email: string[];
  contactPageUrl: string | null;
  address: string | null;
}

export interface ProspectRecord {
  prospectId: string;
  businessName: string;
  niche: string;
  city: string;
  websiteUrl: string;
  publicContactUrl: string | null;
  /** Publicly accessible contact methods extracted from the public website
   *  (phone/email/contact-page/address). NEVER fabricated. */
  publicContact?: PublicContactInfo | null;
  discoverySource: 'fixture' | 'user-url' | 'osm-overpass';
  /** Discovery provenance for real prospects (null for fixtures/user-url). */
  discoverySourceRecord: DiscoverySourceRecord | null;
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
  /** Why discovery stopped (source-resilience milestone). */
  discoveryStopReason?: string | null;
  /** Full discovery attempt log across sources. */
  discoverySourceLog?: DiscoverySourceAttempt[];
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
