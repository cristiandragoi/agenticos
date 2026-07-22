/**
 * IntentRouter unit tests
 * Tests all required routing cases from the spec:
 * - direct conversation
 * - clear CodeX request
 * - clear Hermes request
 * - clear Memory request
 * - ambiguous request
 * - unsupported/unknown request
 */
import { IntentRouter } from '../domains/jarvis/intentRouter.js';

const router = new IntentRouter();

describe('IntentRouter — required routing cases', () => {
  it('routes direct conversation (casual question)', async () => {
    const result = await router.routeIntent('What is the capital of France?');
    expect(result.route).toBe('direct');
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it('routes clear CodeX request (build)', async () => {
    const result = await router.routeIntent('Build a React dashboard component');
    expect(result.route).toBe('codex');
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('routes clear CodeX request (refactor)', async () => {
    const result = await router.routeIntent('Refactor the authentication module');
    expect(result.route).toBe('codex');
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('routes clear Hermes request (project)', async () => {
    const result = await router.routeIntent('Show me the current project status');
    expect(result.route).toBe('hermes');
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('routes clear Hermes request (milestone)', async () => {
    const result = await router.routeIntent('Create a milestone for the Q3 release');
    expect(result.route).toBe('hermes');
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('routes clear Hermes request (task tracking)', async () => {
    const result = await router.routeIntent('List all tasks in the current sprint');
    expect(result.route).toBe('hermes');
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('routes clear Memory request', async () => {
    const result = await router.routeIntent('Remember my preferences for dark mode');
    expect(result.route).toBe('memory');
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('routes memory recall correctly', async () => {
    const result = await router.routeIntent('What did I say about the database design?');
    expect(result.route).toBe('memory');
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('returns clarification_required for ambiguous short prompt', async () => {
    const result = await router.routeIntent('do it');
    expect(result.route).toBe('clarification_required');
    expect(result.confidence).toBeLessThan(0.5);
  });

  it('does NOT return clarification for simple hello (hi)', async () => {
    const result = await router.routeIntent('hi');
    // "hi" contains "hi" so it is NOT short-ambiguous; falls through to direct
    expect(result.route).toBe('direct');
  });

  it('routes single-word unknown prompt to clarification_required', async () => {
    const result = await router.routeIntent('analyze');
    expect(result.route).toBe('clarification_required');
    expect(result.confidence).toBeLessThan(0.5);
  });

  it('CodeX confidence is strictly higher than direct confidence', async () => {
    const codex = await router.routeIntent('Build a login page');
    const direct = await router.routeIntent('How does OAuth work?');
    expect(codex.confidence).toBeGreaterThan(direct.confidence);
  });

  // --- Agent Teams Tests ---
  it('does NOT route ordinary use of team to agent_teams', async () => {
    const result = await router.routeIntent('Write a message to my team.');
    expect(result.route).not.toBe('agent_teams');
  });

  it('does NOT route ordinary questions about agents to agent_teams', async () => {
    const result1 = await router.routeIntent('What is an AI agent?');
    expect(result1.route).not.toBe('agent_teams');

    const result2 = await router.routeIntent('Explain multi-agent systems.');
    expect(result2.route).not.toBe('agent_teams');
  });

  it('does NOT route arbitrary questions about teams', async () => {
    const result = await router.routeIntent('Which football team won?');
    expect(result.route).not.toBe('agent_teams');
  });

  it('routes explicit multi-agent execution request to agent_teams', async () => {
    const result1 = await router.routeIntent('Assemble an agent team to investigate this issue');
    expect(result1.route).toBe('agent_teams');
    
    const result2 = await router.routeIntent('Build a team to analyze this code');
    expect(result2.route).toBe('agent_teams');
  });
});
