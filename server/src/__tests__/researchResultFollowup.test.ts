import { describe, it, expect, vi, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { goalLifecycleManager } from '../domains/controlPlane/GoalLifecycle.js';
import { researchStore } from '../domains/repositoryResearch/store.js';
import { specification } from '../domains/repositoryResearch/specification.js';
import { presentResearchResult, isResearchResultRequest } from '../domains/repositoryResearch/resultFollowup.js';
import { semanticDiscourseInterpreter } from '../domains/controlPlane/SemanticDiscourseInterpreter.js';
import { conversationCapabilityAdapter } from '../domains/controlPlane/adapters/ConversationCapabilityAdapter.js';
import { AuthoritativeIntentCompiler } from '../domains/controlPlane/AuthoritativeIntentCompiler.js';
import * as research from '../domains/repositoryResearch/service.js';
import { createTurnEnvelopeAsync } from '../domains/controlPlane/TurnEnvelope.js';
import { turnLifecycle } from '../domains/turnLifecycle/controller.js';
import { autonomousExecutionKernel } from '../domains/controlPlane/taskGraph/AutonomousExecutionKernel.js';
import * as gateway from '../services/llmGateway.js';
import { authoritativeInteractionContext } from '../domains/controlPlane/AuthoritativeInteractionContext.js';

const request = 'Name the recommended repository. Give me its GitHub link, and explain which capabilities you verified and which remain untested.';
afterEach(() => vi.restoreAllMocks());
function fixture() {
  const conversationId = `research-result-${randomUUID()}`;
  const goal = 'Research one public GitHub repository for reading websites and clicking buttons';
  const run = goalLifecycleManager.startGoal({ conversationId, userInput: goal, normalizedGoal: goal });
  goalLifecycleManager.transitionState(run.goalId, 'EXECUTING', { summary: 'Researching' });
  const id = researchStore.begin(run.goalId, specification(goal, 20));
  return { conversationId, run, id };
}
describe('saved research result follow-ups', () => {
  it('separates live-session recall, status, recommendation and changed subject without a model',async()=>{
    const {conversationId,id}=fixture();
    researchStore.finish(id,{assessed:20,top:[{repository:'vercel-labs/agent-browser'}]});
    for(const text of ['What I asked you earlier','What I ask you, repeat word with word what I ask you.','What was the question that I previously asked?']){
      const envelope=await createTurnEnvelopeAsync({rawText:text,conversationId,source:'voice_text_injection'});
      expect(envelope.compiledIntent.target).toBe('repository_research_result');
      expect(presentResearchResult(conversationId,text)).toContain('Your request was:');
      expect(presentResearchResult(conversationId,text)).not.toContain('provisional leader');
    }
    for(const text of ['Okay, so what is the statues?','And which one?']){
      const envelope=await createTurnEnvelopeAsync({rawText:text,conversationId,source:'voice_text_injection'});
      expect(envelope.compiledIntent.target).toBe('repository_research_result');
    }
    authoritativeInteractionContext.recordDialogueTurn(conversationId,'user','Open YouTube');
    expect(isResearchResultRequest('I said it.',conversationId)).toBe(false);
  });
  it('keeps a consecutive dialogue attached through progress, completion, interruption and subject changes', async () => {
    const { conversationId, id, run } = fixture();
    const kernel = vi.spyOn(autonomousExecutionKernel, 'executeGoal');
    const search = vi.spyOn(research, 'runRepositoryResearch');
    const ask = async (text: string) => {
      const spoken: string[] = [];
      const envelope = await createTurnEnvelopeAsync({ rawText: text, conversationId, source: 'voice_text_injection' });
      expect(envelope.structuredIntent?.executionMode).toBe('DIRECT_ACTION');
      await turnLifecycle.submit({ text, conversationId, source: 'voice_text_injection', envelope }, { speak: async t => { spoken.push(t); } });
      expect(spoken.join(' ')).not.toContain('recorded failure');
      return spoken.join(' ');
    };
    expect(await ask('And?')).toContain('no final recommendation yet');
    expect(await ask('What is the result?')).toContain('0 saved assessments');
    researchStore.finish(id, { assessed: 20, top: [{ repository: 'vercel-labs/agent-browser' }] });
    for (const text of ['What kind of GitHub repo you recommend?', 'What are the findings?', 'Show me the outcome', 'Which candidate should we use?'])
      expect(await ask(text)).toContain('https://github.com/vercel-labs/agent-browser');
    authoritativeInteractionContext.recordDialogueTurn(conversationId, 'user', 'Stop talking');
    expect(await ask('What is your recommendation?')).toContain('vercel-labs/agent-browser');
    authoritativeInteractionContext.recordDialogueTurn(conversationId, 'user', 'Open Notepad');
    expect(isResearchResultRequest('What is the result?', conversationId)).toBe(false);
    expect(await ask('What is the research result?')).toContain('vercel-labs/agent-browser');
    expect(await ask('And?')).toContain('vercel-labs/agent-browser');
    expect(kernel).not.toHaveBeenCalled(); expect(search).not.toHaveBeenCalled();
    expect(goalLifecycleManager.getGoalRun(run.goalId)?.status).toBe('EXECUTING');
  });
  it('reports cancellation on generic result queries without restarting', () => {
    const { conversationId, run } = fixture();
    goalLifecycleManager.transitionState(run.goalId, 'CANCELLED', { summary: 'User stopped' });
    expect(isResearchResultRequest('And what is the result?', conversationId)).toBe(true);
    expect(presentResearchResult(conversationId)).toContain('research stopped');
  });
  it('rejects a model response contradicting installed action capabilities', async () => {
    vi.spyOn(gateway, 'llmChat').mockResolvedValue({ reply: JSON.stringify({ reply: 'I am a language model and do not have the capability to work autonomously or perform actions in the real world.' }) } as any);
    const { conversationId } = fixture();
    const reply = await (conversationCapabilityAdapter as any).reasonAboutConversation('Can you help me?', authoritativeInteractionContext.getContext(conversationId));
    expect(reply).toContain('AgenticOS tools');
    expect(reply).not.toContain('I am a language model');
  });
  it.each(['Okay, so what do you recommend?', 'Which one do you recommend?', 'What would you suggest?', 'What is your recommendation?', 'Which one should we use?'])('delivers the completed recommendation for %s without new work', async text => {
    const { conversationId, id } = fixture();
    researchStore.finish(id, { assessed: 20, top: [{ repository: 'vercel-labs/agent-browser' }] });
    const kernel = vi.spyOn(autonomousExecutionKernel, 'executeGoal');
    const search = vi.spyOn(research, 'runRepositoryResearch');
    const spoken: string[] = [];
    const envelope = await createTurnEnvelopeAsync({ rawText: text, conversationId, source: 'voice_text_injection' });
    await turnLifecycle.submit({ text, conversationId, source: 'voice_text_injection', envelope }, { speak: async value => { spoken.push(value); } });
    expect(spoken.join(' ')).toContain('https://github.com/vercel-labs/agent-browser');
    expect(spoken.join(' ')).not.toContain('recorded failure');
    expect(kernel).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
  });
  it('does not attach recommendations about another subject to saved research', () => {
    const { conversationId } = fixture();
    expect(isResearchResultRequest('What do you recommend for dinner?', conversationId)).toBe(false);
    expect(isResearchResultRequest('What do you recommend?', 'new-conversation')).toBe(false);
  });
  it('reports bounded installed autonomy rather than denying all actions', async () => {
    const { conversationId } = fixture();
    const step = AuthoritativeIntentCompiler.compilePlan('I want Jarvis working with full autonomy.', { conversationId }).steps[0];
    const reply = await conversationCapabilityAdapter.execute({ ...step, action: 'CONVERSATIONAL' }, 'autonomy', conversationId);
    expect(reply.outputText).toContain('AgenticOS tools');
    expect(reply.outputText).toContain('Full unrestricted autonomy is not available');
    expect(reply.outputText).not.toContain('I am a language model');
  });
  it.each(['Okay, so what have you found?', 'Yes, that was my result. What heavy found?', 'I said it already.', 'You said that half an hour ago. Nothing happens.', 'I just asked to research one public GitHub repository that could read websites and click buttons.'])('retains the saved task for %s', async text => {
    const { conversationId } = fixture();
    const kernel = vi.spyOn(autonomousExecutionKernel, 'executeGoal');
    const search = vi.spyOn(research, 'runRepositoryResearch');
    const spoken: string[] = [];
    const envelope = await createTurnEnvelopeAsync({ rawText: text, conversationId, source: 'voice_text_injection' });
    expect(envelope.structuredIntent?.executionMode).toBe('DIRECT_ACTION');
    await turnLifecycle.submit({ text, conversationId, source: 'voice_text_injection', envelope }, { speak: async value => { spoken.push(value); } });
    expect(spoken.join(' ')).toContain('no final recommendation yet');
    expect(spoken.join(' ')).not.toContain('Your request was');
    expect(kernel).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
  });
  it('leads with collected findings, and repeats the request only when asked for it', () => {
    const { conversationId, id } = fixture();
    researchStore.candidate(id, { metadata: { id: 987 }, commitSha: 'a'.repeat(40), collectedAt: new Date().toISOString() }, { eligible: true, repository: 'example/browser', score: 50 });
    expect(presentResearchResult(conversationId)).toMatch(/^So far, example\/browser is the provisional leader/);
    expect(presentResearchResult(conversationId)).toContain('1 saved assessments');
    expect(presentResearchResult(conversationId, 'What was my request?')).toMatch(/^Your request was:/);
  });
  it.each(['Open Word document', 'I said open Notepad', 'Restart the research', 'Research another repository', 'Research one GitHub repository for browser automation'])('preserves explicit new work: %s', text => {
    const { conversationId } = fixture();
    expect(isResearchResultRequest(text, conversationId)).toBe(false);
  });
  it('routes the exact microphone phrase to a direct response, without another autonomous goal', async () => {
    const { conversationId } = fixture();
    const result = await semanticDiscourseInterpreter.interpret(request, { conversationId });
    expect(result.structuredIntent?.executionMode).toBe('DIRECT_ACTION');
    expect(result.structuredIntent?.goalIntent).toBeUndefined();
    expect(result.plan.steps[0].target).toBe('repository_research_result');
  });
  it('reads pending research after a later failed goal displaces the active reference', async () => {
    const { conversationId, run } = fixture();
    const unrelated = goalLifecycleManager.startGoal({ conversationId, userInput: 'Unrelated task' });
    goalLifecycleManager.transitionState(unrelated.goalId, 'FAILED_EXHAUSTED', { summary: 'Failed' });
    const start = vi.spyOn(goalLifecycleManager, 'startGoal');
    const search = vi.spyOn(research, 'runRepositoryResearch');
    const step = AuthoritativeIntentCompiler.compilePlan(request, { conversationId }).steps[0];
    const response = await conversationCapabilityAdapter.execute(step, 'result', conversationId);
    expect(response.outputText).toContain('0 saved assessments');
    expect(response.outputText).toContain('no final recommendation yet');
    expect(start).not.toHaveBeenCalled(); expect(search).not.toHaveBeenCalled();
    expect(goalLifecycleManager.getGoalRun(run.goalId)?.status).toBe('EXECUTING');
  });
  it('returns the saved candidate and link, but never presents README claims as tested actions', () => {
    const { conversationId, id } = fixture();
    researchStore.finish(id, { assessed: 20, top: [{ repository: 'example/browser-tool' }] });
    const text = presentResearchResult(conversationId);
    expect(text).toContain('https://github.com/example/browser-tool');
    expect(text).toContain('not verified browser actions');
    expect(text).toContain('response latency have not been demonstrated');
    expect(presentResearchResult('unrelated-conversation')).not.toContain('example/browser-tool');
  });
  it('does not fall back to an old recommendation when the latest research was cancelled', () => {
    const { conversationId, run } = fixture();
    goalLifecycleManager.transitionState(run.goalId, 'CANCELLED', { summary: 'User stopped' });
    expect(presentResearchResult(conversationId)).toContain('research stopped');
  });
  it('does not mistake a new research request for a result lookup', () => {
    expect(isResearchResultRequest('Research one GitHub repository and recommend one candidate')).toBe(false);
    expect(isResearchResultRequest(request)).toBe(true);
  });
  it('delivers the saved status through the production turn lifecycle without invoking the kernel', async () => {
    const { conversationId } = fixture();
    const kernel = vi.spyOn(autonomousExecutionKernel, 'executeGoal');
    const spoken: string[] = [];
    const envelope = await createTurnEnvelopeAsync({ rawText: request, conversationId, source: 'voice_text_injection' });
    await turnLifecycle.submit({ text: request, conversationId, source: 'voice_text_injection', envelope },
      { speak: async text => { spoken.push(text); } });
    expect(kernel).not.toHaveBeenCalled();
    expect(spoken.join(' ')).toContain('no final recommendation yet');
  });
});
