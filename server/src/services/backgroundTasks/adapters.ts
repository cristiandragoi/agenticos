/**
 * Worker adapters for the Background Task Manager.
 *
 * Each adapter translates between the canonical task contract and one
 * existing AgenticOS worker integration:
 *   - hermes  → hermesApiService (live Hermes API server, /v1/runs)
 *   - codex   → codexService + goalStore (checkpointed CodeX goal loop)
 *   - research→ research brief workflow (db.researchBriefs + runStore)
 *   - team    → coordinatorService + TeamRunner (Agent Teams)
 *
 * Adapters own worker-specific execution; the manager owns orchestration.
 */
import { backgroundTaskManager } from './manager.js';
import { backgroundTaskRepo } from './store.js';
import { taskShortId, TERMINAL_STATUSES, type BackgroundTaskRecord } from './types.js';
import { getWorkspaceRoot } from '../workspaceStore.js';
import { hermesApiService, type HermesRunRecord, type HermesActivityEvent } from '../hermesApiService.js';
import { codexService } from '../../domains/codex/service.js';
import { goalStore } from '../goalStore.js';
import { resumeCodexGoalLoop } from '../../loops/codexLoop.js';
import { coordinatorService } from '../../domains/teams/coordinatorService.js';
import { TeamRunner } from '../agentTeams/teamRunner.js';
import { db as jsonDb } from '../db.js';
import { runStore } from '../runStore.js';
import { executeResearchBriefWorkflow } from '../../workflows/researchBrief.js';
import { randomUUID } from 'node:crypto';
import { logger } from '../../utils/logger.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRevenuePipeline, newRunId, type PipelineHooks } from '../revenuePipeline/pipelineService.js';
import type { PipelineConfig } from '../revenuePipeline/types.js';

/** Guard against duplicate dispatch of the same task (restore/retry safety). */
const dispatched = new Set<string>();

function markDispatched(taskId: string): boolean {
  if (dispatched.has(taskId)) return false;
  dispatched.add(taskId);
  return true;
}

/** Allow a recovery re-dispatch: clear the dispatch-once guard for the task. */
export function clearDispatchGuard(taskId: string): void {
  dispatched.delete(taskId);
}

// ── HERMES ADAPTER ──────────────────────────────────────────────────────────

/** Map upstream Hermes activity events → canonical task events. */
function hermesEventToTaskEvent(taskId: string, evt: HermesActivityEvent, record: HermesRunRecord): void {
  const mgr = backgroundTaskManager;
  const task = backgroundTaskRepo.getTask(taskId);
  if (!task || TERMINAL_STATUSES.has(task.status)) return; // stale protection (Test F)

  switch (evt.kind) {
    case 'run.started':
      mgr.transition(taskId, 'running', { currentStage: 'running', progressMessage: 'Hermes agent started.' });
      break;
    case 'assistant.delta':
      // Streaming text — progress only, no status change.
      mgr.appendEvent(taskId, 'task.progress', evt.summary || 'Hermes responding…', { streaming: true });
      break;
    case 'file.changed': {
      const files = [...new Set([...task.filesChanged, ...(Array.isArray(evt.detail?.files) ? (evt.detail.files as string[]) : [])])];
      mgr.progress(taskId, 'task.file_changed', evt.summary, { filesChanged: files }, { files: evt.detail?.files });
      break;
    }
    case 'approval.request': {
      mgr.requestApproval(task.taskId, {
        action: record.pendingApproval?.action || 'Command execution',
        reason: record.pendingApproval?.reason || 'Hermes requests approval to continue.',
        command: record.pendingApproval?.command,
        files: record.pendingApproval?.files,
        choices: record.pendingApproval?.choices,
      });
      break;
    }
    case 'tool.started':
      mgr.appendEvent(taskId, 'task.progress', evt.summary, { tool: evt.detail?.tool });
      break;
    case 'tool.completed':
    case 'tool.failed':
      mgr.appendEvent(taskId, evt.kind === 'tool.failed' ? 'task.progress' : 'task.progress', evt.summary);
      break;
    case 'error':
      mgr.progress(taskId, 'task.progress', `Hermes error: ${evt.summary}`, { lastError: evt.summary });
      break;
    default:
      mgr.appendEvent(taskId, 'task.progress', evt.summary || evt.kind);
  }
}

