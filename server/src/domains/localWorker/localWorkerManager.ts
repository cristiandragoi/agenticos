/**
 * domains/localWorker/localWorkerManager.ts
 *
 * Authoritative lifecycle and execution manager for the AgenticOS Local Worker subsystem.
 */

import { randomUUID } from 'node:crypto';
import { logger } from '../../utils/logger.js';
import { localWorkerStore } from './localWorkerStore.js';
import { localWorkerPlanner } from './localWorkerPlanner.js';
import { toolRegistryBridge } from './toolRegistryBridge.js';
import type {
  LocalWorkerTask,
  WorkerStep,
  WorkerEvidence,
  WorkerResult,
  LocalWorkerConfig,
} from './types.js';

export class LocalWorkerManager {
  private activeAbortControllers = new Map<string, AbortController>();
  private activeExecutionPromises = new Map<string, Promise<void>>();

  /**
   * Start a new autonomous Local Worker task for a given goal.
   */
  public async startTask(
    goal: string,
    options: {
      origin?: string;
      conversationId?: string;
      config?: LocalWorkerConfig;
      autoApprove?: boolean;
    } = {}
  ): Promise<LocalWorkerTask> {
    const taskId = `worker-${Date.now()}-${randomUUID().slice(0, 6)}`;
    const now = new Date().toISOString();

    const config: LocalWorkerConfig = {
      maxStepRetries: options.config?.maxStepRetries ?? 2,
      maxReplans: options.config?.maxReplans ?? 1,
      maxRuntimeMs: options.config?.maxRuntimeMs ?? 180000,
      maxActions: options.config?.maxActions ?? 20,
      autoApprove: options.autoApprove ?? false,
    };

    const task: LocalWorkerTask = {
      id: taskId,
      goal: goal.trim(),
      origin: options.origin || 'jarvis',
      conversationId: options.conversationId,
      status: 'planning',
      plan: [],
      currentStep: 0,
      createdAt: now,
      evidence: [],
      config,
    };

    localWorkerStore.saveTask(task);
    logger.info('[LocalWorkerManager] Created task:', { taskId, goal: task.goal });

    // Plan steps
    try {
      const plan = await localWorkerPlanner.planGoal(task.goal);
      task.plan = plan;
      task.status = 'queued';
      task.startedAt = new Date().toISOString();
      localWorkerStore.saveTask(task);
    } catch (err: any) {
      task.status = 'failed';
      task.error = `Planning failed: ${err?.message || err}`;
      task.completedAt = new Date().toISOString();
      localWorkerStore.saveTask(task);
      return task;
    }

    // Launch execution loop asynchronously
    this.runTaskLoop(taskId);

    return localWorkerStore.getTask(taskId)!;
  }

