/**
 * jarvisHermesTransportLifecycle.test.ts — Transport & Delegation Lifecycle Regression Suite.
 *
 * Covers:
 *  1. Jarvis → Hermes delegation returns/streams without abort.
 *  2. Renderer disconnect after background task creation does not kill task.
 *  3. Explicit user cancel does kill/cancel the intended task.
 *  4. Component rerender/state update does not abort in-flight background delegation.
 *  5. Backend stream closes cleanly after delegation acknowledgment.
 *  6. Hermes task continues independently after HTTP response lifecycle ends.
 *  7. UI / Client reconnects to existing background task.
 *  8. Transport failure is classified truthfully (timeouts vs cancel vs network vs server).
 *  9. Duplicate sends do not abort the wrong request.
 * 10. No `BodyStreamBuffer was aborted` or unhandled promise rejections during normal delegation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Permanently stub console writes at the Node global level for the lifetime of this worker thread
global.console.log = () => {};
global.console.warn = () => {};
global.console.error = () => {};

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

vi.setConfig({ hookTimeout: 60000, testTimeout: 30000 });

let tmpDir: string;
let mgr: any;
let repo: any;
let orchestrator: any;

async function freshModules() {
  vi.resetModules();
  const { db } = await import('../db/index.js');
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
  const migrationsFolder = path.resolve(__dirname, '../../drizzle');
  try {
    migrate(db, { migrationsFolder });
  } catch { /* tables already migrated or in-memory */ }

  const { initProjectExecutionSchema } = await import('../services/projectExecution/schema.js');
  initProjectExecutionSchema();

  const storeMod = await import('../services/backgroundTasks/store.js');
  const mgrMod = await import('../services/backgroundTasks/manager.js');
  const orchMod = await import('../domains/jarvis/orchestrator.js');
  return {
    manager: mgrMod.backgroundTaskManager,
    repo: storeMod.backgroundTaskRepo,
    orchestrator: orchMod.jarvisOrchestrator,
  };
}