export async function dispatchHermesTask(task: BackgroundTaskRecord, workspaceRoot?: string): Promise<{ ok: boolean; error?: string }> {
  if (!markDispatched(task.taskId)) return { ok: false, error: 'Task already dispatched.' };
  const mgr = backgroundTaskManager;
  try {
    // Policy enforcement (Stage 2): a Hermes run executes on the profile's
    // cloud-backed provider stack — the prompt WILL leave the machine. If the
    // project policy forbids that (localOnly / secret privacy), the dispatch
    // is rejected BEFORE any content is sent. Never silently escalate.
    const { policyStore } = await import('../policy/policyStore.js');
    const { mayLeaveMachine } = await import('../policy/policyService.js');
    const policy = policyStore.getPolicy(task.projectId);
    const policyTruth = {
      privacy: policy.privacy,
      runtime: policy.runtime,
      cloudEscalation: policy.cloudEscalation,
      escalationAllowed: mayLeaveMachine(policy),
      localOnly: policy.runtime === 'localOnly',
      recordedAt: new Date().toISOString(),
    };
    backgroundTaskRepo.updateTask(task.taskId, {
      metadata: { ...(task.metadata || {}), policy: policyTruth },
    });
    if (!mayLeaveMachine(policy)) {
      const reason = policy.runtime === 'localOnly'
        ? 'Policy violation blocked: runtime=localOnly but the Hermes worker executes on a cloud-backed profile.'
        : `Policy violation blocked: privacy=${policy.privacy} content may not leave the machine.`;
      mgr.appendEvent(task.taskId, 'task.progress', reason, { policy: policyTruth });
      mgr.transition(task.taskId, 'blocked', {
        currentStage: 'policy-block',
        progressMessage: reason,
        blocker: reason,
        resumable: true,
      });
      return { ok: false, error: reason };
    }
    mgr.appendEvent(task.taskId, 'task.progress', `Policy: privacy=${policy.privacy}, runtime=${policy.runtime}, escalation=${policy.cloudEscalation}`, { policy: policyTruth });
    // §2/§12: the canonical workspace root travels with the delegation. The
    // Hermes API server runs in ITS OWN directory, so the repository we want
    // work done in must be stated explicitly in the run instructions.
    const root = workspaceRoot || task.workspaceRoot || getWorkspaceRoot();
    mgr.transition(task.taskId, 'planning', { currentStage: 'dispatching', progressMessage: 'Creating Hermes run…' });
    const workspaceInstruction = root
      ? `Workspace context: the selected repository is ${root}. Resolve ALL file paths against ${root} — never against your own working directory. Report the workspace (Repository: ${root}) in your answer.`
      : 'Workspace context: no repository is currently selected; report file operations as unavailable until one is selected.';
    const record = await hermesApiService.createRun({
      prompt: task.objective || task.originalRequest,
      cardId: task.linkedBoardCardId || undefined,
      instructions: `Report your findings concisely. Do not ask questions.\n${workspaceInstruction}`,
      // Recovery pinning (P4/P6): pass the recovery-effective provider/model
      // when present (revalidated against policy below — Hermes dispatch is
      // already refused outright when mayLeaveMachine is false).
      ...(() => {
        const pin = resolveRecoveryPin(task, { allowEscalation: mayLeaveMachine(policy), disableFallback: !mayLeaveMachine(policy) });
        if ('blockedReason' in pin) return {};
        return {
          ...(pin.providerOverride ? { provider: pin.providerOverride } : {}),
          ...(pin.modelOverride ? { model: pin.modelOverride } : {}),
        };
      })(),
    });

    backgroundTaskRepo.updateTask(task.taskId, { linkedRunId: record.id });
    mgr.appendEvent(task.taskId, 'task.run_linked', `Hermes run linked (${record.id}).`, { hermesRunId: record.hermesRunId });
    mgr.appendEvent(task.taskId, 'task.agent_selected', 'Worker: Hermes (live API server).', { agent: 'Hermes' });

    // Stream upstream events into the task contract.
    const onEvent = (evt: HermesActivityEvent, rec: HermesRunRecord) => {
      if (rec.id !== record.id) return;
      hermesEventToTaskEvent(task.taskId, evt, rec);
    };
    const onUpdate = (rec: HermesRunRecord) => {
      if (rec.id !== record.id) return;
      const current = backgroundTaskRepo.getTask(task.taskId);
      if (!current || TERMINAL_STATUSES.has(current.status)) return;
      if (rec.status === 'completed') {
        // Requirement 13 + GateRunner v1 (P10): completion is gated on
        // verification — Hermes "done" is not completion when gates exist.
        void (async () => {
          // Model truth snapshot (smallest fix): the hermes run record stores
          // the PROFILE alias (`model: backend-engineer`, provider '') — the
          // actual provider/model come from the profile config (read-only
          // resolver). Persist that truth into the task record so RunLedger
          // reports it even after restarts (hermes run records are in-memory).
          try {
            const { resolveHermesModelTruth } = await import('../hermesApiService.js');
            const truth = resolveHermesModelTruth();
            const live = backgroundTaskRepo.getTask(task.taskId);
            if (live && !TERMINAL_STATUSES.has(live.status) && (truth.provider || truth.model)) {
              backgroundTaskRepo.updateTask(task.taskId, {
                metadata: {
                  ...(live.metadata || {}),
                  assignedProvider: (live.metadata as any)?.assignedProvider || truth.provider || null,
                  assignedModel: (live.metadata as any)?.assignedModel || truth.model || null,
                  effectiveProvider: (live.metadata as any)?.effectiveProvider || truth.provider || null,
                  effectiveModel: (live.metadata as any)?.effectiveModel || truth.model || null,
                },
              });
            }
          } catch { /* truth snapshot is best-effort */ }
          const { runTaskGates, parseGateConfigs } = await import('../gates/gateRunner.js');
          const hasRequired = parseGateConfigs(backgroundTaskRepo.getTask(task.taskId)).hasRequired;
          if (!hasRequired) {
            mgr.verifyCompletion(task.taskId, {
              resultText: rec.finalText || 'Hermes completed without a text result.',
              readOnly: true,
              verificationNote: 'Hermes run completed — result text verified.',
            });
            return;
          }
          mgr.appendEvent(task.taskId, 'task.verification_started', 'Hermes execution finished — running required gates.', {});
          try {
            const set = await runTaskGates(task.taskId);
            if (set.allRequiredPassed) {
              const gateSummary = set.results.filter((r) => r.status === 'passed').map((r) => r.gateId).join(', ');
              mgr.verifyCompletion(task.taskId, {
                resultText: rec.finalText || 'Hermes completed without a text result.',
                readOnly: true,
                verificationNote: `Hermes run completed — verified: ${gateSummary}.`,
              });
            } else {
              mgr.appendEvent(task.taskId, 'task.verification_completed', 'Verification did not pass — task not completed.', { allRequiredPassed: false });
              // LocalHarness (P6/P7): bounded gate rework — structured
              // evidence to the worker, rework ONLY if budget remains.
              const failedGate = set.results.filter((r) => r.status === 'failed')[0];
              void mgr.recoverAfterFailure(task.taskId, { code: 'GATE_FAILURE', message: `Gate failed: ${failedGate?.gateId ?? 'required-gate'}` }, {
                gateEvidence: failedGate
                  ? { gateId: failedGate.gateId, reason: failedGate.reason || 'required gate failed', attempt: failedGate.attempt ?? 1 }
                  : undefined,
              });
            }
          } catch (e: any) {
            mgr.transition(task.taskId, 'blocked', { verificationState: 'failed', blocker: `Verification error: ${e?.message}`, resumable: true });
          }
        })();
      } else if (rec.status === 'failed') {
        // LocalHarness (P2): Hermes execution failures route through the same
        // recovery entry point as CodeX. recoverAfterFailure decides within
        // budget/privacy bounds — retry/escalate → re-queued, otherwise →
        // blocked with a truthful reason. Never completes on failure.
        void mgr.recoverAfterFailure(task.taskId, rec.errorMessage || rec.finalText || 'Hermes run failed.');
      } else if (rec.status === 'cancelled') {
        mgr.transition(task.taskId, 'cancelled', {
          lastError: rec.errorMessage || rec.finalText || 'Hermes run cancelled.',
        });
      }
    };
    hermesApiService.on('hermes:event', onEvent);
    hermesApiService.on('hermes:update', onUpdate);

    // Race guard: the upstream run may have failed BEFORE the listeners were
    // attached (createRun fires the SSE consumer immediately). Re-check now —
    // the onUpdate TERMINAL guard makes this idempotent.
    const already = hermesApiService.getRun?.(record.id) as HermesRunRecord | undefined;
    if (already && (already.status === 'failed' || already.status === 'cancelled' || already.status === 'completed')) {
      onUpdate(already);
    }

    // Worker control handlers (stop + approval).
    mgr.registerWorkerHandlers(task.taskId, {
      stop: async () => {
        await hermesApiService.stopRun(record.id);
        const current = backgroundTaskRepo.getTask(task.taskId);
        if (current && !TERMINAL_STATUSES.has(current.status)) {
          mgr.transition(task.taskId, 'cancelled', { blocker: 'Stopped by user — Hermes run terminated.' });
        }
      },
    });

    // Approval resolution bridge (task approval → Hermes approval endpoint).
    const approvalWatcher = setInterval(async () => {
      const current = backgroundTaskRepo.getTask(task.taskId);
      if (!current || TERMINAL_STATUSES.has(current.status)) {
        clearInterval(approvalWatcher);
        return;
      }
      const rec = hermesApiService.getRun?.(record.id) as HermesRunRecord | undefined;
      if (rec?.pendingApproval && current.status !== 'waiting_approval') {
        mgr.requestApproval(task.taskId, {
          action: rec.pendingApproval.action || 'Command execution',
          reason: rec.pendingApproval.reason || 'Hermes requests approval.',
          command: rec.pendingApproval.command,
          files: rec.pendingApproval.files,
          choices: rec.pendingApproval.choices,
        });
      }
    }, 1500);

    return { ok: true };
  } catch (err: any) {
    backgroundTaskManager.transition(task.taskId, 'failed', {
      lastError: `Hermes dispatch failed: ${err?.message}`,
      blocker: `Hermes dispatch failed: ${err?.message}`,
    });
    return { ok: false, error: err?.message };
  }
}

