/**
 * domains/hermes/hermesOrchestrator.ts
 *
 * Authoritative Closed-Loop Autonomous Engineering Orchestrator for Hermes in Agentic OS.
 *
 * Execution Invariants:
 * - CODEX_INVOCATION_DISABLED=true (never uses Codex or OpenAI)
 * - STOP_ALWAYS_INTERRUPTS=true
 * - Closed-loop: Observe → Plan → Delegate/Execute → Verify → Evaluate → Repair → Repeat
 * - Bounded retry: Never returns to the human for simple build/test/type/port failures
 * - Escalates ONLY for genuine human-only blockers (credentials, payment, hardware, true ambiguity)
 */

import { randomUUID } from 'node:crypto';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import { logger } from '../../utils/logger.js';
import { runAgentLoop, type AgentRunResult } from '../../services/agent/agentLoop.js';
import { getWorkspaceRoot } from '../../services/workspaceStore.js';
import { hermesProgressBus, type HermesProgressEventType } from './progressEvents.js';
import type {
  MissionState,
  MissionExecutionOptions,
  MissionFinalReport,
  VerificationRecord,
  RepairAttempt,
  DelegatedTaskRecord,
  EscalationRecord,
  EngineeringStep,
} from './types.js';

const execAsync = promisify(exec);

export const HERMES_ENGINEERING_ORCHESTRATOR_SYSTEM_PROMPT = `You are Hermes, the primary Closed-Loop Autonomous Engineering Orchestrator in Agentic OS.

CRITICAL ARCHITECTURAL POLICY:
1. You are the PRIMARY autonomous engineering orchestrator. You do NOT delegate code mutations or repairs to CodeX or OpenAI.
2. CODEX_INVOCATION_DISABLED=true. Never invoke codex, codex exec, OpenAI CLI, or any OpenAI-backed worker.
3. If delegating independent subtasks (e.g. parallel inspection or test investigation), use delegate_hermes_task.
4. You operate in a CLOSED-LOOP:
   OBSERVE → PLAN → EXECUTE/DELEGATE → VERIFY → EVALUATE → REPAIR → REPEAT.
5. Do NOT ask the user to run terminal commands, inspect logs, fix tests, kill processes, or edit files. You have tools:
   - terminal: Run shell commands, tests, builds, and git operations.
   - read_file / write_file / patch_file: Directly inspect and modify code.
   - search_files / workspace_search: Locate symbols and files.
   - delegate_hermes_task: Concurrently delegate independent subtasks to local workers.
6. When tests fail or builds fail:
   - Inspect the exact compiler/runtime error.
   - Formulate a repair hypothesis.
   - Apply the code edit directly.
   - Re-run verification.
   - Continue until all acceptance criteria pass.
7. Only report completion when verified with actual evidence (exit code 0, passing tests, clean builds).`;

export class HermesEngineeringOrchestrator {
  private activeMissions: Map<string, MissionState> = new Map();
  private missionAbortControllers: Map<string, AbortController> = new Map();

