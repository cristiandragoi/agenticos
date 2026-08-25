/**
 * taskReferenceResolver.ts
 *
 * Canonical Conversational Task Reference & Anaphora Resolver.
 *
 * Once Jarvis accepts an operational task, Jarvis owns that operation.
 * Follow-up messages in the conversation (such as "yes", "please proceed",
 * "stop it", "what happened with that task?", "is it done?", "try again")
 * bind unambiguously to the active or recent background task in that
 * conversation BEFORE any generic direct-conversation classification.
 *
 * Precedence Order:
 *  1. Explicit STOP / CANCEL
 *  2. Pending approval response ("yes", "allow", "proceed", "no", "deny")
 *  3. Active-task status query ("what happened?", "is it done?", "why is it stalled?")
 *  4. Active-task continuation ("please proceed", "continue", "resume", "try again")
 *  5. None (falls through to explicit delegation / new operational intent / direct chat)
 */

import { backgroundTaskRepo } from '../../services/backgroundTasks/store.js';
import { backgroundTaskManager } from '../../services/backgroundTasks/manager.js';
import { taskShortId, isActiveStatus, type BackgroundTaskRecord } from '../../services/backgroundTasks/types.js';
import * as executionState from '../../services/executionState.js';
import { logger } from '../../utils/logger.js';

export interface ResolvedTaskReference {
  type: 'stop' | 'approval_resolution' | 'active_task_status' | 'task_continuation' | 'none';
  task?: BackgroundTaskRecord;
  choice?: 'allow' | 'deny';
  replyText?: string;
  confidence: number;
  reason: string;
}

const STOP_PATTERNS = /^(?:stop|cancel|abort|terminate|kill)(?: it| that| this| the task| everything)?[.!?]*$/i;

const AFFIRMATIVE_APPROVAL_PATTERNS = /^(?:yes|yeah|yep|sure|ok|okay|allow|approve|proceed|go ahead|do it|allow it|yes,? please proceed|please proceed|confirm|proceed with writing|do that)[.!?]*$/i;

