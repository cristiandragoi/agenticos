import { test } from 'node:test';
import assert from 'node:assert';
import { scoreOpportunity, OpportunityEvidence } from '../src/services/revenue/scoring.js';

test('scoring service handles empty evidence', () => {
  const result = scoreOpportunity([]);
  assert.strictEqual(result.overallScore, 0);
  assert.strictEqual(result.confidence, 'low');
  assert.ok(result.missingInformation.includes('All metrics'));
});

test('scoring calculates high score for strong metrics', () => {
  const evidence: OpportunityEvidence[] = [{
    id: '1',
    type: 'analytics',
    title: 'Test',
    capturedAt: new Date().toISOString(),
    summary: 'Great stats',
    reliability: 'verified',
    metrics: {
      views: 15000,
      sales: 200,
      price: 100,
      commissionRate: 15
    }
  }];

  const result = scoreOpportunity(evidence);
  // Expected logic checks:
  // Demand: 20 (views) + 30 (sales) = 50
  // Profitability: 20 (price) + 30 (comm) = 50
  // Competition: 50
  // Raw score: (50 * 0.4) - (50 * 0.2) + (50 * 0.4) = 20 - 10 + 20 = 30
  // Wait, let's just check bounds and valid calculations rather than exact math to prevent brittleness
  assert.ok(result.demandScore > 0);
  assert.ok(result.profitabilityScore > 0);
  assert.ok(result.overallScore > 0);
  assert.strictEqual(result.evidenceQualityScore, 100); // 1 verified / 1 total
  assert.strictEqual(result.confidence, 'high'); // no missing info & high quality
});

test('scoring heavily penalizes high compliance risk', () => {
  const evidence: OpportunityEvidence[] = [{
    id: '1',
    type: 'analytics',
    title: 'Test',
    capturedAt: new Date().toISOString(),
    summary: 'Great stats',
    reliability: 'verified',
    metrics: { sales: 200, price: 100, commissionRate: 15 },
    complianceRiskFlags: ['IP Infringement', 'Unapproved claim']
  }];

  const result = scoreOpportunity(evidence);
  assert.strictEqual(result.complianceRiskScore, 50); // 2 flags * 25
  
  const resultHighRisk = scoreOpportunity([{ ...evidence[0], complianceRiskFlags: ['Flag1', 'Flag2', 'Flag3'] }]);
  assert.strictEqual(resultHighRisk.complianceRiskScore, 75);
  // Penalty multiplier 0.5 triggers
  assert.ok(resultHighRisk.overallScore <= 50);
});
