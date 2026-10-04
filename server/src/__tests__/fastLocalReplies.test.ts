import { describe, it, expect } from 'vitest';
import {
  detectPresencePrompt,
  detectDirectLocalQuestion,
  detectLocalFastReply,
} from '../domains/jarvis/fastLocalReplies.js';

describe('fastLocalReplies — presence fast path (R5 + P0 expansion)', () => {
  it('detects presence prompts and returns a short grounded ack', () => {
    for (const p of [
      'Jarvis, are you there?',
      'are you there',
      'Are you here?',
      'you there',
      'Jarvis?',
      'Hey Jarvis',
      'Jarvis',
      'can you hear me',
    ]) {
      const r = detectPresencePrompt(p);
      expect(r, `should detect: ${p}`).not.toBeNull();
      expect(r!.reply.length).toBeGreaterThan(3);
    }
  });

  it('P0: detects "Still there?" and bare greetings/pauses that previously fell through to investigate', () => {
    for (const p of [
      'Still there?',
      'still there',
      'are you still there',
      'Hello?',
      'Hello',
      'Hi',
      'Hey',
      'Hey there',
      'Wait.',
      'Wait',
      'One second.',
      'hold on',
      'Okay.',
      'okay',
      'Yo',
    ]) {
      const r = detectPresencePrompt(p);
      expect(r, `should detect: ${p}`).not.toBeNull();
      expect(r!.reply.length).toBeGreaterThan(3);
    }
  });

  it('P0: does NOT misread task-bearing continuations as bare presence', () => {
    for (const p of [
      'Okay, fix it.',
      'Okay fix it',
      'Wait, don\'t change anything yet.',
      'Do it.',
      'Fix it.',
      'Continue.',
      'Check it again.',
      'One second, let me explain the problem.',
      'Hello, can you fix the bug?',
    ]) {
      expect(detectPresencePrompt(p), `should NOT detect as bare presence: ${p}`).toBeNull();
    }
  });

  it('does NOT treat substantive queries as presence', () => {
    for (const p of [
      'Jarvis, what does Hermes do?',
      'are you sure about that',
      'explain the architecture',
      'what is agentic os',
    ]) {
      expect(detectPresencePrompt(p), `should NOT detect: ${p}`).toBeNull();
    }
  });

  it('greets time-aware on fresh turns and avoids repeating on continuing turns', () => {
    const fresh = detectPresencePrompt('Good evening, Jarvis.', { isContinuing: false });
    expect(fresh).not.toBeNull();
    expect(fresh!.reply).toMatch(/Good (morning|afternoon|evening), Christian\./);

    const continuing = detectPresencePrompt('Good evening, Jarvis.', { isContinuing: true });
    expect(continuing).not.toBeNull();
    expect(continuing!.reply).toBe("I'm here.");
  });
});

describe('fastLocalReplies — direct local knowledge (R6/R7)', () => {
  it('answers "What is Jarvis?" with grounded local identity (no invented OS)', () => {
    const r = detectDirectLocalQuestion('What is Jarvis?');
    expect(r).not.toBeNull();
    expect(r!.reply).toContain('Agentic OS');
    expect(r!.reply).toContain('Hermes');
    expect(r!.reply.toLowerCase()).not.toContain('linux');
  });

  it('answers "What is Agentic OS?" / Agenticos transcription variants', () => {
    for (const p of [
      'what is agentic os',
      'What is Agenticos?',
      'what is argentic os',
      'what is authentic os',
    ]) {
      const r = detectDirectLocalQuestion(p);
      expect(r, `should answer: ${p}`).not.toBeNull();
      expect(r!.reply).toContain('Agentic OS');
    }
  });

  it('answers "What does Jarvis do?" without a worker chain', () => {
    const r = detectDirectLocalQuestion('What does Jarvis do?');
    expect(r).not.toBeNull();
    expect(r!.reply).toContain('coordinate');
  });

  it('does NOT hijack unrelated questions', () => {
    for (const p of [
      'what is the weather today',
      'what is 2+2',
      'tell me about quantum computing',
    ]) {
      expect(detectLocalFastReply(p), `should not fast-reply: ${p}`).toBeNull();
    }
  });

  it('unified entry returns presence first', () => {
    expect(detectLocalFastReply('Jarvis, are you there?')).not.toBeNull();
    expect(detectLocalFastReply('Still there?')).not.toBeNull();
    expect(detectLocalFastReply('what is jarvis')?.reply).toContain('Agentic OS');
  });
});
