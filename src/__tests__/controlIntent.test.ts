import { describe, it, expect } from 'vitest';
import { detectControlIntent, isStandaloneWake, normalizeForControl } from '../lib/controlIntent';
import { normalizeDomainTerms } from '../lib/domainNormalization';

/**
 * controlIntent.test.ts — Phase 11 tests for the LOCAL control-intent layer
 * and Agentic-OS domain grounding. These are pure/unit tests (no mocks).
 */

describe('detectControlIntent — stop phrases', () => {
  const stops = [
    'stop',
    'Jarvis stop',
    'Jarvis, stop',
    'Jarvis, stop.',
    'jarvis stop',
    'stop talking',
    'stop speaking',
    'be quiet',
    'cancel',
    'cancel that',
    'never mind',
    'nevermind',
    'shut up',
    'Jarvis, please stop',
    'hey jarvis, stop',
  ];
  for (const t of stops) {
    it(`detects "${t}" as STOP`, () => {
      const c = detectControlIntent(t);
      expect(c).not.toBeNull();
      expect(c!.kind).toBe('stop');
    });
  }

  it('does NOT detect a normal conversational sentence as stop', () => {
    expect(detectControlIntent('stop the build for the new feature')).toBeNull();
    expect(detectControlIntent('what is the stop loss')).toBeNull();
    expect(detectControlIntent('tell me about Agentic OS')).toBeNull();
  });
});

describe('detectControlIntent — terminate phrases', () => {
  const terms = [
    'terminate',
    'terminate discussion',
    'Jarvis, terminate discussion',
    'terminate the discussion',
    'end discussion',
    'end conversation',
    'Jarvis, end this',
    'close the discussion',
    "we're done",
    "that's all",
  ];
  for (const t of terms) {
    it(`detects "${t}" as TERMINATE`, () => {
      const c = detectControlIntent(t);
      expect(c).not.toBeNull();
      expect(c!.kind).toBe('terminate');
    });
  }
});

describe('isStandaloneWake', () => {
  it('"Jarvis" alone is a wake term (no substantive query)', () => {
    expect(isStandaloneWake('Jarvis')).toBe(true);
    expect(isStandaloneWake('Jarvis.')).toBe(true);
    expect(isStandaloneWake('hey jarvis')).toBe(true);
  });

  it('"Jarvis explain X" is NOT standalone', () => {
    expect(isStandaloneWake('Jarvis explain the architecture')).toBe(false);
  });
});

describe('normalizeForControl', () => {
  it('normalizes casing + punctuation + wake prefixes', () => {
    expect(normalizeForControl('Jarvis, STOP.')).toBe('stop');
    expect(normalizeForControl('  Jarvis,, terminate discussion!!')).toBe('terminate discussion');
  });
});

describe('normalizeDomainTerms — Agentic OS grounding', () => {
  it('normalizes "Authentic OS" in a project context', () => {
    expect(normalizeDomainTerms('Explain the Authentic OS architecture')).toContain('Agentic OS');
    expect(normalizeDomainTerms('Explain the Authentic OS architecture')).not.toContain('Authentic OS');
  });

  it('normalizes "Argentic OS" + "Agenticos" in a project context', () => {
    expect(normalizeDomainTerms('Explain the Argentic OS architecture')).toContain('Agentic OS');
    expect(normalizeDomainTerms('What is Agenticos')).toContain('Agentic OS');
  });

  it('does NOT rewrite "Authentic OS" without a project-context signal', () => {
    expect(normalizeDomainTerms('I like authentic os design')).not.toContain('Agentic OS');
    // No project-context signal ("tell me about ... in general") → unchanged.
    const out = normalizeDomainTerms('tell me about authentic operating systems in general');
    expect(out).not.toContain('Agentic OS');
    expect(out.toLowerCase()).toContain('authentic');
  });
});