  /**
   * Run the sequential step execution loop for a task.
   */
  private runTaskLoop(taskId: string): void {
    const abortController = new AbortController();
    this.activeAbortControllers.set(taskId, abortController);

    const execPromise = (async () => {
      try {
        let task = localWorkerStore.getTask(taskId);
        if (!task || task.status === 'cancelled' || task.status === 'completed' || task.status === 'failed') {
          return;
        }

        task.status = 'running';
        localWorkerStore.saveTask(task);

        while (task.currentStep < task.plan.length) {
          if (abortController.signal.aborted) {
            task.status = 'cancelled';
            task.completedAt = new Date().toISOString();
            localWorkerStore.saveTask(task);
            return;
          }

          const step = task.plan[task.currentStep];
          if (!step) break;

          // Check if step requires approval (SEC-04: autoApprove must NEVER skip high_impact)
          const calculatedRisk = toolRegistryBridge.getRiskLevel(step.tool || '', step.arguments);
          const risk = (step.riskLevel === 'high_impact' || calculatedRisk === 'high_impact') ? 'high_impact' : calculatedRisk;

          if (risk === 'high_impact') {
            const isTestBypass = process.env.AGENTICOS_AUTH_TEST_BYPASS === 'true';
            if (!isTestBypass) {
              // Fail closed: out-of-process issuer is unavailable
              logger.warn(`[LocalWorkerManager] Task ${taskId} step ${step.id} blocked: high-impact action requires verified approval from out-of-process issuer (SEC-04)`, {
                tool: step.tool,
                args: step.arguments,
              });
              step.status = 'failed';
              step.error = 'APPROVAL_ISSUER_UNAVAILABLE: High-impact action requires verified approval from out-of-process issuer';
              task.status = 'blocked';
              task.error = 'APPROVAL_ISSUER_UNAVAILABLE';
              task.pendingApproval = {
                stepId: step.id,
                description: step.description,
                tool: step.tool || '',
                arguments: step.arguments,
                riskReason: 'High-impact operation requires verified approval from out-of-process issuer (SEC-04)',
              };
              task.completedAt = new Date().toISOString();
              task.result = this.generateWorkerResult(task, false);
              localWorkerStore.saveTask(task);
              return;
            }

            // In test bypass mode, explicit approval is still required (autoApprove does NOT bypass)
            if (!step.approved) {
              task.status = 'awaiting_approval';
              task.pendingApproval = {
                stepId: step.id,
                description: step.description,
                tool: step.tool || '',
                arguments: step.arguments,
                riskReason: 'High-impact operation requires explicit operator authorization (SEC-04)',
              };
              localWorkerStore.saveTask(task);
              logger.info(`[LocalWorkerManager] Task ${taskId} awaiting approval in test bypass mode for step: ${step.description}`);
              return; // Pause loop until approved
            }
          }

          // Execute step with bounded retry
          step.status = 'running';
          step.startedAt = new Date().toISOString();
          localWorkerStore.saveTask(task);

          let stepSuccess = false;
          let lastResponse: any = null;
          const maxRetries = task.config?.maxStepRetries ?? 2;

          while (step.attempts <= maxRetries && !stepSuccess && !abortController.signal.aborted) {
            step.attempts++;
            const t0 = Date.now();
            try {
              lastResponse = await toolRegistryBridge.executeTool(step.tool || 'shell.execute', step.arguments || {});
              stepSuccess = lastResponse.success && lastResponse.verification.verified;

              const evidenceItem: WorkerEvidence = {
                id: `ev-${Date.now()}-${randomUUID().slice(0, 4)}`,
                stepId: step.id,
                tool: step.tool || 'unknown',
                arguments: step.arguments,
                startedAt: new Date(t0).toISOString(),
                completedAt: new Date().toISOString(),
                exitState: stepSuccess ? 'success' : 'failure',
                verification: lastResponse.verification,
                evidenceSource: lastResponse.evidenceSource,
                outputSnippet: typeof lastResponse.output === 'string' ? lastResponse.output.slice(0, 500) : JSON.stringify(lastResponse.output || '').slice(0, 500),
                rawOutput: lastResponse.rawOutput,
                error: lastResponse.error,
              };

              task.evidence.push(evidenceItem);
              step.verification = lastResponse.verification;
              step.output = lastResponse.output;

              if (!stepSuccess && step.attempts <= maxRetries) {
                logger.warn(`[LocalWorkerManager] Step ${step.id} attempt ${step.attempts} failed, retrying...`, lastResponse.error);
                await new Promise((r) => setTimeout(r, 800));
              }
            } catch (err: any) {
              lastResponse = { success: false, error: err?.message || String(err) };
              if (step.attempts <= maxRetries) {
                await new Promise((r) => setTimeout(r, 800));
              }
            }
          }

          step.completedAt = new Date().toISOString();

          if (stepSuccess) {
            step.status = 'verified';
            task.currentStep++;
            localWorkerStore.saveTask(task);
          } else {
            step.status = 'failed';
            step.error = lastResponse?.error || 'Verification failed';
            task.status = 'failed';
            task.error = `Step "${step.description}" failed: ${step.error}`;
            task.completedAt = new Date().toISOString();
            task.result = this.generateWorkerResult(task, false);
            localWorkerStore.saveTask(task);
            return;
          }
        }

        // All steps verified and completed
        task.status = 'completed';
        task.completedAt = new Date().toISOString();
        task.result = this.generateWorkerResult(task, true);
        localWorkerStore.saveTask(task);
        logger.info(`[LocalWorkerManager] Task ${taskId} successfully completed!`, { summary: task.result.summary });
      } catch (err: any) {
        logger.error(`[LocalWorkerManager] Unhandled error in task loop ${taskId}:`, err);
        const task = localWorkerStore.getTask(taskId);
        if (task) {
          task.status = 'failed';
          task.error = err?.message || String(err);
          task.completedAt = new Date().toISOString();
          task.result = this.generateWorkerResult(task, false);
          localWorkerStore.saveTask(task);
        }
      } finally {
        this.activeAbortControllers.delete(taskId);
        this.activeExecutionPromises.delete(taskId);
      }
    })();

    this.activeExecutionPromises.set(taskId, execPromise);
  }

  /**
   * Cancel an active worker task.
   */
  public cancelTask(taskId: string): boolean {
    const task = localWorkerStore.getTask(taskId);
    if (!task) return false;

    const aborter = this.activeAbortControllers.get(taskId);
    if (aborter) {
      aborter.abort();
    }

    task.status = 'cancelled';
    task.completedAt = new Date().toISOString();
    task.error = 'Task cancelled by operator';
    if (task.plan[task.currentStep] && task.plan[task.currentStep].status === 'running') {
      task.plan[task.currentStep].status = 'skipped';
    }
    task.result = {
      success: false,
      summary: 'Task was cancelled by operator before completion.',
      evidenceSummary: `Executed ${task.evidence.length} step(s) before cancellation.`,
      finalEvidence: task.evidence,
    };

    localWorkerStore.saveTask(task);
    logger.info(`[LocalWorkerManager] Task ${taskId} cancelled.`);
    return true;
  }

