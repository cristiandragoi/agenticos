/**
 * semanticTurnResolver.ts — Unified semantic turn resolution pipeline (§6 of plan).
 *
 * One canonical entry point replaces the ad-hoc handler chain. Deterministic
 * precedence: cancel → pending-action confirm/reject → explicit action iterator →
 * entity resolution → continuation → deterministic intent → LLM.
 *
 * For delegation proposals ("Give it to Hermes") it creates a PendingAction with
 * status awaiting_confirmation (Source A — no LLM text scraping). Confirmation
 * ("Yes, do that") approves and executes via supervisorTools (idempotent).
 *
 * DeterministicBranch handlers receive structured SemanticContext, never prose.
 */

import { randomUUID } from 'node:crypto';
import {
  getDialogueState,
  upsertDialogueState,
  createPendingAction,
  updatePendingAction,
  getPendingAction,
  type DialogueState,
  type PendingAction,
  type EntityRef,
  type RecommendationRef,
} from './dialogueState.js';
import { resolveEntity } from './entityResolver.js';
import { classifyExecutiveIntent } from './executiveIntent.js';
import { parseJarvisAction, type ActionParseResult, type WorkspaceContextData } from './actionRuntime.js';
import { resolveContinuationIntent, type ContinuationResolution } from './intentRouter.js';
import { taskShortId, TERMINAL_STATUSES, type DelegationEnvelope, type BackgroundTaskRecord } from '../../services/backgroundTasks/types.js';
import { backgroundTaskRepo } from '../../services/backgroundTasks/store.js';
import { backgroundTaskManager } from '../../services/backgroundTasks/manager.js';
import { dispatchTask } from '../../services/backgroundTasks/adapters.js';
import { detectSystemIntrospection, handleSystemIntrospection, type IntrospectionSubject } from './systemIntrospection.js';

// ── Public types ─────────────────────────────────────────────────────────────

export interface SemanticContext {
  activeEntity: EntityRef | null;
  pendingAction: PendingAction | null;
  activeGoal: string | null;
  activeTaskId: string | null;
  delegatedTaskId: string | null;
  resolvedReferences: EntityRef[];
  userTimezone: string;
  currentUtc: string;
  currentLocalTime: string;
  recentHistory: { role: string; content: string }[];
}

export interface DeterministicResponse {
  text: string;
  intent: string;
  data?: Record<string, unknown>;
}

export interface SemanticResult {
  handled: boolean;
  decision:
    | { type: 'cancel' | 'anything' }
    | { type: 'confirm_pending'; pendingActionId: string }
    | { type: 'reject_pending'; pendingActionId: string }
    | { type: 'created_proposal'; pendingActionId: string }
    | { type: 'recommend_next_step'; recommendation: RecommendationRef }
    | { type: 'recommendation_rationale'; rationale: string }
    | { type: 'action'; action: ActionParseResult }
    | { type: 'entity_resolved'; entity: EntityRef }
    | { type: 'system_introspection'; subject: IntrospectionSubject; data?: Record<string, unknown> }
    | { type: 'continuation'; resolution: ContinuationResolution }
    | { type: 'intent_classified'; intent: ReturnType<typeof classifyExecutiveIntent> }
    | { type: 'task_recovery'; action: 'explain' | 'retry' | 'cancel'; taskId?: string }
    | { type: 'requires_llm' };
  dialogueState: DialogueState;
  response?: DeterministicResponse;
  semanticContext?: SemanticContext;
}

export interface ResolveSemanticTurnOptions {
  workspacePath?: string;
  workspaceContext?: WorkspaceContextData;
  recentHistory?: { role: string; content: string }[];
}

// ── Constants ────────────────────────────────────────────────────────────────

