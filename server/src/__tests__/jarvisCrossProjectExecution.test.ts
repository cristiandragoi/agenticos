/**
 * jarvisCrossProjectExecution.test.ts — P0: a state change must NEVER run against
 * a project the user did not ask for.
 *
 * The live defect: `"start the project shop by."` (STT for Shopify) operated the
 * stale active project (Free Cash) because the operate branch treated an entity
 * INHERITED from conversation focus exactly like an explicit mention, and had a
 * hardcoded `|| 'proj-free-cash'` fallback.
 *
 * Two boundaries are locked down here:
 *   1. entity resolution — the near-miss "shop by" -> Shopify (without matching
 *      unrelated text)
 *   2. state-changing target selection — explicit wins, continuation is allowed,
 *      an unmatched mention ABORTS instead of executing
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolveStateChangingTarget, residualMention } from '../domains/jarvisNext/turnRouter.js';
import { ProjectEntityProvider } from '../domains/jarvis/entityProviders/project.js';
import { healthSnapshot, resetHealthCounters } from '../domains/jarvisNext/jarvisHealth.js';
import { operateProject } from '../services/projectExecution/projectController.js';
import { backgroundTaskManager } from '../services/backgroundTasks/manager.js';

describe('P0 — state-changing target resolution', () => {
  beforeEach(() => resetHealthCounters());
  afterEach(() => vi.restoreAllMocks());

  it('the live failure: an INHERITED Free Cash entity must not drive an operate', () => {
    const t = resolveStateChangingTarget({
      explicitProjectId: 'proj-free-cash',      // inherited from focus
      entityId: 'proj-free-cash',
      entityType: 'project',                     // ...still reported as a project
      projectScopeSource: 'conversation',        // <-- the missing signal
      lower: 'start the project shop by.',
      activeProjectId: 'proj-free-cash',
      activeProjectName: 'Free Cash',
    });
    expect(t.projectId).toBeUndefined();
    expect(t.reason).toBe('unmatched_mention');
    expect(healthSnapshot().counters.cross_project_execution_blocked).toBe(1);
  });

  it('an explicit entity always wins over stale context', () => {
    const t = resolveStateChangingTarget({
      explicitProjectId: 'proj-shopify',
      entityType: 'project',
      projectScopeSource: 'explicit',
      lower: 'start the shopify project',
      activeProjectId: 'proj-free-cash',        // stale
      activeProjectName: 'Free Cash',
    });
    expect(t.projectId).toBe('proj-shopify');
    expect(t.reason).toBe('explicit');
    expect(healthSnapshot().counters.cross_project_execution_blocked ?? 0).toBe(0);
  });

  it('a genuine continuation may use the conversation entity', () => {
    const cont = resolveStateChangingTarget({
      entityType: 'project', projectScopeSource: 'conversation',
      lower: 'continue', activeProjectId: 'proj-free-cash', activeProjectName: 'Free Cash',
    });
    expect(cont.projectId).toBe('proj-free-cash');
    expect(cont.reason).toBe('continuation');

    const it2 = resolveStateChangingTarget({
      entityType: 'project', projectScopeSource: 'conversation',
      lower: 'start it', activeProjectId: 'proj-tiktok-shop',
    });
    expect(it2.projectId).toBe('proj-tiktok-shop');
  });

  it('an unmatched mention aborts without touching the active project', () => {
    const t = resolveStateChangingTarget({
      lower: 'start the wobble project',
      activeProjectId: 'proj-free-cash', activeProjectName: 'Free Cash',
    });
    expect(t.projectId).toBeUndefined();
    expect(t.ask).toMatch(/couldn't match/i);
    expect(t.ask).toMatch(/wobble/i);
  });

  it('a bare operate with no context asks instead of guessing', () => {
    const t = resolveStateChangingTarget({ lower: 'start the project' });
    expect(t.projectId).toBeUndefined();
    expect(t.reason).toBe('no_project_context');
  });

  it('worker names are not mistaken for project mentions', () => {
    expect(residualMention('start codex')).toBe('');
    expect(residualMention('continue')).toBe('');
    expect(residualMention('start the project')).toBe('');
    expect(residualMention('start the project shop by')).toBe('shop by');
  });
});

describe('P0 — near-miss entity resolution', () => {
  const PROJECTS = [
    { id: 'proj-free-cash', name: 'Free Cash' },
    { id: 'proj-shopify', name: 'Shopify' },
    { id: 'proj-tiktok-shop', name: 'TikTok Shop' },
  ];
  beforeEach(async () => {
    const { projectsStore } = await import('../services/projectsStore.js');
    vi.spyOn(projectsStore, 'listProjects').mockImplementation(() => PROJECTS as any);
  });
  afterEach(() => vi.restoreAllMocks());

  it('resolves the STT split "shop by" to Shopify', () => {
    const e = ProjectEntityProvider.resolve('start the project shop by.');
    expect(e?.id).toBe('proj-shopify');
  });

  it('still resolves exact names', () => {
    expect(ProjectEntityProvider.resolve('start the project free cash.')?.id).toBe('proj-free-cash');
    expect(ProjectEntityProvider.resolve('start the tiktok shop project.')?.id).toBe('proj-tiktok-shop');
  });

  it('does not invent a project from unrelated text', () => {
    expect(ProjectEntityProvider.resolve('what is blocked?')).toBeNull();
    expect(ProjectEntityProvider.resolve('start the wobble project')).toBeNull();
    expect(ProjectEntityProvider.resolve('tell me about the weather')).toBeNull();
  });
});

describe('P0 — cross-project claim gate in operateProject', () => {
  afterEach(() => vi.restoreAllMocks());

  it('refuses a foreign queued task handed back by the store', async () => {
    resetHealthCounters();
    const { projectsStore } = await import('../services/projectsStore.js');
    vi.spyOn(projectsStore, 'getProject').mockImplementation((id: string) => (
      id === 'proj-shopify' ? ({ id: 'proj-shopify', name: 'Shopify', status: 'active' } as any) : (undefined as any)
    ));
    vi.spyOn(projectsStore, 'updateProject').mockImplementation(() => (undefined as any));
    vi.spyOn(projectsStore, 'setActiveProjectId').mockImplementation(() => (undefined as any));
    vi.spyOn(backgroundTaskManager, 'listTasks').mockImplementation((filter?: any) => {
      // The store misbehaves: a Free Cash task is offered for a Shopify operate.
      if (filter && filter.projectId === 'proj-shopify') {
        return ([{
          taskId: 'bgtask-foreign-1', title: 'Revenue Operator: Free Cash Mission (retry)',
          status: 'queued', projectId: 'proj-free-cash', worker: 'revenue', route: 'revenue_operator',
        }] as any);
      }
      return ([] as any);
    });
    const outcome = await operateProject({ projectId: 'proj-shopify' });
    expect(outcome.tasksStarted).toEqual([]);
    expect(healthSnapshot().counters.cross_project_execution_blocked).toBeGreaterThan(0);
  }, 30000);
});
