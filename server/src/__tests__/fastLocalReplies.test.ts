import { describe, it, expect } from 'vitest';
import {
  detectPresencePrompt,
  detectDirectLocalQuestion,
  detectLocalFastReply,
} from '../domains/jarvis/fastLocalReplies.js';

describe('fastLocalReplies — presence fast path (R5)', () => {
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
      expect(r!.reply).toBe("Yes, I'm here.");
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
    expect(detectLocalFastReply('Jarvis, are you there?')?.reply).toBe("Yes, I'm here.");
    expect(detectLocalFastReply('what is jarvis')?.reply).toContain('Agentic OS');
  });
});