  /**
   * Approve a pending high-impact action and resume execution.
   * Under SEC-03/SEC-04, plain approval fails closed with false unless in test bypass mode.
   */
  public approveTask(taskId: string): boolean {
    const isTestBypass = process.env.AGENTICOS_AUTH_TEST_BYPASS === 'true';
    if (!isTestBypass) {
      logger.warn(`[LocalWorkerManager] Rejecting plain approval request for task ${taskId}: APPROVAL_ISSUER_UNAVAILABLE`);
      return false;
    }
    const task = localWorkerStore.getTask(taskId);
    if (!task || (task.status !== 'awaiting_approval' && task.status !== 'blocked')) return false;

    const step = task.plan[task.currentStep];
    if (step) {
      step.approved = true;
    }
    task.pendingApproval = undefined;
    task.status = 'running';
    localWorkerStore.saveTask(task);

    logger.info(`[LocalWorkerManager] Task ${taskId} approved in test bypass mode. Resuming execution loop...`);
    this.runTaskLoop(taskId);
    return true;
  }

  /**
   * Resume a paused or blocked task.
   */
  public resumeTask(taskId: string, approved = false): boolean {
    if (approved) {
      return this.approveTask(taskId);
    }
    const task = localWorkerStore.getTask(taskId);
    if (!task) return false;
    if (task.status === 'completed' || task.status === 'cancelled') return false;

    task.status = 'running';
    localWorkerStore.saveTask(task);
    this.runTaskLoop(taskId);
    return true;
  }

  public getTask(taskId: string): LocalWorkerTask | undefined {
    return localWorkerStore.getTask(taskId);
  }

  public listTasks(): LocalWorkerTask[] {
    return localWorkerStore.listTasks();
  }

  public getTaskResult(taskId: string): WorkerResult | undefined {
    return localWorkerStore.getTask(taskId)?.result;
  }

  /**
   * Generate truthful structured result synthesizing all step outputs and evidence.
   */
  private generateWorkerResult(task: LocalWorkerTask, success: boolean): WorkerResult {
    const evidenceSummary = task.evidence
      .map((ev) => `[${ev.tool}] ${ev.verification.realityCheck}`)
      .join('\n');

    if (!success) {
      return {
        success: false,
        summary: task.error || 'Worker task failed during execution.',
        error: task.error,
        evidenceSummary,
        finalEvidence: task.evidence,
      };
    }

    // Synthesize domain-specific summary from step outputs
    const stepOutputs = task.plan.map((s) => s.output).filter(Boolean);
    let summary = `Worker completed goal: ${task.goal}`;

    // 1. Git inspection summary
    const branchStep = task.plan.find((s) => s.tool === 'git.branch');
    const statusStep = task.plan.find((s) => s.tool === 'git.status');
    const logStep = task.plan.find((s) => s.tool === 'git.log');
    if (branchStep && statusStep) {
      const branch = String(branchStep.output || 'main');
      const isClean = (statusStep.output as any)?.isClean ?? false;
      const latestCommit = (logStep?.output as any)?.latestCommit || 'latest commit verified';
      summary = `Repository inspection complete. Current branch: ${branch}, latest commit: ${latestCommit}, working tree: ${isClean ? 'clean' : 'modified'}.`;
    }

    // 2. package.json discovery summary
    const pkgReadStep = task.plan.find((s) => s.tool === 'filesystem.read' && String(s.arguments?.path).includes('package.json'));
    if (pkgReadStep && typeof pkgReadStep.output === 'string') {
      try {
        const parsed = JSON.parse(pkgReadStep.output);
        summary = `Found package.json. Project name: ${parsed.name || 'agenticos'}, version: ${parsed.version || 'unknown'}.`;
      } catch {}
    }

    // 3. Build investigation summary
    const buildStep = task.plan.find((s) => s.tool === 'developer.build');
    if (buildStep && buildStep.output) {
      const bOut = buildStep.output as any;
      if (bOut.success) {
        summary = 'AgenticOS server build succeeded with exit code 0.';
      } else {
        summary = `AgenticOS server build failed. First compiler error: ${bOut.firstCompilerError || 'compiler error'}.`;
      }
    }

    // 4. Log ERROR search summary
    const logReadStep = task.plan.find((s) => s.tool === 'filesystem.read' && (String(s.arguments?.path).includes('.log') || s.description.includes('log')));
    if (logReadStep && typeof logReadStep.output === 'string') {
      const lines = logReadStep.output.split('\n');
      const errLine = lines.slice().reverse().find((l) => /error/i.test(l));
      if (errLine) {
        summary = `Identified latest ERROR entry in AgenticOS logs: ${errLine.trim()}`;
      } else {
        summary = 'Inspected recent AgenticOS logs; no active ERROR entries found.';
      }
    }

    return {
      success: true,
      summary,
      output: stepOutputs,
      evidenceSummary,
      finalEvidence: task.evidence,
    };
  }
}

export const localWorkerManager = new LocalWorkerManager();
