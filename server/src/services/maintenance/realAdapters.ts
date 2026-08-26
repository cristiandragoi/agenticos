/**
 * Maintenance Supervisor — real worker adapters (Phase 4.1 + hardening).
 *
 * Wires the Phase 4 repair-loop adapter boundaries to the REAL production
 * execution infrastructure. No duplicate Hermes/CodeX implementations:
 *   - plan   → real Hermes planning (executeHermesTask → canonical run/result)
 *   - repair → real CodeX execution (codexService.createGoal → reconcile)
 *   - test   → real test gates (typed, allowlisted: tsc + focused vitest)
 *   - verify → real verifier (typecheck)
 *
 * Every Hermes/CodeX result remains a canonical execution result (via the
 * existing run/result services), so provenance is preserved end-to-end.
 *
 * Phase 4 hardening:
 *   - the CodeX repair adapter snapshots the repository BEFORE and AFTER the
 *     repair and computes a typed `ChangedFile[]` diff (tracked + untracked
 *     content hashes) — the AUTHORITATIVE file-change evidence, never parsed
 *     from prose finalAnswer. That evidence is persisted on the canonical
 *     execution result and returned to the repair loop for ownership checks.
 */

import type { PlanAdapter, RepairAdapter, TestAdapter, VerifyAdapter } from './repairLoop.js';
import { runTypecheckGate, runTypedTestGates, type TestGateOutcome } from './testGates.js';
import type { MaintenanceChangeSet, MaintenanceTestGate, ChangedFile } from './changeSet.js';
import { snapshotRepo, computeChangedFiles } from './snapshot.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll a predicate until it returns true or the timeout elapses. */
async function pollUntil<T>(fn: () => T | null | undefined | false, timeoutMs: number, intervalMs = 1500): Promise<T | null> {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - start >= timeoutMs) return null;
    await sleep(intervalMs);
  }
}

/**
 * Best-effort extraction of repo-relative source file paths from free-form plan
 * text. Only paths that look like a nested source/script file (contain a '/'
 * and a code extension) are returned — absolute paths and single-token words
 * are excluded so the ownership set is never broadened by prose.
 */