// ── CODEX ADAPTER ───────────────────────────────────────────────────────────

/**
 * Recovery pinning (RecoveryPolicy V1, P4/P7): extract the recovery-effective
 * provider/model from task metadata for re-dispatch, REVALIDATING against the
 * runtime/privacy policy. A pinned 'cloud' marker is only honored when the
 * policy allows escalation; otherwise the pin is refused (never dispatched).
 * Returns the override map, or { blockedReason } when the pin violates policy.
 */
export function resolveRecoveryPin(
  task: BackgroundTaskRecord,
  policyFlags: { allowEscalation: boolean; disableFallback: boolean },
): { providerOverride?: string; modelOverride?: string } | { blockedReason: string } {
  const rec = ((task.metadata || {}).recovery || {}) as Record<string, any>;
  const effProvider = typeof rec.effectiveProvider === 'string' ? rec.effectiveProvider : null;
  const effModel = typeof rec.effectiveModel === 'string' ? rec.effectiveModel : null;
  if (!effProvider && !effModel) return {};

  // 'cloud' is the harness marker for the gateway's policy-permitted
  // escalation chain (no literal cloud model id is known to the harness).
  const cloudPinned = effProvider === 'cloud' || String(effModel || '').startsWith('cloud');
  if (cloudPinned && !policyFlags.allowEscalation) {
    return { blockedReason: `Recovery pinning rejected by policy: cloud escalation is forbidden (${effProvider}/${effModel}).` };
  }
  return {
    ...(effProvider && effProvider !== 'cloud' ? { providerOverride: effProvider } : {}),
    ...(effModel && !String(effModel).startsWith('cloud') ? { modelOverride: effModel } : {}),
  };
}

