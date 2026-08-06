/**
 * Stage 4 — Opportunity scoring (transparent, evidence-based).
 *
 * Seven criteria, each 0–100 with an explicit reason referencing audit
 * findings / verified facts. Weights are documented and fixed in V1.
 * Never scored from visual appearance alone — every criterion cites evidence.
 */
import type { ProspectRecord } from './types.js';
import { SCORING_CRITERIA } from './types.js';

export const SCORING_WEIGHTS: Record<string, number> = {
  visibleWebsiteWeakness: 0.25,
  businessLegitimacyEvidence: 0.15,
  likelyValueOfRebuild: 0.2,
  abilityToDemonstrateImprovement: 0.1,
  recurringServicePotential: 0.1,
  factualConfidence: 0.1,
  implementationComplexity: 0.1,
};

/** Niche → recurring-service potential (documented map; unknown → neutral 50). */
const RECURRING_NICHE: Record<string, number> = {
  roofing: 80,
  plumbing: 75,
  hvac: 75,
  electrical: 70,
  landscaping: 65,
  cleaning: 70,
  dental: 55,
  'web design': 60,
  restaurant: 40,
  salon: 45,
};

export interface ScoreResult {
  criteria: Record<string, { score: number; reason: string }>;
  overall: number;
  confidence: 'low' | 'medium' | 'high';
  reasons: string[];
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export function scoreProspect(prospect: ProspectRecord): ScoreResult {
  const reasons: string[] = [];
  const criteria: Record<string, { score: number; reason: string }> = {};

  const weaknessFindings = prospect.auditFindings.filter((f) => f.severity === 'weakness' && f.label !== 'unavailable');
  const positiveFindings = prospect.auditFindings.filter((f) => f.severity === 'positive');
  const verifiedCount = prospect.auditFindings.filter((f) => f.label === 'verified').length;
  const inferredCount = prospect.auditFindings.filter((f) => f.label === 'inferred').length;
  const totalFindings = Math.max(1, prospect.auditFindings.length);
  const auditScore = prospect.auditScore ?? 50;

  // 1. Visible website weakness — from the audit (inverted audit score).
  const visibleWeakness = Math.round(100 - auditScore * 0.8 + Math.min(20, weaknessFindings.length * 4));
  criteria.visibleWebsiteWeakness = {
    score: clamp(visibleWeakness),
    reason: `${weaknessFindings.length} weakness finding(s); audit score ${auditScore}/100 (lower = weaker site).`,
  };
  reasons.push(`Visible weakness ${clamp(visibleWeakness)}/100 — ${weaknessFindings.slice(0, 3).map((f) => f.category).join(', ') || 'no clear weaknesses'}.`);

  // 2. Business legitimacy evidence — from verified facts only.
  const legitimacyTerms = /(impressum|imprint|tel:|phone|address|gmbh|ug|meisterbetrieb|registered|handelsregister|kontakt|contact page|legal)/i;
  const legitimacyHits = prospect.verifiedFacts.filter((f) => legitimacyTerms.test(f)).length;
  const legitimacyScore = prospect.verifiedFacts.length >= 3 ? 40 : 25;
  criteria.businessLegitimacyEvidence = {
    score: clamp(legitimacyScore + legitimacyHits * 12),
    reason: `${prospect.verifiedFacts.length} verified fact(s) available; ${legitimacyHits} contain legitimacy signals (contact/legal/registered).`,
  };
  reasons.push(`Legitimacy ${criteria.businessLegitimacyEvidence.score}/100 — based on verified contact/legal signals (${legitimacyHits}).`);

  // 3. Likely value of a rebuild — weak baseline + active niche.
  const nicheValue = prospect.niche === 'roofing' || prospect.niche === 'local business' ? 70 : 55;
  const value = Math.round(visibleWeakness * 0.5 + nicheValue * 0.5);
  criteria.likelyValueOfRebuild = {
    score: clamp(value),
    reason: `Weak baseline (${visibleWeakness}/100 weakness) × niche value baseline (${nicheValue}/100).`,
  };
  reasons.push(`Rebuild value ${clamp(value)}/100.`);

  // 4. Ability to demonstrate improvement — weakest sites prove most.
  const demonstrate = Math.round(20 + visibleWeakness * 0.8);
  criteria.abilityToDemonstrateImprovement = {
    score: clamp(demonstrate),
    reason: `Larger visible gaps (audit ${auditScore}/100) → easier before/after demonstration.`,
  };
  reasons.push(`Demonstrable improvement ${clamp(demonstrate)}/100.`);

  // 5. Recurring-service potential — documented niche map, else inferred 50.
  const nicheKey = prospect.niche.toLowerCase();
  const recurring = RECURRING_NICHE[nicheKey] ?? 50;
  criteria.recurringServicePotential = {
    score: recurring,
    reason: `Documented niche baseline for "${prospect.niche}": ${recurring}/100 (repairs/maintenance cycles).`,
  };
  reasons.push(`Recurring potential ${recurring}/100 (niche map).`);

  // 6. Factual confidence — ratio of verified to inferred/unavailable.
  const factualConfidence = Math.round((verifiedCount / totalFindings) * 100);
  criteria.factualConfidence = {
    score: factualConfidence,
    reason: `${verifiedCount}/${totalFindings} audit findings verified; ${inferredCount} inferred; rest unavailable.`,
  };
  reasons.push(`Factual confidence ${factualConfidence}/100.`);

  // 7. Implementation complexity — inverted: simpler sites score higher.
  const complexity = Math.max(30, 100 - Math.min(60, positiveFindings.length * 5 + (prospect.websiteUrl ? 10 : 0)));
  criteria.implementationComplexity = {
    score: complexity,
    reason: `${positiveFindings.length} positive finding(s) → slightly larger scope; static rebuild keeps complexity manageable.`,
  };
  reasons.push(`Implementation complexity (inverted) ${complexity}/100.`);

  // Overall = weighted sum.
  let overall = 0;
  for (const key of SCORING_CRITERIA) {
    overall += criteria[key].score * SCORING_WEIGHTS[key];
  }
  overall = clamp(overall);

  const confidence =
    factualConfidence >= 60 ? 'high'
    : factualConfidence >= 35 ? 'medium'
    : 'low';

  reasons.push(`Overall ${overall}/100 (weighted: ${Object.entries(SCORING_WEIGHTS).map(([k, w]) => `${k} ${Math.round(w * 100)}%`).join(', ')}).`);
  if (confidence === 'low') reasons.push('Confidence low → requires human target selection before proceeding.');

  return { criteria, overall, confidence, reasons };
}

/** Rank prospects by score, descending, with stable ties. */
export function rankProspects(prospects: ProspectRecord[]): ProspectRecord[] {
  return [...prospects].sort((a, b) => (b.opportunityScore ?? 0) - (a.opportunityScore ?? 0));
}
