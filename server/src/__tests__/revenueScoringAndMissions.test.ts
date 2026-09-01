import { describe, it, expect } from 'vitest';
import { computeOpportunityScore, type ScoringInputs } from '../services/revenueOperator/scoringEngine.js';
import {
  seedCanonicalOpportunities,
  listOpportunities,
  convertOpportunityToMission,
} from '../services/revenueOperator/opportunityService.js';

describe('Deterministic Revenue Scoring Engine', () => {
  it('is completely deterministic for identical inputs', () => {
    const input: ScoringInputs = {
      estimatedRevenue: 1200,
      estimatedCost: 0,
      estimatedTimeToRevenueDays: 5,
      automationPotential: 75,
      manualWorkload: 30,
      executionDifficulty: 20,
      riskLevel: 20,
      confidence: 90,
    };

    const res1 = computeOpportunityScore(input);
    const res2 = computeOpportunityScore(input);

    expect(res1.totalScore).toBe(res2.totalScore);
    expect(res1.revenuePotentialPts).toBe(res2.revenuePotentialPts);
    expect(res1.timeToRevenuePts).toBe(res2.timeToRevenuePts);
    expect(res1.automationPotentialPts).toBe(res2.automationPotentialPts);
    expect(res1.lowCapitalPts).toBe(res2.lowCapitalPts);
    expect(res1.confidencePts).toBe(res2.confidencePts);
    expect(res1.manualWorkloadPenalty).toBe(res2.manualWorkloadPenalty);
    expect(res1.riskPenalty).toBe(res2.riskPenalty);
    expect(res1.explanation).toBe(res2.explanation);
    expect(res1.totalScore).toBeGreaterThanOrEqual(0);
    expect(res1.totalScore).toBeLessThanOrEqual(100);
  });

  it('correctly rewards high revenue, low capital, and fast turnaround', () => {
    const highPotential: ScoringInputs = {
      estimatedRevenue: 2500,
      estimatedCost: 0,
      estimatedTimeToRevenueDays: 3,
      automationPotential: 95,
      manualWorkload: 10,
      executionDifficulty: 10,
      riskLevel: 10,
      confidence: 95,
    };

    const lowPotential: ScoringInputs = {
      estimatedRevenue: 100,
      estimatedCost: 500,
      estimatedTimeToRevenueDays: 45,
      automationPotential: 20,
      manualWorkload: 80,
      executionDifficulty: 80,
      riskLevel: 80,
      confidence: 40,
    };

    const highRes = computeOpportunityScore(highPotential);
    const lowRes = computeOpportunityScore(lowPotential);

    expect(highRes.totalScore).toBeGreaterThan(85);
    expect(lowRes.totalScore).toBeLessThan(30);
  });
});

describe('Opportunity to Mission Lifecycle', () => {
  it('seeds 5 realistic opportunities and ranks them deterministically', async () => {
    const opps = await seedCanonicalOpportunities();
    expect(opps.length).toBeGreaterThanOrEqual(5);

    // Verify ordering by score descending
    for (let i = 0; i < opps.length - 1; i++) {
      expect(opps[i].score).toBeGreaterThanOrEqual(opps[i + 1].score);
    }
  });

  it('converts an opportunity to a persisted RevenueMission', async () => {
    const opps = await listOpportunities();
    const topOpp = opps[0];

    const conversion = await convertOpportunityToMission(topOpp.id, {
      strategy: 'Autonomous delivery of high-ranking opportunity',
    });

    expect(conversion.opportunity.status).toBe('CONVERTED');
    expect(conversion.mission).toBeDefined();
    expect(conversion.mission.title).toContain(topOpp.title);
    expect(conversion.mission.targetAmount).toBe(topOpp.estimatedRevenue);
    expect(conversion.mission.assignedAgents).toContain('jarvis');
    expect(conversion.mission.assignedAgents).toContain('hermes');
    expect(conversion.mission.assignedAgents).toContain('codex');
    expect(conversion.mission.assignedAgents).toContain('argus');
    expect(conversion.mission.steps.length).toBeGreaterThanOrEqual(3);
  });
});
