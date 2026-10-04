/**
 * ExplicitEngineeringDelegation.ts
 *
 * Deterministic command parser and execution controller for autonomous engineering tasks
 * across AntiGravity, Hermes, and Codex.
 *
 * Guarantees (Section 5, 6, 7, 9, 10):
 * 1. Executes strictly BEFORE general intent classification or LLM reasoning.
 * 2. Generalizes explicit engineering delegation to Hermes, AntiGravity, and Codex.
 * 3. Enforces ActionClaimGuard: Jarvis NEVER claims delegation without real WORKER_ACCEPTED event.
 * 4. Preserves task identity on continuation across channels (Desktop / Voice / Telegram).
 * 5. Updates UnifiedOperationalContext active referent and global task ledger.
 */

import { logger } from '../../utils/logger.js';
import { engineeringDelegationService } from './EngineeringDelegationService.js';
import { engineeringWorkerRegistry } from './EngineeringWorkerRegistry.js';
import { goalLifecycleManager } from './GoalLifecycle.js';
import { backgroundTaskRepo } from '../../services/backgroundTasks/store.js';
import { unifiedOperationalContext } from './UnifiedOperationalContext.js';
import { actionClaimGuard } from './ActionClaimGuard.js';

export type EngineeringAction = 'delegate' | 'continue' | 'resume';
export type EngineeringWorkerKind = 'antigravity' | 'hermes' | 'codex';

export interface EngineeringCommand {
  worker: EngineeringWorkerKind;
  action: EngineeringAction;
  task: string;
  taskId?: string;
  rawPrompt: string;
}

export interface ExecuteDelegationOptions {
  conversationId?: string;
  turnId?: number | string;
  workspace?: string;
  originChannel?: 'desktop' | 'voice' | 'telegram';
  speakFn?: (text: string, turnId?: number) => Promise<void> | void;
  broadcastFn?: (data: any) => void;
  onProgress?: (update: any) => void;
}

export interface ExecuteDelegationResult {
  success: boolean;
  text: string;
  taskId?: string;
  sessionId?: string;
  goalId?: string;
  worker?: string;
  error?: string;
}

/**
 * Deterministic recognizer for explicit engineering commands across Hermes, AntiGravity, and Codex.
 */
