import { describe, it, expect } from 'vitest';
import { speechArbiter, SpeechPriority } from '../domains/jarvisNext/speechArbiter.js';
import { beginBackgroundOperation, cancelOperation, guardExternalSideEffect, noteConversationTurn, USER_TURN_POLICY } from '../domains/jarvis/perception/perceptionOperation.js';

describe('accepted goal lifetime and speech ownership', () => {
  it('preserves final speech across newer voice turns and queue pressure', async () => {
    let turn = 1;
    let busy = true;
    const spoken: string[] = [];
    speechArbiter.register({ speakFn: async text => { spoken.push(text); },
      getCurrentTurnId: () => turn, isUserTurnActive: () => busy });
    const controller = new AbortController();
    const request = (text: string, responseType: string) => speechArbiter.request({ text,
      priority: SpeechPriority.P2_PROGRESS, turnId: 1, goalSignal: controller.signal, responseType });
    await request('Opening Telegram.', 'goal_progress');
    await request('Reading the messages.', 'goal_progress');
    await request('Verified final messages.', 'goal_result');
    expect(speechArbiter.snapshot().queueDepth).toBe(1);
    turn = 2;
    speechArbiter.flush(true);
    for (let i = 0; i < 5; i++) await speechArbiter.request({ text: `Other update ${i}`, priority: SpeechPriority.P2_PROGRESS });
    busy = false;
    await speechArbiter.onUserTurnComplete();
    expect(spoken).toContain('Verified final messages.');
    speechArbiter.flush();
  });

  it('user cancellation suppresses queued goal speech', async () => {
    const spoken: string[] = [];
    speechArbiter.register({ speakFn: async text => { spoken.push(text); },
      getCurrentTurnId: () => 3, isUserTurnActive: () => true });
    const controller = new AbortController();
    await speechArbiter.request({ text: 'A late result.', priority: SpeechPriority.P2_PROGRESS,
      goalSignal: controller.signal, responseType: 'goal_result' });
    controller.abort('user_stop');
    await speechArbiter.onUserTurnComplete();
    expect(spoken).toEqual([]);
  });

  it('goal desktop ownership survives supersession but explicit cancellation closes the gate', () => {
    const op = beginBackgroundOperation({ origin: 'autonomous_goal', capability: 'autonomous_goal',
      conversationId: 'goal-ownership-test', policy: USER_TURN_POLICY });
    noteConversationTurn(op.conversationId, 100);
    const input = { ...op, capability: 'gui_launch' };
    expect(guardExternalSideEffect(input).ok).toBe(true);
    cancelOperation(op, 'user_stop');
    expect(guardExternalSideEffect(input).ok).toBe(false);
  });
});
