/**
 * domains/codingRuntime/service.ts — CodingRuntime orchestrator.
 *
 * Agentic OS owns the run lifecycle: queued → preparing_workspace → running
 * → (retrying/switching_provider) → verifying → awaiting_review →
 * completed/failed/cancelled. Provider failures never lose workspace state:
 * a compact CodingFallbackHandoff carries the run forward in the SAME
 * worktree. No merge/deploy ever happens here.
 */

import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { logger } from '../../utils/logger.js';
import type {
  CodingRun, CodingRunRequest, CodingRunStatus, CodingProviderAttempt,
  CodingFallbackHandoff, CodingCheckpoint, CodingFailureClass,
} from './types.js';
import { createWorktree, removeWorktree, collectWorktreeDiff, runTestCommand, gitStatus, WorktreeInfo } from './gitWorktree.js';
import { buildTaskPacket, renderTaskPrompt } from './taskPacket.js';
import { classifyCodingFailure, isFallbackEligible } from './failureClassifier.js';
import { codexRuntimeAdapter, CodexRunResult } from './codexRuntimeAdapter.js';
import { saveCodingRun, getCodingRun, listCodingRuns, countCodingRuns } from './store.js';

/** Resolve a provider's scoped env for the codex subprocess (key from the
 *  canonical secret mechanism; caller supplies it — never logged). */
export interface ProviderEnvResolver {
  (provider: string, model: string): Promise<Record<string, string>>;
}

export class CodingRuntimeService {
  private activeCancels = new Map<string, () => void>();
  private providerEnvResolver: ProviderEnvResolver;

  constructor(providerEnvResolver: ProviderEnvResolver = async () => ({})) {
    this.providerEnvResolver = providerEnvResolver;
  }

  private newRun(req: CodingRunRequest): CodingRun {
    const now = new Date().toISOString();
    return {
      runId: `cr-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`,
      taskId: req.taskId,
      projectId: req.projectId,
      projectTaskId: req.projectTaskId,
      backgroundTaskId: req.backgroundTaskId,
      executionRunId: req.executionRunId,
      status: 'queued',
      runtime: 'codex_builder',
      providerPolicyId: req.providerPolicy.policyId,
      workspace: req.workspace,
      created: now,
      updated: now,
      instructions: req.instructions,
      acceptanceCriteria: req.acceptanceCriteria,
      changedFiles: [],
      commands: [],
      artifacts: [],
      providerAttempts: [],
      fallbackHistory: [],
      checkpoints: [],
      errors: [],
      metadata: { request: req },
    };
  }

  private touch(run: CodingRun): void {
    run.updated = new Date().toISOString();
  }

  private checkpoint(run: CodingRun, phase: CodingCheckpoint['phase'], detail?: Record<string, unknown>): void {
    run.checkpoints.push({ phase, timestamp: new Date().toISOString(), detail });
    this.touch(run);
    saveCodingRun(run);
  }

  private addError(run: CodingRun, phase: string, message: string): void {
    run.errors.push({ phase, message: String(message).slice(0, 500), at: new Date().toISOString() });
  }

  async startRun(req: CodingRunRequest): Promise<CodingRun> {
    const run = this.newRun(req);
    saveCodingRun(run);
    logger.info(`[CodingRuntime] ${run.runId} start project=${req.projectId} task=${req.taskId} policy=${req.providerPolicy.policyId}`);
    // Kick off async execution (fire-and-forget with internal error capture).
    this.executeRun(run.runId).catch((err) => {
      logger.error(`[CodingRuntime] ${run.runId} uncaught execution error:`, err);
    });
    return run;
  }

  getRun(runId: string): CodingRun | null { return getCodingRun(runId); }
  listRuns(projectId?: string): CodingRun[] { return listCodingRuns(projectId); }
  countRuns(): number { return countCodingRuns(); }

  cancelRun(runId: string): CodingRun | null {
    const run = getCodingRun(runId);
    if (!run) return null;
    const cancel = this.activeCancels.get(runId);
    if (cancel) cancel();
    if (run.status === 'queued' || run.status === 'preparing_workspace' || run.status === 'running' || run.status === 'retrying' || run.status === 'switching_provider' || run.status === 'verifying') {
      run.status = 'cancelled';
      run.cancellationReason = 'Cancelled by user';
      run.endedAt = new Date().toISOString();
      run.providerAttempts = run.providerAttempts.map((a) => a.outcome === 'running' ? { ...a, outcome: 'cancelled', endedAt: new Date().toISOString() } : a);
      this.checkpoint(run, 'awaiting_review', { note: 'cancelled' });
    }
    return run;
  }

