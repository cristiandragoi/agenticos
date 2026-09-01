/**
 * backgroundTaskApprovalPipeline.test.ts — Critical Background Task Approval Regression Suite.
 *
 * Covers:
 *  1. Hermes execute_code normalization.
 *  2. Unknown action fails closed.
 *  3. Allow resolves approval.
 *  4. Deny resolves approval.
 *  5. Allow continues suspended task.
 *  6. Deny does not execute gated operation.
 *  7. Modal closes after acknowledged resolution (state clearing).
 *  8. Backend failure leaves recoverable UI/task state.
 *  9. Duplicate approval cannot execute operation twice.
 * 10. Action cannot be completed before approval.
 * 11. Reload restores legitimate pending approval.
 * 12. Stale approval can be reconciled safely.
 * 13. Task and approval IDs remain correlated.
 * 14. Workspace-safe read policy behaves as intended.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  normalizeApprovalAction,
  isWorkspaceSafeReadOnlyOperation,
} from '../services/backgroundTasks/approvalNormalization.js';

let tmpDir: string;
let mgr: any;
let repo: any;

async function freshModules() {
  vi.resetModules();
  const storeMod = await import('../services/backgroundTasks/store.js');
  const mgrMod = await import('../services/backgroundTasks/manager.js');
  return { manager: mgrMod.backgroundTaskManager, repo: storeMod.backgroundTaskRepo };
}

describe('PHASE 3 & 7: Action Normalization & Workspace-Safe Read Policy', () => {
  const workspaceRoot = 'B:/AgenticOS';

  it('1. Hermes execute_code normalization identifies Python scripts and inspection', () => {
    // Read-only path inspection
    const readCheck = normalizeApprovalAction({
      action: 'execute_code',
      command: "execute_code << 'PY'\nimport os\nprint(os.path.exists('B:/AgenticOS/package.json'))\nPY",
      files: ['package.json'],
      workspaceRoot,
    });
    expect(readCheck.canonicalAction).toBe('filesystem.read');
    expect(readCheck.label).toBe('Inspect File / Path');
    expect(readCheck.isReadOnly).toBe(true);
    expect(readCheck.riskLevel).toBe('low');

    // General script execution
    const scriptExec = normalizeApprovalAction({
      action: 'execute_code',
      command: "execute_code << 'PY'\nprint('hello world')\nPY",
      workspaceRoot,
    });
    expect(scriptExec.canonicalAction).toBe('code.execute');
    expect(scriptExec.label).toBe('Execute Python Script');
    expect(scriptExec.isReadOnly).toBe(false);
    expect(scriptExec.riskLevel).toBe('medium');
  });

  it('2. Unknown action fails closed with strict review required', () => {
    const unknown = normalizeApprovalAction({
      action: 'custom_exfiltration_tool',
      command: '',
      workspaceRoot,
    });
    expect(unknown.canonicalAction).toBe('unknown');
    expect(unknown.riskLevel).toBe('critical');
    expect(unknown.isReadOnly).toBe(false);
    expect(unknown.isWorkspaceSafe).toBe(false);
    expect(isWorkspaceSafeReadOnlyOperation({ action: 'custom_exfiltration_tool', workspaceRoot })).toBe(false);
  });

  it('14. Workspace-safe read policy behaves as intended', () => {
    // Safe read inside workspace
    expect(isWorkspaceSafeReadOnlyOperation({
      action: 'read_file',
      files: ['package.json'],
      workspaceRoot,
    })).toBe(true);

    expect(isWorkspaceSafeReadOnlyOperation({
      action: 'git',
      command: 'git status --short',
      workspaceRoot,
    })).toBe(true);

    expect(isWorkspaceSafeReadOnlyOperation({
      action: 'git',
      command: 'git branch --show-current',
      workspaceRoot,
    })).toBe(true);

    // Destructive command inside or outside workspace must NOT be auto-approved
    expect(isWorkspaceSafeReadOnlyOperation({
      action: 'terminal',
      command: 'rm -rf server/data',
      workspaceRoot,
    })).toBe(false);

    // Write command must NOT be treated as read-only
    expect(isWorkspaceSafeReadOnlyOperation({
      action: 'write_file',
      files: ['server/src/index.ts'],
      workspaceRoot,
    })).toBe(false);

    // Git write must NOT be treated as read-only
    expect(isWorkspaceSafeReadOnlyOperation({
      action: 'git',
      command: 'git push origin main',
      workspaceRoot,
    })).toBe(false);
  });
});

describe('PHASE 4, 5, 6: Background Task Approval State Machine & Deadlock Prevention', () => {
  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgtask-approval-'));
    process.env.AGENT_TEAMS_DB_PATH = path.join(tmpDir, 'test.db');
    ({ manager: mgr, repo } = await freshModules());
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  const baseTaskInput = {
    title: 'Deploy to Staging',
    objective: 'Deploy artifacts to production host',
    originalRequest: 'deploy now',
    route: 'hermes',
    selectedAgent: 'Hermes',
    worker: 'hermes' as const,
    workspaceRoot: 'B:/AgenticOS',
  };

  it('3 & 5. Allow resolves approval and continues suspended task to running', async () => {
    const { task } = mgr.createTask(baseTaskInput);
    mgr.transition(task.taskId, 'running');
    mgr.requestApproval(task.taskId, {
      action: 'execute_code',
      reason: 'Hermes requests approval to continue.',
      command: "execute_code << 'PY'\nimport os\nprint(os.path.exists('B:/AgenticOS/package.json'))\nPY",
    });

    const waiting = mgr.getTask(task.taskId);
    expect(waiting.status).toBe('waiting_approval');
    expect(waiting.approvalState).toBe('pending');

    let upstreamChoice: string | null = null;
    const res = await mgr.resolveApproval(task.taskId, 'allow', async (c: string) => {
      upstreamChoice = c;
    });

    expect(res.ok).toBe(true);
    expect(upstreamChoice).toBe('allow');

    const resumed = mgr.getTask(task.taskId);
    expect(resumed.status).toBe('running');
    expect(resumed.approvalState).toBe('allowed');
    expect(mgr.getPendingApproval(task.taskId)).toBeNull();
  });

  it('4 & 6. Deny resolves approval and prevents execution of gated operation', async () => {
    const { task } = mgr.createTask(baseTaskInput);
    mgr.transition(task.taskId, 'running');
    mgr.requestApproval(task.taskId, {
      action: 'destructive.delete',
      reason: 'Delete old database backup',
      command: 'rm -rf /tmp/backup',
    });

    let upstreamChoice: string | null = null;
    const res = await mgr.resolveApproval(task.taskId, 'deny', async (c: string) => {
      upstreamChoice = c;
    });

    expect(res.ok).toBe(true);
    expect(upstreamChoice).toBe('deny');

    const deniedTask = mgr.getTask(task.taskId);
    expect(deniedTask.status).toBe('blocked');
    expect(deniedTask.approvalState).toBe('denied');
    expect(deniedTask.blocker).toContain('Action denied by user');
    expect(mgr.getPendingApproval(task.taskId)).toBeNull();
  });

  it('7. Modal closes / pending approvals clear after acknowledged resolution', async () => {
    const { task } = mgr.createTask(baseTaskInput);
    mgr.requestApproval(task.taskId, {
      action: 'terminal.execute',
      reason: 'Run migration script',
      command: 'npm run migrate',
    });

    expect(mgr.listPendingApprovals().length).toBe(1);
    await mgr.resolveApproval(task.taskId, 'allow', async () => {});
    expect(mgr.listPendingApprovals().length).toBe(0);
  });

  it('8. Backend / upstream resolver failure leaves recoverable state and does not deadlock', async () => {
    const { task } = mgr.createTask(baseTaskInput);
    mgr.requestApproval(task.taskId, {
      action: 'terminal.execute',
      reason: 'Run remote script',
      command: 'ssh host.internal "reboot"',
    });

    // Failing upstream resolver on allow returns structured error
    const failRes = await mgr.resolveApproval(task.taskId, 'allow', async () => {
      throw new Error('Upstream run 409: Run has no pending approval');
    });
    expect(failRes.ok).toBe(false);
    expect(failRes.error).toContain('Upstream run 409');

    // User can still Deny or Force Reconcile to unblock the UI
    const reconcileRes = await mgr.reconcileStaleApproval(task.taskId, 'deny', 'User dismissed failed approval');
    expect(reconcileRes.ok).toBe(true);
    expect(reconcileRes.task?.status).toBe('blocked');
    expect(reconcileRes.task?.approvalState).toBe('denied');
    expect(mgr.getPendingApproval(task.taskId)).toBeNull();
  });

  it('9. Duplicate approval cannot execute operation twice (idempotent)', async () => {
    const { task } = mgr.createTask(baseTaskInput);
    mgr.requestApproval(task.taskId, {
      action: 'filesystem.write',
      reason: 'Write config',
      files: ['config.json'],
    });

    let execCount = 0;
    const first = await mgr.resolveApproval(task.taskId, 'allow', async () => { execCount++; });
    expect(first.ok).toBe(true);
    expect(execCount).toBe(1);

    // Second duplicate resolution returns idempotent ok and does not call resolver again
    const second = await mgr.resolveApproval(task.taskId, 'allow', async () => { execCount++; });
    expect(second.ok).toBe(true);
    expect(second.alreadyResolved).toBe(true);
    expect(execCount).toBe(1);
  });

  it('10. Action cannot be completed before approval is granted', () => {
    const { task } = mgr.createTask(baseTaskInput);
    mgr.requestApproval(task.taskId, {
      action: 'terminal.execute',
      command: 'npm run build',
      reason: 'Build step',
    });

    // Attempting verifyCompletion while approval is pending fails verification
    mgr.verifyCompletion(task.taskId, {
      resultText: 'Build output finished.',
      readOnly: false,
    });

    const current = mgr.getTask(task.taskId);
    expect(current.status).not.toBe('completed');
    expect(['waiting_approval', 'review', 'blocked']).toContain(current.status);
    expect(current.approvalState).toBe('pending');
  });

  it('11. Reload / restore restores legitimate pending approval with normalized action', () => {
    const { task } = mgr.createTask(baseTaskInput);
    mgr.requestApproval(task.taskId, {
      action: 'execute_code',
      reason: 'Hermes requests approval to continue.',
      command: "execute_code << 'PY'\nimport os\nprint(os.path.exists('B:/AgenticOS/package.json'))\nPY",
    });

    // Simulate backend restart by wiping memory manager
    const newMgr = mgr;
    newMgr.approvalRequests.clear();
    expect(newMgr.approvalRequests.size).toBe(0);

    // Restore from DB
    newMgr.restoreAfterRestart();
    const restoredApproval = newMgr.getPendingApproval(task.taskId);
    expect(restoredApproval).not.toBeNull();
    expect(restoredApproval?.action).toBe('Inspect File / Path');
    expect(restoredApproval?.canonicalAction).toBe('filesystem.read');
    expect(restoredApproval?.riskLevel).toBe('low');
  });

  it('12. Stale approval can be reconciled safely via cancel / deny', async () => {
    const { task } = mgr.createTask(baseTaskInput);
    mgr.requestApproval(task.taskId, {
      action: 'unknown',
      reason: 'Stale unhandled tool',
    });

    const res = await mgr.reconcileStaleApproval(task.taskId, 'cancel', 'Stale task cancelled');
    expect(res.ok).toBe(true);
    expect(res.task?.status).toBe('cancelled');
    expect(mgr.getPendingApproval(task.taskId)).toBeNull();
  });

  it('13. Task and approval IDs remain correlated throughout lifecycle', () => {
    const { task } = mgr.createTask(baseTaskInput);
    mgr.requestApproval(task.taskId, {
      action: 'git.read',
      command: 'git status',
      reason: 'Inspect git tree',
    });

    const approval = mgr.getPendingApproval(task.taskId);
    expect(approval?.taskId).toBe(task.taskId);
    const list = mgr.listPendingApprovals();
    expect(list.some((a: any) => a.taskId === task.taskId)).toBe(true);
  });

  it('15. same approval returned by multiple polls does not create duplicate presentation or re-trigger', () => {
    const { task } = mgr.createTask(baseTaskInput);
    mgr.requestApproval(task.taskId, {
      action: 'terminal.execute',
      command: 'git pull origin main',
      reason: 'Update codebase',
    });

    const poll1 = mgr.listPendingApprovals();
    const poll2 = mgr.listPendingApprovals();
    const poll3 = mgr.listPendingApprovals();

    expect(poll1.length).toBe(1);
    expect(poll2.length).toBe(1);
    expect(poll3.length).toBe(1);
    expect(poll1[0].taskId).toBe(task.taskId);
    expect(poll2[0].taskId).toBe(task.taskId);
  });

  it('16. after Allow, resolved approval does not reappear on subsequent polls or ticks', async () => {
    const { task } = mgr.createTask(baseTaskInput);
    mgr.requestApproval(task.taskId, {
      action: 'terminal.execute',
      command: 'npm test',
      reason: 'Run validation suite',
    });

    expect(mgr.listPendingApprovals().length).toBe(1);

    const resolveRes = await mgr.resolveApproval(task.taskId, 'allow', async () => {});
    expect(resolveRes.ok).toBe(true);

    const postResolvePoll1 = mgr.listPendingApprovals();
    const postResolvePoll2 = mgr.listPendingApprovals();
    expect(postResolvePoll1.length).toBe(0);
    expect(postResolvePoll2.length).toBe(0);
    expect(mgr.getPendingApproval(task.taskId)).toBeNull();
  });

  it('17. a NEW approval with a different stable identity still appears normally', async () => {
    const { task: task1 } = mgr.createTask(baseTaskInput);
    mgr.requestApproval(task1.taskId, {
      action: 'terminal.execute',
      command: 'rm -rf dist',
      reason: 'Clean build directory',
    });

    await mgr.resolveApproval(task1.taskId, 'allow', async () => {});
    expect(mgr.listPendingApprovals().length).toBe(0);

    const { task: task2 } = mgr.createTask({ ...baseTaskInput, title: 'Second task' });
    mgr.requestApproval(task2.taskId, {
      action: 'terminal.execute',
      command: 'npm run deploy',
      reason: 'Deploy new artifact',
    });

    const pending = mgr.listPendingApprovals();
    expect(pending.length).toBe(1);
    expect(pending[0].taskId).toBe(task2.taskId);
    expect(pending[0].command).toBe('npm run deploy');
  });
});
