import { describe, expect, it } from 'vitest';
import { normalizeDomainTerms } from './domainNormalization';

describe('normalizeDomainTerms (STT variant normalization)', () => {
  it('normalizes "Agentic OS" variants in a project-context sentence', () => {
    expect(normalizeDomainTerms('Can you explain the Authentic OS architecture?')).toBe(
      'Can you explain the Agentic OS architecture?'
    );
    expect(normalizeDomainTerms('Tell me about our Agenticos project.')).toBe(
      'Tell me about our Agentic OS project.'
    );
  });

  it('leaves text unchanged when there is no project context', () => {
    const input = 'I really like the authentic os flavor of this coffee.';
    expect(normalizeDomainTerms(input)).toBe(input);
  });

  it('is idempotent: normalizing an already-normalized string returns it unchanged', () => {
    const input = 'Can you explain the Agentic OS architecture?';
    expect(normalizeDomainTerms(normalizeDomainTerms(input))).toBe(input);
  });
});