function goalStateToTaskStatus(state: string): BackgroundTaskRecord['status'] | null {
  switch (state) {
    case 'queued': return 'queued';
    case 'planning': return 'planning';
    case 'executing': case 'reasoning': case 'validating': case 'tool_started': case 'tool_completed': return 'running';
    case 'waiting_for_approval': return 'waiting_approval';
    case 'paused': case 'pause_requested': return 'paused';
    case 'completed': return 'completed';
    case 'failed': return 'failed';
    case 'stopped': case 'interrupted': return 'cancelled';
    default: return null;
  }
}

export async function dispatchCodexTask(task: BackgroundTaskRecord, workspacePath: string): Promise<{ ok: boolean; error?: string }> {
  if (!markDispatched(task.taskId)) return { ok: false, error: 'Task already dispatched.' };
  const mgr = backgroundTaskManager;
  try {
    mgr.transition(task.taskId, 'planning', { currentStage: 'dispatching', progressMessage: 'Creating CodeX goal…' });
    // Policy enforcement (Stage 2): resolve the project's privacy/runtime
    // policy ONCE at dispatch. It controls whether local failure may
    // escalate to cloud and is persisted as execution truth for RunLedger.
    const { policyStore } = await import('../policy/policyStore.js');
    const { chatPolicyFlags } = await import('../policy/policyService.js');
    const policy = policyStore.getPolicy(task.projectId);
    const policyFlags = chatPolicyFlags(policy);
    const policyTruth = {
      privacy: policy.privacy,
      runtime: policy.runtime,
      cloudEscalation: policy.cloudEscalation,
      escalationAllowed: policyFlags.allowEscalation,
      localOnly: policy.runtime === 'localOnly',
      recordedAt: new Date().toISOString(),
    };
    backgroundTaskRepo.updateTask(task.taskId, {
      metadata: { ...(task.metadata || {}), policy: policyTruth },
    });
    mgr.appendEvent(task.taskId, 'task.progress', `Policy: privacy=${policy.privacy}, runtime=${policy.runtime}, escalation=${policy.cloudEscalation}`, { policy: policyTruth });
    const approvalPolicy = (task.metadata?.approvalPolicy as string) === 'auto' ? 'auto' : 'manual';
    // Recovery pinning (P4/P5/P7): the recovery-effective model must ACTUALLY
    // be used by the re-run. Policy revalidation happens here — a pinned
    // cloud model is refused when escalation is forbidden.
    const pin = resolveRecoveryPin(task, policyFlags);
    if ('blockedReason' in pin) {
      mgr.appendEvent(task.taskId, 'task.progress', pin.blockedReason, {});
      mgr.transition(task.taskId, 'blocked', {
        blocker: pin.blockedReason,
        currentStage: 'blocked',
        resumable: true,
      });
      return { ok: false, error: pin.blockedReason };
    }
    const goalId = await codexService.createGoal(
      task.objective || task.originalRequest,
      workspacePath,
      approvalPolicy,
      undefined,
      task.conversationId || undefined,
      undefined,
      // Policy-driven execution options: disableFallback keeps localOnly
      // content local; allowCloudEscalation gates the planning escalation.
      // Recovery overrides (providerOverride/modelOverride) pin the
      // recovery-effective model into the actual goal run.
      {
        disableFallback: policyFlags.disableFallback,
        allowCloudEscalation: policyFlags.allowEscalation,
        ...(pin.providerOverride ? { providerOverride: pin.providerOverride } : {}),
        ...(pin.modelOverride ? { modelOverride: pin.modelOverride } : {}),
      },
    );

    backgroundTaskRepo.updateTask(task.taskId, { linkedRunId: goalId, resumable: true });
    mgr.appendEvent(task.taskId, 'task.run_linked', `CodeX goal linked (${goalId}).`, { goalId });
    mgr.appendEvent(task.taskId, 'task.agent_selected', 'Worker: CodeX (checkpointed goal loop).', { agent: 'CodeX' });

    // Stream goalStore events into the task contract.
    let lastSeq = 0;
    const goalListener = (goal: any) => {
      if (goal.id !== goalId) return;
      const current = backgroundTaskRepo.getTask(task.taskId);
      if (!current || TERMINAL_STATUSES.has(current.status)) return; // stale protection
      const mapped = goalStateToTaskStatus(goal.status);
      if (!mapped) return;
      if (mapped === 'completed') {
        // GateRunner v1 (P9): execution finished → VERIFYING → required gates
        // → only then completion. The goal's summary is NOT sufficient.
        void (async () => {
          // Model truth snapshot (smallest fix): persist the routingLedger
          // requested/resolved provider+model into the task record so
          // RunLedger reports the truth even after restarts (routingLedger
          // itself is in-memory only).
          try {
            const { routingLedger } = await import('../routingLedger.js');
            const rec = routingLedger.get(goalId);
            if (rec) {
              const live = backgroundTaskRepo.getTask(task.taskId);
              if (live && !TERMINAL_STATUSES.has(live.status)) {
                backgroundTaskRepo.updateTask(task.taskId, {
                  metadata: {
                    ...(live.metadata || {}),
                    assignedProvider: (live.metadata as any)?.assignedProvider || rec.requestedProvider || null,
                    assignedModel: (live.metadata as any)?.assignedModel || rec.requestedModel || null,
                    effectiveProvider: (live.metadata as any)?.effectiveProvider || rec.resolvedProvider || null,
                    effectiveModel: (live.metadata as any)?.effectiveModel || rec.resolvedModel || null,
                  },
                });
              }
            }
          } catch { /* truth snapshot is best-effort */ }
          const { runTaskGates } = await import('../gates/gateRunner.js');
          const { parseGateConfigs } = await import('../gates/gateRunner.js');
          const hasRequired = parseGateConfigs(backgroundTaskRepo.getTask(task.taskId)).hasRequired;
          if (!hasRequired) {
            mgr.verifyCompletion(task.taskId, {
              resultText: goal.runSummary?.summary || 'CodeX goal completed.',
              readOnly: false,
              verificationNote: 'CodeX goal completed.',
            });
            return;
          }
          mgr.appendEvent(task.taskId, 'task.verification_started', 'Execution finished — running required gates.', {});
          try {
            const set = await runTaskGates(task.taskId);
            if (set.allRequiredPassed) {
              const gateSummary = set.results.filter((r) => r.status === 'passed').map((r) => r.gateId).join(', ');
              mgr.verifyCompletion(task.taskId, {
                resultText: goal.runSummary?.summary || 'CodeX goal completed.',
                readOnly: false,
                verificationNote: `Completed and verified: ${gateSummary || 'gates passed'}.`,
              });
            } else {
              // GateRunner already transitioned to blocked/failed with evidence.
              mgr.appendEvent(task.taskId, 'task.verification_completed', 'Verification did not pass — task not completed.', {
                allRequiredPassed: false,
              });
              // LocalHarness (P6/P7): bounded gate rework — structured
              // evidence to the worker, rework ONLY if budget remains.
              const failedGate = set.results.filter((r) => r.status === 'failed')[0];
              void mgr.recoverAfterFailure(task.taskId, { code: 'GATE_FAILURE', message: `Gate failed: ${failedGate?.gateId ?? 'required-gate'}` }, {
                gateEvidence: failedGate
                  ? { gateId: failedGate.gateId, reason: failedGate.reason || 'required gate failed', attempt: failedGate.attempt ?? 1 }
                  : undefined,
              });
            }
          } catch (e: any) {
            mgr.transition(task.taskId, 'blocked', {
              verificationState: 'failed',
              blocker: `Verification error: ${e?.message}`,
              resumable: true,
            });
          }
        })();
        return;
      }
      if (mapped === 'failed') {
        // LocalHarness (RecoveryPolicy V1): intercept execution failure
        // BEFORE the terminal transition. recoverAfterFailure decides within
        // budget/privacy bounds — retry/escalate → re-queued, otherwise →
        // blocked with a truthful reason. Never completes on failure.
        const err = goal.lastError || goal.error || goal.runSummary?.error || 'CodeX goal failed';
        void mgr.recoverAfterFailure(task.taskId, err);
        return;
      }
      if (mapped !== current.status) {
        mgr.transition(task.taskId, mapped, {
          currentStage: goal.status,
          approvalState: goal.status === 'waiting_for_approval' ? 'pending' : current.approvalState,
        });
      }
      // Forward new goal events as progress.
      const events = goalStore.getEventsAfter(goalId, lastSeq);
      for (const ge of events) {
        lastSeq = ge.sequence;
        if (ge.tool) {
          mgr.appendEvent(task.taskId, 'task.progress', ge.message || `${ge.tool} (${ge.state})`, { step: ge.step });
        }
      }
    };
    goalStore.on('goal:updated', goalListener);

    mgr.registerWorkerHandlers(task.taskId, {
      stop: async () => {
        await codexService.abortGoal(goalId);
        const current = backgroundTaskRepo.getTask(task.taskId);
        if (current && !TERMINAL_STATUSES.has(current.status)) {
          mgr.transition(task.taskId, 'cancelled', { blocker: 'Stopped by user — CodeX goal aborted.' });
        }
      },
      pause: async () => {
        // CodeX loop checks goal.status === 'paused' each iteration → clean pause.
        goalStore.update(goalId, { status: 'paused' });
      },
      resume: async () => {
        const goal = goalStore.get(goalId);
        if (!goal) throw new Error('CodeX goal not found.');
        if (goal.status !== 'paused') throw new Error(`Goal is ${goal.status}, not paused.`);
        goalStore.update(goalId, { status: 'queued' });
        await resumeCodexGoalLoop(goalId);
      },
    });

    return { ok: true };
  } catch (err: any) {
    backgroundTaskManager.transition(task.taskId, 'failed', {
      lastError: `CodeX dispatch failed: ${err?.message}`,
      blocker: `CodeX dispatch failed: ${err?.message}`,
    });
    return { ok: false, error: err?.message };
  }
}

