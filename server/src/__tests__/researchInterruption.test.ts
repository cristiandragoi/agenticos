import { describe, it, expect, vi, afterEach } from 'vitest';
import { turnLifecycle } from '../domains/turnLifecycle/controller.js';
import { autonomousExecutionKernel } from '../domains/controlPlane/taskGraph/AutonomousExecutionKernel.js';
import { researchFollowup } from '../domains/repositoryResearch/followup.js';
import { specification, searchQueries } from '../domains/repositoryResearch/specification.js';
import { speechArbiter, SpeechPriority } from '../domains/jarvisNext/speechArbiter.js';
import { createTurnEnvelopeAsync } from '../domains/controlPlane/TurnEnvelope.js';

afterEach(() => { vi.restoreAllMocks(); speechArbiter.flush(); });
describe('research interruption and refinement', () => {
  it('cancels an older research run, deduplicates repeats, and cancels the replacement on stop', async () => {
    const signals: AbortSignal[] = []; const milestones = vi.fn(async () => {});
    vi.spyOn(autonomousExecutionKernel, 'executeGoal').mockImplementation(async (_goal, options) => {
      signals.push(options.signal!);
      options.onUserMilestone?.('I found 50 unique repositories.');
      options.onUserMilestone?.('I have assessed 10 repositories.');
      return await new Promise(resolve => options.signal!.addEventListener('abort', () => resolve({ success: false } as any), { once: true }));
    });
    const conversationId = `research-stop-${Date.now()}`;
    const sink = { goalAccepted: async () => {}, goalMilestone: milestones };
    const first = { source: 'voice_text_injection' as const, conversationId, text: 'Find GitHub repositories for agent latency' };
    const envelope = await createTurnEnvelopeAsync({ rawText: first.text, conversationId, source: first.source });
    await turnLifecycle.submit({ ...first, envelope }, sink);
    const repeat = await turnLifecycle.submit({ ...first, externalTurnId: 'second' }, sink);
    expect(repeat.duplicate).toBe(true); expect(signals).toHaveLength(1);
    const nextText = 'Find GitHub repositories for browser automation';
    const nextEnvelope = await createTurnEnvelopeAsync({ rawText: nextText, conversationId, source: first.source });
    await turnLifecycle.submit({ ...first, text: nextText, envelope: nextEnvelope }, sink);
    expect(signals).toHaveLength(2); expect(signals[0].aborted).toBe(true); expect(signals[1].aborted).toBe(false);
    expect(milestones).not.toHaveBeenCalled();
    turnLifecycle.cancelAutonomousGoals(conversationId);
    expect(signals[1].aborted).toBe(true);
    await turnLifecycle.waitForAutonomousGoals(conversationId);
  });
  it('retains latency requirements when the user adds website tools, without inheriting a cancelled goal', () => {
    const active = { originalUserInput: 'Search GitHub repositories to improve response latency', status: 'EXECUTING' };
    const text = 'And tools for reading websites and clicking';
    expect(researchFollowup(text, active)).toContain(active.originalUserInput);
    expect(researchFollowup(text, active)).toContain(text);
    expect(researchFollowup(text, { ...active, status: 'CANCELLED' })).toBeNull();
    expect(researchFollowup('Open Telegram', active)).toBeNull();
    expect(researchFollowup('Stop', active)).toBeNull();
    const queries = searchQueries(specification('Search for the GitHub repository to make the latency of the response fast. And tools for reading websites and clicking.'));
    expect(queries.every(q => q.startsWith('browser '))).toBe(true);
    expect(queries.some(q => q.includes('"browser automation"'))).toBe(true);
    expect(queries.some(q => q.includes('"content extraction"'))).toBe(true);
  });
  it('a late drain callback never speaks over newly started microphone input', async () => {
    let busy = true; const spoken = vi.fn(async () => {});
    speechArbiter.register({ speakFn: spoken, getCurrentTurnId: () => 1, isUserTurnActive: () => busy });
    await speechArbiter.request({ text: 'Research result', priority: SpeechPriority.P2_PROGRESS,
      goalSignal: new AbortController().signal, responseType: 'goal_result' });
    await speechArbiter.onUserTurnComplete(); expect(spoken).not.toHaveBeenCalled();
    busy = false; await speechArbiter.onUserTurnComplete(); expect(spoken).toHaveBeenCalledOnce();
  });
});
