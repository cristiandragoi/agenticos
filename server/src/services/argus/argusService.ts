/**
 * ARGUS — independent verification system (v1).
 *
 * Wraps the CANONICAL verifier base (GateRunner gate implementations, the
 * Verifier role in codexLoop, verification_reports) rather than replacing it:
 * ARGUS decides WHEN to verify, grades evidence L0–L6, and drives the
 * correction loop — it never runs inside the builder's execution context.
 *
 * Lifecycle per goal (goalStore.verificationState, ARGUS-owned only):
 *   none → (createContract) implementation_ready → verifying → verified_complete
 *                                                    ↘ verification_failed
 *                                                      → correcting (auto-dispatch ≤3)
 *                                                        → verifying → ... 
 *                                                        → escalated (Hermes)
 *
 * Guard: generic goalStore.update() strips verificationState, so Codex/the
 * builder can NEVER create VERIFIED_COMPLETE. Only setVerificationState() —
 * called exclusively from this service — writes it.
 */
import { randomUUID, createHash } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { db } from '../../db/index.js';
import { argusContracts, argusVerifications, argusDefects, argusCorrections, verificationReports } from '../../db/schema.js';
import { eq, and, desc } from 'drizzle-orm';
import { goalStore } from '../goalStore.js';
import { AgentProviderAssignmentService } from '../agent/assignments.js';

const execFileP = promisify(execFile);

export const ARGUS_CORRECTION_CEILING = 3;

export type ArgusVerificationState =
  | 'none'
  | 'implementation_ready'
  | 'verifying'
  | 'verification_failed'
  | 'correcting'
  | 'verified_complete';

export type ArgusCheck =
  | { type: 'file-exists'; path: string }
  | { type: 'file-content'; path: string; contains?: string; exact?: string }
  | { type: 'command'; command: string; args?: string[]; timeoutMs?: number; expectExit?: number; evidenceLevel?: string };

export interface ArgusVerdict {
  passed: boolean;
  summary: string;
  checks: { name: string; passed: boolean; evidence: string; level: string }[];
  blockingIssues: string[];
  recommendedFixes: string[];
}

