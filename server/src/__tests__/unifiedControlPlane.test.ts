import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unifiedOperationalContext } from '../domains/controlPlane/UnifiedOperationalContext.js';
import { actionClaimGuard } from '../domains/controlPlane/ActionClaimGuard.js';
import { sanitizeMarkdownForSpeech } from '../services/voice/speechMarkdownSanitizer.js';
import { parseExplicitEngineeringDelegation } from '../domains/controlPlane/ExplicitEngineeringDelegation.js';
import { backgroundTaskManager } from '../services/backgroundTasks/manager.js';

describe('Unified Cross-Channel Control Plane & Truthful Execution', () => {

  beforeEach(() => {
    // Reset active referent
    unifiedOperationalContext.setActiveReferent({
      activeTaskId: undefined,
      activeGoalRunId: undefined,
      activeWorker: undefined,
      activeSubject: undefined,
      originChannel: undefined,
    });
  });

  describe('1. Shared Operational Context & Referent Resolution (§1, §2, §3, §16)', () => {
    it('enforces single authenticated ownerId "local-owner"', () => {
      expect(unifiedOperationalContext.getOwnerId()).toBe('local-owner');
    });

    it('resolves explicit task ID deterministically', () => {
      // Create a mock background task
      const { task } = backgroundTaskManager.createTask({
        title: 'Inspect AgenticOS git status',
        objective: 'Inspect git status of D:\\AgenticOS',
        originalRequest: 'Delegate to Hermes: inspect git status',
        worker: 'hermes',
        route: 'hermes',
        selectedAgent: 'hermes',
        metadata: {
          originChannel: 'telegram',
          delegatedBy: 'telegram',
        },
      });

      const res = unifiedOperationalContext.resolveTaskReferent(`What is the status of task ${task.taskId}?`);
      expect(res.match).toBeDefined();
      expect(res.match?.taskId).toBe(task.taskId);
      expect(res.match?.worker).toBe('hermes');
      expect(res.resolutionMethod).toBe('explicit_id');

      // Verify active referent was automatically updated
      const activeRef = unifiedOperationalContext.getActiveReferent();
      expect(activeRef.activeTaskId).toBe(task.taskId);
      expect(activeRef.activeWorker).toBe('hermes');
    });

    it('resolves task by worker and subject ("the task I gave Hermes on Telegram")', () => {
      const { task } = backgroundTaskManager.createTask({
        title: 'AgenticOS GitHub repository update',
        objective: 'Inspect why AgenticOS GitHub repository has not been pushed',
        originalRequest: 'Delegate to Hermes: inspect why AgenticOS GitHub repository update has not been pushed',
        worker: 'hermes',
        route: 'hermes',
        selectedAgent: 'hermes',
        metadata: {
          originChannel: 'telegram',
          delegatedBy: 'telegram',
        },
      });

      const res = unifiedOperationalContext.resolveTaskReferent(
        'What is the status of the AgenticOS GitHub repository update task I delegated to Hermes?'
      );

      expect(res.match).toBeDefined();
      expect(res.match?.taskId).toBe(task.taskId);
      expect(res.match?.worker).toBe('hermes');
      expect(res.match?.originChannel).toBe('telegram');
    });

    it('resolves deictic follow-up ("did Hermes finish it?" / "what happened with it?") via active referent', () => {
      const { task } = backgroundTaskManager.createTask({
        title: 'Repository Inspection',
        objective: 'Check git repository status',
        originalRequest: 'Inspect git',
        worker: 'hermes',
        route: 'hermes',
        selectedAgent: 'hermes',
        metadata: {
          originChannel: 'telegram',
        },
      });

      // Set active referent
      unifiedOperationalContext.setActiveReferent({
        activeTaskId: task.taskId,
        activeWorker: 'hermes',
        activeSubject: task.objective,
        originChannel: 'telegram',
      });

      const res = unifiedOperationalContext.resolveTaskReferent('Did Hermes finish it?');
      expect(res.match).toBeDefined();
      expect(res.match?.taskId).toBe(task.taskId);
    });

    it('returns truthful "not found" when no matching task exists', () => {
      const res = unifiedOperationalContext.resolveTaskReferent('What is the status of non_existent_bgtask_99999?');
      expect(res.match).toBeNull();
      expect(res.message).toBe('I could not find an existing task matching that request.');
    });
  });

  describe('2. ActionClaimGuard Enforcement (§7, §26)', () => {
    it('refuses delegation claim when worker has not accepted the task', () => {
      const check = actionClaimGuard.assertClaim('DELEGATING', {
        taskId: 'bgtask-mock-1',
        worker: 'hermes',
        hasWorkerAccepted: false,
      });

      expect(check.allowed).toBe(false);
      expect(check.reason).toContain('WORKER_ACCEPTED');
      expect(check.truthfulStatement).toContain('Worker did not accept');
    });

    it('permits delegation claim ONLY when worker acceptance evidence exists', () => {
      const check = actionClaimGuard.assertClaim('DELEGATING', {
        taskId: 'bgtask-mock-2',
        worker: 'hermes',
        hasWorkerAccepted: true,
      });

      expect(check.allowed).toBe(true);
      expect(check.reason).toBeUndefined();
    });

    it('validates sanitized claims against false completed or verified assertions', () => {
      const falseCompleted = actionClaimGuard.sanitizeClaimText(
        'I completed and verified the repository update.',
        { isVerified: false, hasExecutionEvidence: false }
      );
      expect(falseCompleted).not.toContain('I completed and verified');
      expect(falseCompleted).toContain('underway');
    });
  });

  describe('3. Explicit Engineering Delegation Parsing (§5, §6, §9)', () => {
    it('parses explicit Hermes delegation command', () => {
      const cmd = parseExplicitEngineeringDelegation(
        'Delegate to Hermes: inspect why the AgenticOS GitHub update has not been pushed.'
      );
      expect(cmd).not.toBeNull();
      expect(cmd?.worker).toBe('hermes');
      expect(cmd?.action).toBe('delegate');
      expect(cmd?.task).toBe('inspect why the AgenticOS GitHub update has not been pushed.');
    });

    it('parses explicit AntiGravity delegation command', () => {
      const cmd = parseExplicitEngineeringDelegation(
        'AntiGravity, implement: unified operational context layer'
      );
      expect(cmd).not.toBeNull();
      expect(cmd?.worker).toBe('antigravity');
      expect(cmd?.action).toBe('delegate');
      expect(cmd?.task).toBe('unified operational context layer');
    });

    it('parses explicit Codex delegation command', () => {
      const cmd = parseExplicitEngineeringDelegation(
        'Delegate to Codex: fix typescript type errors in store.ts'
      );
      expect(cmd).not.toBeNull();
      expect(cmd?.worker).toBe('codex');
      expect(cmd?.action).toBe('delegate');
      expect(cmd?.task).toBe('fix typescript type errors in store.ts');
    });

    it('parses continuation command ("Continue that task and check authentication")', () => {
      const cmd = parseExplicitEngineeringDelegation(
        'Continue that task and check authentication status too.'
      );
      expect(cmd).not.toBeNull();
      expect(cmd?.action).toBe('continue');
      expect(cmd?.task).toContain('check authentication status too');
    });
  });

  describe('4. Speech Markdown Sanitization (§21)', () => {
    it('strips bold and italic markdown without speaking "star star"', () => {
      const md = 'The task status is **COMPLETED** and *verified*.';
      const spoken = sanitizeMarkdownForSpeech(md);
      expect(spoken).toBe('The task status is COMPLETED and verified.');
      expect(spoken).not.toContain('*');
      expect(spoken).not.toContain('star');
    });

    it('strips headers without speaking "hash"', () => {
      const md = '# AgenticOS Report\n## Status Summary\nEverything is operational.';
      const spoken = sanitizeMarkdownForSpeech(md);
      expect(spoken).not.toContain('#');
      expect(spoken).not.toContain('hash');
      expect(spoken).toContain('AgenticOS Report.');
    });

    it('strips inline code and bullet points cleanly', () => {
      const md = '• Task `bgtask-123` is running.\n• Next step: check git.';
      const spoken = sanitizeMarkdownForSpeech(md);
      expect(spoken).not.toContain('`');
      expect(spoken).not.toContain('•');
      expect(spoken).toContain('Task bgtask-123 is running');
    });
  });

  describe('5. Worker State and Observability (§19)', () => {
    it('returns worker state truthfully from UnifiedOperationalContext', () => {
      const state = unifiedOperationalContext.getWorkerState('hermes');
      expect(state.worker).toBe('hermes');
      expect(['IDLE', 'BUSY', 'DEGRADED', 'OFFLINE']).toContain(state.status);
    });
  });
});
