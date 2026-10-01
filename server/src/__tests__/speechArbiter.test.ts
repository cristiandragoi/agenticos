import { describe, it, expect, vi, beforeEach } from 'vitest';
import { speechArbiter, SpeechPriority } from '../domains/jarvisNext/speechArbiter.js';

describe('SpeechArbiter — Single Voice Output Authority', () => {
  let speakFn: any;
  let getCurrentTurnId: any;
  let isUserTurnActive: any;
  let turnId = 1;
  let userTurnActive = false;

  beforeEach(() => {
    vi.clearAllMocks();
    turnId = 1;
    userTurnActive = false;
    speakFn = vi.fn().mockResolvedValue(undefined);
    getCurrentTurnId = vi.fn(() => turnId);
    isUserTurnActive = vi.fn(() => userTurnActive);

    speechArbiter.flush();
    speechArbiter.register({
      speakFn,
      getCurrentTurnId,
      isUserTurnActive,
    });
  });

  it('reports registered and empty queue in snapshot', () => {
    const snap = speechArbiter.snapshot();
    expect(snap.registered).toBe(true);
    expect(snap.queueDepth).toBe(0);
    expect(snap.foregroundActive).toBe(false);
  });

  it('drops empty or whitespace-only text', async () => {
    const res1 = await speechArbiter.request({ text: '', priority: SpeechPriority.P4_BACKGROUND });
    const res2 = await speechArbiter.request({ text: '   ', priority: SpeechPriority.P4_BACKGROUND });
    expect(res1).toBe(false);
    expect(res2).toBe(false);
    expect(speakFn).not.toHaveBeenCalled();
  });

  it('accepts P4 background speech when foreground is idle', async () => {
    const res = await speechArbiter.request({
      text: 'Background job complete.',
      priority: SpeechPriority.P4_BACKGROUND,
      source: 'test_worker',
    });
    expect(res).toBe(true);
    expect(speakFn).toHaveBeenCalledWith('Background job complete.', undefined);
  });

  it('drops P4/P5 background speech when foreground user turn is active', async () => {
    userTurnActive = true;
    const resP4 = await speechArbiter.request({
      text: 'Background update.',
      priority: SpeechPriority.P4_BACKGROUND,
      source: 'revenue_op',
    });
    const resP5 = await speechArbiter.request({
      text: 'Status tick.',
      priority: SpeechPriority.P5_STATUS,
      source: 'scheduler',
    });
    expect(resP4).toBe(false);
    expect(resP5).toBe(false);
    expect(speakFn).not.toHaveBeenCalled();
  });

  it('queues P2 and P3 requests when foreground user turn is active', async () => {
    userTurnActive = true;
    const resP3 = await speechArbiter.request({
      text: 'Approval needed for payment.',
      priority: SpeechPriority.P3_APPROVAL,
      source: 'approval_gate',
    });
    const resP2 = await speechArbiter.request({
      text: 'Search progress update.',
      priority: SpeechPriority.P2_PROGRESS,
      source: 'hermes',
    });
    expect(resP3).toBe(true);
    expect(resP2).toBe(true);
    expect(speakFn).not.toHaveBeenCalled();
    expect(speechArbiter.snapshot().queueDepth).toBe(2);

    // Turn completes -> drains highest priority first (P2 before P3)
    userTurnActive = false;
    await speechArbiter.onUserTurnComplete();
    expect(speakFn).toHaveBeenCalledTimes(1);
    expect(speakFn).toHaveBeenCalledWith('Search progress update.', undefined);
    expect(speechArbiter.snapshot().queueDepth).toBe(1);

    // Drain second item
    await speechArbiter.onUserTurnComplete();
    expect(speakFn).toHaveBeenCalledTimes(2);
    expect(speakFn).toHaveBeenLastCalledWith('Approval needed for payment.', undefined);
    expect(speechArbiter.snapshot().queueDepth).toBe(0);
  });

  it('drops stale requests carrying non-matching turnId', async () => {
    turnId = 5;
    const res = await speechArbiter.request({
      text: 'Old response from superseded turn',
      priority: SpeechPriority.P4_BACKGROUND,
      turnId: 3, // Stale! Current is 5
      source: 'hermes',
    });
    expect(res).toBe(false);
    expect(speakFn).not.toHaveBeenCalled();
  });

  it('flushes queue on demand', async () => {
    userTurnActive = true;
    await speechArbiter.request({ text: 'Msg 1', priority: SpeechPriority.P2_PROGRESS });
    await speechArbiter.request({ text: 'Msg 2', priority: SpeechPriority.P3_APPROVAL });
    expect(speechArbiter.snapshot().queueDepth).toBe(2);
    speechArbiter.flush();
    expect(speechArbiter.snapshot().queueDepth).toBe(0);
  });

  it('rate-limits simultaneous background completions to prevent stream of unsolicited messages', async () => {
    const res1 = await speechArbiter.request({ text: 'Task 1 complete', priority: SpeechPriority.P4_BACKGROUND });
    const res2 = await speechArbiter.request({ text: 'Task 2 complete', priority: SpeechPriority.P4_BACKGROUND });
    const res3 = await speechArbiter.request({ text: 'Task 3 complete', priority: SpeechPriority.P4_BACKGROUND });
    expect(res1).toBe(true);
    expect(res2).toBe(false); // Rate-limited
    expect(res3).toBe(false); // Rate-limited
    expect(speakFn).toHaveBeenCalledTimes(1);
  });

  it('drops P4/P5 speech if assistant is already speaking', async () => {
    let assistantSpeaking = true;
    speechArbiter.register({
      speakFn,
      getCurrentTurnId,
      isUserTurnActive,
      isSpeaking: () => assistantSpeaking,
    });
    const res = await speechArbiter.request({ text: 'Background notification', priority: SpeechPriority.P4_BACKGROUND });
    expect(res).toBe(false);
    expect(speakFn).not.toHaveBeenCalled();
  });
});