  /**
   * Execute the run: prepare worktree → run codex (provider A, fallback B) →
   * collect diff → run tests → mark awaiting_review.
   */
  private async executeRun(runId: string): Promise<void> {
    let run = getCodingRun(runId);
    if (!run) return;

    // ── 1. Prepare worktree ──
    run.status = 'preparing_workspace';
    this.touch(run); saveCodingRun(run);
    let worktree: WorktreeInfo;
    try {
      worktree = await createWorktree({ taskId: run.taskId, runId: run.runId, repoPath: run.workspace });
      run.worktreePath = worktree.worktreePath;
      run.branch = worktree.branch;
      run.baseCommit = worktree.baseCommit;
      run.baseBranch = worktree.baseBranch;
      this.checkpoint(run, 'workspace_created', {
        worktreePath: worktree.worktreePath,
        branch: worktree.branch,
        baseCommit: worktree.baseCommit,
        parentDirty: worktree.parentDirty,
      });
      if (worktree.parentDirty) {
        run.metadata = { ...run.metadata, parentDirtyAtStart: worktree.parentUncommittedPaths.slice(0, 20) };
      }
    } catch (err: any) {
      run.status = 'failed';
      run.endedAt = new Date().toISOString();
      this.addError(run, 'workspace_creation', err.message);
      saveCodingRun(run);
      return;
    }

    // ── 2. Task packet ──
    const packet = buildTaskPacket({
      objective: run.instructions,
      acceptanceCriteria: run.acceptanceCriteria,
      workspacePath: run.worktreePath,
      testCommands: (run.metadata.request as CodingRunRequest)?.allowedCommands ?? [],
    });
    run.packetHash = packet.hash;
    const prompt = renderTaskPrompt(packet);
    this.checkpoint(run, 'repository_inspected', { packetHash: packet.hash });

    // ── 3. Provider policy ──
    const policy = (run.metadata.request as CodingRunRequest).providerPolicy;
    const primary = policy.primary;
    const fallbacks = policy.fallback.slice(0, policy.maxFallbacks);
    const maxTotal = policy.maxTotalAttempts || (1 + fallbacks.length);
    let totalAttempts = 0;
    let currentProvider = primary;

    const policyAttempt = (provider: string, model: string): CodingProviderAttempt => ({
      attempt: totalAttempts + 1,
      provider,
      model,
      startedAt: new Date().toISOString(),
      outcome: 'running',
    });

    // ── 4. Provider loop ──
    run.status = 'running';
    this.touch(run); saveCodingRun(run);

    let lastResult: CodexRunResult | null = null;
    let attemptIndex = 0;
    const providersToTry: { provider: string; model: string }[] = [{ provider: primary, model: primary }];
    for (const fb of fallbacks) providersToTry.push({ provider: fb, model: fb });

    for (const attempt of providersToTry) {
      if (totalAttempts >= maxTotal) break;
      // Re-read fresh state — cancelRun() may have mutated the stored run.
      run = getCodingRun(runId) ?? run;
      if ((run.status as CodingRunStatus) === 'cancelled') break;

      currentProvider = attempt.provider;
      let attemptRec = policyAttempt(attempt.provider, attempt.model);
      run.providerAttempts.push(attemptRec);
      this.touch(run); saveCodingRun(run);

      // Build a handoff when this is NOT the first provider.
      let attemptPrompt = prompt;
      if (attemptIndex > 0) {
        const handoff = this.buildHandoff(run, attempt.provider, attempt.model, 'provider fallback');
        run.status = 'switching_provider';
        this.checkpoint(run, 'fallback_initiated', { from: run.providerAttempts[attemptIndex - 1]?.provider, to: attempt.provider });
        attemptPrompt = `${prompt}\n\n# CONTINUATION HANDOFF (previous provider failed)\n${JSON.stringify(handoff)}`;
      }

      // Resolve provider scoped env (keys from the canonical secret mechanism).
      let providerEnv: Record<string, string> = {};
      try {
        providerEnv = await this.providerEnvResolver(attempt.provider, attempt.model);
      } catch (err: any) {
        logger.warn(`[CodingRuntime] ${run.runId} provider env resolution failed: ${err.message}`);
      }

      // Deterministic live-fallback test hook (spike.forceProviderFailure):
      // force an ELIGIBLE transient failure for the named provider so the
      // A→B fallback path can be proven live without a real outage.
      const spikeReq = (run.metadata.request as CodingRunRequest).spike;
      if (spikeReq?.forceProviderFailure?.provider?.toLowerCase() === attempt.provider.toLowerCase()) {
        const reason = spikeReq.forceProviderFailure.reason || 'Simulated transient provider outage (spike.forceProviderFailure)';
        this.checkpoint(run, attemptIndex === 0 ? 'implementation_started' : 'files_changed', { provider: attempt.provider });
        lastResult = { exitCode: 1, status: 'failed', events: [], eventTail: [], commands: [], agentMessages: [], error: reason, durationMs: 0 };
        totalAttempts++;
        run = getCodingRun(runId) ?? run;
        attemptRec = run.providerAttempts[run.providerAttempts.length - 1] ?? attemptRec;
        attemptRec.outcome = 'failed';
        attemptRec.endedAt = new Date().toISOString();
        attemptRec.failureClass = 'PROVIDER_TRANSIENT';
        attemptRec.failureReason = reason;
        this.addError(run, `provider_${attempt.provider}`, reason);
        this.checkpoint(run, 'provider_failure', { provider: attempt.provider, failureClass: 'PROVIDER_TRANSIENT' });
        const eligible = isFallbackEligible('PROVIDER_TRANSIENT') && attemptIndex < fallbacks.length && totalAttempts < maxTotal;
        if (!eligible) {
          run.status = 'failed';
          run.endedAt = new Date().toISOString();
          this.touch(run); saveCodingRun(run);
          return;
        }
        attemptIndex++;
        this.touch(run); saveCodingRun(run);
        continue;
      }

      this.checkpoint(run, attemptIndex === 0 ? 'implementation_started' : 'files_changed', { provider: attempt.provider });
      lastResult = await this.runWithAdapter(run, attemptPrompt, attempt.provider, attempt.model, providerEnv);

      // Record commands from the codex run.
      if (lastResult) {
        for (const c of lastResult.commands) {
          run.commands.push({
            command: c.command.slice(0, 1000),
            cwd: run.worktreePath!,
            startedAt: run.startedAt || run.created,
            exitCode: c.exitCode,
            outputPreview: c.aggregatedOutput.slice(0, 500),
            provider: attempt.provider,
            model: attempt.model,
            runId: run.runId,
            highRisk: /(rm|del|drop|truncate|format|push|merge|deploy|env|secret|token)/i.test(c.command),
          });
        }
        run.artifacts = [...new Set([...run.artifacts, ...(lastResult.agentMessages.length ? ['agent-summary'] : [])])];
      }

      totalAttempts++;

      run = getCodingRun(runId) ?? run;
      // Re-sync the attempt record from the reloaded run — the reload creates
      // fresh objects; mutating the stale `attemptRec` would be lost.
      attemptRec = run.providerAttempts[run.providerAttempts.length - 1] ?? attemptRec;
      if ((run.status as CodingRunStatus) === 'cancelled') break;

      if (lastResult?.status === 'completed') {
        attemptRec.outcome = 'succeeded';
        attemptRec.endedAt = new Date().toISOString();
        this.touch(run); saveCodingRun(run);
        break;
      }

      // Failure classification.
      const errMsg = lastResult?.error || `codex exit ${lastResult?.exitCode}`;
      const failureClass: CodingFailureClass = classifyCodingFailure(errMsg, { aborted: run.status === 'cancelled' });
      attemptRec.outcome = 'failed';
      attemptRec.endedAt = new Date().toISOString();
      attemptRec.failureClass = failureClass;
      attemptRec.failureReason = errMsg.slice(0, 500);
      this.addError(run, `provider_${attempt.provider}`, errMsg.slice(0, 500));
      this.checkpoint(run, 'provider_failure', { provider: attempt.provider, failureClass });

      const eligible = isFallbackEligible(failureClass) && attemptIndex < fallbacks.length && totalAttempts < maxTotal;
      if (!eligible) {
        run.status = 'failed';
        run.endedAt = new Date().toISOString();
        this.touch(run); saveCodingRun(run);
        return;
      }
      attemptIndex++;
    }

    if ((run.status as CodingRunStatus) === 'cancelled') {
      this.touch(run); saveCodingRun(run);
      return;
    }

    if (!lastResult || lastResult.status !== 'completed') {
      run.status = 'failed';
      run.endedAt = new Date().toISOString();
      this.touch(run); saveCodingRun(run);
      return;
    }

    // Bounded model-response telemetry (redacted in the adapter; never
    // secrets). Useful for diagnosing no-op model turns (Phase 32).
    if (lastResult?.agentMessages?.length || lastResult?.eventTail?.length) {
      run.metadata = {
        ...run.metadata,
        agentMessages: (lastResult?.agentMessages ?? []).slice(-5).map((m) => m.slice(0, 600)),
        eventTail: (lastResult?.eventTail ?? []).slice(-30),
      };
    }

    // ── 5. Collect diff ──
    try {
      const diffInfo = collectWorktreeDiff(run.worktreePath!, run.baseCommit!);
      run.changedFiles = diffInfo.changedFiles;
      run.diffSummary = diffInfo.summary.slice(0, 2000);
      run.diffRef = diffInfo.diff.slice(0, 200_000);
      this.checkpoint(run, 'files_changed', { changedFiles: diffInfo.changedFiles.length });
    } catch (err: any) {
      this.addError(run, 'diff', err.message);
    }

    // ── 6. Run tests (Agentic OS owns the verification command set) ──
    run.status = 'verifying';
    this.checkpoint(run, 'verification_started');
    this.touch(run); saveCodingRun(run);

    const testCommands = (run.metadata.request as CodingRunRequest).allowedCommands?.filter((c) => /test|spec|vitest|jest/.test(c)) ?? [];
    const testResults: CodingRun['testResults'] = { requested: testCommands, ran: [], passed: 0, failed: 0, skipped: 0, buildOk: false, rawRefs: [] };
    for (const tc of testCommands) {
      // Simple "npm run X" / "npx X" style commands; split on first space.
      const [cmd, ...rest] = tc.split(/\s+/);
      const r = await runTestCommand(run.worktreePath!, cmd, rest, 180000);
      testResults.ran.push(tc);
      testResults.rawRefs.push(`${tc} → exit ${r.exitCode}`);
      run.commands.push({
        command: tc,
        cwd: run.worktreePath!,
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        exitCode: r.exitCode,
        outputPreview: (r.output + r.error).slice(0, 500),
        provider: currentProvider,
        model: currentProvider,
        runId: run.runId,
      });
      if (r.exitCode === 0) testResults.passed++;
      else testResults.failed++;
    }
    if (testCommands.length === 0) {
      testResults.ran = [];
      testResults.rawRefs = ['(no test commands configured for this task)'];
    }
    run.testResults = testResults;
    this.touch(run); saveCodingRun(run);

    // ── 7. Verifier (deterministic: acceptance criteria present in diff + tests pass) ──
    const diffOk = run.changedFiles.length > 0;
    const testsOk = testResults.failed === 0;
    run.verifierVerdict = diffOk && testsOk ? 'PASS' : 'NEEDS_REVISION';
    run.verifierProvenance = 'deterministic: changedFiles>0 && configuredTestCommands exit 0';

    // ── 8. Review gate ──
    run.status = 'awaiting_review';
    run.reviewState = 'awaiting_review';
    this.checkpoint(run, 'awaiting_review', { changedFiles: run.changedFiles.length, verifier: run.verifierVerdict });
    this.touch(run); saveCodingRun(run);
    logger.info(`[CodingRuntime] ${run.runId} awaiting_review changed=${run.changedFiles.length} verifier=${run.verifierVerdict}`);
  }