// ── RESEARCH ADAPTER ────────────────────────────────────────────────────────

export async function dispatchResearchTask(task: BackgroundTaskRecord): Promise<{ ok: boolean; error?: string }> {
  if (!markDispatched(task.taskId)) return { ok: false, error: 'Task already dispatched.' };
  const mgr = backgroundTaskManager;
  try {
    mgr.transition(task.taskId, 'planning', { currentStage: 'dispatching', progressMessage: 'Creating research brief…' });
    const briefId = `brief-${randomUUID()}`;
    const runId = `run-${randomUUID()}`;
    jsonDb.researchBriefs.upsert({
      id: briefId,
      title: task.title,
      requestType: 'task-manager',
      target: task.objective,
      goal: task.objective,
      competitors: [],
      priority: task.priority,
      outputFormat: 'markdown',
      status: 'queued',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      runId,
      artifactIds: [],
    } as any);
    runStore.create({
      id: runId,
      agentId: 'agent-hermes',
      sessionId: 'sess-research',
      workspaceId: 'ws-default',
      mode: 'workflow',
      status: 'queued',
      input: `Execute research brief: ${task.title}`,
      logs: ['Background task manager dispatched research brief.'],
      events: [],
      linkedArtifacts: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as any);

    backgroundTaskRepo.updateTask(task.taskId, { linkedRunId: runId });
    mgr.appendEvent(task.taskId, 'task.run_linked', `Research brief linked (${briefId}).`, { briefId, runId });
    mgr.appendEvent(task.taskId, 'task.agent_selected', 'Worker: Research pipeline.', { agent: 'Research' });
    mgr.transition(task.taskId, 'running', { currentStage: 'running', progressMessage: 'Research brief executing.' });

    // The workflow runs async; poll the brief for terminal status.
    // Recovery semantics (P3): the research pipeline exposes NO
    // model/provider/runtime override surface, so recovery can only classify
    // and block honestly — escalation is RECOVERY UNSUPPORTED FOR research.
    executeResearchBriefWorkflow(briefId, runId)
      .then(() => {
        const brief = jsonDb.researchBriefs.get(briefId) as any;
        const current = backgroundTaskRepo.getTask(task.taskId);
        if (!current || TERMINAL_STATUSES.has(current.status)) return;
        if (brief?.status === 'failed') {
          void mgr.recoverAfterFailure(task.taskId, 'Research brief failed.');
        } else {
          mgr.verifyCompletion(task.taskId, {
            resultText: `Research brief "${task.title}" completed (status: ${brief?.status || 'exported'}).`,
            readOnly: true,
            verificationNote: 'Research workflow finished.',
          });
        }
      })
      .catch((err: any) => {
        const current = backgroundTaskRepo.getTask(task.taskId);
        if (!current || TERMINAL_STATUSES.has(current.status)) return;
        void mgr.recoverAfterFailure(task.taskId, `Research workflow error: ${err?.message}`);
      });

    return { ok: true };
  } catch (err: any) {
    backgroundTaskManager.transition(task.taskId, 'failed', {
      lastError: `Research dispatch failed: ${err?.message}`,
      blocker: `Research dispatch failed: ${err?.message}`,
    });
    return { ok: false, error: err?.message };
  }
}

// ── AGENT TEAMS ADAPTER ─────────────────────────────────────────────────────

export async function dispatchTeamTask(task: BackgroundTaskRecord, workspacePath: string): Promise<{ ok: boolean; error?: string }> {
  if (!markDispatched(task.taskId)) return { ok: false, error: 'Task already dispatched.' };
  const mgr = backgroundTaskManager;
  try {
    mgr.transition(task.taskId, 'planning', { currentStage: 'dispatching', progressMessage: 'Creating Agent Team…' });
    const approvalPolicy = (task.metadata?.approvalPolicy as string) === 'auto' ? 'auto' : 'manual';
    const { teamId } = await coordinatorService.createTeam(task.objective || task.originalRequest, workspacePath, approvalPolicy as any);
    const goalId = await TeamRunner.startTeam(teamId);

    backgroundTaskRepo.updateTask(task.taskId, { linkedRunId: goalId });
    mgr.appendEvent(task.taskId, 'task.run_linked', `Agent Team linked (team ${teamId}, goal ${goalId}).`, { teamId, goalId });
    mgr.appendEvent(task.taskId, 'task.agent_selected', 'Worker: Agent Teams.', { agent: 'Agent Teams', teamId });
    mgr.transition(task.taskId, 'running', { currentStage: 'running', progressMessage: 'Agent Team executing.' });

    const goalListener = (goal: any) => {
      if (goal.id !== goalId) return;
      const current = backgroundTaskRepo.getTask(task.taskId);
      if (!current || TERMINAL_STATUSES.has(current.status)) return;
      const mapped = goalStateToTaskStatus(goal.status);
      if (!mapped || mapped === current.status) return;
      if (mapped === 'completed') {
        // GateRunner v1 (P7): team completion is gated the same way as CodeX —
        // execution finished → VERIFYING → required gates → only then complete.
        void (async () => {
          const { runTaskGates, parseGateConfigs } = await import('../gates/gateRunner.js');
          const hasRequired = parseGateConfigs(backgroundTaskRepo.getTask(task.taskId)).hasRequired;
          if (!hasRequired) {
            mgr.verifyCompletion(task.taskId, {
              resultText: goal.runSummary?.summary || 'Agent Team completed.',
              readOnly: false,
              verificationNote: 'Agent Team goal completed.',
            });
            return;
          }
          mgr.appendEvent(task.taskId, 'task.verification_started', 'Agent Team execution finished — running required gates.', {});
          try {
            const set = await runTaskGates(task.taskId);
            if (set.allRequiredPassed) {
              const gateSummary = set.results.filter((r) => r.status === 'passed').map((r) => r.gateId).join(', ');
              mgr.verifyCompletion(task.taskId, {
                resultText: goal.runSummary?.summary || 'Agent Team completed.',
                readOnly: false,
                verificationNote: `Agent Team completed and verified: ${gateSummary || 'gates passed'}.`,
              });
            } else {
              mgr.appendEvent(task.taskId, 'task.verification_completed', 'Verification did not pass — task not completed.', { allRequiredPassed: false });
              const failedGate = set.results.filter((r) => r.status === 'failed')[0];
              void mgr.recoverAfterFailure(task.taskId, { code: 'GATE_FAILURE', message: `Gate failed: ${failedGate?.gateId ?? 'required-gate'}` }, {
                gateEvidence: failedGate
                  ? { gateId: failedGate.gateId, reason: failedGate.reason || 'required gate failed', attempt: failedGate.attempt ?? 1 }
                  : undefined,
              });
            }
          } catch (e: any) {
            mgr.transition(task.taskId, 'blocked', { verificationState: 'failed', blocker: `Verification error: ${e?.message}`, resumable: true });
          }
        })();
        return;
      }
      if (mapped === 'failed') {
        // LocalHarness (P3): team goals are codex-backed — recovery via the
        // same entry point as CodeX (retry/escalate → re-queued, else blocked).
        const err = goal.lastError || goal.error || goal.runSummary?.error || 'Agent Team goal failed';
        void mgr.recoverAfterFailure(task.taskId, err);
        return;
      }
      mgr.transition(task.taskId, mapped, { currentStage: goal.status });
    };
    goalStore.on('goal:updated', goalListener);

    mgr.registerWorkerHandlers(task.taskId, {
      stop: async () => {
        await codexService.abortGoal(goalId);
        const current = backgroundTaskRepo.getTask(task.taskId);
        if (current && !TERMINAL_STATUSES.has(current.status)) {
          mgr.transition(task.taskId, 'cancelled', { blocker: 'Stopped by user — Agent Team goal aborted.' });
        }
      },
    });

    return { ok: true };
  } catch (err: any) {
    backgroundTaskManager.transition(task.taskId, 'failed', {
      lastError: `Team dispatch failed: ${err?.message}`,
      blocker: `Team dispatch failed: ${err?.message}`,
    });
    return { ok: false, error: err?.message };
  }
}

// ── AUTOMATION ADAPTER ──────────────────────────────────────────────────────
//
// Reuses the EXISTING scheduler (server/src/services/scheduler + the
// schedules/tasks drizzle tables behind POST /api/schedules). There is no
// event back-channel from the scheduler to the task manager: cron jobs fire
// via `enqueueRun` into the run system and log to [Scheduler]. The adapter
// therefore registers the schedule (the real, persistent action), links it to
// the task, and completes truthfully — with a documented limitation that live
// per-fire progress does not stream back into the task event stream.

import { registerCronJob, unregisterCronJob } from '../scheduler/scheduler.js';
import { db as drizzleDb } from '../../db/index.js';
import { schedules as schedulesTable } from '../../db/schema.js';
import { eq } from 'drizzle-orm';

export async function dispatchAutomationTask(task: BackgroundTaskRecord): Promise<{ ok: boolean; error?: string }> {
  if (!markDispatched(task.taskId)) return { ok: false, error: 'Task already dispatched.' };
  const mgr = backgroundTaskManager;
  try {
    const cronExpression = (task.metadata?.cronExpression as string) || '0 9 * * *';
    const timezone = (task.metadata?.timezone as string) || 'UTC';
    mgr.transition(task.taskId, 'planning', { currentStage: 'dispatching', progressMessage: `Registering schedule (${cronExpression})…` });

    const scheduleId = `sched-${randomUUID()}`;
    await drizzleDb.insert(schedulesTable).values({
      id: scheduleId,
      taskId: `bgtask-${task.taskId.slice(-8)}`,
      type: 'cron',
      cronExpression,
      timezone,
      enabled: true,
    } as any);

    registerCronJob(scheduleId, `bgtask-${task.taskId.slice(-8)}`, cronExpression, timezone);
    backgroundTaskRepo.updateTask(task.taskId, { metadata: { ...task.metadata, scheduleId, cronExpression, timezone } });
    mgr.appendEvent(task.taskId, 'task.run_linked', `Schedule registered (${scheduleId}, ${cronExpression} ${timezone}).`, { scheduleId });
    mgr.appendEvent(task.taskId, 'task.agent_selected', 'Worker: Automations (scheduler).', { agent: 'Automations' });

    mgr.verifyCompletion(task.taskId, {
      resultText: `Automation registered: ${cronExpression} ${timezone} (schedule ${scheduleId}). The existing scheduler will fire this task on schedule via enqueueRun.`,
      readOnly: true,
      verificationNote: 'Schedule created. NOTE: the scheduler system has no live event back-channel, so per-fire progress does not stream into this task (documented limitation).',
    });

    mgr.registerWorkerHandlers(task.taskId, {
      stop: async () => {
        unregisterCronJob(scheduleId);
        await drizzleDb.update(schedulesTable).set({ enabled: false } as any).where(eq(schedulesTable.id, scheduleId)).catch(() => undefined);
      },
    });

    return { ok: true };
  } catch (err: any) {
    backgroundTaskManager.transition(task.taskId, 'failed', {
      lastError: `Automation dispatch failed: ${err?.message}`,
      blocker: `Automation dispatch failed: ${err?.message}`,
    });
    return { ok: false, error: err?.message };
  }
}

// ── REVENUE PIPELINE ADAPTER ────────────────────────────────────────────────
//
// Maps the canonical task contract onto the Revenue Pipeline V1 service.
// The pipeline runs asynchronously (fire-and-forget after dispatch); all
// progress flows back through the manager's transition/progress/approval
// machinery — one task, one Board card, task-owned approvals.

interface ApprovalGate {
  resolve: (choice: 'allow' | 'deny') => void;
}

/** Per-task active approval gate (only one wait at a time in the pipeline). */
const approvalGates = new Map<string, ApprovalGate>();

export async function dispatchRevenuePipelineTask(task: BackgroundTaskRecord, workspacePath?: string): Promise<{ ok: boolean; error?: string }> {
  if (!markDispatched(task.taskId)) return { ok: false, error: 'Task already dispatched.' };
  const mgr = backgroundTaskManager;
  let stopRequested = false;

  try {
    mgr.transition(task.taskId, 'running', {
      currentStage: 'DISCOVERING PROSPECTS',
      progressMessage: 'Revenue pipeline started.',
      buildState: 'idle',
      testState: 'idle',
    });
    mgr.appendEvent(task.taskId, 'task.agent_selected', 'Worker: Revenue Pipeline (audit → concept → proposal).', { agent: 'Revenue Pipeline' });

    const runId = newRunId();
    backgroundTaskRepo.updateTask(task.taskId, { linkedRunId: runId, resumable: false });
    mgr.appendEvent(task.taskId, 'task.run_linked', `Revenue pipeline run linked (${runId}).`, { runId });

    const config: PipelineConfig = {
      niche: (task.metadata?.niche as string) || 'local business',
      city: (task.metadata?.city as string) || '',
      serviceKeywords: Array.isArray(task.metadata?.serviceKeywords) ? (task.metadata?.serviceKeywords as string[]) : [],
      prospectCount: Number(task.metadata?.prospectCount) || 3,
      specificUrl: (task.metadata?.specificUrl as string) || null,
      maxResearchBudgetUsd: task.metadata?.maxResearchBudgetUsd != null ? Number(task.metadata?.maxResearchBudgetUsd) : null,
      dryRun: task.metadata?.dryRun !== false,
      fixturesOnly: task.metadata?.fixturesOnly === true,
      runBuild: task.metadata?.runBuild !== false,
      useCodex: task.metadata?.useCodex !== false,
      useLlm: task.metadata?.useLlm === true,
      rawRequest: task.originalRequest || '',
      workspacePath: workspacePath || pipelineWorkspaceRoot(),
    };

    const hooks: PipelineHooks = {
      transition: (status: string, patch: Record<string, unknown> = {}) => {
        mgr.transition(task.taskId, status as any, patch as any);
      },
      progress: (kind: string, summary: string, patch: Record<string, unknown> = {}, detail: Record<string, unknown> = {}) => {
        mgr.progress(task.taskId, kind as any, summary, patch as any, detail);
      },
      requestApprovalAndWait: (request) => {
        mgr.requestApproval(task.taskId, request);
        return new Promise<'allow' | 'deny'>((resolve) => {
          approvalGates.set(task.taskId, { resolve });
        });
      },
      verifyCompletion: (evidence) => {
        const updated = mgr.verifyCompletion(task.taskId, evidence as any);
        if (!updated) return null;
        return { status: updated.status, blocker: updated.blocker };
      },
      setFilesChanged: (files) => {
        const current = backgroundTaskRepo.getTask(task.taskId);
        if (!current) return;
        const merged = [...new Set([...(current.filesChanged || []), ...files])];
        backgroundTaskRepo.updateTask(task.taskId, { filesChanged: merged });
        mgr.appendEvent(task.taskId, 'task.file_changed', `${files.length} artifact(s) written.`, { files: merged.slice(-20) });
      },
      getTask: () => {
        const t = backgroundTaskRepo.getTask(task.taskId);
        return t ? { buildState: t.buildState, testState: t.testState } : null;
      },
      isStopRequested: () => stopRequested,
    };

    mgr.registerApprovalResolver(task.taskId, async (choice) => {
      const gate = approvalGates.get(task.taskId);
      if (gate) {
        approvalGates.delete(task.taskId);
        gate.resolve(choice);
      }
    });

    mgr.registerWorkerHandlers(task.taskId, {
      stop: async () => {
        stopRequested = true;
      },
    });

    // Fire-and-forget: the pipeline reports through the hooks; the manager
    // guards terminal transitions. Never block the dispatch return.
    runRevenuePipeline({ runId, taskId: task.taskId, config, hooks }).catch((err: any) => {
      logger.error(`[bg-task] revenue pipeline crash for ${task.taskId}: ${err?.message}`);
      const current = backgroundTaskRepo.getTask(task.taskId);
      if (current && !TERMINAL_STATUSES.has(current.status)) {
        mgr.transition(task.taskId, 'failed', { lastError: err?.message, blocker: `Revenue pipeline crashed: ${err?.message}` });
      }
    });

    return { ok: true };
  } catch (err: any) {
    backgroundTaskManager.transition(task.taskId, 'failed', {
      lastError: `Revenue dispatch failed: ${err?.message}`,
      blocker: `Revenue dispatch failed: ${err?.message}`,
    });
    return { ok: false, error: err?.message };
  }
}

function pipelineWorkspaceRoot(): string {
  // Artifacts live under the server data dir (runtime state, not source).
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.resolve(__dirname, '..', '..', '..', 'data', 'revenue-pipeline');
}

export async function dispatchTask(task: BackgroundTaskRecord, workspacePath?: string): Promise<{ ok: boolean; error?: string }> {
  // §2: the canonical workspace root TRAVELS with the delegation. The task
  // carries the root captured at creation time; an explicit parameter only
  // wins when the task has none (legacy rows). Never process.cwd().
  const root = task.workspaceRoot || workspacePath || getWorkspaceRoot();
  switch (task.worker) {
    case 'hermes': return dispatchHermesTask(task, root);
    case 'codex': return dispatchCodexTask(task, root);
    case 'research': return dispatchResearchTask(task);
    case 'team': return dispatchTeamTask(task, root);
    case 'automation': return dispatchAutomationTask(task);
    case 'revenue': return dispatchRevenuePipelineTask(task, root || workspacePath);
    default:
      backgroundTaskManager.transition(task.taskId, 'failed', { lastError: `No adapter for worker kind: ${task.worker}` });
      return { ok: false, error: `No adapter for worker kind: ${task.worker}` };
  }
}