export function extractRepoPaths(text: string): string[] {
  if (!text) return [];
  const re = /([A-Za-z0-9_\-./]+\/(?:[A-Za-z0-9_\-./]+)?[A-Za-z0-9_\-]+\.(?:ts|tsx|js|mjs|cjs|json|py|md|css|html))/g;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    let p = m[1].replace(/\\/g, '/').replace(/^\.\//, '');
    // Drop leading markdown/punctuation noise.
    p = p.replace(/^[`'"([=:]+/, '');
    if (p.includes('/') && !p.startsWith('/') && !/^https?:/.test(p)) {
      seen.add(p);
    }
  }
  return [...seen];
}

/* ── Real Hermes plan adapter ─────────────────────────────────────────── */

export interface HermesPlanAdapterOptions {
  projectId?: string;
  conversationId?: string;
  /** Poll timeout for the Hermes run to reach a terminal state. */
  timeoutMs?: number;
}

export function makeHermesPlanAdapter(opts: HermesPlanAdapterOptions = {}): PlanAdapter {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  return async (evidence, ctx) => {
    const { projectTaskService } = await import('../../services/projectExecution/projectTaskService.js');
    const { executionRunService } = await import('../../services/projectExecution/executionRunService.js');
    const { executeHermesTask } = await import('../../domains/workerAdapters/hermesAdapter.js');
    const { projectsStore } = await import('../../services/projectsStore.js');

    let projectId = opts.projectId || projectsStore.getActiveProjectId();
    if (!projectId) {
      const all = projectsStore.listProjects();
      projectId = all[0]?.id || `proj-maint-${Date.now()}`;
      if (!all.length) {
        projectsStore.createProject({ id: projectId, name: 'Maintenance', description: 'Self-maintenance', status: 'active' });
      }
      projectsStore.setActiveProjectId(projectId);
    }

    const goal = projectTaskService.createGoal({
      projectId,
      title: `Maintenance diagnosis (${ctx.changeSetId})`,
      objective: evidence,
    });
    const task = projectTaskService.createTask({
      projectId,
      goalId: goal.id,
      title: `Diagnose & plan: ${ctx.changeSetId}`,
      description: evidence,
      taskType: 'engineering',
      assignedCapability: 'hermes',
      acceptanceCriteria: 'Produce a concrete, structured repair plan: root cause, exact files to change, and the change to apply.',
    });

    const { run } = await executeHermesTask(task, {
      prompt: `Diagnose this software failure and produce a concrete repair plan. Identify the root cause, the exact files to change, and the change to apply. The following is the REPRODUCED failure evidence (authoritative — do not guess beyond it):\n\n${evidence}`,
      conversationId: opts.conversationId,
      projectId,
      goalId: goal.id,
    });

    // Wait for the canonical run to reach a terminal state.
    const completed = await pollUntil(
      () => {
        const r = executionRunService.getRun(run.id);
        return r && !['running', 'queued'].includes(r.status) ? r : null;
      },
      timeoutMs
    );

    if (!completed) {
      throw new Error(`Hermes plan run ${run.id} did not reach a terminal state within ${timeoutMs}ms.`);
    }

    const result = completed.finalResultId ? executionRunService.getResult(completed.finalResultId) : null;
    const struct = (result?.structuredOutput as any) || {};
    const planText = struct.summary || result?.summary || `Hermes plan for ${evidence.slice(0, 80)}`;
    return { resultId: result?.id ?? run.id, plan: planText, files: extractRepoPaths(String(planText)) };
  };
}

/* ── Real CodeX repair adapter ────────────────────────────────────────── */

export interface CodexRepairAdapterOptions {
  repoPath?: string;
  conversationId?: string;
  /** Poll timeout for the CodeX goal to reach a terminal state. */
  timeoutMs?: number;
}

export function makeCodexRepairAdapter(opts: CodexRepairAdapterOptions = {}): RepairAdapter {
  const timeoutMs = opts.timeoutMs ?? 240_000;
  return async (plan, ctx) => {
    const { codexService } = await import('../../domains/codex/service.js');
    const { goalStore } = await import('../../services/goalStore.js');
    const { reconcileGoalToResult } = await import('../../domains/workerAdapters/codexAdapter.js');

    const repoPath = opts.repoPath || process.cwd();
    // Authoritative changed-file evidence: snapshot BEFORE the repair so the
    // supervisor can compute the repair's true delta afterward.
    const before = await snapshotRepo(repoPath);

    const goalId = await codexService.createGoal(
      `Implement this repair in the repository at ${repoPath}. Edit the affected files to apply the fix. Do NOT commit, do NOT deploy, do NOT push.\n\nRepair plan:\n${plan}`,
      repoPath,
      'auto', // auto-execute the working-tree edit; the COMMIT remains human-approved
      undefined,
      opts.conversationId
    );

    // Wait for the goal to reach a terminal state.
    const terminalGoal = await pollUntil(
      () => {
        const g = goalStore.get(goalId);
        return g && ['completed', 'failed', 'stopped', 'cancelled', 'interrupted'].includes(g.status) ? g : null;
      },
      timeoutMs
    );

    if (!terminalGoal) {
      throw new Error(`CodeX repair goal ${goalId} did not reach a terminal state within ${timeoutMs}ms.`);
    }
    if (terminalGoal.status !== 'completed') {
      throw new Error(`CodeX repair goal ${goalId} ended in status '${terminalGoal.status}'.`);
    }

    // AFTER snapshot + typed diff (tracked + untracked content hashes).
    const after = await snapshotRepo(repoPath);
    const changedFiles: ChangedFile[] = computeChangedFiles(before, after);

    const rs: any = (terminalGoal as any).runSummary || {};
    const finalAnswer = typeof rs.finalAnswer === 'string' ? rs.finalAnswer : (rs.summary as string | undefined);

    // Reconcile to the canonical execution result (idempotent), persisting the
    // typed changed-file evidence alongside the result.
    let resultId = goalId;
    try {
      const rec = await reconcileGoalToResult(goalId, finalAnswer || 'CodeX repair completed', changedFiles);
      resultId = rec.resultId ?? goalId;
    } catch {
      /* non-fatal: fall back to goalId as the provenance handle */
    }

    return { resultId, filesChanged: changedFiles };
  };
}

/* ── Real test-gates adapter ──────────────────────────────────────────── */

export interface TestGatesAdapterOptions {
  repoPath?: string;
  /** Typed, allowlisted gate definitions (reproduction + verification). */
  testGates?: MaintenanceTestGate[];
  /** Legacy: focused vitest suite paths (ignored when testGates provided). */
  suites?: string[];
  includeBuild?: boolean;
}

export function makeTestGatesAdapter(opts: TestGatesAdapterOptions = {}): TestAdapter {
  return async (): Promise<TestGateOutcome[]> => {
    const repoPath = opts.repoPath || process.cwd();
    if (opts.testGates && opts.testGates.length > 0) {
      return runTypedTestGates(repoPath, opts.testGates);
    }
    const out: TestGateOutcome[] = [await runTypecheckGate(repoPath)];
    if (opts.suites && opts.suites.length > 0) {
      out.push(...(await runTypedTestGates(repoPath, opts.suites.map((target) => ({ type: 'vitest' as const, target })))));
    }
    return out;
  };
}

/* ── Real verifier adapter ────────────────────────────────────────────── */

export interface VerifierAdapterOptions {
  repoPath?: string;
}

/**
 * Real verifier: re-confirms the repair by running a real typecheck gate after
 * the repair. The maintenance loop's canonical verification is the combination
 * of (a) test gates (typecheck + focused tests) and (b) diff-safety; this
 * adapter performs a real, non-hardcoded re-verification of compilation.
 */
export function makeVerifierAdapter(opts: VerifierAdapterOptions = {}): VerifyAdapter {
  return async () => {
    const repoPath = opts.repoPath || process.cwd();
    const typecheck = await runTypecheckGate(repoPath);
    return {
      passed: typecheck.passed,
      reason: typecheck.passed
        ? 'verifier: typecheck passed after repair'
        : `verifier: typecheck failed after repair (${typecheck.evidence})`,
    };
  };
}

export type { PlanAdapter, RepairAdapter, TestAdapter, VerifyAdapter, MaintenanceChangeSet, MaintenanceTestGate, ChangedFile };
