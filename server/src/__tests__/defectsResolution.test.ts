import { describe, it, expect, beforeAll } from 'vitest';
import { resolveSemanticTurn } from '../domains/jarvis/semanticTurnResolver.js';
import { getDialogueState, getPendingAction, ensureJarvisDialogueTables } from '../domains/jarvis/dialogueState.js';
import { OperationalClaimGate } from '../domains/jarvis/operationalEvidence.js';
import { resolveAuthorizedDomainContext } from '../services/backgroundTasks/adapters.js';
import { registerEntityProvider } from '../domains/jarvis/entityResolver.js';
import { RevenueOperatorEntityProvider } from '../domains/jarvis/entityProviders/revenueOperator.js';
import { CapabilityEntityProvider } from '../domains/jarvis/entityProviders/capability.js';
import { ProjectEntityProvider } from '../domains/jarvis/entityProviders/project.js';
import { seedCanonicalOpportunities, listOpportunities, createOpportunity } from '../services/revenueOperator/opportunityService.js';

ensureJarvisDialogueTables();
registerEntityProvider(RevenueOperatorEntityProvider);
registerEntityProvider(ProjectEntityProvider);
registerEntityProvider(CapabilityEntityProvider);

describe('Defect 1 & Defect 2 Resolution Suite', () => {
  const convId = `conv-defects-${Date.now()}`;

  beforeAll(async () => {
    await seedCanonicalOpportunities();
    const opps = await listOpportunities();
    if (!opps.some((o) => o.title.includes('Free Cash'))) {
      await createOpportunity({
        title: 'Free Cash Finance Automation',
        description: 'Automated cash-flow forecasting service for SMEs.',
        category: 'sme_ai_automation',
        source: 'smoke_test',
        estimatedRevenue: 1500,
        estimatedCost: 0,
        estimatedTimeToRevenueDays: 7,
        automationPotential: 80,
        manualWorkload: 20,
        executionDifficulty: 20,
        riskLevel: 20,
        confidence: 85,
      });
    }
  });

  it('Turn 1: "Check the Free Cash project." sets activeEntity', async () => {
    const res = await resolveSemanticTurn('Check the Free Cash project.', convId);
    expect(res.handled).toBe(true);
    expect(res.decision.type).toBe('entity_resolved');
    expect(res.response?.text).toContain('Free Cash');

    const state = getDialogueState(convId);
    expect(state?.activeEntity?.displayName).toBe('Free Cash Finance Automation');
  });

  it('Turn 2: "What should we do next?" generates recommendation without task lookup or refusal', async () => {
    const res = await resolveSemanticTurn('What should we do next?', convId);
    expect(res.handled).toBe(true);
    expect(res.decision.type).toBe('recommend_next_step');
    expect(res.response?.text).not.toContain('No matching task exists');
    expect(res.response?.text).toContain('recommend creating a research workflow plan with Hermes');

    const state = getDialogueState(convId);
    expect(state?.lastRecommendation).toBeDefined();
    expect(state?.lastRecommendation?.action).toContain('Create a research workflow plan');
    expect(state?.lastRecommendation?.worker).toBe('hermes');
  });

  it('Turn 3: "Why?" explains the recommendation rationale', async () => {
    const res = await resolveSemanticTurn('Why?', convId);
    expect(res.handled).toBe(true);
    expect(res.decision.type).toBe('recommendation_rationale');
    expect(res.response?.text).toContain('discovery and evaluation stage');
    expect(res.response?.text).toContain('automation potential');
  });

  it('Turn 4: "Do that." creates a structured PendingAction awaiting confirmation', async () => {
    const res = await resolveSemanticTurn('Do that.', convId);
    expect(res.handled).toBe(true);
    expect(res.decision.type).toBe('created_proposal');
    expect(res.response?.text).toContain('Shall I proceed');

    const state = getDialogueState(convId);
    expect(state?.pendingActionId).toBeDefined();
    const pa = getPendingAction(state!.pendingActionId!);
    expect(pa?.status).toBe('awaiting_confirmation');
    expect(pa?.executor).toBe('hermes');
    expect(pa?.target?.displayName).toBe('Free Cash Finance Automation');
  });

  it('OperationalClaimGate does NOT falsely reject advisory recommendation replies', () => {
    const advisoryReply = 'I recommend creating a research workflow plan with Hermes to analyze Free Cash Finance Automation. Would you like to proceed?';
    const emptyConv = `empty-conv-${Date.now()}`;
    const check = OperationalClaimGate.verifyClaims(advisoryReply, emptyConv, 'What should we do next?');
    expect(check.ok).toBe(true);
  });

  it('Defect 2: resolveAuthorizedDomainContext enriches Revenue Operator opportunities', async () => {
    const mockTask: any = {
      taskId: 'bgtask-unit-test-fc',
      title: 'Create a research workflow plan for Free Cash',
      objective: 'Create a research workflow plan for Free Cash',
      metadata: {
        delegationEnvelope: {
          target: {
            id: 'opp-45086c0d-',
            type: 'revenue_opportunity',
            domain: 'revenue_operator',
            displayName: 'Free Cash Finance Automation',
          },
          objective: 'Create a research workflow plan for Free Cash',
        },
      },
    };

    const domainCtx = await resolveAuthorizedDomainContext(mockTask);
    expect(domainCtx).toBeDefined();
    expect(domainCtx).toContain('AUTHORIZED REVENUE OPERATOR CONTEXT');
    expect(domainCtx).toContain('Free Cash Finance Automation');
    expect(domainCtx).toContain('ID: opp-');
    expect(domainCtx).toContain('Total Score:');
    expect(domainCtx).toContain('Human Gates');
  });
});