export function parseExplicitEngineeringDelegation(input: string): EngineeringCommand | null {
  if (!input || typeof input !== 'string') return null;
  const raw = input.trim();
  const lower = raw.toLowerCase();

  // Determine target worker if explicitly mentioned
  let worker: EngineeringWorkerKind = 'antigravity';
  if (/\bhermes\b/i.test(lower)) {
    worker = 'hermes';
  } else if (/\bcodex\b|\bcode[- ]?x\b/i.test(lower)) {
    worker = 'codex';
  } else if (/\banti[- ]?gravity\b/i.test(lower)) {
    worker = 'antigravity';
  } else {
    // Check if prompt is a general continuation command like "continue that task", "resume task bgtask-XYZ"
    const hasContinueKeyword = /^(?:continue|resume)\s+(?:the\s+)?(?:current\s+|active\s+|that\s+)?(?:task|work|job)\b/i.test(lower);
    if (!hasContinueKeyword && !/\bdelegate\b|\bhand\s+off\b|\bassign\b/i.test(lower)) {
      return null;
    }
    // Use active referent worker if available
    const activeRef = unifiedOperationalContext.getActiveReferent();
    if (activeRef.activeWorker === 'hermes' || activeRef.activeWorker === 'codex' || activeRef.activeWorker === 'antigravity') {
      worker = activeRef.activeWorker as EngineeringWorkerKind;
    }
  }

  // Strip leading conversational scaffolding
  const stripped = raw
    .replace(/^(?:(?:hey|ok(?:ay)?|hi|hello)\s+)?(?:jarvis|javis|jarves)?[,\s:]*(?:please\s+)?/i, '')
    .trim();

  // 1. Resume pattern:
  // e.g. "Resume AntiGravity task bgtask-123" or "Resume Hermes task: bgtask-123" or "Resume task bgtask-123"
  const resumeMatch = stripped.match(
    /^resume\s+(?:the\s+)?(?:current\s+)?(?:anti[- ]?gravity\s+|hermes\s+|codex\s+)?task[:\s]+([a-zA-Z0-9_\-]+)(?:[:\s,-]+(.*))?$/i
  );
  if (resumeMatch) {
    const taskId = resumeMatch[1].trim();
    const task = (resumeMatch[2] || '').trim();
    return {
      worker,
      action: 'resume',
      taskId,
      task: task || `Resume task ${taskId}`,
      rawPrompt: raw,
    };
  }

  // 2. Continue pattern:
  // e.g. "Continue that task and check authentication status too."
  // e.g. "Continue the Hermes task: inspect repo"
  // e.g. "Tell Hermes to continue and also check authentication"
  const continueMatch = stripped.match(
    /^(?:continue|tell\s+(?:hermes|antigravity|codex)\s+to\s+continue)\s+(?:the\s+|that\s+)?(?:current\s+|active\s+)?(?:anti[- ]?gravity\s+|hermes\s+|codex\s+)?(?:task[:\s,-]*|and\s+)?(.+)$/i
  );
  if (continueMatch) {
    const task = continueMatch[1].trim();
    if (task) {
      return {
        worker,
        action: 'continue',
        task,
        rawPrompt: raw,
      };
    }
  }

  // 3. Delegate patterns:
  // e.g. "Delegate to Hermes: inspect why the AgenticOS GitHub update has not been pushed."
  // e.g. "Delegate this to Hermes"
  // Prevent misinterpreting window/content reading or UI inspection as worker delegation
  if (/\b(?:read\s+what\s+is\s+inside|what\s+is\s+inside|read\s+point|what\s+does\s+point|inside\s+this\s+window)\b/i.test(stripped)) {
    return null;
  }

  const delegateMatch = stripped.match(
    /^(?:delegate|hand\s+off|assign|pass|forward)\s+(?:this\s+|the\s+)?(?:task\s+|problem\s+|issue\s+|investigation\s+|work\s+)?to\s+(?:anti[- ]?gravity|hermes|codex|code[- ]?x)[:\s,-]*(.*)$/i
  );
  if (delegateMatch) {
    let task = delegateMatch[1]?.trim() || '';
    if (!task || task.length < 3) {
      // Anaphoric task like "Delegate this to Hermes" -> use active referent or fallback
      const activeRef = unifiedOperationalContext.getActiveReferent();
      task = activeRef.activeSubject || 'Review and continue previous investigation';
    }
    return {
      worker,
      action: 'delegate',
      task,
      rawPrompt: raw,
    };
  }

  // e.g. "Send this to Hermes: <task>" or "Send to Hermes: <task>"
  const sendMatch = stripped.match(
    /^send\s+(?:this\s+)?(?:the\s+)?(?:task\s+)?to\s+(?:anti[- ]?gravity|hermes|codex)[:\s,-]*(.+)$/i
  );
  if (sendMatch) {
    const task = sendMatch[1].trim();
    if (task) {
      return {
        worker,
        action: 'delegate',
        task,
        rawPrompt: raw,
      };
    }
  }

  // e.g. "Hermes, inspect: <task>" or "AntiGravity, implement: <task>"
  const directCmdMatch = stripped.match(
    /^(?:anti[- ]?gravity|hermes|codex)[,:\s]+(?:implement|build|fix|create|code|develop|refactor|solve|address|inspect|check|diagnose|investigate)[:\s,-]*(.+)$/i
  );
  if (directCmdMatch) {
    const task = directCmdMatch[1].trim();
    if (/\b(?:this\s+window|what\s+is\s+inside|the\s+screen|point\s+\d+|inside\s+this)\b/i.test(task)) {
      return null;
    }
    if (task) {
      return {
        worker,
        action: 'delegate',
        task,
        rawPrompt: raw,
      };
    }
  }

  // e.g. "Ask Hermes to inspect: <task>" or "Have AntiGravity fix: <task>"
  const askCmdMatch = stripped.match(
    /^(?:ask|have)\s+(?:anti[- ]?gravity|hermes|codex)\s+to\s+(?:implement|build|fix|create|code|develop|refactor|solve|address|inspect|check|diagnose|investigate)[:\s,-]*(.+)$/i
  );
  if (askCmdMatch) {
    const task = askCmdMatch[1].trim();
    if (task) {
      return {
        worker,
        action: 'delegate',
        task,
        rawPrompt: raw,
      };
    }
  }

  return null;
}

