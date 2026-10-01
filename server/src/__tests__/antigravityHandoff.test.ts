import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { backgroundTaskManager } from '../services/backgroundTasks/manager.js';
import { backgroundTaskRepo } from '../services/backgroundTasks/store.js';
import { execFileSync } from 'node:child_process';
import {
  dispatchAntigravityTask,
  clearAntigravityDispatchGuard,
  discoverAntigravityDesktopSession,
  antigravitySessionDiscoveryProvider,
  setExecFileSyncRunnerForTesting,
  resetAntigravityQueueForTesting,
} from '../services/backgroundTasks/antigravityAdapter.js';

describe('Antigravity Desktop Builder Handoff', () => {
  beforeEach(() => {
    resetAntigravityQueueForTesting();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setExecFileSyncRunnerForTesting((...args) => execFileSync(...args));
    resetAntigravityQueueForTesting();
  });

  it('1. Discovers active local Antigravity Desktop Builder session', () => {
    const discovery = discoverAntigravityDesktopSession();
    expect(discovery).toBeDefined();
    if (discovery.ok) {
      expect(discovery.activeConversationId).toBeDefined();
      expect(discovery.activeConversationId!.length).toBeGreaterThan(10);
    }
  });

  it('2. Durable handoff creates persisted task with IDs, timestamps, and structured trace events', async () => {
    const { task } = backgroundTaskManager.createTask({
      title: 'Handoff to Antigravity test',
      objective: 'Implement autonomous repair plan in Antigravity session',
      originalRequest: 'Implement autonomous repair plan in Antigravity session',
      route: '/jarvis',
      selectedAgent: 'Jarvis',
      worker: 'antigravity',
      projectId: 'proj-default',
    });

    expect(task).toBeDefined();
    expect(task!.taskId).toMatch(/^bgtask-/);
    clearAntigravityDispatchGuard(task!.taskId);

    const res = await dispatchAntigravityTask(task!);
    expect(res.ok).toBe(true);
    expect(res.handoffId).toBe(task!.taskId);
    expect(res.conversationId).toBeDefined();

    // Verify task in SQLite store - must be executing under active supervision, NEVER prematurely completed
    const updated = backgroundTaskRepo.getTask(task!.taskId);
    expect(updated).toBeDefined();
    expect(updated?.worker).toBe('antigravity');
    expect(updated?.status).toBe('executing');
    expect(updated?.linkedRunId).toBe(res.conversationId);

    // Verify structured audit trace events
    const events = backgroundTaskRepo.getEvents(task!.taskId);
    const agentSelected = events.find(e => e.kind === 'task.agent_selected');
    const handoffInitiated = events.find(e => e.kind === 'task.handoff_initiated');
    const handoffDelivered = events.find(e => e.kind === 'task.handoff_delivered');
    const workerAccepted = events.find(e => e.kind === 'task.worker_accepted');
    const taskCompleted = events.find(e => e.kind === 'task.completed');

    expect(agentSelected).toBeDefined();
    expect(agentSelected?.summary).toContain('Antigravity Desktop Builder');

    expect(handoffInitiated).toBeDefined();
    expect(handoffInitiated?.detail?.taskId).toBe(task!.taskId);

    expect(handoffDelivered).toBeDefined();
    expect(workerAccepted).toBeDefined();

    // AntiGravity cannot self-certify completion upon handoff
    expect(taskCompleted).toBeUndefined();
  });

  it('3. Reports truthful blocking state when desktop builder session is unavailable', async () => {
    vi.spyOn(antigravitySessionDiscoveryProvider, 'discover').mockReturnValue({
      ok: false,
      error: 'Simulated: Antigravity Desktop not running',
      desktopExePath: 'C:\\nonexistent\\Antigravity.exe',
      isDesktopRunning: false,
    });

    const { task } = backgroundTaskManager.createTask({
      title: 'Blocked handoff test',
      objective: 'Should block truthfully',
      originalRequest: 'Should block truthfully',
      route: '/jarvis',
      selectedAgent: 'Jarvis',
      worker: 'antigravity',
      projectId: 'proj-default',
    });

    clearAntigravityDispatchGuard(task!.taskId);
    const res = await dispatchAntigravityTask(task!);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('Antigravity Desktop Builder session is unavailable');

    const updated = backgroundTaskRepo.getTask(task!.taskId);
    expect(updated?.status).toBe('blocked');
    expect(updated?.blocker).toContain('Antigravity Desktop Builder session is unavailable');
  });

  it('4. Blocks task and does not claim completion if language-server message delivery fails', async () => {
    vi.spyOn(antigravitySessionDiscoveryProvider, 'discover').mockReturnValue({
      ok: true,
      activeConversationId: 'mock-conv-12345',
      agentapiPath: 'C:\\fake\\agentapi.bat',
      desktopExePath: 'C:\\fake\\Antigravity.exe',
      isDesktopRunning: true,
    });

    setExecFileSyncRunnerForTesting(((_cmd: any, args: any) => {
      if (Array.isArray(args) && (args.includes('send-message') || (args as string[]).some(a => String(a).includes('send-message')))) {
        throw new Error('connect ECONNREFUSED 127.0.0.1:59314');
      }
      return '{}' as any;
    }) as any);

    const { task } = backgroundTaskManager.createTask({
      title: 'Transport failure test',
      objective: 'Should block when send-message fails',
      originalRequest: 'Should block when send-message fails',
      route: '/jarvis',
      selectedAgent: 'Jarvis',
      worker: 'antigravity',
      projectId: 'proj-default',
    });

    clearAntigravityDispatchGuard(task!.taskId);
    const res = await dispatchAntigravityTask(task!);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('Antigravity handoff blocked: failed to deliver message');

    const updated = backgroundTaskRepo.getTask(task!.taskId);
    expect(updated?.status).toBe('blocked');
    expect(updated?.blocker).toContain('language-server transport');

    const events = backgroundTaskRepo.getEvents(task!.taskId);
    const taskCompleted = events.find(e => e.kind === 'task.completed');
    expect(taskCompleted).toBeUndefined(); // NEVER claim completed if delivery failed!
  });
});
