import { describe, it, expect } from 'vitest';
import {
  isCurrentWorkQuestion,
  formatCurrentWorkContext,
  type CurrentWorkContext,
} from '../domains/jarvis/currentWorkContext.js';

const EMPTY: CurrentWorkContext = {
  activeProject: null,
  activeExecution: null,
  latestCompletedTask: null,
  latestHermesRun: null,
  latestCodeXRun: null,
  pendingApproval: null,
  latestFailure: null,
  queuedCount: 0,
  runningCount: 0,
  nextPlannedAction: null,
};

describe('isCurrentWorkQuestion (semantic family, not exact phrases)', () => {
  it.each([
    'What are we currently working on?',
    'What are we working on?',
    "What's the current task?",
    'What is the current project?',
    'Where did we leave off?',
    'What did Hermes just finish?',
    'What did CodeX just complete?',
    "What's still pending?",
    'What is pending?',
    'What should we do next?',
    "What's up next?",
    'What is the current milestone?',
    'What failed?',
    'What are we waiting for?',
    'What are we waiting on?',
    'Which task are we on right now?',
  ])('detects: %s', (q) => {
    expect(isCurrentWorkQuestion(q)).toBe(true);
  });

  it.each([
    'Jarvis, are you there?',
    'What is Jarvis?',
    'What is Agentic OS?',
    'What are you doing?',
    'What are you doing right now?',
    'Is it stuck?',
    'Tell me about Hermes.',
    'Open the projects page.',
    'Stop.',
  ])('does NOT hijack: %s', (q) => {
    expect(isCurrentWorkQuestion(q)).toBe(false);
  });
});

describe('formatCurrentWorkContext (data-derived, honest)', () => {
  it('says it cannot determine when no authoritative state exists', () => {
    const reply = formatCurrentWorkContext(EMPTY);
    expect(reply).toContain("can't determine the current task");
    expect(reply).toContain('no active project');
  });

  it('reports the active project and live execution', () => {
    const reply = formatCurrentWorkContext({
      ...EMPTY,
      activeProject: { id: 'proj-1', name: 'Jewelry Store' },
      activeExecution: {
        worker: 'codex',
        status: 'RUNNING',
        currentAction: 'Implementing product grid',
        provider: 'openrouter',
        model: 'poolside/laguna-s-2.1:free',
        startedAt: Date.now(),
      },
    });
    expect(reply).toContain('"Jewelry Store"');
    expect(reply).toContain('CodeX is currently running');
    expect(reply).toContain('Implementing product grid');
  });

  it('reports pending approval and latest failure', () => {
    const reply = formatCurrentWorkContext({
      ...EMPTY,
      pendingApproval: { title: 'Deploy to production', taskId: 'T-101' },
      latestFailure: { title: 'Run smoke tests', status: 'failed', worker: 'hermes', updatedAt: new Date().toISOString() },
    });
    expect(reply).toContain('Waiting on your approval');
    expect(reply).toContain('"Deploy to production"');
    expect(reply).toContain('most recent failure');
    expect(reply).toContain('"Run smoke tests"');
  });

  it('reports latest completed task and next scheduled action', () => {
    const reply = formatCurrentWorkContext({
      ...EMPTY,
      latestCompletedTask: { title: 'Recruiting pipeline audit', worker: 'hermes', completedAt: new Date().toISOString() },
      nextPlannedAction: { title: 'Shopify sync', nextRunAt: new Date(Date.now() + 3600000).toISOString() },
    });
    expect(reply).toContain('"Recruiting pipeline audit"');
    expect(reply).toContain('by hermes');
    expect(reply).toContain('Next scheduled action');
    expect(reply).toContain('"Shopify sync"');
  });

  it('answer derives from supplied state — no canned project status', () => {
    // The SAME question phrasing answered from DIFFERENT state must produce
    // DIFFERENT answers (proves no phrase-specific canned response).
    const a = formatCurrentWorkContext({
      ...EMPTY,
      activeProject: { id: 'p1', name: 'Recruiting' },
      activeExecution: { worker: 'hermes', status: 'RUNNING', currentAction: 'Sourcing candidates', provider: null, model: null, startedAt: Date.now() },
    });
    const b = formatCurrentWorkContext({
      ...EMPTY,
      activeProject: { id: 'p2', name: 'Website Redesign' },
      activeExecution: { worker: 'codex', status: 'COMPLETING', currentAction: 'Finalizing layout', provider: null, model: null, startedAt: Date.now() },
    });
    expect(a).toContain('"Recruiting"');
    expect(b).toContain('"Website Redesign"');
    expect(a).not.toBe(b);
  });
});