  /**
   * Execution seam — routes a single provider attempt through the Codex
   * adapter with cancellation registration. Tests override this method.
   */
  protected async runWithAdapter(
    run: CodingRun,
    prompt: string,
    provider: string,
    model: string,
    providerEnv: Record<string, string>,
  ): Promise<CodexRunResult> {
    const opts = await this.buildCodexOptions(run, provider, providerEnv);
    const { promise, cancel } = codexRuntimeAdapter.runCodex({
      workdir: run.worktreePath!,
      prompt,
      sandboxMode: 'workspace-write',
      ...opts,
      timeoutMs: (run.metadata.request as CodingRunRequest).timeoutMs || 600000,
    });
    this.activeCancels.set(run.runId, cancel);
    try {
      return await promise;
    } finally {
      this.activeCancels.delete(run.runId);
    }
  }

  /**
   * Build provider-specific Codex options. For DeepSeek, create a bounded
   * CODEX_HOME with a model_providers entry using the CURRENT official wire
   * contract (`wire_api = "responses"` — "chat" is no longer supported in
   * Codex >= 0.145). The key arrives via providerEnv (never logged).
   */
  protected async buildCodexOptions(run: CodingRun, provider: string, providerEnv: Record<string, string>): Promise<{ model?: string; modelProvider?: string; codexHome?: string; providerConfig?: Record<string, string> }> {
    const request = (run.metadata.request as CodingRunRequest) || {};
    if (provider.toLowerCase() === 'deepseek') {
      const baseUrl = request.spike?.deepseekBaseUrl || 'https://api.deepseek.com/v1';
      const wireModel = request.spike?.deepseekModel || 'deepseek-chat';
      // Write a minimal CODEX_HOME config declaring the DeepSeek provider.
      // CODEX_HOME must NOT live under the system temp dir: Codex 0.145
      // refuses to create helper binaries/PATH aliases under temp, which
      // breaks the apply_patch tool (live spike evidence: "Refusing to
      // create helper binaries under temporary dir"). Use a per-run dir
      // under LOCALAPPDATA (non-temp) so helper binaries work.
      const homesRoot = process.env.LOCALAPPDATA
        ? path.join(process.env.LOCALAPPDATA, 'agenticos', 'codex-homes')
        : path.join(os.homedir(), '.agenticos', 'codex-homes');
      fs.mkdirSync(homesRoot, { recursive: true });
      const codexHome = fs.mkdtempSync(path.join(homesRoot, `codex-deepseek-${run.runId}-`));
      const config = `
model = "${wireModel}"
model_provider = "deepseek"
# Windows sandbox driver: WITHOUT this, Codex on Windows degrades to a
# restrictive profile that declines ALL writes/process execution even with
# -s workspace-write (live spike evidence: "rejected: blocked by policy").
# The user's working CODEX_HOME sets the same value.
[windows]
sandbox = "elevated"
[model_providers.deepseek]
name = "DeepSeek V4"
base_url = "${baseUrl}"
env_key = "DEEPSEEK_API_KEY"
wire_api = "responses"
`;
      fs.writeFileSync(path.join(codexHome, 'config.toml'), config);
      return { model: wireModel, modelProvider: 'deepseek', codexHome, providerConfig: providerEnv };
    }
    // Default provider (e.g. openai): use the existing user auth and the
    // user's configured default model — do NOT pass a model name (passing
    // `-m openai` would ask Codex for a model literally named "openai").
    return { providerConfig: providerEnv };
  }