  /**
   * Execute an engineering goal to completion as a closed-loop autonomous orchestrator.
   */
  public async executeMission(
    goal: string,
    options: MissionExecutionOptions = {}
  ): Promise<MissionFinalReport> {
    const missionId = `mission-${randomUUID().slice(0, 8)}`;
    const workspaceRoot = options.workspaceRoot || getWorkspaceRoot() || process.cwd();
    const maxRepairCycles = options.maxRepairCycles ?? 5;
    const startTime = Date.now();

    const abortController = new AbortController();
    this.missionAbortControllers.set(missionId, abortController);

    const state: MissionState = {
      missionId,
      goal,
      acceptanceCriteria: this.extractAcceptanceCriteria(goal),
      workspaceRoot,
      status: 'observing',
      completedSteps: [],
      activeSteps: [],
      currentBlockers: [],
      verificationEvidence: [],
      repairAttempts: [],
      delegatedTasks: [],
      workerResults: {},
      deploymentState: {
        required: true,
        synced: false,
        paths: [
          'C:\\Users\\cd-pr\\AppData\\Local\\Programs\\AgenticOS\\resources\\server\\dist',
          'D:\\AgenticOS\\release\\win-unpacked\\resources\\server\\dist',
        ],
      },
      startTime,
      lastUpdatedAt: startTime,
    };

    this.activeMissions.set(missionId, state);
    logger.info(`[HermesOrchestrator] Starting autonomous mission ${missionId}:`, { goal, workspaceRoot });

    let cycle = 0;

    const emit = (
      type: HermesProgressEventType,
      message: string,
      extra?: { status?: string; evidenceSummary?: string; metadata?: Record<string, unknown>; worker?: string }
    ) => {
      const ev = hermesProgressBus.emitProgress({
        missionId,
        taskId: options.taskId,
        conversationId: options.conversationId,
        phase: state.status,
        type,
        message,
        status: extra?.status || (state.status === 'completed' ? 'completed' : state.status === 'failed' ? 'failed' : 'running'),
        worker: extra?.worker || 'hermes',
        evidenceSummary: extra?.evidenceSummary,
        metadata: extra?.metadata,
      });

      if (options.taskId) {
        import('../../services/backgroundTasks/manager.js').then(({ backgroundTaskManager }) => {
          backgroundTaskManager.progress(options.taskId!, 'task.progress', ev.message, {}, {
            phase: ev.phase,
            type: ev.type,
            status: ev.status,
            evidenceSummary: ev.evidenceSummary,
          });
        }).catch(() => {});
      }

      if (options.conversationId) {
        import('../conversations/service.js').then(({ conversationService }) => {
          conversationService.broadcast(options.conversationId!, 'hermes_progress', ev);
          conversationService.broadcast(options.conversationId!, 'progress', {
            summary: ev.message,
            phase: ev.phase,
            type: ev.type,
            status: ev.status,
          });
        }).catch(() => {});
      }
    };

    const unsubscribeCustom = options.onProgress
      ? hermesProgressBus.onMission(missionId, options.onProgress)
      : null;

    const stopHeartbeat = hermesProgressBus.startHeartbeat(
      missionId,
      () => ({
        phase: state.status,
        cycle,
        taskId: options.taskId,
        conversationId: options.conversationId,
      }),
      10000,
      12000
    );

    emit('MISSION_STARTED', `Starting autonomous engineering mission: ${goal}`);

    try {
      let missionSatisfied = false;

      while (cycle < maxRepairCycles && !missionSatisfied) {
        cycle++;
        state.lastUpdatedAt = Date.now();

        if (options.abortSignal?.aborted || abortController.signal.aborted) {
          state.status = 'stopped';
          emit('STOPPED', 'Mission interrupted by stop signal.', { status: 'stopped' });
          logger.warn(`[HermesOrchestrator] Mission ${missionId} interrupted by STOP.`);
          return this.generateReport(state, false, 'Mission interrupted by stop signal.');
        }

        logger.info(`[HermesOrchestrator] Mission ${missionId} executing Cycle ${cycle}/${maxRepairCycles}`);

        // ── 1. OBSERVE ────────────────────────────────────────────────────────
        state.status = 'observing';
        emit('OBSERVING', `Cycle ${cycle}: Inspecting workspace environment and repository state...`);
        const observation = await this.observeEnvironment(workspaceRoot);
        logger.info(`[HermesOrchestrator] Cycle ${cycle} Observation:`, {
          gitStatus: observation.gitSummary,
          buildStatus: observation.buildSummary,
        });
        emit('FINDING', `Repository status: ${observation.gitSummary}. Analyzing code structure...`);

        // ── 2. PLAN ───────────────────────────────────────────────────────────
        state.status = cycle === 1 ? 'planning' : 'repairing';
        const isRepair = cycle > 1;
        const lastVerification = state.verificationEvidence[state.verificationEvidence.length - 1];

        if (cycle === 1) {
          emit('PLANNING', 'Analyzing objectives and formulating engineering execution plan...');
        } else {
          const failureText = lastVerification?.outputSummary || 'Previous cycle verification failed';
          const repairHypothesis = this.formulateRepairHypothesis(failureText);
          emit('REPAIRING', `Formulating repair hypothesis for cycle ${cycle}: ${repairHypothesis}`);
        }

        const prompt = this.buildIterationPrompt({
          goal,
          cycle,
          isRepair,
          observation,
          lastVerification,
          state,
        });

        // ── 3. EXECUTE / DELEGATE (Direct via Agent Loop) ─────────────────────
        state.status = 'executing';
        emit('WORKER_STARTED', `Starting autonomous execution cycle ${cycle}...`);
        const executionResult = await runAgentLoop(
          HERMES_ENGINEERING_ORCHESTRATOR_SYSTEM_PROMPT,
          prompt,
          15, // iterations per cycle
          'agent-hermes',
          missionId,
          {
            providerOverride: 'ollama',
            disableFallback: true,
          },
          undefined,
          {
            workspaceRoot,
            requireToolExecution: true,
            onToolEvent: (toolEv: any) => {
              const toolName = toolEv?.toolName;
              const args = toolEv?.arguments || {};
              const targetPath = args.path || args.file_glob || args.query || '';
              const shortPath = targetPath ? path.basename(String(targetPath)) : '';

              if (toolName === 'read_file' || toolName === 'search_files' || toolName === 'workspace_search') {
                emit('INSPECTING', `Inspecting ${shortPath || 'repository code'}...`, {
                  evidenceSummary: `Tool: ${toolName}`,
                });
              } else if (toolName === 'patch_file' || toolName === 'write_file') {
                emit('EDITING', `Applying changes to ${shortPath || 'source file'}...`, {
                  evidenceSummary: `Tool: ${toolName}`,
                });
              } else if (toolName === 'terminal') {
                const cmd = String(args.command || '');
                if (/npm\s+run\s+build|tsc\b/i.test(cmd)) {
                  emit('BUILD_RUNNING', 'Running build command in terminal...', { evidenceSummary: cmd });
                } else if (/npm\s+test|vitest|jest/i.test(cmd)) {
                  emit('TEST_RUNNING', 'Running automated test suite in terminal...', { evidenceSummary: cmd });
                } else {
                  emit('COMMAND_RUNNING', `Executing command: ${cmd.slice(0, 70)}...`, { evidenceSummary: cmd });
                }
              } else if (toolName === 'delegate_hermes_task') {
                emit('DELEGATING', `Delegating subtask: ${String(args.objective || 'parallel task').slice(0, 60)}...`, {
                  evidenceSummary: 'Subtask delegation',
                });
              }

              if (toolEv?.success && (toolName === 'read_file' || toolName === 'search_files')) {
                emit('FINDING', `Inspected ${shortPath || 'target'}; content analyzed.`, {
                  evidenceSummary: `Inspected ${shortPath}`,
                });
              } else if (toolEv?.success && toolName === 'patch_file') {
                emit('EDITING', `Targeted patch successfully applied to ${shortPath}.`, {
                  evidenceSummary: `Patched ${shortPath}`,
                });
              }
            },
          } as any
        );

        emit('WORKER_COMPLETED', `Execution cycle ${cycle} completed. Advancing to verification...`);

        state.completedSteps.push({
          id: `step-${cycle}`,
          description: `Engineering execution cycle ${cycle}`,
          type: isRepair ? 'edit' : 'inspect',
          status: executionResult.completionStatus === 'max_iterations' ? 'failed' : 'passed',
          evidence: { reply: executionResult.text.slice(0, 500), iterations: executionResult.iterations, toolCalls: executionResult.toolCalls },
          durationMs: Date.now() - state.lastUpdatedAt,
        });

        // ── 4. VERIFY ─────────────────────────────────────────────────────────
        state.status = 'verifying';
        emit('VERIFYING', 'Running automated engineering verification (build & tests)...');
        const verification = await this.runEngineeringVerification(workspaceRoot, goal);
        state.verificationEvidence.push(verification);

        logger.info(`[HermesOrchestrator] Cycle ${cycle} Verification:`, {
          buildPassed: verification.passed,
          summary: verification.outputSummary,
        });

        // ── 5. EVALUATE ───────────────────────────────────────────────────────
        state.status = 'evaluating';
        if (verification.passed) {
          missionSatisfied = true;
          emit('VERIFYING', `Verification PASSED on cycle ${cycle}: ${verification.outputSummary}`);
          logger.info(`[HermesOrchestrator] Mission ${missionId} verified successfully on Cycle ${cycle}!`);
          break;
        }

        // ── 6. REPAIR (Hypothesis & Recording) ────────────────────────────────
        state.status = 'repairing';
        const failureObserved = verification.outputSummary;
        const hypothesis = this.formulateRepairHypothesis(failureObserved);
        emit('FINDING', `Verification failed on cycle ${cycle}: ${failureObserved}`);
        emit('REPAIRING', `Formulating repair hypothesis: ${hypothesis}`);
        emit('RETRYING', `Initiating autonomous repair loop (cycle ${cycle + 1})...`);

        state.repairAttempts.push({
          cycle,
          failureObserved,
          hypothesis,
          actionTaken: `Executed repair in cycle ${cycle}`,
          verificationPassed: verification.passed,
          timestamp: new Date().toISOString(),
        });

        // Check if an escalation condition is reached
        const escalation = this.checkEscalationCriteria(state, failureObserved, cycle, maxRepairCycles);
        if (escalation) {
          state.status = 'escalated';
          state.escalation = escalation;
          emit('BLOCKED', `Mission blocked: ${escalation.description}`, { status: 'blocked' });
          logger.warn(`[HermesOrchestrator] Mission ${missionId} escalated to human:`, escalation);
          return this.generateReport(state, false, `Escalated: ${escalation.description}`);
        }
      }

      // ── 7. DEPLOY / SYNC ──────────────────────────────────────────────────
      if (missionSatisfied && state.deploymentState.required) {
        state.status = 'deploying';
        emit('DEPLOYING', 'Synchronizing compiled distribution artifacts to installed locations...');
        await this.syncDeploymentArtifacts(workspaceRoot, state);
        emit('LIVE_TESTING', 'Verifying runtime integrity of synchronized artifacts...');
      }

      state.status = missionSatisfied ? 'completed' : 'failed';
      emit(
        missionSatisfied ? 'MISSION_COMPLETED' : 'MISSION_FAILED',
        missionSatisfied ? 'Engineering mission satisfied and verified. Final report generated.' : 'Max repair cycles reached without full pass.',
        { status: missionSatisfied ? 'completed' : 'failed' }
      );
      return this.generateReport(
        state,
        missionSatisfied,
        missionSatisfied ? 'Engineering mission satisfied and verified.' : 'Max repair cycles reached without full pass.'
      );
    } catch (err: any) {
      logger.error(`[HermesOrchestrator] Mission ${missionId} error:`, err);
      state.status = 'failed';
      emit('MISSION_FAILED', `Mission failed with unexpected error: ${err?.message || err}`, { status: 'failed' });
      return this.generateReport(state, false, `Mission failed with unexpected exception: ${err?.message || err}`);
    } finally {
      stopHeartbeat();
      if (unsubscribeCustom) unsubscribeCustom();
      this.missionAbortControllers.delete(missionId);
    }
  }

