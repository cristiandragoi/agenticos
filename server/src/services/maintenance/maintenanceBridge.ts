/**
 * Maintenance Supervisor — Jarvis conversational bridge (Phase 4.1).
 *
 * Wires natural Jarvis requests to the Maintenance Supervisor without adding
 * another user-facing agent or rewriting the intent router. This module owns the
 * CONVERSATION-LEVEL decisions for self-maintenance:
 *
 *   "check why the tests are failing"  → start an investigation (real loop)
 *   "can you fix it?" / "fix it"       → continue the SAME changeSet (plan→repair→test→verify)
 *   "did the fix work?"                → answer from persisted test/verifier evidence
 *   "what is CodeX doing?"             → answer from persisted changeSet state
 *   "what did Hermes recommend?"       → answer from the persisted Hermes plan result
 *   "what did CodeX change?"           → answer from the persisted CodeX repair files
 *   "where were we?"                   → reconstruct persisted state
 *   "commit it"                        → ONLY when approved + gates passed (explicit)
 *
 * SAFETY: "okay"/"continue"/"go ahead"/"fix it" NEVER reach the commit path. Only
 * an explicit "commit …" phrase, after the changeSet reached `ready_for_approval`
 * and `approveChangeSet` ran with explicit authorization, performs a commit.
 */

import { randomUUID } from 'crypto';
import { conversationService } from '../../domains/conversations/service.js';
import { getWorkspaceRoot } from '../../services/workspaceStore.js';
import { executionRunService } from '../../services/projectExecution/executionRunService.js';
import {
  diagnoseAndRepair,
  getMaintenanceStatus,
  approveChangeSet,
  commitChangeSet,
  rejectChangeSet,
} from './maintenanceSupervisor.js';
import {
  detectMaintenanceIntent,
  isFixWorkedQuestion,
  isHermesRecommendQuestion,
  isCodexChangeQuestion,
  isCodexDoingQuestion,
} from './maintenanceIntent.js';
import type { PlanAdapter, RepairAdapter, TestAdapter, VerifyAdapter } from './repairLoop.js';
import type { MaintenanceChangeSet, MaintenanceTestGate } from './changeSet.js';

export interface MaintenanceTurnResult {
  route: string;
  status?: string;
  error?: string;
  operationId?: string;
  changeSetId?: string;
}

export interface MaintenanceTurnContext {
  conversationId: string;
  prompt: string;
  workspacePath: string;
  operationId?: string;
  /** Explicit owned files for a new investigation (acceptance/fixture). */
  files?: string[];
  forbiddenFiles?: string[];
  /** Typed, allowlisted gate definitions (reproduction + verification). */
  testGates?: MaintenanceTestGate[];
  /** Injected adapters for deterministic tests; omit for the REAL adapters. */
  adapters?: { plan?: PlanAdapter; repair?: RepairAdapter; reproduce?: TestAdapter; test?: TestAdapter; verify?: VerifyAdapter };
  /** Allow commit to actually run (default false). Never enabled implicitly. */
  allowCommit?: boolean;
}

/* ── Status answers (from persisted evidence) ──────────────────────────── */

function describeStatus(cs: MaintenanceChangeSet): string {
  switch (cs.status) {
    case 'investigating':
    case 'planning':
      return 'Hermes is diagnosing the problem and preparing a repair plan.';
    case 'repairing':
      return 'CodeX is working on the repair right now.';
    case 'testing':
      return 'The repair is running through the test gates.';
    case 'verifying':
      return 'The verifier is checking the repair.';
    case 'ready_for_approval':
      return 'The repair passed the test gates and verification, and is waiting for your approval before committing.';
    case 'approved':
      return 'The repair is approved and ready to commit.';
    case 'committing':
      return 'The repair is being committed.';
    case 'completed':
      return `The maintenance operation is complete.${cs.reason ? ` ${cs.reason}` : ''}`;
    case 'blocked':
      return `The repair was blocked: ${cs.reason || 'ownership or safety check failed'}.`;
    case 'failed':
      return `The repair failed after ${cs.attempts} attempt${cs.attempts === 1 ? '' : 's'}: ${cs.reason || 'no further detail'}.`;
    case 'rejected':
      return `The repair was rejected: ${cs.reason || 'declined by the user'}.`;
    default:
      return `Maintenance is in state '${cs.status}'.`;
  }
}