const CONFIRM_RE = /^(?:yes|yeah|yep|sure|ok|okay|do it|do that|go ahead|proceed|let's do that|let's go|please)\b/i;
const REJECT_RE = /^(?:no|nope|nah|cancel|never mind|don'?t|stop)\b/i;
const CANCEL_RE = /^(?:cancel|stop|no,? never mind|forget it|never mind|scrap that|forget that)\b/i;

const NEXT_STEP_RE = /^(?:what(?:'s| is| should we do| do we do| can we do| would you recommend)?\s+(?:next|now|the next step)|what should (?:we|i) do(?:\s+with (?:it|this|that))?|what do you recommend|what would you recommend|how should (?:we|i) proceed|what('s| is) next)\b/i;
const WHY_RE = /^why[?!.]*$/i;
const DO_THAT_RE = /^(?:do that|let's do that|proceed with that|execute that|go ahead with that)\b/i;

const ping_worker_RE = /(?:give|hand|send|delegate|assign|pass|route|have)\s+(.+?)\s+(?:to\s+)?(hermes|codex|antigravity|research|magnitude)\b/i;
const create_plan_RE = /(?:create|build|make|prepare|write|draft)\s+a\s+(?:(?:research\s+|workflow\s+|implementation\s+|execution\s+)+)?plan\s+(?:for|to|about)\s+/i;
const evaluate_RE = /(?:evaluate|analy[sz]e|inspect|review|research|assess|look at|check)\s+(?:the\s+)?(?:revenue potential of|value of|profitability of)\s+/i;

// ── Time context ─────────────────────────────────────────────────────────────

function buildTimeContext(timezone: string): { currentUtc: string; currentLocalTime: string } {
  const now = new Date();
  const tz = timezone || 'UTC';
  let localTime = '';
  try {
    localTime = now.toLocaleString('en-US', {
      timeZone: tz,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    localTime = now.toISOString();
  }
  return { currentUtc: now.toISOString(), currentLocalTime: localTime };
}

// ── Pronoun resolution (typed references, NOT regex scraping) ───────────────

function resolvePronoun(prompt: string, state: DialogueState): EntityRef | null {
  const p = prompt.toLowerCase().trim();

  // "that" → pendingAction.target (if pending action awaiting confirmation)
  if (/\b(that|this one|the proposed action)\b/.test(p) && state.pendingActionId) {
    const pa = getPendingAction(state.pendingActionId);
    if (pa?.target) return pa.target;
  }

  // "it" / "this" / "that" → activeEntity (most recently resolved entity)
  if (/\b(it|this|that|that one)\b/.test(p) && state.activeEntity) {
    return state.activeEntity;
  }

  return null;
}

// ── Deterministic handlers ───────────────────────────────────────────────────

function detectCancellation(prompt: string): boolean {
  const p = prompt.trim().toLowerCase();
  if (!p) return false;
  // "cancel the task", "stop the delegation" etc. — reject of an in-flight proposal
  if (CANCEL_RE.test(p)) return true;
  return /\b(cancel|reject|never mind)\b.*\b(delegation|proposal|plan|task|that action)\b/i.test(p);
}

function confirmTextFor(pa: PendingAction): string {
  const targetName = pa.target?.displayName || pa.objective || 'this';
  const worker = pa.executor || 'an agent';
  return `I can delegate "${targetName}" to ${worker} for this: "${pa.objective}". Shall I proceed?`;
}

// ── Idempotent delegation execution (§10) ─────────────────────────────────────

export interface PendingActionExecution {
  taskId: string;
  alreadyExisted: boolean;
  message: string;
  status: 'queued' | 'blocked';
}

/**
 * Execute a confirmed pending action by delegating to the real worker
 * (Hermes via delegateHermesTask, CodeX via delegateCodexGoal). Idempotency is
 * guaranteed by pendingAction.id + delegatedTaskId: a repeated confirmation
 * reuses the already-allocated task instead of creating a duplicate.
 *
 * The DelegationEnvelope preserves the canonical context (target entity,
 * objective, parent goal, pending action id) so the worker receives
 * structured context, never a flattened prompt string (§14).
 */
async function executePendingAction(pa: PendingAction, state: DialogueState): Promise<PendingActionExecution> {
  // IDEMPOTENCY — already delegated: reuse the allocated task.
  if (pa.delegatedTaskId) {
    return {
      taskId: pa.delegatedTaskId,
      alreadyExisted: true,
      message: `Task ${taskShortId(pa.delegatedTaskId)} is already allocated to ${pa.executor || 'worker'} for this action.`,
      status: 'queued',
    };
  }

  updatePendingAction(pa.id, { status: 'executing' });

  // Re-read under the execution lock: concurrent confirmations must not
  // double-delegate in the gap between the check above and this flip.
  const refreshed = getPendingAction(pa.id);
  if (refreshed?.delegatedTaskId) {
    return {
      taskId: refreshed.delegatedTaskId,
      alreadyExisted: true,
      message: `Task ${taskShortId(refreshed.delegatedTaskId)} was already allocated by a concurrent confirmation.`,
      status: 'queued',
    };
  }

  const envelope: DelegationEnvelope = {
    pendingActionId: pa.id,
    target: pa.target || undefined,
    objective: pa.objective || pa.intent,
    acceptanceCriteria: Array.isArray((pa.args as any)?.acceptanceCriteria) ? (pa.args as any).acceptanceCriteria : undefined,
    constraints: (pa.args as any)?.constraints,
    relevantInstruction: (pa.args as any)?.relevantInstruction,
    relatedTaskIds: (pa.args as any)?.relatedTaskIds,
    relatedResultIds: (pa.args as any)?.relatedResultIds,
    parentGoal: state.activeGoal?.description || (state as any)?.activeGoal?.description,
  };

  let result: { taskId: string; message: string; blocked?: boolean };
  try {
    const executor = (pa.executor || 'hermes').toLowerCase();
    if (executor === 'antigravity') {
      const { delegateAntigravityTask } = await import('./supervisorTools.js');
      const out = await delegateAntigravityTask({
        objective: pa.objective || pa.intent,
        conversationId: pa.conversationId,
        envelope,
      });
      result = { taskId: out.taskId, message: out.message, blocked: out.status === 'blocked' };
    } else if (executor === 'codex') {
      const { delegateCodexGoal } = await import('./supervisorTools.js');
      const out = await delegateCodexGoal({
        goal: pa.objective || pa.intent,
        conversationId: pa.conversationId,
        envelope,
      });
      result = { taskId: out.taskId, message: out.message, blocked: out.status === 'blocked' };
    } else {
      const { delegateHermesTask } = await import('./supervisorTools.js');
      const out = await delegateHermesTask({
        objective: pa.objective || pa.intent,
        conversationId: pa.conversationId,
        envelope,
      });
      result = { taskId: out.taskId, message: out.message, blocked: out.status === 'blocked' };
    }
  } catch (err: any) {
    updatePendingAction(pa.id, { status: 'failed' });
    throw err;
  }

  updatePendingAction(pa.id, { status: 'executing', delegatedTaskId: result.taskId });
  upsertDialogueState(pa.conversationId, {
    delegatedTaskId: result.taskId,
    activeTaskId: result.taskId,
    pendingActionId: null,
    lastResolvedIntent: 'pending_action_executed',
  });

  return {
    taskId: result.taskId,
    alreadyExisted: false,
    message: result.message,
    status: result.blocked ? 'blocked' : 'queued',
  };
}

function findAffectedTask(state: DialogueState, conversationId: string): BackgroundTaskRecord | null {
  if (state.activeTaskId) {
    const t = backgroundTaskRepo.getTask(state.activeTaskId);
    if (t) return t;
  }
  if (state.delegatedTaskId) {
    const t = backgroundTaskRepo.getTask(state.delegatedTaskId);
    if (t) return t;
  }
  const allRecent = backgroundTaskRepo.listTasks({ limit: 50 });
  const convTasks = allRecent.filter((t) => t.conversationId === conversationId);
  if (convTasks.length > 0) {
    const blockedOrFailed = convTasks.find((t) => t.status === 'blocked' || t.status === 'failed');
    return blockedOrFailed || convTasks[0];
  }
  const recentBlockedOrFailed = allRecent.find((t) => t.status === 'blocked' || t.status === 'failed');
  return recentBlockedOrFailed || null;
}

// ── Main resolver ────────────────────────────────────────────────────────────

/**
 * Resolve a single semantic turn. Returns a handled DeterministicResponse or
 * a semanticContext describing what needs LLM reasoning.
 */
export async function resolveSemanticTurn(
  prompt: string,
  conversationId: string,
  opts: ResolveSemanticTurnOptions = {},
): Promise<SemanticResult> {
  const state = getDialogueState(conversationId) || {
    conversationId,
    activeEntity: null,
    activeGoal: null,
    activeTaskId: null,
    pendingActionId: null,
    delegatedTaskId: null,
    lastCompletedActionId: null,
    lastResolvedIntent: null,
    userTimezone: 'Europe/Berlin',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const activePa = state.pendingActionId ? getPendingAction(state.pendingActionId) : null;
  const activeAwaiting = activePa?.status === 'awaiting_confirmation' ? activePa : null;

  // 1. EXPLICIT CANCEL / REJECT
  if (detectCancellation(prompt)) {
    if (activeAwaiting) {
      updatePendingAction(activeAwaiting.id, { status: 'rejected' });
      upsertDialogueState(conversationId, { pendingActionId: null, lastResolvedIntent: 'rejected_pending' });
      return {
        handled: true,
        decision: { type: 'reject_pending', pendingActionId: activeAwaiting.id },
        dialogueState: getDialogueState(conversationId) || state,
        response: {
          text: 'Cancelled. No task was delegated.',
          intent: 'reject_pending',
        },
      };
    }
    const affected = findAffectedTask(state, conversationId);
    if (affected && !TERMINAL_STATUSES.has(affected.status)) {
      backgroundTaskManager.cancelTask(affected.taskId, 'User cancelled task via conversation');
      upsertDialogueState(conversationId, { activeTaskId: null, delegatedTaskId: null, lastResolvedIntent: 'task_recovery_cancelled' });
      return {
        handled: true,
        decision: { type: 'task_recovery', action: 'cancel', taskId: affected.taskId },
        dialogueState: getDialogueState(conversationId) || state,
        response: {
          text: `Cancelled task ${taskShortId(affected.taskId)}.`,
          intent: 'cancel',
        },
      };
    }
    return {
      handled: true,
      decision: { type: 'anything' },
      dialogueState: state,
      response: {
        text: 'Cancelled.',
        intent: 'cancel',
      },
    };
  }

  // 1b. TASK RECOVERY — explain failure or retry interrupted/blocked task
  const EXPLAIN_FAILURE_RE =
    /^(?:what\s+went\s+wrong(?:\s+with\s+(?:it|the\s+task))?|why\s+is\s+it\s+blocked|why\s+did\s+it\s+fail|what\s+happened(?:\s+to\s+(?:it|the\s+task))?)[.!?]*$/i;
  const RETRY_TASK_RE =
    /^(?:retry(?:\s+it|\s+the\s+task)?|start(?:\s+it|\s+the\s+task)?\s+again|give(?:\s+it)?\s+to\s+hermes\s+again|run(?:\s+it)?\s+again)[.!?]*$/i;

  if (EXPLAIN_FAILURE_RE.test(prompt.trim())) {
    const affected = findAffectedTask(state, conversationId);
    if (affected) {
      const reason = affected.blocker || affected.lastError || affected.progressMessage || 'The task execution was interrupted.';
      return {
        handled: true,
        decision: { type: 'task_recovery', action: 'explain', taskId: affected.taskId },
        dialogueState: state,
        response: {
          text: `Task ${taskShortId(affected.taskId)} (${affected.title}) was interrupted: ${reason} You can say "Retry it" to run it again, or "Cancel it" to dismiss it.`,
          intent: 'task_recovery_explained',
          data: { taskId: affected.taskId, blocker: affected.blocker, lastError: affected.lastError },
        },
      };
    }
  }

  if (RETRY_TASK_RE.test(prompt.trim())) {
    const affected = findAffectedTask(state, conversationId);
    if (affected) {
      const { task: newTask, error } = backgroundTaskManager.createTask({
        title: affected.title,
        objective: affected.objective,
        originalRequest: affected.originalRequest,
        route: affected.route,
        selectedAgent: affected.selectedAgent || (affected.worker === 'hermes' ? 'Hermes' : 'Revenue Operator'),
        worker: affected.worker,
        priority: affected.priority,
        conversationId,
        resumable: affected.resumable,
        metadata: { ...(affected.metadata || {}), retryOf: affected.taskId },
        boardCardId: affected.linkedBoardCardId,
      });

      if (!newTask) {
        return {
          handled: true,
          decision: { type: 'task_recovery', action: 'retry', taskId: affected.taskId },
          dialogueState: state,
          response: {
            text: `Could not retry task: ${error || 'creation failed'}.`,
            intent: 'task_recovery_retry_failed',
          },
        };
      }

      dispatchTask(newTask).catch(() => {});
      upsertDialogueState(conversationId, {
        activeTaskId: newTask.taskId,
        delegatedTaskId: newTask.taskId,
        lastResolvedIntent: 'task_recovery_retried',
      });

      return {
        handled: true,
        decision: { type: 'task_recovery', action: 'retry', taskId: newTask.taskId },
        dialogueState: getDialogueState(conversationId) || state,
        response: {
          text: `Retrying ${affected.title} as task ${taskShortId(newTask.taskId)} with ${newTask.selectedAgent}.`,
          intent: 'task_recovery_retried',
          data: { oldTaskId: affected.taskId, newTaskId: newTask.taskId },
        },
      };
    }
  }

  // 2. PENDING ACTION CONFIRMATION — approve AND execute (idempotent §10).
  //    Repeated confirmations reuse the allocated task; never duplicate.
  const hasIndicationsRef = /\b(?:indications?|instructions?|parameters?|constraints?)\b/i.test(prompt);
  const hasSeeThemRef = /\b(?:do you see them|can you see them|see them)\b/i.test(prompt);
  const isTaskQueueRequest = /\b(?:task\s+queue|prepare\s+(?:the\s+)?task|queue\s+(?:the\s+)?task)\b/i.test(prompt);

  if (activeAwaiting && CONFIRM_RE.test(prompt.trim())) {
    try {
      const execution = await executePendingAction(activeAwaiting, state);
      let replyText = execution.alreadyExisted
        ? execution.message
        : `Approved. I delegated "${activeAwaiting.objective || 'task'}" to ${activeAwaiting.executor || 'hermes'} — task ${taskShortId(execution.taskId)} (${execution.status}).`;

      if (hasIndicationsRef && hasSeeThemRef) {
        const targetName = activeAwaiting.target?.displayName || state.activeEntity?.displayName || 'the project';
        replyText = `The task queue is prepared for ${targetName} (${taskShortId(execution.taskId)}). I don't see the additional indications yet; give them to me and I'll attach them to the task before execution.`;
      }

      return {
        handled: true,
        decision: { type: 'confirm_pending', pendingActionId: activeAwaiting.id },
        dialogueState: getDialogueState(conversationId) || state,
        response: {
          text: replyText,
          intent: 'confirm_pending',
          data: { pendingActionId: activeAwaiting.id, taskId: execution.taskId, alreadyExisted: execution.alreadyExisted, status: execution.status },
        },
      };
    } catch (err: any) {
      const reason = err?.message || 'the delegate failed';
      return {
        handled: true,
        decision: { type: 'confirm_pending', pendingActionId: activeAwaiting.id },
        dialogueState: getDialogueState(conversationId) || state,
        response: {
          text: `I tried to delegate "${activeAwaiting.objective || 'task'}" but it could not be created: ${reason}`,
          intent: 'confirm_pending_failed',
          data: { pendingActionId: activeAwaiting.id, error: String(err?.message || err) },
        },
      };
    }
  }

  // 2b. COMPOUND CONFIRMATION & TASK QUEUE PREPARATION (when prior LLM turn proposed an action without structured pendingAction)
  if (!activeAwaiting && CONFIRM_RE.test(prompt.trim()) && isTaskQueueRequest && state.activeEntity) {
    try {
      const { delegateHermesTask } = await import('./supervisorTools.js');
      const target = state.activeEntity;
      const objective = `Prepare and monitor task queue for ${target.displayName}`;
      const out = await delegateHermesTask({
        objective,
        conversationId,
        envelope: {
          target,
          objective,
          parentGoal: state.activeGoal?.description,
        },
      });

      upsertDialogueState(conversationId, {
        activeTaskId: out.taskId,
        delegatedTaskId: out.taskId,
        activeEntity: target,
        lastResolvedIntent: 'compound_confirm_and_await_indications',
      });

      let replyText = `The task queue is prepared for ${target.displayName} (${taskShortId(out.taskId)}).`;
      if (hasIndicationsRef && hasSeeThemRef) {
        replyText += ` I don't see the additional indications yet; give them to me and I'll attach them to the task before execution.`;
      }

      return {
        handled: true,
        decision: { type: 'confirm_pending', pendingActionId: out.taskId },
        dialogueState: getDialogueState(conversationId) || state,
        response: {
          text: replyText,
          intent: 'confirm_pending',
          data: { taskId: out.taskId, status: out.status },
        },
      };
    } catch (err: any) {
      // Fall through to other handlers if creation fails
    }
  }

  // 3. PENDING ACTION REJECTION
  if (activeAwaiting && REJECT_RE.test(prompt.trim())) {
    updatePendingAction(activeAwaiting.id, { status: 'rejected' });
    upsertDialogueState(conversationId, { pendingActionId: null, lastResolvedIntent: 'rejected_pending' });
    return {
      handled: true,
      decision: { type: 'reject_pending', pendingActionId: activeAwaiting.id },
      dialogueState: getDialogueState(conversationId) || state,
      response: {
        text: 'Okay, I\'ve cancelled that task.',
        intent: 'reject_pending',
      },
    };
  }

  // 4. EXPLICIT ACTION — navigation / module open / action runtime
  const parsedAction = await parseJarvisAction(prompt, opts.workspaceContext);
  if (parsedAction.isAction && 'action' in parsedAction && parsedAction.action) {
    return {
      handled: true,
      decision: { type: 'action', action: parsedAction },
      dialogueState: state,
      response: {
        text: parsedAction.explanation,
        intent: 'explicit_action',
      },
    };
  }

  // 4b. SYSTEM INTROSPECTION — closed-world deterministic queries about runtime state
  //     ("What AI model are you using right now?", "What provider are you using?",
  //      "Are you using a fallback?", "What are we currently working on?",
  //      "Do you have a pending action?")
  const introspection = detectSystemIntrospection(prompt);
  if (introspection.isIntrospection && introspection.subject) {
    const introspectionResult = await handleSystemIntrospection(introspection.subject, conversationId, state);
    return {
      handled: true,
      decision: { type: 'system_introspection', subject: introspection.subject, data: introspectionResult.data },
      dialogueState: state,
      response: {
        text: introspectionResult.text,
        intent: introspectionResult.intent,
        data: introspectionResult.data,
      },
    };
  }

  // 5. DELEGATION PROPOSAL — deterministic Source A proposal creation
  //   "Create a research workflow plan for FreeCash" / "Evaluate FreeCash"
  //   / "Give that to Hermes" → createPendingAction(awaiting_confirmation)
  const workerMatch = ping_worker_RE.exec(prompt);
  const taskPhrase = workerMatch?.[1] || null;
  const requestedWorker = workerMatch?.[2] || null;
  const isPlanRequest = create_plan_RE.test(prompt);
  const isEvaluateRequest = evaluate_RE.test(prompt);

  let entity = await resolveEntity(prompt);
  if (entity?.id === 'jarvis') entity = null;
  const pronounRef = resolvePronoun(prompt, state);
  const fallbackRef: EntityRef | null = (requestedWorker && taskPhrase) ? {
    id: `task-${randomUUID().slice(0, 8)}`,
    type: 'task',
    displayName: taskPhrase.replace(/^[.\s,;!?-]+|[.\s,;!?-]+$/g, '').trim(),
  } : null;
  // When a worker is specified (e.g. "Give that to Codex" or "Give the implementation review to Codex"),
  // resolve target entity from pronoun or activeEntity.
  const targetRef = (requestedWorker && (pronounRef || state.activeEntity))
    ? (pronounRef || state.activeEntity)
    : (entity || pronounRef || fallbackRef);

  if (targetRef && (isPlanRequest || isEvaluateRequest || requestedWorker)) {
    let resolvedObjective = `Work on ${targetRef.displayName}`;
    if (taskPhrase && !/^(it|that|this|this to|that to|this task|that task)$/i.test(taskPhrase.trim())) {
      resolvedObjective = taskPhrase.replace(/^[.\s,;!?-]+|[.\s,;!?-]+$/g, '').trim();
    } else if (state.activeEntity) {
      resolvedObjective = `Work on ${state.activeEntity.displayName}`;
    } else if (isPlanRequest) {
      resolvedObjective = `Create a research workflow plan for ${targetRef.displayName}`;
    }

    const pa = createPendingAction({
      id: `pa-${randomUUID().slice(0, 10)}`,
      conversationId,
      intent: 'delegate',
      target: targetRef,
      executor: (requestedWorker || (isPlanRequest ? 'hermes' : undefined))?.toLowerCase(),
      objective: resolvedObjective,
      status: 'awaiting_confirmation',
    });
    upsertDialogueState(conversationId, {
      pendingActionId: pa.id,
      activeEntity: targetRef,
      lastResolvedIntent: 'delegation_proposal',
    });

    const isExplicitDirective = /^(?:jarvis,?\s*)?(?:delegate|give|assign)\b/i.test(prompt.trim());
    if (isExplicitDirective && requestedWorker?.toLowerCase() === 'antigravity') {
      const execResult = await executePendingAction(pa, state);
      return {
        handled: true,
        decision: { type: 'execute_pending', pendingActionId: pa.id, taskId: execResult.taskId },
        dialogueState: getDialogueState(conversationId) || state,
        response: {
          text: execResult.message,
          intent: 'delegated_task',
          data: { taskId: execResult.taskId, worker: 'antigravity' },
        },
      };
    }

    return {
      handled: true,
      decision: { type: 'created_proposal', pendingActionId: pa.id },
      dialogueState: getDialogueState(conversationId) || state,
      response: {
        text: confirmTextFor(pa),
        intent: 'delegation_proposal',
        data: { pendingActionId: pa.id },
      },
    };
  }

  // 6. ENTITY RESOLUTION — "Can you see the FreeCash operator?"
  if (entity) {
    upsertDialogueState(conversationId, {
      activeEntity: entity,
      lastResolvedIntent: 'entity_resolved',
    });
    const isNavigation = /^\s*(?:can you\s+|could you\s+|please\s+|i would like to\s+|i want to\s+|i'd like to\s+|let me\s+|can i\s+)*(?:open|show|view|see|bring up|go to|switch to|display)\b/i.test(prompt) ||
      /\b(?:open|show|view|see|bring up)\b.*\b(?:so\s+)?(?:that\s+)?(?:i\s+can\s+see\s+it)\b/i.test(prompt);

    if (isNavigation && !/^\s*(?:can you|do you|are you able to)\s+(?:see|find)\b/i.test(prompt)) {
      const destination = entity.domain === 'projects' || entity.type === 'project'
        ? `/projects?project=${encodeURIComponent(entity.id)}`
        : (entity.domain === 'revenue_operator' ? `/revenue-operator?${entity.type === 'mission' ? 'mission' : 'opportunity'}=${encodeURIComponent(entity.id)}` : `/${entity.domain || 'projects'}`);

      return {
        handled: true,
        decision: {
          type: 'action',
          action: {
            isAction: true,
            action: {
              type: 'OPEN_ENTITY',
              module: entity.domain || 'projects',
              entityType: entity.type,
              entityId: entity.id,
              displayName: entity.displayName,
              destination,
            },
            explanation: `Opening ${entity.displayName}.`,
          }
        },
        dialogueState: getDialogueState(conversationId) || state,
        response: {
          text: `Opening ${entity.displayName}.`,
          intent: 'navigation',
          data: { entity, destination },
        },
      };
    }

    const isQuestion = /\b(can you|do you|are you|see|show|check|find|look at|what is|where is|tell me about|what do you|inspect|examine|open|review|audit|investigate|view)\b/i.test(prompt);
    if (isQuestion) {
      const isInspect = /\b(inspect|examine|review|audit|investigate|details|status)\b/i.test(prompt);
      let details = '';
      if (isInspect && entity.domain === 'revenue_operator') {
        try {
          const { getOpportunity } = await import('../../services/revenueOperator/opportunityService.js');
          const opp = await getOpportunity(entity.id);
          if (opp) {
            details = ` (status: ${opp.status}, score: ${opp.score}/100, estimated revenue: $${opp.estimatedRevenue})`;
          }
        } catch {}
      } else if (isInspect && entity.domain === 'projects') {
        try {
          const { projectsStore } = await import('../../services/projectsStore.js');
          const proj = projectsStore.getProject(entity.id);
          if (proj) {
            details = ` (status: ${proj.status || 'active'}, priority: ${proj.priority || 1})`;
          }
        } catch {}
      }
      const desc = `${entity.displayName} (${entity.type} in ${entity.domain})`;
      const text = isInspect
        ? `I have inspected ${desc}${details}. What would you like to do next with it?`
        : `Yes, I see the ${desc}. What would you like to do with it?`;
      return {
        handled: true,
        decision: { type: 'entity_resolved', entity },
        dialogueState: getDialogueState(conversationId) || state,
        response: {
          text,
          intent: 'entity_resolved',
          data: { entity },
        },
      };
    }
  }

  // 6b. RECOMMENDATION FOLLOW-UP — "Why?"
  if (WHY_RE.test(prompt.trim()) && state.lastRecommendation) {
    return {
      handled: true,
      decision: { type: 'recommendation_rationale', rationale: state.lastRecommendation.reason },
      dialogueState: state,
      response: {
        text: `${state.lastRecommendation.reason} Would you like me to proceed with that?`,
        intent: 'recommendation_rationale',
        data: { recommendation: state.lastRecommendation },
      },
    };
  }

  // 6c. RECOMMENDATION CONFIRMATION — "Do that." (when no active awaiting pendingAction)
  if (DO_THAT_RE.test(prompt.trim()) && state.lastRecommendation && !activeAwaiting) {
    const rec = state.lastRecommendation;
    const pa = createPendingAction({
      id: `pa-${randomUUID().slice(0, 10)}`,
      conversationId,
      intent: 'delegate',
      target: rec.target,
      executor: rec.worker || 'hermes',
      objective: rec.action,
      status: 'awaiting_confirmation',
    });
    upsertDialogueState(conversationId, {
      pendingActionId: pa.id,
      lastResolvedIntent: 'delegation_proposal',
    });
    return {
      handled: true,
      decision: { type: 'created_proposal', pendingActionId: pa.id },
      dialogueState: getDialogueState(conversationId) || state,
      response: {
        text: confirmTextFor(pa),
        intent: 'delegation_proposal',
        data: { pendingActionId: pa.id },
      },
    };
  }

  // 6d. NEXT STEP RECOMMENDATION — "What should we do next?" / "What's next?" / "What would you recommend?"
  if (NEXT_STEP_RE.test(prompt.trim()) && (state.activeEntity || state.activeGoal)) {
    const activeEnt = state.activeEntity;
    const isFreeCashOrRev = activeEnt && (
      activeEnt.domain === 'revenue_operator' ||
      activeEnt.type === 'revenue_opportunity' ||
      /free\s*cash/i.test(activeEnt.displayName)
    );

    let recAction = '';
    let recReason = '';
    let recText = '';
    let recWorker = 'hermes';

    if (isFreeCashOrRev && activeEnt) {
      recAction = `Create a research workflow plan for ${activeEnt.displayName}`;
      recReason = `${activeEnt.displayName} is in the discovery and evaluation stage with strong automation potential (80%) and high confidence (85%), but requires a technical research and workflow plan to verify execution viability, identify blockers, and outline implementation stages.`;
      recText = `I recommend creating a research workflow plan with Hermes to analyze the ${activeEnt.displayName} opportunity, verify technical viability, evaluate blockers, and outline implementation stages. Would you like me to proceed with that?`;
      recWorker = 'hermes';
    } else if (activeEnt) {
      recAction = `Create an execution plan for ${activeEnt.displayName}`;
      recReason = `${activeEnt.displayName} has been selected as the active target. Planning with Hermes will evaluate dependencies and define concrete execution steps.`;
      recText = `I recommend creating a research and execution plan with Hermes for ${activeEnt.displayName}. Would you like me to proceed with that?`;
      recWorker = 'hermes';
    } else if (state.activeGoal) {
      const goalDesc = typeof state.activeGoal === 'string' ? state.activeGoal : state.activeGoal.description;
      recAction = `Create a plan for: ${goalDesc}`;
      recReason = `The active goal requires structured planning and task decomposition before execution.`;
      recText = `I recommend drafting an execution plan for "${goalDesc}" with Hermes to decompose the goal into actionable tasks. Would you like to proceed?`;
      recWorker = 'hermes';
    }

    const rec: RecommendationRef = {
      action: recAction,
      reason: recReason,
      target: state.activeEntity,
      worker: recWorker,
    };

    upsertDialogueState(conversationId, {
      lastRecommendation: rec,
      lastResolvedIntent: 'recommend_next_step',
    });

    return {
      handled: true,
      decision: { type: 'recommend_next_step', recommendation: rec },
      dialogueState: getDialogueState(conversationId) || state,
      response: {
        text: recText,
        intent: 'recommend_next_step',
        data: { recommendation: rec },
      },
    };
  }

  // 7. CONTINUATION / REFERENCE — "continue it", "do that", "show me what you did"
  const recentText = (opts.recentHistory || []).map((m) => m.content).join('\n');
  const continuation = resolveContinuationIntent(prompt, recentText);
  if (continuation.resolved !== 'unresolved') {
    // "continue it" with an active task → resume or report status
    const activeTaskId = state.activeTaskId || state.delegatedTaskId;
    if (activeTaskId) {
      const taskId: string = activeTaskId;
      const { backgroundTaskRepo } = await import('../../services/backgroundTasks/store.js');
      const task = backgroundTaskRepo.getTask(taskId);
      const taskStatusText = task
        ? `Task ${taskShortId(task.taskId)} (${task.worker || 'agent'}) is currently ${task.status}. ${task.progressMessage || ''}`.trim()
        : `I'll resume task ${taskId}.`;
      return {
        handled: true,
        decision: { type: 'continuation', resolution: continuation },
        dialogueState: state,
        response: {
          text: taskStatusText,
          intent: 'continuation',
          data: { taskId, status: task?.status || 'unknown' },
        },
      };
    }
    if (state.activeEntity && continuation.resolved === 'direct_confirm') {
      return {
        handled: true,
        decision: { type: 'continuation', resolution: continuation },
        dialogueState: state,
        response: {
          text: `Okay, continuing on ${state.activeEntity.displayName}.`,
          intent: 'continuation_entity',
          data: { entity: state.activeEntity },
        },
      };
    }
  }

  // 8. DETERMINISTIC INTENT — worker status, revenue pipeline, etc.
  const intent = classifyExecutiveIntent(prompt);
  if (intent) {
    return {
      handled: true,
      decision: { type: 'intent_classified', intent },
      dialogueState: state,
      response: {
        text: intent.reason || intent.intent,
        intent: intent.intent,
        data: { intent },
      },
    };
  }

  // 9. REQUIRES LLM — build structured context
  const timeCtx = buildTimeContext(state.userTimezone);
  const semanticContext: SemanticContext = {
    activeEntity: state.activeEntity,
    pendingAction: activePa,
    activeGoal: state.activeGoal?.description || null,
    activeTaskId: state.activeTaskId,
    delegatedTaskId: state.delegatedTaskId,
    resolvedReferences: state.activeEntity ? [state.activeEntity] : [],
    userTimezone: state.userTimezone,
    currentUtc: timeCtx.currentUtc,
    currentLocalTime: timeCtx.currentLocalTime,
    recentHistory: opts.recentHistory || [],
  };

  return {
    handled: false,
    decision: { type: 'requires_llm' },
    dialogueState: state,
    semanticContext,
  };
}

/** Convenience: build a DeterministicResponse from arbitrary text. */
export function streamableResponse(text: string, intent: string): SemanticResult['response'] {
  return { text, intent };
}