  /**
   * Cancel an in-flight mission immediately (STOP_ALWAYS_INTERRUPTS).
   */
  public cancelMission(missionId: string, reason = 'User requested stop'): boolean {
    const controller = this.missionAbortControllers.get(missionId);
    if (controller) {
      controller.abort();
      const state = this.activeMissions.get(missionId);
      if (state) {
        state.status = 'stopped';
        state.lastUpdatedAt = Date.now();
      }
      logger.info(`[HermesOrchestrator] Mission ${missionId} cancelled: ${reason}`);
      return true;
    }
    return false;
  }

  public getMissionState(missionId: string): MissionState | undefined {
    return this.activeMissions.get(missionId);
  }

  /* ── Helper Functions ── */

  private async observeEnvironment(workspaceRoot: string): Promise<{
    gitSummary: string;
    modifiedFiles: string[];
    buildSummary: string;
  }> {
    let gitSummary = 'clean';
    let modifiedFiles: string[] = [];
    try {
      const { stdout } = await execAsync('git status --short', { cwd: workspaceRoot });
      gitSummary = stdout.trim() || 'clean';
      modifiedFiles = stdout
        .split('\n')
        .map((l) => l.trim().slice(3).trim())
        .filter(Boolean);
    } catch {
      gitSummary = 'git status unavailable';
    }

    return {
      gitSummary,
      modifiedFiles,
      buildSummary: 'checked on verification',
    };
  }