function describeFixWorked(cs: MaintenanceChangeSet): string {
  if (['ready_for_approval', 'approved', 'completed', 'committing'].includes(cs.status)) {
    const tests = cs.testResults;
    const allPassed = !tests || tests.every((t) => t.passed);
    const verifier = cs.verification;
    const parts: string[] = [];
    if (allPassed) parts.push('the test gates passed');
    else parts.push('the test gates did not fully pass');
    if (verifier) parts.push(verifier.passed ? 'the verifier passed' : 'the verifier failed');
    return `Yes — the fix worked: ${parts.join(' and ') || 'all checks passed'}.${cs.status === 'ready_for_approval' ? ' It is waiting for your approval to commit.' : ''}`;
  }
  if (cs.status === 'failed') return `No — the fix did not work: ${cs.reason || 'the repair loop gave up'}.`;
  if (cs.status === 'blocked') return `No — the fix was blocked: ${cs.reason || 'a safety check failed'}.`;
  return `The fix hasn't finished yet — it's in state '${cs.status}'.`;
}

function describeHermesRecommendation(cs: MaintenanceChangeSet): string {
  if (cs.planResultId) {
    const r = executionRunService.getResult(cs.planResultId);
    if (r?.summary) return `Hermes recommended: ${String(r.summary).slice(0, 500)}`;
  }
  if (cs.status === 'planning') return 'Hermes is still preparing its recommendation.';
  return "I don't have a persisted Hermes recommendation for this yet.";
}

function describeCodexChange(cs: MaintenanceChangeSet): string {
  const files = (cs.filesChanged ?? []).map((f) => f.path);
  if (files.length > 0) {
    return `CodeX changed ${files.length} file${files.length === 1 ? '' : 's'}: ${files.join(', ')}.`;
  }
  if (cs.repairResultId) return 'CodeX completed a repair, but did not report specific changed files.';
  if (cs.status === 'repairing') return 'CodeX is working on the change right now.';
  return "CodeX hasn't reported a change yet.";
}

/* ── Message append helper ─────────────────────────────────────────────── */

async function reply(
  conversationId: string,
  content: string,
  operationId: string | undefined,
  extraMeta: Record<string, unknown> = {}
): Promise<void> {
  await conversationService.appendMessage({
    conversationId,
    role: 'agent',
    content,
    routedAgent: 'jarvis',
    metadata: {
      ...(operationId ? { operationId } : {}),
      provider: 'agentic-os',
      model: 'maintenance-supervisor',
      intent: { type: 'maintenance', ...extraMeta },
    },
  });
}

/* ── Main handler ──────────────────────────────────────────────────────── */

/**
 * Handle a message that concerns maintenance. Returns null when the message is
 * not maintenance-related, or when a maintenance-only intent (continue/status/
 * commit/reject) has no pending changeSet to act on (so normal routing applies).
 */
export async function handleMaintenanceTurn(ctx: MaintenanceTurnContext): Promise<MaintenanceTurnResult | null> {
  const intent = detectMaintenanceIntent(ctx.prompt);
  if (!intent) return null;

  const pending = getMaintenanceStatus();

  // START always begins a new investigation (no prior state required).
  if (intent === 'start') {
    return startInvestigation(ctx);
  }

  // Every other intent requires an existing maintenance changeSet.
  if (!pending) return null;

  switch (intent) {
    case 'continue':
      return continueInvestigation(ctx, pending);
    case 'commit':
      return commitApproved(ctx, pending);
    case 'reject':
      return rejectApproved(ctx, pending);
    case 'status':
      return answerStatus(ctx, pending);
    default:
      return null;
  }
}

