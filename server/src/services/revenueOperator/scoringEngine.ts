/**
 * Deterministic Revenue Opportunity Scoring Engine.
 * 
 * Computes an explainable score (0-100) based strictly on objective mathematical
 * rules. The same inputs ALWAYS produce the exact same score.
 */

export interface ScoringInputs {
  estimatedRevenue: number;
  estimatedCost: number;
  estimatedTimeToRevenueDays: number;
  automationPotential: number; // 0..100
  manualWorkload: number;      // 0..100
  executionDifficulty: number; // 0..100
  riskLevel: number;           // 0..100
  confidence: number;          // 0..100
}

export interface ScoreBreakdown {
  revenuePotentialPts: number;
  timeToRevenuePts: number;
  automationPotentialPts: number;
  lowCapitalPts: number;
  confidencePts: number;
  manualWorkloadPenalty: number;
  riskPenalty: number;
  totalScore: number;
  explanation: string;
}

export function computeOpportunityScore(inputs: ScoringInputs): ScoreBreakdown {
  const rev = Math.max(0, Number(inputs.estimatedRevenue) || 0);
  const cost = Math.max(0, Number(inputs.estimatedCost) || 0);
  const days = Math.max(1, Number(inputs.estimatedTimeToRevenueDays) || 30);
  const autoPct = Math.max(0, Math.min(100, Number(inputs.automationPotential) || 0));
  const workPct = Math.max(0, Math.min(100, Number(inputs.manualWorkload) || 0));
  const diffPct = Math.max(0, Math.min(100, Number(inputs.executionDifficulty) || 0));
  const riskPct = Math.max(0, Math.min(100, Number(inputs.riskLevel) || 0));
  const confPct = Math.max(0, Math.min(100, Number(inputs.confidence) || 0));

  // 1. Revenue Potential (+0..+25 pts)
  let revenuePotentialPts = 5;
  if (rev >= 2500) revenuePotentialPts = 25;
  else if (rev >= 1500) revenuePotentialPts = 22;
  else if (rev >= 1000) revenuePotentialPts = 18;
  else if (rev >= 500) revenuePotentialPts = 14;
  else if (rev >= 250) revenuePotentialPts = 10;

  // 2. Time to Revenue (+0..+20 pts)
  let timeToRevenuePts = 3;
  if (days <= 3) timeToRevenuePts = 20;
  else if (days <= 7) timeToRevenuePts = 18;
  else if (days <= 14) timeToRevenuePts = 14;
  else if (days <= 30) timeToRevenuePts = 8;

  // 3. Automation Potential (+0..+20 pts)
  const automationPotentialPts = Math.round(20 * (autoPct / 100));

  // 4. Low Capital Requirement (+0..+15 pts)
  let lowCapitalPts = 1;
  if (cost === 0) lowCapitalPts = 15;
  else if (cost <= 25) lowCapitalPts = 13;
  else if (cost <= 50) lowCapitalPts = 10;
  else if (cost <= 100) lowCapitalPts = 7;
  else if (cost <= 250) lowCapitalPts = 4;

  // 5. Confidence (+0..+10 pts)
  const confidencePts = Math.round(10 * (confPct / 100));

  // 6. Penalties (-0..-10 each)
  const manualWorkloadPenalty = Math.round(10 * (workPct / 100));
  const maxRisk = Math.max(riskPct, diffPct);
  const riskPenalty = Math.round(10 * (maxRisk / 100));

  // Sum and clamp to 0..100
  const rawScore = (
    revenuePotentialPts +
    timeToRevenuePts +
    automationPotentialPts +
    lowCapitalPts +
    confidencePts -
    manualWorkloadPenalty -
    riskPenalty
  );
  const totalScore = Math.max(0, Math.min(100, rawScore));

  const explanation = [
    `Revenue potential       +${revenuePotentialPts}`,
    `Time to revenue         +${timeToRevenuePts}`,
    `Automation potential    +${automationPotentialPts}`,
    `Low capital requirement +${lowCapitalPts}`,
    `Confidence              +${confidencePts}`,
    `Manual workload         -${manualWorkloadPenalty}`,
    `Risk / Difficulty       -${riskPenalty}`,
    `--------------------------------`,
    `TOTAL                    ${totalScore}/100`
  ].join('\n');

  return {
    revenuePotentialPts,
    timeToRevenuePts,
    automationPotentialPts,
    lowCapitalPts,
    confidencePts,
    manualWorkloadPenalty,
    riskPenalty,
    totalScore,
    explanation
  };
}
