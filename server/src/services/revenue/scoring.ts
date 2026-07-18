export interface OpportunityEvidence {
  id: string;
  type:
    | "marketplace_listing"
    | "trend_signal"
    | "competitor_example"
    | "customer_problem"
    | "analytics"
    | "manual_note"
    | "other";

  title: string;
  sourcePlatform?: string;
  sourceUrl?: string;
  capturedAt: string;
  summary: string;

  metrics?: {
    views?: number;
    likes?: number;
    comments?: number;
    sales?: number;
    reviewCount?: number;
    rating?: number;
    price?: number;
    commissionRate?: number;
    growthRate?: number;
  };

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

export function scoreOpportunity(evidenceList: OpportunityEvidence[]): OpportunityScoreResult {
  const result: OpportunityScoreResult = {
    demandScore: 0,
    competitionScore: 0,
    profitabilityScore: 0,
    complianceRiskScore: 0,
    evidenceQualityScore: 0,
    overallScore: 0,
    confidence: "low",
    reasons: [],
    missingInformation: [],
    assumptions: [],
    scoredAt: new Date().toISOString(),
    scoringVersion: "1.0",
  };

  if (!evidenceList || evidenceList.length === 0) {
    result.reasons.push("No evidence provided. Scores are zero.");
    result.missingInformation.push("All metrics");
    return result;
  }

  let totalDemand = 0;
  let totalCompetition = 50; // Assume average competition if no data
  let totalProfitability = 0;
  let hasPrice = false;
  let hasCommission = false;
  let hasSales = false;
  let complianceFlags: string[] = [];
  
  let verifiedCount = 0;

  for (const ev of evidenceList) {
    if (ev.reliability === 'verified') verifiedCount++;

    if (ev.complianceRiskFlags && ev.complianceRiskFlags.length > 0) {
      complianceFlags.push(...ev.complianceRiskFlags);
    }

    if (ev.metrics) {
      // Demand indicators
      if (ev.metrics.views && ev.metrics.views > 10000) totalDemand += 20;
      if (ev.metrics.likes && ev.metrics.likes > 1000) totalDemand += 10;
      if (ev.metrics.sales && ev.metrics.sales > 100) {
        totalDemand += 30;
        hasSales = true;
      }
      if (ev.metrics.growthRate && ev.metrics.growthRate > 10) totalDemand += 20;

      // Competition indicators (more reviews/competitors = higher competition)
      if (ev.metrics.reviewCount && ev.metrics.reviewCount > 1000) totalCompetition += 20;
      
      // Profitability indicators
      if (ev.metrics.price !== undefined) {
        hasPrice = true;
        if (ev.metrics.price > 50) totalProfitability += 20;
      }
      if (ev.metrics.commissionRate !== undefined) {
        hasCommission = true;
        if (ev.metrics.commissionRate > 10) totalProfitability += 30;
      }
    }
  }

  // Normalize scores 0-100
  result.demandScore = Math.min(100, Math.max(0, totalDemand));
  result.competitionScore = Math.min(100, Math.max(0, totalCompetition));
  result.profitabilityScore = Math.min(100, Math.max(0, totalProfitability));
  
  // Calculate evidence quality
  result.evidenceQualityScore = Math.round((verifiedCount / evidenceList.length) * 100);

  // Calculate compliance risk
  result.complianceRiskScore = complianceFlags.length > 0 ? Math.min(100, complianceFlags.length * 25) : 0;

  // Determine missing information and assumptions
  if (!hasSales) {
    result.missingInformation.push("Sales volume");
    result.assumptions.push("Assuming unverified baseline conversion rate.");
  }
  if (!hasPrice) result.missingInformation.push("Product Price");
  if (!hasCommission) result.missingInformation.push("Commission Rate");

  // Determine confidence
  if (result.missingInformation.length >= 2 || result.evidenceQualityScore < 50) {
    result.confidence = "low";
  } else if (result.missingInformation.length === 0 && result.evidenceQualityScore > 80) {
    result.confidence = "high";
  } else {
    result.confidence = "medium";
  }

  // Calculate overall score (formula: Demand * 0.4 - Competition * 0.2 + Profitability * 0.4)
  // Penalize by compliance risk and evidence quality.
  let rawScore = (result.demandScore * 0.4) - (result.competitionScore * 0.2) + (result.profitabilityScore * 0.4);
  rawScore = Math.max(0, rawScore); // don't go below 0

  // Penalty multiplier
  let penaltyMultiplier = 1.0;
  if (result.complianceRiskScore > 50) {
    penaltyMultiplier *= 0.5; // Halve the score if high compliance risk
    result.reasons.push("Severe compliance risk identified; overall score halved.");
  }
  if (result.evidenceQualityScore < 30) {
    penaltyMultiplier *= 0.8;
  }

  result.overallScore = Math.round(rawScore * penaltyMultiplier);
  result.reasons.push(`Calculated base score: ${rawScore.toFixed(1)}`);
  
  return result;
}