async function startInvestigation(ctx: MaintenanceTurnContext): Promise<MaintenanceTurnResult> {
  const changeSetId = `maint-${randomUUID().slice(0, 12)}`;
  const repoPath = ctx.workspacePath && ctx.workspacePath !== 'default' ? ctx.workspacePath : getWorkspaceRoot();

  await reply(ctx.conversationId, 'I\'ll investigate that. Starting a maintenance investigation with Hermes to diagnose the problem and prepare a plan.', ctx.operationId, { changeSetId, phase: 'investigating' });

  const outcome = await diagnoseAndRepair({
    changeSetId,
    evidence: ctx.prompt,
    files: ctx.files ?? [],
    forbiddenFiles: ctx.forbiddenFiles ?? [],
    repoPath,
    conversationId: ctx.conversationId,
    testGates: ctx.testGates,
    plan: ctx.adapters?.plan,
    repair: ctx.adapters?.repair,
    reproduce: ctx.adapters?.reproduce,
    test: ctx.adapters?.test,
    verify: ctx.adapters?.verify,
  });

  const cs = outcome.changeSet;
  const summary =
    outcome.status === 'ready_for_approval'
      ? `I diagnosed the problem, prepared a repair, and it passed the test gates and verification. It's ready for your approval — I have NOT committed anything.${cs.filesChanged?.length ? ` CodeX changed: ${cs.filesChanged.join(', ')}.` : ''}`
      : outcome.status === 'blocked'
        ? `The repair was blocked: ${outcome.reason}`
        : `The repair did not succeed: ${outcome.reason || 'unknown failure'}.`;

  await reply(ctx.conversationId, summary, ctx.operationId, { changeSetId, status: cs.status, filesChanged: cs.filesChanged });

  return { route: 'maintenance', status: cs.status, operationId: ctx.operationId, changeSetId: cs.id };
}

async function continueInvestigation(ctx: MaintenanceTurnContext, pending: MaintenanceChangeSet): Promise<MaintenanceTurnResult> {
  // A changeSet already in a terminal success state has nothing left to repair.
  if (pending.status === 'ready_for_approval') {
    await reply(ctx.conversationId, `The repair is already done and passed the gates — it's waiting for your approval to commit. Say "commit it" to commit, or ask "what did CodeX change?" for details.`, ctx.operationId, { changeSetId: pending.id });
    return { route: 'maintenance', status: pending.status, operationId: ctx.operationId, changeSetId: pending.id };
  }
  if (['approved', 'committing', 'completed'].includes(pending.status)) {
    await reply(ctx.conversationId, describeStatus(pending), ctx.operationId, { changeSetId: pending.id });
    return { route: 'maintenance', status: pending.status, operationId: ctx.operationId, changeSetId: pending.id };
  }

  const repoPath = ctx.workspacePath && ctx.workspacePath !== 'default' ? ctx.workspacePath : getWorkspaceRoot();
  await reply(ctx.conversationId, 'Continuing the maintenance repair with Hermes planning and CodeX applying the fix.', ctx.operationId, { changeSetId: pending.id, phase: 'continuing' });

  const outcome = await diagnoseAndRepair({
    changeSetId: pending.id,
    evidence: pending.reason ?? 'continue prior maintenance repair',
    files: pending.files,
    forbiddenFiles: ctx.forbiddenFiles ?? [],
    repoPath,
    conversationId: ctx.conversationId,
    testGates: ctx.testGates,
    plan: ctx.adapters?.plan,
    repair: ctx.adapters?.repair,
    reproduce: ctx.adapters?.reproduce,
    test: ctx.adapters?.test,
    verify: ctx.adapters?.verify,
  });

  const cs = outcome.changeSet;
  const summary =
    outcome.status === 'ready_for_approval'
      ? `The repair passed the test gates and verification, and is ready for your approval — nothing has been committed.`
      : `The repair did not reach a ready state: ${outcome.reason || 'unknown failure'}.`;
  await reply(ctx.conversationId, summary, ctx.operationId, { changeSetId: cs.id, status: cs.status });

  return { route: 'maintenance', status: cs.status, operationId: ctx.operationId, changeSetId: cs.id };
}

