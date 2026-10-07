import { describe, it, expect, vi, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { isRepositoryEvaluationRequest, evaluateSelectedRepository } from '../domains/repositoryResearch/evaluation.js';
import { semanticDiscourseInterpreter } from '../domains/controlPlane/SemanticDiscourseInterpreter.js';
import { autonomousPlanner } from '../domains/controlPlane/taskGraph/AutonomousPlanner.js';
import { goalLifecycleManager } from '../domains/controlPlane/GoalLifecycle.js';
import { researchStore } from '../domains/repositoryResearch/store.js';
import { specification } from '../domains/repositoryResearch/specification.js';
import { isResearchResultRequest, presentResearchResult } from '../domains/repositoryResearch/resultFollowup.js';
afterEach(() => vi.restoreAllMocks());
const request = 'Evaluate the recommended repository in an isolated sandbox. Test reading a webpage, clicking a button and verifying the result. Compare latency. Do not install it into production.';
function fixture(repository = 'vercel-labs/agent-browser') {
  const conversationId = randomUUID();
  const goal = goalLifecycleManager.startGoal({ conversationId, userInput: 'Research one browser repository' });
  const id = researchStore.begin(goal.goalId, specification('Research one browser repository', 20));
  researchStore.finish(id, { top: [{ repository }], assessed: 20 });
  return { id, conversationId };
}
describe('selected repository evaluation', () => {
  it('uses the selected-candidate execution operation, never another discovery search', async () => {
    const { conversationId } = fixture();
    const interpreted = await semanticDiscourseInterpreter.interpret(request, { conversationId });
    expect(interpreted.structuredIntent?.executionMode).toBe('AUTONOMOUS_GOAL');
    const graph = autonomousPlanner.planGoal(interpreted.structuredIntent!.goalIntent!, 'evaluation', conversationId);
    expect([...graph.nodes.values()].map(n => n.operation)).toEqual(['GITHUB_EVALUATE', 'PRESENT_RESULT']);
  });
  it('does not upgrade discovery, status or cancellation into code execution', () => {
    for (const text of ['Research one GitHub repository for browser tools', 'What have you found?', 'Stop evaluating the repository', 'Do not test the recommended candidate']) expect(isRepositoryEvaluationRequest(text)).toBe(false);
  });
  it('blocks an unsupported candidate without substituting another repository', async () => {
    const { conversationId } = fixture('example/other');
    await expect(evaluateSelectedRepository({ conversationId, goalId: 'test' })).rejects.toThrow('no reviewed sandbox profile');
  });
  it('honors user cancellation before doing work', async () => {
    await expect(evaluateSelectedRepository({ conversationId: randomUUID(), goalId: 'test', signal: AbortSignal.abort(new Error('user stop')) })).rejects.toThrow('user stop');
  });
  it('grounds feedback requests in the last actual event, not a model promise', () => {
    const { conversationId, id } = fixture();
    researchStore.finish(id, { evaluation: { lastEvent: 'The sandbox evaluation was cancelled.', error: true } });
    const text = 'While you do that, provide me feedback';
    expect(isResearchResultRequest(text, conversationId)).toBe(true);
    expect(presentResearchResult(conversationId, text)).toContain('cancelled');
    expect(presentResearchResult(conversationId, text)).not.toContain('currently evaluating');
    expect(isResearchResultRequest('What was the task that I requested?', conversationId)).toBe(true);
  });
});
