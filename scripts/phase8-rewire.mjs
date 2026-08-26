// Phase 8 rewire — insert the in-repo Hermes-plan → in-repo CodeX-execute bridge
// into adapters.ts, and route Hermes tasks that need CodeX work to it.
import { readFileSync, writeFileSync } from 'node:fs';
const f = 'B:/AgenticOS/server/src/services/backgroundTasks/adapters.ts';
let s = readFileSync(f, 'utf8');

// 1. Export the two helpers the bridge needs (currently module-private).
if (s.includes('function attachCodexGoalListener(') && !s.includes('export function attachCodexGoalListener(')) {
  s = s.replace('function attachCodexGoalListener(', 'export function attachCodexGoalListener(');
}
if (s.includes('function goalStateToTaskStatus(') && !s.includes('export function goalStateToTaskStatus(')) {
  s = s.replace('function goalStateToTaskStatus(', 'export function goalStateToTaskStatus(');
}

// 2. New bridge functions, inserted before dispatchTask.
const BRIDGE = `
/** True when a Hermes task's objective explicitly asks for CodeX engineering work. */
function detectsCodexDelegation(objective: string): boolean {
  const o = objective || '';
  const mentionsCodex = /\\bcodex\\b/i.test(o);
  const hasWorkVerb = /\\b(implement|edit|modify|change|fix|refactor|add|write|build|test|inspect|analy[sz]e|read|search|run)\\b/i.test(o);
  return mentionsCodex && hasWorkVerb;
}

/**
 * Phase 8 — Hermes-plan → in-repo CodeX-execute bridge.
 *
 * A Hermes background task whose objective ALSO requires CodeX engineering work
 * must NOT funnel CodeX execution through the external Hermes One api_server
 * (which spawns the external, rate-limited codex CLI). Instead: the in-repo
 * Hermes planner (executeHermesTask → hermes/service.ts, DeepSeek) produces
 * structured proposedTasks; any codex-capable proposed task is then executed by
 * the canonical in-repo CodeX runtime (codexService.createGoal → resumeCodexGoalLoop).
 *
 * Reuses the existing lifecycle: attachCodexGoalListener (event bridge),
 * verifyCompletion (verification + gates), reconcileCodexTasksAfterRestart
 * (restart-safe), and the canonical provider/model truth snapshot.
 */
export async function dispatchHermesPlanCodexTask(task: BackgroundTaskRecord, root: string): Promise<{ ok: boolean; error?: string }> {
  if (!markDispatched(task.taskId)) return { ok: false, error: 'Task already dispatched.' };
  const mgr = backgroundTaskManager;
  try {
    mgr.transition(task.taskId, 'planning', { currentStage: 'dispatching', progressMessage: 'Creating in-repo Hermes plan…' });

    // Policy: the in-repo Hermes + CodeX run on the gateway (DeepSeek) — the
    // prompt leaves the machine. Enforce the same policy gate as the external path.
    const { policyStore } = await import('../policy/policyStore.js');
    const { mayLeaveMachine } = await import('../policy/policyService.js');
    const policy = policyStore.getPolicy(task.projectId);
    if (!mayLeaveMachine(policy)) {
      const reason = 'Policy violation blocked: Hermes-plan→CodeX requires cloud-backed execution.';
      mgr.appendEvent(task.taskId, 'task.progress', reason, {});
      mgr.transition(task.taskId, 'blocked', { currentStage: 'policy-block', progressMessage: reason, blocker: reason, resumable: true });
      return { ok: false, error: reason };
    }

    // 1. Canonical project task + in-repo Hermes planning run.
    const { projectTaskService } = await import('../../services/projectExecution/projectTaskService.js');
    const { executionRunService } = await import('../../services/projectExecution/executionRunService.js');
    const { executeHermesTask } = await import('../../domains/workerAdapters/hermesAdapter.js');
    const objective = task.objective || task.originalRequest;
    const projectId = (task.projectId as string | null) ?? null;
    const goal = projectTaskService.createGoal({ projectId, title: \`Hermes plan: \${task.title.slice(0, 60)}\`, objective });
    const ptask = projectTaskService.createTask({
      projectId, goalId: goal.id, title: \`Formulate plan: \${task.title.slice(0, 60)}\`,
      description: objective, taskType: 'engineering', assignedCapability: 'hermes',
      acceptanceCriteria: 'Produce structured proposedTasks with worker capabilities; identify codex-capable implementation tasks.',
    });
    const { run } = await executeHermesTask(ptask, {
      prompt: objective, conversationId: task.conversationId ?? undefined,
      requestId: task.taskId, projectId: projectId ?? undefined, goalId: goal.id,
    });
    backgroundTaskRepo.updateTask(task.taskId, { linkedRunId: run.id });
    mgr.appendEvent(task.taskId, 'task.run_linked', \`In-repo Hermes plan run linked (\${run.id}).\`, { planRunId: run.id });
    mgr.appendEvent(task.taskId, 'task.agent_selected', 'Worker: Hermes (in-repo) → CodeX (in-repo).', { agent: 'Hermes+CodeX' });

    // 2. Bounded poll for the Hermes plan to finish.
    let completed = executionRunService.getRun(run.id);
    const start = Date.now();
    while (completed && (completed.status === 'running' || completed.status === 'queued') && Date.now() - start < 120000) {
      await new Promise((r) => setTimeout(r, 1000));
      completed = executionRunService.getRun(run.id);
    }
    const result = completed?.finalResultId ? executionRunService.getResult(completed.finalResultId) : null;
    const struct = (result as any)?.structuredOutput as any;
    const codexTasks = Array.isArray(struct?.proposedTasks)
      ? (struct.proposedTasks as any[]).filter((t) => t?.capability === 'codex')
      : [];

    if (codexTasks.length === 0) {
      // No CodeX work proposed — complete truthfully with the plan.
      const planText = (struct as any)?.summary || (result as any)?.summary || 'Hermes plan completed (no CodeX delegation proposed).';
      mgr.verifyCompletion(task.taskId, { resultText: String(planText), readOnly: true, verificationNote: 'In-repo Hermes plan completed — no CodeX delegation.' });
      return { ok: true };
    }

    // 3. Delegate the first codex-capable proposed task to in-repo CodeX.
    const ct = codexTasks[0];
    const codexObjective = [
      ct?.objective || ct?.title || '',
      ct?.acceptanceCriteria ? \`Acceptance criteria: \${ct.acceptanceCriteria}\` : '',
    ].filter(Boolean).join('\\n');
    const workspace = root || getWorkspaceRoot();
    const goalId = await codexService.createGoal(codexObjective, workspace, 'auto', undefined, task.conversationId ?? undefined);
    backgroundTaskRepo.updateTask(task.taskId, {
      linkedRunId: goalId,
      metadata: {
        ...(task.metadata || {}),
        hermesPlanRunId: run.id,
        hermesResultId: (result as any)?.id ?? null,
        codexGoalId: goalId,
        delegatedBy: 'hermes-inrepo',
        provider: (task.metadata as any)?.provider || 'prov-deepseek',
        model: (task.metadata as any)?.model || 'deepseek-v4-flash',
      },
    });
    mgr.appendEvent(task.taskId, 'task.run_linked', \`Hermes plan (\${run.id}) delegated in-repo CodeX goal \${goalId}.\`, { codexGoalId: goalId });

    // 4. Attach the event bridge (handles completion/failure/verification) and
    //    re-check terminal state immediately (idempotent).
    attachCodexGoalListener(task.taskId, goalId);
    const g = goalStore.get(goalId);
    if (g && TERMINAL_STATUSES.has(goalStateToTaskStatus(g.status) ?? '')) {
      // Force a reconciliation pass (idempotent — verifyCompletion re-entry guarded).
      void (async () => {
        const cur = goalStore.get(goalId);
        if (!cur) return;
        const mapped = goalStateToTaskStatus(cur.status);
        if (mapped === 'completed') {
          backgroundTaskManager.verifyCompletion(task.taskId, {
            resultText: (cur as any).runSummary?.summary || (cur as any).runSummary?.finalAnswer || 'CodeX goal completed.',
            readOnly: false,
            verificationNote: 'CodeX goal completed (in-repo).',
          });
        } else if (mapped === 'failed') {
          void backgroundTaskManager.recoverAfterFailure(task.taskId, (cur as any).lastError || 'CodeX goal failed');
        }
      })();
    }
    return { ok: true };
  } catch (err: any) {
    backgroundTaskManager.transition(task.taskId, 'failed', {
      lastError: \`Hermes→CodeX dispatch failed: \${err?.message}\`,
      blocker: \`Hermes→CodeX dispatch failed: \${err?.message}\`,
    });
    return { ok: false, error: err?.message };
  }
}

`;

const MARKER = 'export async function dispatchTask(task: BackgroundTaskRecord, workspacePath?: string)';
if (!s.includes(MARKER)) { console.error('dispatchTask marker not found'); process.exit(1); }
s = s.replace(MARKER, BRIDGE + MARKER);

// 3. Route hermes tasks that need CodeX work to the bridge.
const OLD_CASE = "    case 'hermes': return dispatchHermesTask(task, root);";
const NEW_CASE = "    case 'hermes': return detectsCodexDelegation(task.objective || task.originalRequest)\n      ? dispatchHermesPlanCodexTask(task, root)\n      : dispatchHermesTask(task, root);";
if (!s.includes(OLD_CASE)) { console.error('hermes case not found'); process.exit(1); }
s = s.replace(OLD_CASE, NEW_CASE);

writeFileSync(f, s);
console.log('inserted dispatchHermesPlanCodexTask + routing');