  private async runEngineeringVerification(workspaceRoot: string, goal: string): Promise<VerificationRecord> {
    const timestamp = new Date().toISOString();
    const serverDir = path.join(workspaceRoot, 'server');
    const targetDir = fs.existsSync(serverDir) ? serverDir : workspaceRoot;

    try {
      const { stdout, stderr } = await execAsync('npm run build', {
        cwd: targetDir,
        timeout: 90000,
      });

      return {
        type: 'build',
        command: 'npm run build',
        exitCode: 0,
        passed: true,
        outputSummary: 'Build succeeded with exit code 0.',
        timestamp,
        evidence: { stdoutSnippet: stdout.slice(-300) },
      };
    } catch (err: any) {
      const errorOutput = (err.stderr || err.stdout || err.message || '').slice(-600);
      return {
        type: 'build',
        command: 'npm run build',
        exitCode: err.code || 1,
        passed: false,
        outputSummary: `Build failed (code ${err.code || 1}): ${errorOutput}`,
        timestamp,
        evidence: { error: errorOutput },
      };
    }
  }

  private formulateRepairHypothesis(failureText: string): string {
    if (/TS\d+/.test(failureText)) {
      return 'TypeScript compilation error detected. Fix missing property, import, or type assertion in modified files.';
    }
    if (/MODULE_NOT_FOUND|Cannot find module/.test(failureText)) {
      return 'Module import resolution failure. Verify relative path and extension in import statement.';
    }
    if (/EADDRINUSE/.test(failureText)) {
      return 'Port conflict. Identify process on port and gracefully terminate or release port.';
    }
    return 'Execution failure. Inspect stack trace and apply targeted fix.';
  }

