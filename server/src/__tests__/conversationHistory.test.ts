import { describe, expect, it } from 'vitest';
import { buildConversationHistory } from '../routers/jarvis.js';

describe('buildConversationHistory (runtime root-cause fix)', () => {
  const messages = [
    { role: 'user', content: 'My favorite color is teal. Please remember that for this conversation.' },
    { role: 'agent', content: 'Got it — teal is noted.' },
    { role: 'system', messageType: 'routing_event', content: 'Intent routed to DIRECT (55%)' },
    { role: 'user', content: 'What is my favorite color?' }, // current prompt
  ];

  it('excludes the current prompt, routing events and system rows', () => {
    const h = buildConversationHistory(messages, 'What is my favorite color?');
    expect(h.some((m) => m.content.includes('favorite color?'))).toBe(false);
    expect(h.some((m) => m.content.includes('Intent routed'))).toBe(false);
  });

  it('maps agent -> assistant and preserves order', () => {
    const h = buildConversationHistory(messages, 'What is my favorite color?');
    expect(h).toEqual([
      { role: 'user', content: 'My favorite color is teal. Please remember that for this conversation.' },
      { role: 'assistant', content: 'Got it — teal is noted.' },
    ]);
  });

  it('bounds the window to maxTurns and maxChars', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ role: (i % 2 === 0 ? 'user' : 'agent') as 'user' | 'agent', content: `turn ${i} ` + 'x'.repeat(50) }));
    many.push({ role: 'user', content: 'current' });
    const h = buildConversationHistory(many, 'current', 12, 5000);
    expect(h.length).toBeLessThanOrEqual(12);
    const total = h.reduce((s, m) => s + m.content.length, 0);
    expect(total).toBeLessThanOrEqual(5000);
  });

  it('returns empty for empty or non-array input', () => {
    expect(buildConversationHistory([], 'x')).toEqual([]);
    expect(buildConversationHistory(null as any, 'x')).toEqual([]);
  });
});