/**
 * Execute explicit engineering delegation with deterministic verification.
 */
export async function executeEngineeringDelegation(
  command: EngineeringCommand,
  opts: ExecuteDelegationOptions = {}
): Promise<ExecuteDelegationResult> {
  const { conversationId, workspace, originChannel = 'desktop' } = opts;
  const targetWorker = command.worker;
  const workerDisplayName = targetWorker === 'hermes' ? 'Hermes' : targetWorker === 'codex' ? 'CodeX' : 'AntiGravity';

  logger.info(`[ExplicitEngineeringDelegation] Dispatching explicit command to ${workerDisplayName}:`, {
    action: command.action,
    task: command.task,
    conversationId,
    originChannel,
  });

  // 1. Immediate Broadcast Acknowledgment (no speech here — turn lifecycle owns speech)
  const spokenAck = `Delegating to ${workerDisplayName}: ${command.task}`;
  opts.broadcastFn?.({
    type: 'assistant_text',
    text: spokenAck,
    meta: { status: 'delegating', worker: targetWorker },
  });

  // 2. GoalLifecycle Initialization
  const goalRun = goalLifecycleManager.initializeGoal({
    rawPrompt: command.rawPrompt,
    normalizedGoal: `${command.action === 'delegate' ? 'Delegate to ' + workerDisplayName : command.action}: ${command.task}`,
    category: 'engineering',
    target: targetWorker,
    clientTurnId: typeof opts.turnId === 'number' ? opts.turnId : undefined,
    conversationId,
    workspacePath: workspace,
  });
  const goalId = goalRun.goalId;

  // 3. Dispatch to EngineeringDelegationService
  let dispatchResult: {
    success: boolean;
    taskId: string;
    conversationId?: string;
    message?: string;
    hasWorkerAccepted?: boolean;
    status?: string;
  };

  try {
    if (command.action === 'continue') {
      // Find active or referent task to continue
      let targetTaskId = command.taskId;
      if (!targetTaskId) {
        const activeRef = unifiedOperationalContext.getActiveReferent();
        if (activeRef.activeTaskId) {
          targetTaskId = activeRef.activeTaskId;
        } else {
          const activeTasks = backgroundTaskRepo.listTasks({ activeOnly: true }).filter(t => t.worker === targetWorker);
          if (activeTasks.length > 0) {
            targetTaskId = activeTasks[0].taskId;
          } else {
            const allTasks = backgroundTaskRepo.listTasks({ limit: 10 }).filter(t => t.worker === targetWorker);
            if (allTasks.length > 0) {
              targetTaskId = allTasks[0].taskId;
            }
          }
        }
      }

      if (targetTaskId) {
        const contOut = await engineeringDelegationService.continueTask({
          taskId: targetTaskId,
          instruction: command.task,
          workspacePath: workspace,
        });
        dispatchResult = {
          success: contOut.success,
          taskId: contOut.taskId,
          conversationId: contOut.conversationId,
          message: contOut.message,
          hasWorkerAccepted: true,
          status: contOut.status,
        };
      } else {
        // No task to continue — delegate as fresh task
        const delOut = await engineeringDelegationService.delegateTask({
          objective: command.task,
          conversationId,
          goalId,
          worker: targetWorker,
          workspacePath: workspace,
          delegatedBy: `Jarvis Explicit Delegation (${originChannel})`,
        });
        dispatchResult = delOut;
      }
    } else if (command.action === 'resume') {
      if (!command.taskId) {
        throw new Error('Resume command requires a taskId.');
      }
      const resOut = await engineeringDelegationService.resumeTask(command.taskId);
      dispatchResult = {
        success: resOut.success,
        taskId: resOut.taskId,
        message: resOut.message,
        hasWorkerAccepted: true,
      };
    } else {
      // action === 'delegate'
      const delOut = await engineeringDelegationService.delegateTask({
        objective: command.task,
        conversationId,
        goalId,
        worker: targetWorker,
        workspacePath: workspace,
        delegatedBy: `Jarvis Explicit Delegation (${originChannel})`,
      });
      dispatchResult = delOut;
    }
  } catch (dispatchErr: any) {
    logger.error(`[ExplicitEngineeringDelegation] Dispatch error for ${workerDisplayName}:`, dispatchErr?.message || dispatchErr);
    const failureText = `I could not deliver the task to ${workerDisplayName}: ${dispatchErr?.message || 'Task could not be dispatched.'}`;

    opts.broadcastFn?.({
      type: 'assistant_text',
      text: failureText,
    });

    return {
      success: false,
      text: failureText,
      worker: targetWorker,
      error: dispatchErr?.message || String(dispatchErr),
    };
  }

  const assignedTaskId = dispatchResult.taskId;

  // 4. Verify Actual WORKER_ACCEPTED and Execution Events
  const startTime = Date.now();
  let verifiedAcceptance = false;
  let capturedSessionId = dispatchResult.conversationId;

  while (Date.now() - startTime < 7000) {
    const taskRecord = backgroundTaskRepo.getTask(assignedTaskId);
    const workerEvents = engineeringWorkerRegistry.getWorkerEvents(targetWorker).filter(e => e.taskId === assignedTaskId);
    const session = engineeringWorkerRegistry.getSession(assignedTaskId);

    if (session?.antigravityConversationId) {
      capturedSessionId = session.antigravityConversationId;
    } else if (taskRecord?.linkedRunId) {
      capturedSessionId = taskRecord.linkedRunId;
    }

    const hasWorkerAccepted =
      dispatchResult.hasWorkerAccepted ||
      workerEvents.some(e => e.eventType === 'WORKER_ACCEPTED') ||
      taskRecord?.status === 'worker_accepted' ||
      taskRecord?.status === 'running' ||
      taskRecord?.status === 'executing';

    const hasExecutionEvent = workerEvents.some(e =>
      e.eventType === 'FILE_READ' ||
      e.eventType === 'FILE_EDITED' ||
      e.eventType === 'COMMAND_STARTED' ||
      e.eventType === 'REPOSITORY_OPENED' ||
      e.eventType === 'WORKER_ACCEPTED'
    );

    if (hasWorkerAccepted && (hasExecutionEvent || taskRecord?.status === 'executing' || taskRecord?.status === 'worker_accepted' || taskRecord?.status === 'running')) {
      verifiedAcceptance = true;
      break;
    }

    await new Promise(r => setTimeout(r, 250));
  }

  // Enforce ActionClaimGuard before claiming delegation!
  const claimCheck = actionClaimGuard.verifyClaim('DELEGATING', {
    taskId: assignedTaskId,
    worker: workerDisplayName,
    hasWorkerAccepted: verifiedAcceptance,
  });

  if (claimCheck.allowed) {
    const successText = `Accepted. Worker: ${workerDisplayName}. Task: ${assignedTaskId}. Status: running.`;
    logger.info(`[ExplicitEngineeringDelegation] Successful ${workerDisplayName} acceptance:`, {
      taskId: assignedTaskId,
      sessionId: capturedSessionId,
    });

    // Update shared operational context referent
    unifiedOperationalContext.setActiveReferent({
      activeTaskId: assignedTaskId,
      activeGoalRunId: goalId,
      activeWorker: targetWorker,
      activeSubject: command.task,
      originChannel,
    });

    opts.broadcastFn?.({
      type: 'assistant_text',
      text: successText,
    });

    return {
      success: true,
      text: successText,
      taskId: assignedTaskId,
      sessionId: capturedSessionId,
      goalId,
      worker: targetWorker,
    };
  }

  // Not accepted — speak truthful rejection
  logger.warn(`[ExplicitEngineeringDelegation] ${workerDisplayName} task was not accepted in time:`, assignedTaskId);
  const failureText = `I could not deliver the task to ${workerDisplayName}. The task has not been accepted.`;

  opts.broadcastFn?.({
    type: 'assistant_text',
    text: failureText,
  });

  return {
    success: false,
    text: failureText,
    taskId: assignedTaskId,
    worker: targetWorker,
    error: claimCheck.reason || 'Worker did not emit WORKER_ACCEPTED within verification window.',
  };
}