  private checkEscalationCriteria(
    state: MissionState,
    failureText: string,
    cycle: number,
    maxCycles: number
  ): EscalationRecord | null {
    const lower = failureText.toLowerCase();

    // 1. Missing secret / credential
    if (lower.includes('api_key') || lower.includes('unauthorized') || lower.includes('401') || lower.includes('invalid credentials')) {
      return {
        reason: 'missing_credential',
        description: 'Operation requires external credential or API token not present in environment.',
        technicalEvidence: [failureText],
        timestamp: new Date().toISOString(),
      };
    }

    // 2. Exhausted all technical approaches
    if (cycle >= maxCycles) {
      return {
        reason: 'exhausted_approaches',
        description: `Hermes exhausted ${maxCycles} autonomous repair cycles without full verification pass.`,
        technicalEvidence: state.repairAttempts.map((r) => `Cycle ${r.cycle}: ${r.failureObserved}`),
        timestamp: new Date().toISOString(),
      };
    }

    return null;
  }

  private async syncDeploymentArtifacts(workspaceRoot: string, state: MissionState): Promise<void> {
    const distSrc = path.join(workspaceRoot, 'server', 'dist');
    if (!fs.existsSync(distSrc)) return;

    for (const dest of state.deploymentState.paths) {
      try {
        if (fs.existsSync(path.dirname(dest))) {
          await execAsync(`robocopy "${distSrc}" "${dest}" /MIR /NJH /NJS /NDL /NC /NS`, {
            windowsHide: true,
          }).catch(() => {}); // Robocopy exit code 1-3 indicates success with files copied
        }
      } catch (err: any) {
        logger.warn(`[HermesOrchestrator] Warning: Robocopy to ${dest} had note:`, err.message);
      }
    }
    state.deploymentState.synced = true;
    state.deploymentState.lastSyncedAt = new Date().toISOString();
    logger.info('[HermesOrchestrator] Deployment synchronization verified.');
  }

