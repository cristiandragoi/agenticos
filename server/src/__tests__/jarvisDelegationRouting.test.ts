// jarvisDelegationRouting.test.ts — regression: a Hermes task that explicitly
// asks Jarvis to delegate implementation to CodeX must be detected as CodeX
// delegation (so the canonical in-repo CodeX executes real work), never routed
// to the plain Hermes path that returns only a plan.
import { describe, it, expect } from 'vitest';
import { detectsCodexDelegation } from '../services/backgroundTasks/adapters';

describe('detectsCodexDelegation (Jarvis → Hermes → CodeX routing)', () => {
  it('detects the exact reproduction prompt (delegate implementation to CodeX)', () => {
    const prompt = 'Ask Hermes to inspect the current Agentic OS repository, choose one small safe code-quality improvement, delegate the implementation to CodeX, have CodeX run the relevant targeted test, and return the real result to me.';
    expect(detectsCodexDelegation(prompt)).toBe(true);
  });

  it('detects "have CodeX run the test" phrasing', () => {
    expect(detectsCodexDelegation('inspect adapters.ts and have CodeX run the targeted test')).toBe(true);
  });

  it('does NOT detect a pure Hermes research request (no CodeX)', () => {
    expect(detectsCodexDelegation('Ask Hermes to explain how the scheduler works')).toBe(false);
  });

  it('does NOT detect a greeting', () => {
    expect(detectsCodexDelegation('hello there')).toBe(false);
  });
});
