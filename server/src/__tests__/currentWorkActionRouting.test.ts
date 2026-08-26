// currentWorkActionRouting.test.ts — regression: an explicit action/execution
// clause must take precedence over a current-work context question.
import { describe, it, expect } from 'vitest';
import { isCurrentWorkQuestion, hasActionClause } from '../domains/jarvis/currentWorkContext.js';

describe('hasActionClause', () => {
  it.each([
    'Fix it.',
    'fix the restart recovery bug',
    'implement the feature',
    'build the module',
    'execute the plan',
    'delegate to CodeX',
    'run the test',
    'test the component',
    'deploy to staging',
    'create a task',
    'have Hermes plan it',
    'have CodeX execute it',
    'continue working on AgenticOS',
    'continue the implementation',
    'inspect the current issue and fix it',
    'find the bug and fix it',
    'proceed with the next step',
  ])('detects action: %s', (q) => {
    expect(hasActionClause(q)).toBe(true);
  });

  it.each([
    'What am I working on?',
    'What was the last completed task?',
    'What failed most recently?',
    'Which project is active?',
    'What should we do next?',
    "What's the current task?",
    'Tell me about Hermes.',
  ])('no action clause in: %s', (q) => {
    expect(hasActionClause(q)).toBe(false);
  });
});

describe('action clause overrides current-work context', () => {
  it.each([
    'What failed last? Fix it.',
    'What should we do next? Have Hermes plan it and CodeX execute it.',
    'Continue AgenticOS implementation.',
    'Inspect the current issue and fix it.',
    'What is the current problem? Fix it.',
    'Check what is broken now and have Hermes delegate the fix to CodeX.',
    'What are we currently working on, and can you implement the next module?',
  ])('action wins over current-work: %s', (q) => {
    expect(isCurrentWorkQuestion(q)).toBe(false);
  });

  it.each([
    'What am I working on?',
    'What was the last completed task?',
    'What failed most recently?',
    'Which project is active?',
    'What should we do next?',
    'What are we currently working on?',
  ])('pure current-work question stays current-work: %s', (q) => {
    expect(isCurrentWorkQuestion(q)).toBe(true);
  });
});