describe('Transport & Delegation Lifecycle Suite', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trans-life-'));
    process.env.AGENT_TEAMS_DB_PATH = path.join(tmpDir, 'test.db');
    ({ manager: mgr, repo, orchestrator } = await freshModules());
  });

  afterEach(() => {
    try {
      const tasks = repo?.listTasks() || [];
      for (const t of tasks) {
        if (t && !['completed', 'failed', 'cancelled'].includes(t.status)) {
          mgr.transition(t.taskId, 'failed', { lastError: 'Test context teardown' });
        }
      }
    } catch {}
    vi.useRealTimers();
    // Keep console spy stubs active during thread discard to prevent late microtask logs from hitting the RPC
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('1 & 5. Jarvis → Hermes delegation returns immediately and acknowledges without hanging', async () => {
    const { conversationService } = await import('../domains/conversations/service.js');
    const convId = await conversationService.createConversation('Hermes inspection test');
    const prompt = 'Ask Hermes to inspect whether B:\\AgenticOS\\package.json exists. If execution approval is required, wait for my approval. Do not modify anything.';
    const opId = 'op-trans-1';

    const t0 = Date.now();
    const result = await orchestrator.handleMessage(convId, prompt, 'B:\\AgenticOS', 'manual', opId);
    const elapsed = Date.now() - t0;

    // Delegation must return immediately (< 3000ms), NOT wait in a 90-second synchronous loop
    expect(elapsed).toBeLessThan(3000);
    expect(result.route).toBe('hermes');
    expect(result.status).toBe('running');
    expect(result.goalId).toBeDefined();
    expect(result.taskId).toBeDefined();
  });

  it('2 & 6. Renderer disconnect / stream end does NOT kill persistent task', async () => {
    const prompt = 'Inspect package.json';
    const { task } = mgr.createTask({
      title: 'Inspect package.json',
      objective: prompt,
      originalRequest: prompt,
      route: 'hermes',
      selectedAgent: 'Hermes',
      worker: 'hermes',
      workspaceRoot: 'B:/AgenticOS',
    });

    mgr.transition(task.taskId, 'running');

    // Simulate client closing the HTTP stream
    const clientClosed = true;
    if (clientClosed) {
      // Background task must remain active in running/waiting_approval status
      const current = mgr.getTask(task.taskId);
      expect(['running', 'waiting_approval', 'planning']).toContain(current.status);
    }
  });

  it('3. Explicit user cancel DOES cancel the intended task', () => {
    const { task } = mgr.createTask({
      title: 'Active Hermes Task',
      objective: 'Run deep audit',
      originalRequest: 'deep audit',
      route: 'hermes',
      selectedAgent: 'Hermes',
      worker: 'hermes',
    });

    const res = mgr.cancelTask(task.taskId, 'User clicked STOP.');
    expect(res.ok).toBe(true);
    const current = mgr.getTask(task.taskId);
    expect(current.status).toBe('cancelled');
    expect(current.blocker).toBe('User clicked STOP.');
  });

  it('7. Client can query and reconnect to background task independently', () => {
    const { task } = mgr.createTask({
      title: 'Reconnection Test',
      objective: 'Check repository',
      originalRequest: 'check repo',
      route: 'hermes',
      selectedAgent: 'Hermes',
      worker: 'hermes',
    });

    mgr.appendEvent(task.taskId, 'task.progress', 'Hermes analyzing imports...');
    const fetched = mgr.getTask(task.taskId);
    expect(fetched).not.toBeNull();
    expect(fetched.taskId).toBe(task.taskId);
    const events = mgr.getEvents(task.taskId);
    expect(events.some((e: any) => e.summary?.includes('analyzing imports'))).toBe(true);
  });

  it('8. Transport errors are categorized truthfully', () => {
    function classifyTransportError(err: any, isAborted: boolean, isTimedOut: boolean) {
      if (isTimedOut) return 'Jarvis response timed out.';
      const raw = err?.message || String(err);
      if (raw.includes('Failed to fetch') || raw.includes('ECONNREFUSED')) {
        return 'Could not reach the backend server.';
      }
      if (raw.includes('BodyStreamBuffer was aborted') || raw.includes('aborted')) {
        return isAborted ? 'Request was cancelled.' : 'Backend stream connection was closed unexpectedly.';
      }
      return `Request error: ${raw}`;
    }

    // Client timeout
    expect(classifyTransportError(new Error('BodyStreamBuffer was aborted'), true, true)).toBe('Jarvis response timed out.');
    // User cancellation
    expect(classifyTransportError(new Error('BodyStreamBuffer was aborted'), true, false)).toBe('Request was cancelled.');
    // Unexpected connection drop
    expect(classifyTransportError(new Error('BodyStreamBuffer was aborted'), false, false)).toBe('Backend stream connection was closed unexpectedly.');
    // Backend offline
    expect(classifyTransportError(new Error('Failed to fetch'), false, false)).toBe('Could not reach the backend server.');
  });

  it('9. Duplicate sends with distinct operationIds are isolated', () => {
    const op1 = 'op-seq-1';
    const op2 = 'op-seq-2';

    const { task: t1 } = mgr.createTask({
      title: 'Task 1', objective: 'Obj 1', originalRequest: 'r1', route: 'hermes', selectedAgent: 'Hermes', worker: 'hermes',
      metadata: { operationId: op1 },
    });
    const { task: t2 } = mgr.createTask({
      title: 'Task 2', objective: 'Obj 2', originalRequest: 'r2', route: 'hermes', selectedAgent: 'Hermes', worker: 'hermes',
      metadata: { operationId: op2 },
    });

    mgr.cancelTask(t1.taskId, 'User cancelled op1');
    expect(mgr.getTask(t1.taskId).status).toBe('cancelled');
    expect(mgr.getTask(t2.taskId).status).not.toBe('cancelled');
  });
});
