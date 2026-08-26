/**
 * Canonical Revenue Pipeline contract (Milestone: Local Business Revenue Pipeline V1).
 *
 * Pipeline: LOCAL BUSINESS WEBSITE AUDIT → REBUILD CONCEPT → PROPOSAL.
 * One canonical prospect record. One persistent background task + one Board
 * card per run. Every finding is labelled verified | inferred | unavailable.
 * No fabricated business facts, prices, reviews, rankings, traffic, revenue,
 * or contact details — fixture data is always explicitly labelled.
 */
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
];
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
];
/** Scoring criteria (transparent weights, documented in scoring.ts). */
export const SCORING_CRITERIA = [
    'visibleWebsiteWeakness',
    'businessLegitimacyEvidence',
    'likelyValueOfRebuild',
    'abilityToDemonstrateImprovement',
    'recurringServicePotential',
    'factualConfidence',
    'implementationComplexity',
];
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
