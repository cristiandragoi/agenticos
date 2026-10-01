/**
 * semanticGoalParserContinuation.test.ts — compound-goal continuation inheritance.
 *
 * Root cause guarded here: `parseGoal` splits a compound goal on " and " and
 * requires EVERY fragment to classify independently. A continuation fragment
 * such as "tell me its current project insight" has no executor keyword of its
 * own, scored 0.00, and the parser discarded the already-resolved project
 * (clarificationRequired = true, steps = []) — so the live request
 *
 *   "Jarvis, inspect the Free Cash project and tell me its current project insight."
 *
 * answered "I didn't catch which command you requested."
 *
 * The fix lets such a fragment inherit entityId/entityName from the previous
 * resolved internal_agenticos project step and emit a query_status step — but
 * ONLY when a real project entity was resolved, the fragment fails independent
 * classification, and it carries recognised continuation language. Confidence
 * thresholds are unchanged: without prior project context these goals must
 * still clarify.
 */
import { describe, it, expect } from 'vitest';
import { semanticGoalParser } from '../domains/jarvis/execution/semanticGoalParser';
import type { ActionPlan, TurnContext } from '../domains/jarvis/execution/types';

const ctx: TurnContext = { conversationId: 'test-continuation-conversation' };

const parse = (goal: string): ActionPlan => semanticGoalParser.parseGoal(goal, ctx);

const internalSteps = (plan: ActionPlan) =>
  plan.steps.filter((s) => s.executorId === 'internal_agenticos');

describe('semanticGoalParser — compound project continuation', () => {
  it('1. compound project continuation succeeds (no clarification, project preserved)', () => {
    const plan = parse('Inspect Free Cash and tell me its current project insight');

    expect(plan.clarificationRequired).toBe(false);
    expect(plan.steps.length).toBeGreaterThanOrEqual(2);
    expect(internalSteps(plan).length).toBeGreaterThanOrEqual(2);

    // Step 1 resolved the project; step 2 must not have discarded it.
    expect(plan.steps[0].parameters.entityId).toBe('proj-free-cash');
    const continuation = plan.steps[plan.steps.length - 1];
    expect(continuation.executorId).toBe('internal_agenticos');
    expect(continuation.parameters.entityId).toBe('proj-free-cash');
    expect(continuation.parameters.entityName).toBe('Free Cash');
  });

  it('2. `it` continuation inherits the previously resolved project', () => {
    const plan = parse('Check Revenue Operator and tell me what is happening with it');

    expect(plan.clarificationRequired).toBe(false);
    expect(plan.steps[0].parameters.entityId).toBe('revenue-operator');

    const continuation = plan.steps[plan.steps.length - 1];
    expect(continuation.executorId).toBe('internal_agenticos');
    expect(continuation.parameters.entityId).toBe('revenue-operator');
    expect(continuation.parameters.entityName).toBe('Revenue Operator');
  });

  it('3. `its` continuation inherits the previously resolved project', () => {
    const plan = parse('Inspect Free Cash and tell me its status');

    expect(plan.clarificationRequired).toBe(false);
    const continuation = plan.steps[plan.steps.length - 1];
    expect(continuation.executorId).toBe('internal_agenticos');
    expect(continuation.parameters.entityId).toBe('proj-free-cash');
  });

  it('4. `project insight` continuation maps to query_status', () => {
    const plan = parse('Inspect Free Cash and tell me its current project insight');

    const continuation = plan.steps[plan.steps.length - 1];
    expect(continuation.action).toBe('query_status');
    expect(continuation.capabilityId).toBe('internal_agenticos');
    expect(continuation.parameters.inheritedFromPreviousStep).toBe(true);

    // "Open Free Cash and tell me its current state" is the same shape.
    const statePlan = parse('Open Free Cash and tell me its current state');
    expect(statePlan.clarificationRequired).toBe(false);
    const stateStep = statePlan.steps[statePlan.steps.length - 1];
    expect(stateStep.action).toBe('query_status');
    expect(stateStep.parameters.entityId).toBe('proj-free-cash');
  });

  it('5. unresolved continuation still clarifies (no project context at all)', () => {
    // Single clause, no prior step: must stay a clarification.
    const single = parse('Jarvis, tell me its status');
    expect(single.clarificationRequired).toBe(true);
    expect(single.steps).toEqual([]);

    // Compound, but the first clause resolved no project entity.
    const compound = parse('Inspect the build pipeline and tell me its status');
    expect(compound.clarificationRequired).toBe(true);
    expect(compound.steps).toEqual([]);

    const noVerb = parse('Jarvis, do something and blah blah');
    expect(noVerb.clarificationRequired).toBe(true);
    expect(noVerb.steps).toEqual([]);

    // Literal non-resolution cases from the defect report.
    const inspectWhatever = parse('Jarvis, inspect and whatever');
    expect(inspectWhatever.clarificationRequired).toBe(true);
    expect(inspectWhatever.steps).toEqual([]);
  });

  it('6. unknown second clause is NOT automatically executable', () => {
    const plan = parse('Inspect Free Cash and do the thing with the widget');

    expect(plan.clarificationRequired).toBe(true);
    expect(plan.steps).toEqual([]);
  });

  it('7. existing single project query still works', () => {
    const plan = parse("Jarvis, what is the status of Free Cash?");

    expect(plan.clarificationRequired).toBe(false);
    expect(plan.steps.length).toBe(1);
    expect(plan.steps[0].executorId).toBe('internal_agenticos');
    expect(plan.steps[0].action).toBe('query_status');
    expect(plan.steps[0].parameters.entityId).toBe('proj-free-cash');
  });

  it('8. existing independent compound behaviour is unchanged', () => {
    // Both clauses independently classified: browser navigate + browser search.
    const browser = parse('Open Google and search for flights');
    expect(browser.clarificationRequired).toBe(false);
    expect(browser.steps.length).toBe(2);
    expect(browser.steps[0].executorId).toBe('browser');
    expect(browser.steps[0].action).toBe('navigate');
    expect(browser.steps[1].executorId).toBe('browser');
    expect(browser.steps[1].action).toBe('search');
    expect(browser.steps[1].parameters.target).toBe('Google');
    expect(browser.steps[1].parameters.query).toBe('flights');

    // A second clause naming its OWN project must not inherit the first one.
    const twoProjects = parse('Open Free Cash and open Shopify');
    expect(twoProjects.clarificationRequired).toBe(false);
    expect(twoProjects.steps[0].parameters.entityId).toBe('proj-free-cash');
    expect(twoProjects.steps[1].parameters.entityId).toBe('proj-shopify');
  });

  it('9. a second clause that classifies independently never inherits the project', () => {
    // "status" is continuation language, but git classifies this clause on its
    // own — inheritance must be blocked by independent classification.
    const plan = parse('Inspect Free Cash and run git status in D:/AgenticOS');

    expect(plan.clarificationRequired).toBe(false);
    const gitSteps = plan.steps.filter((s) => s.executorId === 'git');
    expect(gitSteps.length).toBe(1);
    expect(gitSteps[0].action).toBe('status');

    const inherited = plan.steps.filter((s) => s.parameters.inheritedFromPreviousStep === true);
    expect(inherited).toEqual([]);
  });
});
