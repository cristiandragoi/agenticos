import { describe, it, expect } from 'vitest';
import { detectsCodexDelegation } from '../services/backgroundTasks/adapters.js';
import { classifyTaskControl } from '../services/backgroundTasks/taskControl.js';

/**
 * Phase 8 — the routing heuristic that decides whether a Hermes background
 * task must bridge to the in-repo CodeX runtime instead of the external
 * Hermes One (which would spawn the external codex CLI).
 */
describe('detectsCodexDelegation — Phase 8 routing heuristic', () => {
  it('true when the objective names CodeX + a code-work verb', () => {
    expect(detectsCodexDelegation('Ask Hermes to plan, then delegate to CodeX to inspect and edit adapters.ts')).toBe(true);
    expect(detectsCodexDelegation('use CodeX to add a test and run vitest')).toBe(true);
    expect(detectsCodexDelegation('have CodeX implement the fix and build')).toBe(true);
  });

  it('false when CodeX is named but no code-work verb', () => {
    expect(detectsCodexDelegation('what is CodeX doing')).toBe(false);
    expect(detectsCodexDelegation('show me the CodeX status')).toBe(false);
  });

  it('false when a work verb is present but CodeX is not named', () => {
    expect(detectsCodexDelegation('inspect the restart recovery implementation')).toBe(false);
    expect(detectsCodexDelegation('add a regression test for reconciliation')).toBe(false);
  });

  it('false for pure Hermes research', () => {
    expect(detectsCodexDelegation('Ask Hermes to research the SME market')).toBe(false);
    expect(detectsCodexDelegation('Hermes, summarize the pipeline')).toBe(false);
  });

  it('classifyTaskControl returns null for a plain greeting', () => {
    expect(classifyTaskControl('hello world')).toBeNull();
  });
});
