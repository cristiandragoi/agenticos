import { describe, it, expect } from 'vitest';
import { stripWakeWord } from '../domains/jarvisNext/wakeWord.js';

describe('Conversational Preamble and Correction Normalization', () => {
  it('strips "Come on, open YouTube."', () => {
    const res = stripWakeWord('Come on, open YouTube.');
    expect(res.wakeWordDetected).toBe(true);
    expect(res.commandText).toBe('open YouTube.');
  });

  it('strips "Come on Jarvis, open YouTube."', () => {
    const res = stripWakeWord('Come on Jarvis, open YouTube.');
    expect(res.wakeWordDetected).toBe(true);
    expect(res.commandText).toBe('open YouTube.');
  });

  it('strips "No, you didn\'t open it. Open YouTube."', () => {
    const res = stripWakeWord("No, you didn't open it. Open YouTube.");
    expect(res.wakeWordDetected).toBe(true);
    expect(res.commandText).toBe('Open YouTube.');
  });

  it('strips "No, you did not open it. Open YouTube."', () => {
    const res = stripWakeWord('No, you did not open it. Open YouTube.');
    expect(res.wakeWordDetected).toBe(true);
    expect(res.commandText).toBe('Open YouTube.');
  });

  it('preserves clean commands: "Jarvis, open YouTube."', () => {
    const res = stripWakeWord('Jarvis, open YouTube.');
    expect(res.wakeWordDetected).toBe(true);
    expect(res.commandText).toBe('open YouTube.');
  });
});