async function answerStatus(ctx: MaintenanceTurnContext, pending: MaintenanceChangeSet): Promise<MaintenanceTurnResult> {
  let answer: string;
  if (isFixWorkedQuestion(ctx.prompt)) answer = describeFixWorked(pending);
  else if (isHermesRecommendQuestion(ctx.prompt)) answer = describeHermesRecommendation(pending);
  else if (isCodexChangeQuestion(ctx.prompt)) answer = describeCodexChange(pending);
  else if (isCodexDoingQuestion(ctx.prompt)) answer = describeStatus(pending);
  else answer = `${describeStatus(pending)} The changeSet is '${pending.id}'.`;

  await reply(ctx.conversationId, answer, ctx.operationId, { changeSetId: pending.id, status: pending.status });
  return { route: 'maintenance', status: pending.status, operationId: ctx.operationId, changeSetId: pending.id };
}

async function commitApproved(ctx: MaintenanceTurnContext, pending: MaintenanceChangeSet): Promise<MaintenanceTurnResult> {
  if (!ctx.allowCommit) {
    await reply(
      ctx.conversationId,
      pending.status === 'ready_for_approval'
        ? `I can commit this once you explicitly approve it. The repair passed the gates and is ready — but committing requires an explicit authorization I'm not going to infer from conversation.`
        : `I can only commit after the repair reaches "ready for approval" and is explicitly approved. Current state: ${pending.status}.`,
      ctx.operationId,
      { changeSetId: pending.id }
    );
    return { route: 'maintenance', status: pending.status, operationId: ctx.operationId, changeSetId: pending.id };
  }

  // Explicit commit authorization path (only reachable when the caller — not a
  // conversational continuation — grants commit authority).
  try {
    const approved = approveChangeSet(pending.id, { authorized: true, reason: 'explicit user commit authorization' });
    const repoPath = ctx.workspacePath && ctx.workspacePath !== 'default' ? ctx.workspacePath : getWorkspaceRoot();
    const result = await commitChangeSet(approved.id, repoPath, undefined, { authorized: true, reason: 'explicit user commit authorization' });
    const msg = result.status === 'completed'
      ? `Committed the repair as ${result.sha || 'a new commit'} (${result.committedFiles.join(', ')}).`
      : `Commit did not complete: ${result.reason}`;
    await reply(ctx.conversationId, msg, ctx.operationId, { changeSetId: approved.id, status: result.status });
    return { route: 'maintenance', status: result.status, operationId: ctx.operationId, changeSetId: approved.id };
  } catch (e: any) {
    await reply(ctx.conversationId, `Commit failed: ${e?.message}`, ctx.operationId, { changeSetId: pending.id });
    return { route: 'maintenance', error: e?.message, operationId: ctx.operationId, changeSetId: pending.id };
  }
}

async function rejectApproved(ctx: MaintenanceTurnContext, pending: MaintenanceChangeSet): Promise<MaintenanceTurnResult> {
  const rejected = rejectChangeSet(pending.id, 'declined by user');
  await reply(ctx.conversationId, `Okay — I've rejected the pending change and left the repository untouched.`, ctx.operationId, { changeSetId: rejected.id, status: 'rejected' });
  return { route: 'maintenance', status: 'rejected', operationId: ctx.operationId, changeSetId: rejected.id };
}

export type { MaintenanceChangeSet };