  private buildHandoff(run: CodingRun, nextProvider: string, nextModel: string, reason: string): CodingFallbackHandoff {
    const failedAttempt = [...run.providerAttempts].reverse().find((a) => a.outcome === 'failed');
    const handoff: CodingFallbackHandoff = {
      runId: run.runId,
      taskId: run.taskId,
      projectId: run.projectId,
      workspacePath: run.worktreePath || run.workspace,
      baseCommit: run.baseCommit || '',
      currentBranch: run.branch || '',
      provider: failedAttempt?.provider || run.providerAttempts[0]?.provider || 'unknown',
      model: failedAttempt?.model || run.providerAttempts[0]?.model || 'unknown',
      failureReason: failedAttempt?.failureReason || reason,
      failureClass: failedAttempt?.failureClass || 'UNKNOWN',
      completedSteps: run.checkpoints.filter((c) => c.phase !== 'provider_failure').map((c) => c.phase),
      remainingAcceptanceCriteria: run.acceptanceCriteria ? [run.acceptanceCriteria] : [],
      filesChanged: run.changedFiles,
      diffSummary: run.diffSummary || '',
      commandsRun: run.commands.slice(-10),
      testsPassed: run.testResults?.ran.filter((_, i) => run.testResults?.rawRefs[i]?.includes('exit 0')) ?? [],
      testsFailing: run.testResults?.ran.filter((_, i) => run.testResults?.rawRefs[i]?.includes('exit 0') === false) ?? [],
      knownErrors: run.errors.map((e) => e.message),
      nextRecommendedAction: `Continue in the SAME worktree (${run.worktreePath}) with provider ${nextProvider}/${nextModel}; inspect existing diff and finish remaining acceptance criteria, then run the configured tests and report.`,
      handoffAt: new Date().toISOString(),
    };
    run.fallbackHistory.push({ from: failedAttempt?.provider || 'unknown', to: nextProvider, reason, at: new Date().toISOString(), handoffRef: `handoff-${run.runId}-${run.fallbackHistory.length + 1}` });
    return handoff;
  }