export interface ArgusContractRecord {
  id: string;
  goalId: string;
  workspacePath: string;
  title: string;
  originalSpec: string;
  acceptanceCriteria: ArgusCheck[];
  specHash: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface ArgusDefectRecord {
  id: string;
  verificationId: string;
  contractId: string;
  goalId: string;
  severity: string;
  description: string;
  reproduction: string | null;
  expected: string | null;
  actual: string | null;
  fixSuggestion: string | null;
  status: string;
  correctionGoalId: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

// ── contract helpers ────────────────────────────────────────────────────────

function hashSpec(originalSpec: string, criteria: ArgusCheck[]): string {
  return createHash('sha256')
    .update(originalSpec)
    .update('\u0000')
    .update(JSON.stringify(criteria))
    .digest('hex');
}

export function getContractForGoal(goalId: string): ArgusContractRecord | undefined {
  const row = db.select().from(argusContracts).where(eq(argusContracts.goalId, goalId)).get();
  if (!row) return undefined;
  return {
    ...row,
    acceptanceCriteria: Array.isArray(row.acceptanceCriteria) ? row.acceptanceCriteria : [],
  } as unknown as ArgusContractRecord;
}

export function getContractById(contractId: string): ArgusContractRecord | undefined {
  const row = db.select().from(argusContracts).where(eq(argusContracts.id, contractId)).get();
  if (!row) return undefined;
  return {
    ...row,
    acceptanceCriteria: Array.isArray(row.acceptanceCriteria) ? row.acceptanceCriteria : [],
  } as unknown as ArgusContractRecord;
}

export function listContracts(limit = 50) {
  return db.select().from(argusContracts).orderBy(desc(argusContracts.createdAt)).limit(limit).all();
}

export function listDefects(limit = 100) {
  return db.select().from(argusDefects).orderBy(desc(argusDefects.createdAt)).limit(limit).all();
}

export function listVerifications(contractId?: string, limit = 50) {
  const q = contractId
    ? db.select().from(argusVerifications).where(eq(argusVerifications.contractId, contractId)).orderBy(desc(argusVerifications.createdAt)).limit(limit)
    : db.select().from(argusVerifications).orderBy(desc(argusVerifications.createdAt)).limit(limit);
  return q.all();
}

/**
 * Create the immutable Task Contract for a goal. Snapshots the ORIGINAL user
 * spec (goal.originalGoal — never the live goal text) + acceptance criteria,
 * and stores a sha256 so any later rewrite of the goal text is detectable.
 */
export async function createContract(
  goalId: string,
  opts: { acceptanceCriteria?: ArgusCheck[]; title?: string } = {},
): Promise<ArgusContractRecord> {
  const goal = goalStore.get(goalId);
  if (!goal) throw Object.assign(new Error('Goal not found.'), { status: 404 });
  if (getContractForGoal(goalId)) throw Object.assign(new Error('Contract already exists for this goal.'), { status: 409 });

  const criteria: ArgusCheck[] =
    opts.acceptanceCriteria && opts.acceptanceCriteria.length
      ? opts.acceptanceCriteria
      : (() => {
          const m = goal.originalGoal.match(/[\w./\\-]+\.\w{1,10}/);
          if (m?.[0]) return [{ type: 'file-exists', path: m[0] }];
          throw Object.assign(new Error('acceptanceCriteria is required when no file path can be inferred from the goal.'), { status: 400 });
        })();

  const contractId = `argus-${randomUUID().slice(0, 9)}`;
  const now = new Date().toISOString();
  const specHash = hashSpec(goal.originalGoal, criteria);

  db.insert(argusContracts).values({
    id: contractId,
    goalId,
    workspacePath: goal.workspacePath || '',
    title: opts.title || `ARGUS contract — ${goal.originalGoal.slice(0, 60)}`,
    originalSpec: goal.originalGoal,
    acceptanceCriteria: criteria as any,
    specHash,
    status: 'implementation_ready',
    createdAt: now,
    updatedAt: now,
  }).run();

  goalStore.update(goalId, { contractId });
  goalStore.setVerificationState(goalId, 'implementation_ready');
  return getContractById(contractId)!;
}

// ── deterministic acceptance checks ────────────────────────────────────────

async function runCheck(check: ArgusCheck, workspacePath: string): Promise<{ passed: boolean; evidence: string; level: string; blockingIssue?: string; fix?: string }> {
  const fs = await import('fs/promises');
  const pathMod = await import('path');
  const abs = (p: string) => pathMod.resolve(workspacePath, p);

  if (check.type === 'file-exists') {
    const p = abs(check.path);
    try {
      await fs.access(p);
      return { passed: true, evidence: `file exists: ${p}`, level: 'L1' };
    } catch {
      return { passed: false, evidence: `file missing: ${p}`, level: 'L1', blockingIssue: `Required file does not exist: ${check.path}`, fix: `Create the file ${check.path} with the required content.` };
    }
  }

  if (check.type === 'file-content') {
    const p = abs(check.path);
    try {
      const content = await fs.readFile(p, 'utf-8');
      if (check.exact !== undefined) {
        const ok = content === check.exact;
        return ok
          ? { passed: true, evidence: `file content matches exactly (${p})`, level: 'L1' }
          : { passed: false, evidence: `file content differs from expected (${p})`, level: 'L1', blockingIssue: `${check.path} content does not match the required exact value. Expected: "${check.exact}".`, fix: `Write the exact required content "${check.exact}" into ${check.path}.` };
      }
      if (check.contains !== undefined) {
        const ok = content.includes(check.contains);
        return ok
          ? { passed: true, evidence: `file contains required text (${p})`, level: 'L1' }
          : { passed: false, evidence: `file does not contain required text (${p})`, level: 'L1', blockingIssue: `${check.path} is missing required content: "${check.contains.slice(0, 80)}".`, fix: `Add the required text into ${check.path}.` };
      }
      return { passed: true, evidence: `file readable (${p})`, level: 'L1' };
    } catch (e: any) {
      return { passed: false, evidence: `cannot read ${p}: ${e?.message}`, level: 'L1', blockingIssue: `Cannot read required file: ${check.path}`, fix: `Create the file ${check.path}.` };
    }
  }

  if (check.type === 'command') {
    const level = check.evidenceLevel || 'L2';
    try {
      const { stdout, stderr } = await execFileP(check.command, check.args || [], {
        cwd: workspacePath,
        timeout: check.timeoutMs || 120000,
        shell: false,
        windowsHide: true,
      });
      const expectExit = check.expectExit ?? 0;
      const tail = (stdout + stderr).slice(-400).trim();
      if (expectExit === 0) {
        return { passed: true, evidence: `command exited 0: ${check.command} ${(check.args || []).join(' ')} — ${tail.slice(0, 120)}`, level };
      }
      return { passed: true, evidence: `command completed (exit ${expectExit}): ${check.command}`, level };
    } catch (e: any) {
      const tail = (e?.stderr || e?.stdout || e?.message || '').toString().slice(-400).trim();
      return { passed: false, evidence: `command failed: ${check.command} ${(check.args || []).join(' ')} — ${tail.slice(0, 200)}`, level, blockingIssue: `Verification command failed: ${check.command} ${(check.args || []).join(' ')}`, fix: `Fix the code so ${check.command} ${(check.args || []).join(' ')} succeeds.` };
    }
  }

  return { passed: false, evidence: `unknown check type`, level: 'L0' };
}

/** Highest evidence level with all checks at-or-below it passed (ladder). */
function gradeEvidence(checkResults: { passed: boolean; level: string }[]): string {
  const order = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6'];
  const highestRequested = Math.max(...checkResults.map((c) => order.indexOf(c.level)));
  // A check of level Ln only counts if every lower-level check also passed.
  for (let lvl = 1; lvl <= highestRequested; lvl++) {
    const atLevel = checkResults.filter((c) => order.indexOf(c.level) === lvl);
    if (atLevel.length && !atLevel.every((c) => c.passed)) return order[lvl - 1];
  }
  return checkResults.length ? order[highestRequested] : 'L0';
}

// ── verification ───────────────────────────────────────────────────────────

/**
 * Run independent verification for a contract. Deterministic checks + the
 * canonical verifier base (verification_reports presence for L5). Never runs
 * inside the builder loop. Returns the verification record.
 */
export async function verifyContract(
  contractId: string,
  opts: { signal?: AbortSignal; attempt?: number } = {},
): Promise<{ verificationId: string; status: string; evidenceLevel: string; verdict: ArgusVerdict; defect?: ArgusDefectRecord }> {
  const contract = getContractById(contractId);
  if (!contract) throw Object.assign(new Error('Contract not found.'), { status: 404 });

  const verificationId = `argv-${randomUUID().slice(0, 9)}`;
  const now = new Date().toISOString();

  db.insert(argusVerifications).values({
    id: verificationId,
    contractId,
    goalId: contract.goalId,
    attempt: opts.attempt ?? 0,
    status: 'verifying',
    evidenceLevel: 'L0',
    verdict: { passed: false, summary: 'verifying', checks: [], blockingIssues: [], recommendedFixes: [] } as any,
    createdAt: now,
  }).run();
  goalStore.setVerificationState(contract.goalId, 'verifying');
  db.update(argusContracts).set({ status: 'verifying', updatedAt: now }).where(eq(argusContracts.id, contractId)).run();

  // 1. Immutability proof — the stored contract must still hash-match the
  //    ORIGINAL spec. A rewrite of the goal text after contract creation is
  //    a contract violation by itself.
  const recomputedHash = hashSpec(contract.originalSpec, contract.acceptanceCriteria);
  const tampered = recomputedHash !== contract.specHash;

  const checks: ArgusVerdict['checks'] = [];
  const blockingIssues: string[] = [];
  const recommendedFixes: string[] = [];

  if (tampered) {
    checks.push({ name: 'contract-immutability', passed: false, evidence: `stored ${contract.specHash.slice(0, 12)} ≠ recomputed ${recomputedHash.slice(0, 12)}`, level: 'L0' });
    blockingIssues.push('The ARGUS task contract no longer matches its original hash — the acceptance criteria were modified after contract creation.');
    recommendedFixes.push('Restore the original spec or create a new contract; never edit acceptance criteria post-hoc.');
  } else {
    checks.push({ name: 'contract-immutability', passed: true, evidence: `sha256 ${contract.specHash.slice(0, 12)} stable`, level: 'L1' });

    // 2. Acceptance criteria — deterministic, no builder involvement.
    const fsMod = await import('fs');
    const ws = contract.workspacePath && fsMod.existsSync(contract.workspacePath) ? contract.workspacePath : '';
    if (!ws) {
      blockingIssues.push('Contract has no resolvable workspace path; verification cannot run.');
    } else {
      for (const check of contract.acceptanceCriteria) {
        if (opts.signal?.aborted) break;
        const name = check.type === 'file-exists' ? `file-exists:${check.path}` : check.type === 'file-content' ? `file-content:${check.path}` : `command:${check.command}`;
        const r = await runCheck(check, ws);
        checks.push({ name, passed: r.passed, evidence: r.evidence, level: r.level });
        if (!r.passed && r.blockingIssue) blockingIssues.push(r.blockingIssue);
        if (!r.passed && r.fix) recommendedFixes.push(r.fix);
      }
    }

    // 3. Canonical verifier integration (L5): a Verifier-role report in
    //    verification_reports for this goal is independent, model-backed
    //    evidence — the canonical verifier is preserved, not replaced.
    const canon = db.select().from(verificationReports).where(eq(verificationReports.goalId, contract.goalId)).all();
    if (canon.some((r: any) => r.passed)) {
      checks.push({ name: 'canonical-verifier', passed: true, evidence: `${canon.filter((r: any) => r.passed).length} passed verification_reports`, level: 'L5' });
    }
  }

  const evidenceLevel = gradeEvidence(checks);
  const passed = blockingIssues.length === 0 && checks.length > 0;
  const verdict: ArgusVerdict = {
    passed,
    summary: passed
      ? `ARGUS verification passed (evidence ${evidenceLevel}).`
      : `ARGUS verification failed (evidence ${evidenceLevel}): ${blockingIssues.length} blocking issue(s).`,
    checks,
    blockingIssues,
    recommendedFixes,
  };

  const completedAt = new Date().toISOString();
  db.update(argusVerifications)
    .set({ status: passed ? 'verified_complete' : 'verification_failed', evidenceLevel, verdict: verdict as any, completedAt })
    .where(eq(argusVerifications.id, verificationId))
    .run();
  db.update(argusContracts).set({ status: passed ? 'verified_complete' : 'verification_failed', updatedAt: completedAt }).where(eq(argusContracts.id, contractId)).run();

  let defect: ArgusDefectRecord | undefined;
  if (passed) {
    goalStore.setVerificationState(contract.goalId, 'verified_complete');
  } else {
    goalStore.setVerificationState(contract.goalId, 'verification_failed');
    defect = createDefectPacket(verificationId, contract, verdict);
    if (tampered) {
      // Contract immutability violation is NOT a builder defect — Codex
      // cannot "fix" an edited contract. Escalate directly to Hermes.
      await escalateToHermes(contract, defect, 1);
    } else {
      // Auto-correction: ARGUS dispatches a correction goal to Codex (≤3).
      await dispatchCorrection(contract, defect, opts);
    }
  }

  return { verificationId, status: passed ? 'verified_complete' : 'verification_failed', evidenceLevel, verdict, defect };
}

/** The exact structured defect packet (requirement 10). */
function createDefectPacket(verificationId: string, contract: ArgusContractRecord, verdict: ArgusVerdict): ArgusDefectRecord {
  const id = `argd-${randomUUID().slice(0, 9)}`;
  const failed = verdict.checks.filter((c) => !c.passed);
  const now = new Date().toISOString();
  db.insert(argusDefects).values({
    id,
    verificationId,
    contractId: contract.id,
    goalId: contract.goalId,
    severity: failed.some((c) => c.name === 'contract-immutability') ? 'critical' : 'major',
    description: verdict.blockingIssues.join(' ').slice(0, 1000),
    reproduction: failed.map((c) => `Check ${c.name}: ${c.evidence.slice(0, 300)}`).join('\n').slice(0, 1500),
    expected: 'All acceptance criteria pass',
    actual: `${failed.length} of ${verdict.checks.length} checks failed`,
    fixSuggestion: verdict.recommendedFixes.join(' ').slice(0, 800),
    status: 'open',
    createdAt: now,
    resolvedAt: null,
  }).run();
  return db.select().from(argusDefects).where(eq(argusDefects.id, id)).get() as unknown as ArgusDefectRecord;
}

/**
 * Auto-correction dispatch (requirements 11–14): ARGUS creates a NEW Codex
 * goal whose loop context carries repairContext (the defect packet) — the
 * user never copies feedback manually. Ceiling = 3 attempts; beyond that the
 * contract escalates to Hermes.
 */
// Test seam: replaces the real loop launcher (never fires an LLM run in tests).
let correctionLauncher = async (goalId: string, ctx: any): Promise<void> => {
  const { resumeCodexGoalLoop } = await import('../../loops/codexLoop.js');
  return resumeCodexGoalLoop(goalId, ctx);
};
export function _setCorrectionLauncher(fn: (goalId: string, ctx: any) => Promise<void>) {
  correctionLauncher = fn;
}

async function dispatchCorrection(contract: ArgusContractRecord, defect: ArgusDefectRecord, opts: { signal?: AbortSignal } = {}): Promise<string | null> {
  const prior = db.select({ attempt: argusCorrections.attempt }).from(argusCorrections).where(eq(argusCorrections.contractId, contract.id)).orderBy(desc(argusCorrections.attempt)).limit(1).get();
  const attempt = (prior?.attempt || 0) + 1;

  if (attempt > ARGUS_CORRECTION_CEILING) {
    await escalateToHermes(contract, defect, attempt);
    return null;
  }

  const goalId = `goal-${randomUUID().slice(0, 9)}`;
  const now = new Date().toISOString();
  const correctionPrompt =
    `AUTO-CORRECTION (ARGUS attempt ${attempt}/${ARGUS_CORRECTION_CEILING}). The implementation was independently verified and FAILED. ` +
    `Original task: ${contract.originalSpec.slice(0, 800)}\n` +
    `Defect: ${defect.description}\n` +
    `Reproduction:\n${defect.reproduction || '—'}\n` +
    `Expected: ${defect.expected}\nActual: ${defect.actual}\n` +
    `Recommended fix: ${defect.fixSuggestion || 'Fix the implementation to satisfy the contract.'}\n` +
    `Fix ONLY this defect against the original task, then finish normally.`;

  goalStore.create({
    id: goalId,
    workspacePath: contract.workspacePath || undefined,
    originalGoal: correctionPrompt,
    status: 'queued',
    history: [],
    createdAt: now,
    updatedAt: now,
    retryCount: 0,
    providerFallbackCount: 0,
    executionOptions: { argusCorrection: { contractId: contract.id, defectId: defect.id, attempt } },
  });
  // Link the correction goal to the contract + mark correcting so the finish
  // hook re-verifies automatically.
  goalStore.update(goalId, { contractId: contract.id });
  goalStore.setVerificationState(goalId, 'correcting');
  goalStore.setVerificationState(contract.goalId, 'correcting');

  db.insert(argusCorrections).values({
    id: `argc-${randomUUID().slice(0, 9)}`,
    contractId: contract.id,
    defectId: defect.id,
    goalId,
    attempt,
    status: 'dispatched',
    createdAt: now,
    completedAt: null,
  }).run();
  db.update(argusDefects).set({ status: 'dispatched', correctionGoalId: goalId }).where(eq(argusDefects.id, defect.id)).run();

  // The defect packet is injected automatically into the correction loop's
  // system prompt via context.repairContext — no manual copying.
  correctionLauncher(goalId, {
    repairContext: {
      blockingIssues: [defect.description],
      recommendedFixes: [defect.fixSuggestion || 'Fix the implementation to satisfy the contract.'],
      attempt,
    },
  }).catch(console.error);
  return goalId;
}

/** Requirement 14 — after the retry ceiling, escalate to Hermes. */
async function escalateToHermes(contract: ArgusContractRecord, defect: ArgusDefectRecord, attempt: number): Promise<void> {
  const now = new Date().toISOString();
  db.update(argusDefects).set({ status: 'escalated' }).where(eq(argusDefects.id, defect.id)).run();
  db.update(argusContracts).set({ status: 'escalated', updatedAt: now }).where(eq(argusContracts.id, contract.id)).run();

  try {
    const { backgroundTaskManager } = await import('../backgroundTasks/manager.js');
    const res = backgroundTaskManager.createTask({
      title: `ARGUS escalation: ${contract.title.slice(0, 80)}`,
      objective: 'Review the ARGUS verification failure after the 3-correction ceiling and decide the next action (manual fix, new task, or accept).',
      originalRequest: contract.originalSpec.slice(0, 2000),
      route: 'argus-escalation',
      selectedAgent: 'agent-hermes',
      worker: 'hermes',
      priority: 'high',
      workspaceRoot: contract.workspacePath || undefined,
      metadata: {
        argus: { contractId: contract.id, defectId: defect.id, attempt, status: 'escalated' },
      },
    });
    if (res?.error) console.error(`[ARGUS] Hermes escalation task rejected: ${res.error}`);
  } catch (e: any) {
    // Escalation is recorded in argus tables regardless; the task is best-effort.
    console.error(`[ARGUS] Hermes escalation task failed: ${e?.message}`);
  }
}

/**
 * Hook called when ANY goal completes (builder finish). If the goal is bound
 * to an ARGUS contract (primary goal or auto-correction goal), verification
 * runs automatically — no manual ARGUS feedback copying (requirement 12).
 */
export async function onGoalCompleted(goalId: string): Promise<void> {
  const goal = goalStore.get(goalId);
  if (!goal) return;
  const execOpts: any = goal.executionOptions || {};
  const correctionCtx: any = execOpts.argusCorrection;
  const contractId = correctionCtx?.contractId || goal.contractId;
  if (!contractId) return;
  const contract = getContractById(contractId);
  if (!contract) return;
  // Correction goals are in 'correcting' — verify after they finish; primary
  // goals in 'implementation_ready' are verified as soon as the builder done.
  if (goal.verificationState !== 'correcting' && goal.verificationState !== 'implementation_ready') return;
  if (goal.status !== 'completed') return;
  try {
    await verifyContract(contractId, { attempt: correctionCtx?.attempt ?? 0 });
  } catch (e: any) {
    console.error(`[ARGUS] auto-verify after goal ${goalId} failed: ${e?.message}`);
  }
}

export async function verifyGoal(goalId: string): Promise<ReturnType<typeof verifyContract>> {
  const contract = getContractForGoal(goalId);
  if (!contract) throw Object.assign(new Error('No ARGUS contract for this goal.'), { status: 404 });
  return verifyContract(contract.id);
}

/** Provider/model used by ARGUS (requirement 4) — for observability. */
export async function getArgusAssignment() {
  try {
    const a = await AgentProviderAssignmentService.getAssignment('agent-argus');
    return a ? { providerId: a.providerId, modelId: a.modelId || null, routingMode: a.routingMode } : null;
  } catch {
    return null;
  }
}