const NEGATIVE_APPROVAL_PATTERNS = /^(?:no|nope|deny|reject|don'?t do (?:that|it)|disallow|do not proceed|cancel)[.!?]*$/i;

const STATUS_QUERY_PATTERNS = /^(?:what happened\??|what happened with (?:that|the) task\??|is it (?:done|finished)\??|how is (?:it|the task) going\??|what is it doing\??|why is it stalled\??|status\??|show task\??|check task\??|did it finish\??|has it finished\??|what did you find\??)[.!?]*$/i;

const CONTINUATION_PATTERNS = /^(?:please proceed|proceed|continue|go on|keep going|do it|do that|try again|retry|run it again|resume)[.!?]*$/i;

export async function resolveActiveOperationReference(options: {
  conversationId: string;
  message: string;
  workspacePath?: string;
}): Promise<ResolvedTaskReference> {
  const { conversationId, message } = options;
  const p = (message || '').trim();
  const lower = p.toLowerCase().replace(/\s+/g, ' ');

  // Get tasks associated with this conversation, newest first
  const allTasks = backgroundTaskRepo.listTasks().filter(t => t.conversationId === conversationId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  const activeTasks = allTasks.filter(t => isActiveStatus(t.status));
  const latestTask = allTasks.length > 0 ? allTasks[0] : undefined;
  const activeTask = activeTasks.length > 0 ? activeTasks[0] : undefined;

  // ── 1. Explicit STOP / CANCEL ──
  if (STOP_PATTERNS.test(lower)) {
    const targetTask = activeTask || latestTask;
    if (targetTask && isActiveStatus(targetTask.status)) {
      await backgroundTaskManager.stopTask(targetTask.taskId, 'Stopped by user command.');
      const shortId = taskShortId(targetTask.taskId);
      const workerName = targetTask.selectedAgent || targetTask.worker;
      return {
        type: 'stop',
        task: targetTask,
        confidence: 1.0,
        reason: `Explicit stop requested for active task ${shortId}`,
        replyText: `Stopping ${workerName} (${shortId})…`,
      };
    }
  }

  // ── 2. Pending Approval Response ──
  const waitingTask = allTasks.find(t => t.status === 'waiting_approval' || t.approvalState === 'pending');
  if (waitingTask) {
    if (AFFIRMATIVE_APPROVAL_PATTERNS.test(lower) || /\b(?:yes|allow|approve|proceed|go ahead|do it)\b/i.test(lower)) {
      await backgroundTaskManager.resolveApproval(
        waitingTask.taskId,
        'allow',
        async () => {},
        { force: true }
      );
      const workerName = waitingTask.selectedAgent || waitingTask.worker;
      return {
        type: 'approval_resolution',
        task: waitingTask,
        choice: 'allow',
        confidence: 0.99,
        reason: `Approval granted by user for ${waitingTask.taskId}`,
        replyText: `Approval granted for ${waitingTask.title}. ${workerName} is proceeding with the approved action…`,
      };
    }

    if (NEGATIVE_APPROVAL_PATTERNS.test(lower) || /\b(?:no|deny|reject|disallow|don't)\b/i.test(lower)) {
      await backgroundTaskManager.resolveApproval(
        waitingTask.taskId,
        'deny',
        async () => {},
        { force: true }
      );
      return {
        type: 'approval_resolution',
        task: waitingTask,
        choice: 'deny',
        confidence: 0.99,
        reason: `Approval denied by user for ${waitingTask.taskId}`,
        replyText: `Approval denied. The operation has been blocked.`,
      };
    }
  }

  // ── 3. Active-Task Status Query ──
  if (STATUS_QUERY_PATTERNS.test(lower) || /\bwhat happened with (?:that|the) task\b/i.test(lower)) {
    const targetTask = activeTask || latestTask;
    if (targetTask) {
      const shortId = taskShortId(targetTask.taskId);
      const workerName = targetTask.selectedAgent || targetTask.worker;
      let reply = '';

      if (targetTask.status === 'queued') {
        const meta = (targetTask.metadata as any)?.concurrency;
        const pos = meta?.position || 1;
        reply = `Task ${shortId} is currently QUEUED behind ${workerName} (position ${pos}). I will dispatch it automatically when a worker slot frees.`;
      } else if (targetTask.status === 'waiting_approval' || targetTask.approvalState === 'pending') {
        reply = `${workerName} is ready and waiting for your approval to proceed: ${targetTask.blocker || targetTask.progressMessage || 'Action approval requested'}.`;
      } else if (targetTask.status === 'running') {
        const elapsed = Math.round((Date.now() - new Date(targetTask.createdAt).getTime()) / 1000);
        reply = `${workerName} is currently running on "${targetTask.title}" (${elapsed}s elapsed).\nCurrent status: ${targetTask.progressMessage || 'Working…'}`;
      } else if (targetTask.status === 'completed') {
        reply = `${workerName} completed the task (${shortId}):\n\n${targetTask.resultText || 'Task completed and verified successfully.'}`;
      } else if (targetTask.status === 'failed' || targetTask.status === 'cancelled' || targetTask.status === 'blocked') {
        reply = `Task ${shortId} is ${targetTask.status}: ${targetTask.lastError || targetTask.blocker || 'Execution stopped.'}`;
      } else {
        reply = `Task ${shortId} (${workerName}) is currently ${targetTask.status}: ${targetTask.progressMessage || 'In progress.'}`;
      }

      return {
        type: 'active_task_status',
        task: targetTask,
        confidence: 0.98,
        reason: `Status query resolved against conversation task ${shortId}`,
        replyText: reply,
      };
    }
  }

  // ── 4. Task Continuation / Resume ──
  if (CONTINUATION_PATTERNS.test(lower) || lower === 'yes' || lower === 'proceed' || lower === 'please proceed') {
    const targetTask = activeTask || latestTask;
    if (targetTask) {
      const shortId = taskShortId(targetTask.taskId);
      const workerName = targetTask.selectedAgent || targetTask.worker;

      if (targetTask.status === 'paused' || targetTask.status === 'blocked') {
        if (targetTask.resumable) {
          const res = await backgroundTaskManager.resumeTask(targetTask.taskId);
          if (res.ok) {
            return {
              type: 'task_continuation',
              task: targetTask,
              confidence: 0.95,
              reason: `Resumed paused/blocked task ${shortId}`,
              replyText: `Resuming ${workerName} on task ${shortId}…`,
            };
          }
        }
      }

      if (targetTask.status === 'running') {
        return {
          type: 'task_continuation',
          task: targetTask,
          confidence: 0.95,
          reason: `Follow-up bound to running task ${shortId}`,
          replyText: `${workerName} is already actively running on "${targetTask.title}".\nStatus: ${targetTask.progressMessage || 'In progress'}.`,
        };
      }

      if (targetTask.status === 'queued') {
        return {
          type: 'task_continuation',
          task: targetTask,
          confidence: 0.95,
          reason: `Follow-up bound to queued task ${shortId}`,
          replyText: `Task ${shortId} is queued and will dispatch automatically as soon as a ${workerName} slot becomes available.`,
        };
      }
    }
  }

  return {
    type: 'none',
    confidence: 0,
    reason: 'No active task reference match in this conversation.',
  };
}