  /** Phase 25 — request changes: preserve run/task/worktree, new continuation turn. */
  async requestChanges(runId: string, feedback: string): Promise<CodingRun | null> {
    const run = getCodingRun(runId);
    if (!run) return null;
    if (run.status !== 'awaiting_review' && run.status !== 'completed') return run;
    run.reviewState = 'changes_requested';
    run.reviewFeedback = feedback;
    run.status = 'running';
    this.checkpoint(run, 'files_changed', { note: 'review continuation' });
    this.touch(run); saveCodingRun(run);
    // Continuation: re-run codex in the SAME worktree with feedback appended.
    const policy = (run.metadata.request as CodingRunRequest).providerPolicy;
    const providerEnv = await this.providerEnvResolver(policy.primary, policy.primary).catch(() => ({}));
    const prompt = `${renderTaskPrompt(buildTaskPacket({
      objective: run.instructions,
      acceptanceCriteria: run.acceptanceCriteria,
      workspacePath: run.worktreePath || run.workspace,
    }))}\n\n# REVIEW FEEDBACK (apply these changes)\n${feedback}`;
    const result = await this.runWithAdapter(run, prompt, policy.primary, policy.primary, providerEnv);
    if (result.status === 'completed') {
      try {
        const diffInfo = collectWorktreeDiff(run.worktreePath!, run.baseCommit!);
        run.changedFiles = diffInfo.changedFiles;
        run.diffSummary = diffInfo.summary.slice(0, 2000);
        run.diffRef = diffInfo.diff.slice(0, 200_000);
      } catch { /* diff best effort */ }
    }
    run.status = 'awaiting_review';
    run.reviewState = 'awaiting_review';
    this.touch(run); saveCodingRun(run);
    return run;
  }