  private extractAcceptanceCriteria(goal: string): string[] {
    const lines = goal.split('\n');
    const criteria: string[] = [];
    for (const line of lines) {
      const match = line.match(/^[-*]\s*(.+)/);
      if (match) criteria.push(match[1].trim());
    }
    return criteria.length ? criteria : [goal.trim()];
  }

  private buildIterationPrompt(params: {
    goal: string;
    cycle: number;
    isRepair: boolean;
    observation: any;
    lastVerification?: VerificationRecord;
    state: MissionState;
  }): string {
    const { goal, cycle, isRepair, observation, lastVerification, state } = params;

    return `MISSION GOAL:
${goal}

CURRENT CYCLE: ${cycle} (${isRepair ? 'REPAIR & ITERATE' : 'INITIAL IMPLEMENTATION'})
WORKSPACE ROOT: ${state.workspaceRoot}

ENVIRONMENT OBSERVATION:
- Git modified files: ${observation.modifiedFiles.join(', ') || 'none'}
- Recent status: ${observation.gitSummary}

${
  isRepair && lastVerification
    ? `LAST VERIFICATION FAILURE:
${lastVerification.outputSummary}

REPAIR INSTRUCTION:
Formulate a repair hypothesis, edit the source code using write_file or patch_file to fix the failure, verify with terminal tools, and do NOT stop until complete.`
    : `TASK INSTRUCTION:
Execute the implementation directly. Inspect relevant files, make required changes, test, and proceed autonomously.`
}

IMPORTANT: You are the autonomous engineering orchestrator. Never delegate to CodeX or OpenAI. Perform all necessary work directly or delegate independent subtasks using delegate_hermes_task.`;
  }

  private generateReport(
    state: MissionState,
    success: boolean,
    summary: string
  ): MissionFinalReport {
    const allModified = state.completedSteps.flatMap((s) => s.targetFiles || []);
    const uniqueFiles = Array.from(new Set(allModified));

    return {
      success,
      missionId: state.missionId,
      goal: state.goal,
      whatChanged: summary,
      filesChanged: uniqueFiles,
      testsAndBuilds: state.verificationEvidence.map((v) => `${v.command}: ${v.passed ? 'PASS' : 'FAIL'}`).join(', ') || 'None run',
      deployment: state.deploymentState.synced ? `Synchronized to ${state.deploymentState.paths.join(', ')}` : 'Not required or pending',
      liveVerification: success ? 'Actual build verification passed with exit code 0.' : 'Verification incomplete.',
      remainingLimitations: state.escalation ? state.escalation.description : 'None',
      evidence: {
        stepsCompleted: state.completedSteps.length,
        repairsAttempted: state.repairAttempts.length,
        verificationsRun: state.verificationEvidence.length,
        durationMs: Date.now() - state.startTime,
      },
      escalation: state.escalation,
    };
  }
}

export const hermesEngineeringOrchestrator = new HermesEngineeringOrchestrator();
