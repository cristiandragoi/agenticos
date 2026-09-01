import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { backgroundTaskManager } from '../services/backgroundTasks/manager.js';
import { backgroundTaskRepo } from '../services/backgroundTasks/store.js';
import { dispatchAntigravityTask, clearAntigravityDispatchGuard } from '../services/backgroundTasks/antigravityAdapter.js';
import { antigravityProviderService } from '../services/antigravity/antigravityProviderService.js';
import { policyStore } from '../services/policy/policyStore.js';

describe('Antigravity Background Task Adapter & Approval Gate', () => {
  const testKey = 'AIzaSyTestKeyForAntigravityAdapterTest';

  beforeEach(async () => {
    await antigravityProviderService.saveApiKey(testKey);
  });

  afterEach(async () => {
    await antigravityProviderService.deleteApiKey();
    vi.restoreAllMocks();
  });

  it('1. Blocks execution when project policy forbids cloud transmission (localOnly)', async () => {
    vi.spyOn(policyStore, 'getPolicy').mockReturnValue({
      projectId: 'proj-local',
      privacy: 'secret',
      runtime: 'localOnly',
      cloudEscalation: 'forbidden',
    } as any);

    const { task } = backgroundTaskManager.createTask({
      title: 'Local task testing',
      objective: 'Do not send outside',
      originalRequest: 'Do not send outside',
      route: '/jarvis',
      selectedAgent: 'Jarvis',
      worker: 'antigravity',
      projectId: 'proj-local',
    });

    expect(task).toBeDefined();
    clearAntigravityDispatchGuard(task!.taskId);

    const res = await dispatchAntigravityTask(task!);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('Policy violation blocked');

    const updated = backgroundTaskRepo.getTask(task!.taskId);
    expect(updated?.status).toBe('blocked');
    expect(updated?.blocker).toContain('runtime=localOnly');
  });

  it('2. Enforces explicit approval before project files are sent externally', async () => {
    vi.spyOn(policyStore, 'getPolicy').mockReturnValue({
      projectId: 'proj-cloud',
      privacy: 'internal',
      runtime: 'hybrid',
      cloudEscalation: 'allowed',
    } as any);

    const { task } = backgroundTaskManager.createTask({
      title: 'Analyze codebase files',
      objective: 'Inspect project structure',
      originalRequest: 'Inspect project structure',
      route: '/jarvis',
      selectedAgent: 'Jarvis',
      worker: 'antigravity',
      projectId: 'proj-cloud',
      metadata: {
        files: ['package.json', 'README.md'],
      },
    });

    expect(task).toBeDefined();
    clearAntigravityDispatchGuard(task!.taskId);

    const res = await dispatchAntigravityTask(task!);
    expect(res.ok).toBe(true);

    const updated = backgroundTaskRepo.getTask(task!.taskId);
    // Task should be waiting for approval because files are attached
    expect(updated?.approvalState).toBe('pending');
    expect(updated?.status).toBe('waiting_approval');

    const events = backgroundTaskRepo.getEvents(task!.taskId);
    const hasApprovalEvt = events.some(e => e.kind === 'task.approval_requested');
    expect(hasApprovalEvt).toBe(true);
  });

  it('3. Executes read-only analysis and normalizes events on approved dispatch', async () => {
    vi.spyOn(policyStore, 'getPolicy').mockReturnValue({
      projectId: 'proj-cloud',
      privacy: 'public',
      runtime: 'cloudOnly',
      cloudEscalation: 'allowed',
    } as any);

    vi.spyOn(antigravityProviderService, 'executeReadOnlyRun').mockResolvedValue({
      text: '### Antigravity Analysis\nArchitecture is robust and modular.',
      usage: {
        promptTokens: 120,
        completionTokens: 80,
        totalTokens: 200,
        estimatedCostUsd: 0.000033,
      },
      model: 'gemini-2.5-flash',
      latencyMs: 142,
    });

    const { task } = backgroundTaskManager.createTask({
      title: 'Analyze architectural patterns',
      objective: 'Provide architectural recommendations',
      originalRequest: 'Provide architectural recommendations',
      route: '/jarvis',
      selectedAgent: 'Jarvis',
      worker: 'antigravity',
      projectId: 'proj-cloud',
    });

    expect(task).toBeDefined();
    clearAntigravityDispatchGuard(task!.taskId);

    const res = await dispatchAntigravityTask(task!);
    expect(res.ok).toBe(true);

    const updated = backgroundTaskRepo.getTask(task!.taskId);
    expect(updated?.status).toBe('completed');
    expect(updated?.resultText).toContain('Antigravity Analysis');
    expect(updated?.verificationState).toBe('passed');

    const events = backgroundTaskRepo.getEvents(task!.taskId);
    const eventKinds = events.map(e => e.kind);
    expect(eventKinds).toContain('task.agent_selected');
    expect(eventKinds).toContain('task.progress');
    expect(eventKinds).toContain('task.completed');
  });
});