  /** Phase 24 — approve (Agentic OS decision; NO merge performed here). */
  async approveRun(runId: string): Promise<CodingRun | null> {
    const run = getCodingRun(runId);
    if (!run) return null;
    run.reviewState = 'approved';
    run.status = 'completed';
    run.endedAt = new Date().toISOString();
    this.touch(run); saveCodingRun(run);
    return run;
  }

  /** Phase 26 — discard: stop worker, preserve audit record, remove disposable worktree only. */
  async discardRun(runId: string, options: { removeWorktree?: boolean } = {}): Promise<CodingRun | null> {
    const run = getCodingRun(runId);
    if (!run) return null;
    const cancel = this.activeCancels.get(runId);
    if (cancel) cancel();
    run.reviewState = 'discarded';
    run.status = 'cancelled';
    run.cancellationReason = 'Discarded by reviewer';
    run.endedAt = new Date().toISOString();
    if (options.removeWorktree && run.worktreePath && run.baseCommit) {
      try {
        removeWorktree(run.workspace, run.worktreePath, run.branch);
        run.worktreePath = undefined;
      } catch (err: any) {
        this.addError(run, 'discard_cleanup', err.message);
      }
    }
    this.touch(run); saveCodingRun(run);
    return run;
  }
}

export const codingRuntimeService = new CodingRuntimeService(async (provider: string): Promise<Record<string, string>> => {
  // Provider-scoped env for the codex subprocess, resolved from the canonical
  // secret mechanism (keytar in-process). Never logged. For 'deepseek' we
  // inject DEEPSEEK_API_KEY so Codex's model_provider env_key resolves it.
  if (provider.toLowerCase() === 'deepseek') {
    try {
      const { secretStore } = await import('../../services/gateway/secretStore.js');
      const key = await secretStore.get('deepseek').catch(() => undefined)
        || await secretStore.get('DEEPSEEK_API_KEY').catch(() => undefined);
      if (key) return { DEEPSEEK_API_KEY: key };
    } catch { /* no key resolved */ }
  }
  return {};
});
