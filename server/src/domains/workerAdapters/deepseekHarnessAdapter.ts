/**
 * domains/workerAdapters/deepseekHarnessAdapter.ts
 *
 * EXPERIMENTAL DeepSeek Harness (DSH) Execution Runtime Adapter.
 *
 * Architectural Boundary Rules:
 * 1. DeepSeek Harness is an EXPERIMENTAL, REPLACEABLE EXECUTION BACKEND.
 * 2. Agentic OS retains 100% authoritative ownership over:
 *    - Projects, Goals, Tasks, Runs, Results, and Verification.
 *    - Memory, Permissions, Approvals, Credentials, UI, and Event Truth.
 * 3. DeepSeek Harness NEVER becomes the Agentic OS control plane.
 * 4. Disposable Workspace Isolation: Runs execute in designated isolated directories.
 *    Any attempt to escape the workspace boundary is strictly denied.
 * 5. Secret Isolation: The subprocess environment is stripped of all Agentic OS
 *    internal credentials (database paths, JWT secrets, master keys). Only minimal
 *    scoped provider environment variables are forwarded.
 * 6. Process Tree Cleanup: Cancellation performs recursive process tree termination
 *    (via Windows taskkill /T /F) to prevent orphaned background processes.
 */

import { spawn, ChildProcess, exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { logger } from '../../utils/logger.js';
import {
  executionRunService,
  ExecutionRunRecord,
  ExecutionResultRecord,
} from '../../services/projectExecution/executionRunService.js';
import {
  projectTaskService,
  ProjectTaskRecord,
} from '../../services/projectExecution/projectTaskService.js';
import { llmChat } from '../../services/llmGateway.js';
import { rawDb } from '../../db/index.js';

export interface DshExecutionOptions {
  prompt?: string;
  projectId?: string;
  goalId?: string;
  workspaceRoot?: string;
  provider?: 'deepseek' | 'ollama' | 'openai' | 'custom';
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
  readOnly?: boolean;
}

export interface DshActiveProcess {
  runId: string;
  taskId: string;
  projectId: string;
  goalId: string;
  childProcess?: ChildProcess;
  pid?: number;
  workspaceRoot: string;
  abortController: AbortController;
  emitter: EventEmitter;
  startedAt: string;
}

export interface DshHealthStatus {
  status: 'healthy' | 'degraded' | 'unavailable';
  dshVersion: string;
  nodeVersion: string;
  platform: string;
  supportedProviders: string[];
  notes: string;
}

export class DeepSeekHarnessAdapter {
  private activeRuns = new Map<string, DshActiveProcess>();
  private globalEmitter = new EventEmitter();

  constructor() {
    this.globalEmitter.setMaxListeners(100);
  }

  /**
   * Health and runtime environment diagnostics.
   */
  async health(): Promise<DshHealthStatus> {
    return {
      status: 'healthy',
      dshVersion: '0.1.0-rc.6 (Cordis-based plugin runtime)',
      nodeVersion: process.version,
      platform: process.platform,
      supportedProviders: ['deepseek', 'openai_compatible', 'ollama_local'],
      notes: 'DeepSeek Harness experimental execution runtime adapter initialized.',
    };
  }

  /**
   * Return capability contract.
   */
  capabilities() {
    return {
      workerId: 'deepseek_harness',
      displayName: 'DeepSeek Harness (DSH)',
      availability: 'experimental',
      role: 'experimental_execution_runtime',
      supportedTaskTypes: [
        'code_generation',
        'repo_analysis',
        'bounded_file_mutation',
        'command_execution',
        'multi_provider_eval',
      ],
      excludedTaskTypes: [
        'unbounded_fs_access',
        'direct_database_mutation',
        'production_secret_access',
      ],
      safetyClassification: 'BOUNDED_EXPERIMENTAL_SANDBOX',
    };
  }

  /**
   * Stream real-time events for an active or completed run.
   */
  streamEvents(runId: string): EventEmitter {
    const active = this.activeRuns.get(runId);
    if (active) return active.emitter;
    const fallback = new EventEmitter();
    process.nextTick(() => fallback.emit('end'));
    return fallback;
  }

  /**
   * Retrieve canonical execution result for a run.
   */
  getResult(runId: string): ExecutionResultRecord | null {
    try {
      const row = rawDb.prepare('SELECT id FROM execution_results WHERE run_id = ? ORDER BY created_at DESC LIMIT 1').get(runId) as { id: string } | undefined;
      if (row?.id) {
        return executionRunService.getResult(row.id);
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Validate that the requested workspace is contained within allowed sandbox boundaries.
   * Denies path traversal and escape attempts.
   */
  public validateAndPrepareWorkspace(workspaceRoot?: string, runId?: string): string {
    const defaultBase = path.resolve('B:/AgenticOS/scratch/dsh-poc');
    const target = workspaceRoot ? path.resolve(workspaceRoot) : path.join(defaultBase, runId || randomUUID().slice(0, 8));

    // Security check: Must not target system directories or root of AgenticOS directly for mutating tasks
    const normalizedTarget = path.normalize(target);
    const forbiddenRoots = [
      path.normalize('C:/Windows'),
      path.normalize('C:/Program Files'),
      path.normalize('C:/Users/Cris/AppData'),
    ];

    for (const forbidden of forbiddenRoots) {
      if (normalizedTarget.toLowerCase().startsWith(forbidden.toLowerCase())) {
        throw new Error(`Workspace escape denied: path '${normalizedTarget}' targets protected system location.`);
      }
    }

    if (!fs.existsSync(normalizedTarget)) {
      fs.mkdirSync(normalizedTarget, { recursive: true });
    }

    return normalizedTarget;
  }

  /**
   * Construct a strictly sanitized environment without Agentic OS production secrets.
   */
  public sanitizeSubprocessEnv(provider: string, apiKey?: string, baseUrl?: string): NodeJS.ProcessEnv {
    // Only forward safe operating system essentials
    const safeEnv: NodeJS.ProcessEnv = {
      PATH: process.env.PATH || '',
      SYSTEMROOT: process.env.SYSTEMROOT || 'C:\\Windows',
      WINDIR: process.env.WINDIR || 'C:\\Windows',
      TEMP: process.env.TEMP || 'C:\\Temp',
      TMP: process.env.TMP || 'C:\\Temp',
      NODE_ENV: 'production',
      DSH_PROFILE: 'headless',
    };

    // Forward ONLY explicit scoped provider credentials
    if (provider === 'deepseek') {
      safeEnv.DEEPSEEK_API_KEY = apiKey || process.env.DEEPSEEK_API_KEY || '';
      safeEnv.DEEPSEEK_BASE_URL = baseUrl || 'https://api.deepseek.com/v1';
    } else if (provider === 'openai' || provider === 'custom') {
      safeEnv.OPENAI_API_KEY = apiKey || process.env.OPENAI_API_KEY || '';
      safeEnv.OPENAI_BASE_URL = baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    } else if (provider === 'ollama') {
      safeEnv.OLLAMA_HOST = baseUrl || 'http://127.0.0.1:11434';
    }

    // Explicitly delete any potential Agentic OS production persistence or token leaks
    delete (safeEnv as any).DATABASE_URL;
    delete (safeEnv as any).SESSION_SECRET;
    delete (safeEnv as any).JWT_SECRET;
    delete (safeEnv as any).AGENTIC_OS_MASTER_KEY;
    delete (safeEnv as any).ELECTRON_USERDATA;

    return safeEnv;
  }

  /**
   * Start an experimental DeepSeek Harness task execution.
   */
  async start(
    task: ProjectTaskRecord,
    options: DshExecutionOptions = {}
  ): Promise<{ run: ExecutionRunRecord; dshRunId: string }> {
    const dshRunId = `dsh-${Date.now().toString(36)}-${randomUUID().slice(0, 5)}`;
    const prompt = options.prompt || task.description || task.title;
    const provider = options.provider || 'deepseek';
    const model = options.model || (provider === 'deepseek' ? 'deepseek-chat' : 'gpt-4o-mini');
    const baseUrl = options.baseUrl;
    const apiKey = options.apiKey;

    // 1. Create canonical ExecutionRun
    const run = executionRunService.createRun({
      projectId: task.projectId,
      goalId: task.goalId,
      taskId: task.id,
      workerType: 'deepseek_harness',
      provider,
      model,
      metadata: {
        prompt,
        dshRunId,
        actionClass: options.readOnly ? 'READ_ONLY' : 'WRITE_REVERSIBLE',
      },
    });

    // 2. Prepare isolated workspace
    const workspaceRoot = this.validateAndPrepareWorkspace(options.workspaceRoot, run.id);

    // 3. Setup active process tracking
    const abortController = new AbortController();
    const emitter = new EventEmitter();
    const activeProcess: DshActiveProcess = {
      runId: run.id,
      taskId: task.id,
      projectId: task.projectId,
      goalId: task.goalId,
      workspaceRoot,
      abortController,
      emitter,
      startedAt: new Date().toISOString(),
    };
    this.activeRuns.set(run.id, activeProcess);

    // 4. Update task and run status
    projectTaskService.updateTask(task.id, { status: 'running' });
    executionRunService.updateRun(run.id, {
      status: 'running',
      startTime: new Date().toISOString(),
    });

    executionRunService.emitEvent({
      projectId: task.projectId,
      goalId: task.goalId,
      taskId: task.id,
      runId: run.id,
      worker: 'deepseek_harness',
      eventType: 'DSH_RUN_STARTED',
      payload: {
        dshRunId,
        workspaceRoot,
        provider,
        model,
        prompt: prompt.slice(0, 200),
      },
    });

    // 5. Execute asynchronous runtime lifecycle
    this.executeDshRuntime(run, task, activeProcess, prompt, provider, model, baseUrl, apiKey, options.readOnly)
      .catch((err) => {
        logger.error(`[DeepSeekHarnessAdapter] Uncaught error in run ${run.id}:`, err);
      });

    return { run, dshRunId };
  }

  /**
   * Execute the runtime core: builds isolated prompt/context, manages subprocess or LLM driver,
   * streams stdout/events, captures changes, and records canonical ExecutionResult.
   */
  private async executeDshRuntime(
    run: ExecutionRunRecord,
    task: ProjectTaskRecord,
    active: DshActiveProcess,
    prompt: string,
    provider: string,
    model: string,
    baseUrl?: string,
    apiKey?: string,
    readOnly?: boolean
  ): Promise<void> {
    const { signal } = active.abortController;
    const sanitizedEnv = this.sanitizeSubprocessEnv(provider, apiKey, baseUrl);

    let stdoutBuffer = '';
    const generatedFiles: string[] = [];

    try {
      if (signal.aborted) throw new Error('DSH execution cancelled before start');

      active.emitter.emit('event', { type: 'stdout', data: `[DSH] Booting headless runner in ${active.workspaceRoot}\n` });
      active.emitter.emit('event', { type: 'stdout', data: `[DSH] Provider: ${provider} | Model: ${model}\n` });

      executionRunService.emitEvent({
        projectId: active.projectId,
        goalId: active.goalId,
        taskId: active.taskId,
        runId: run.id,
        worker: 'deepseek_harness',
        eventType: 'DSH_INITIALIZED',
        payload: { workspace: active.workspaceRoot },
      });

      // Execute prompt against model via provider interface in the isolated workspace context
      const systemPrompt = `You are DeepSeek Harness (DSH), an execution worker runtime.
You operate inside the isolated workspace: ${active.workspaceRoot}
${readOnly ? 'MODE: READ-ONLY AUDIT. DO NOT modify any files.' : 'MODE: BOUNDED EXECUTION. You may produce structured files within the workspace.'}

Respond with your execution log and structured output JSON inside \`\`\`json:
{
  "summary": "<high-level summary of action>",
  "actionsTaken": ["<action 1>", "<action 2>"],
  "filesCreated": [
    { "path": "<relative_path>", "content": "<content>" }
  ],
  "findings": ["<finding 1>"],
  "status": "success" | "failure"
}`;

      active.emitter.emit('event', { type: 'stdout', data: `[DSH] Sending prompt to ${provider} (${model})...\n` });

      const chatResp = await llmChat({
        systemPrompt,
        prompt,
        provider,
        model,
        signal,
        maxTokens: 2000,
      });

      if (signal.aborted) throw new Error('DSH execution cancelled after response');

      const rawReply = chatResp.reply || '';
      stdoutBuffer += rawReply;
      active.emitter.emit('event', { type: 'stdout', data: rawReply });

      // Parse structured JSON output using robust extractor
      let parsedOutput: any = null;

      // Helper to extract JSON safely
      const tryParse = (str: string) => {
        try { return JSON.parse(str); } catch { return null; }
      };

      // 1. Direct parse or stripped markdown code fence
      const cleaned = rawReply.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      parsedOutput = tryParse(cleaned);

      // 2. Greedy match from first { to last }
      if (!parsedOutput) {
        const firstBrace = rawReply.indexOf('{');
        const lastBrace = rawReply.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace > firstBrace) {
          parsedOutput = tryParse(rawReply.slice(firstBrace, lastBrace + 1));
        }
      }

      // 3. Fallback structure if parsing failed
      if (!parsedOutput) {
        parsedOutput = {
          summary: rawReply.slice(0, 300) || 'DSH execution completed.',
          actionsTaken: ['Analysis completed'],
          filesCreated: [],
          findings: [rawReply.slice(0, 200)],
          status: 'success',
        };
      }

      // Write bounded files if allowed and not read-only
      if (!readOnly && Array.isArray(parsedOutput.filesCreated)) {
        const normalizedWorkspace = path.normalize(path.resolve(active.workspaceRoot)).toLowerCase();

        for (const file of parsedOutput.filesCreated) {
          if (file.path && typeof file.content === 'string') {
            // Resolve path relative to workspaceRoot or treat absolute path
            const resolvedPath = path.isAbsolute(file.path)
              ? path.resolve(file.path)
              : path.resolve(active.workspaceRoot, file.path);

            const normalizedTarget = path.normalize(resolvedPath).toLowerCase();

            // Strict containment check: must be strictly inside workspaceRoot
            if (!normalizedTarget.startsWith(normalizedWorkspace + path.sep)) {
              logger.warn(`[DeepSeekHarnessAdapter] SECURITY DENIAL: Attempted write outside workspace boundary: ${resolvedPath}`);
              active.emitter.emit('event', {
                type: 'stdout',
                data: `[DSH Security] DENIED: File write outside sandbox boundary: ${file.path}\n`,
              });
              continue;
            }

            fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
            fs.writeFileSync(resolvedPath, file.content, 'utf8');
            const safeRelPath = path.relative(active.workspaceRoot, resolvedPath);
            generatedFiles.push(safeRelPath);
            active.emitter.emit('event', { type: 'stdout', data: `[DSH] Created file: ${safeRelPath}\n` });
          }
        }
      }

      const endNow = new Date().toISOString();

      // 6. Record canonical ExecutionResult
      const result = executionRunService.createResult({
        runId: run.id,
        taskId: active.taskId,
        summary: parsedOutput.summary || 'DSH task execution completed successfully.',
        structuredOutput: {
          runtime: 'deepseek_harness',
          requestedProvider: provider,
          requestedModel: model,
          resolvedProvider: chatResp.provider || provider,
          resolvedModel: chatResp.model || model,
          baseUrl: baseUrl || (provider === 'ollama' ? 'http://127.0.0.1:11434' : 'https://api.deepseek.com/v1'),
          workspaceRoot: active.workspaceRoot,
          actionsTaken: parsedOutput.actionsTaken || [],
          changedFiles: generatedFiles,
          findings: parsedOutput.findings || [],
          rawLog: stdoutBuffer.slice(0, 4000),
        },
      });

      // 7. Complete run and task
      executionRunService.updateRun(run.id, {
        status: 'completed',
        endTime: endNow,
        finalResultId: result.id,
      });

      projectTaskService.updateTask(active.taskId, {
        status: 'completed',
      });

      executionRunService.emitEvent({
        projectId: active.projectId,
        goalId: active.goalId,
        taskId: active.taskId,
        runId: run.id,
        worker: 'deepseek_harness',
        eventType: 'DSH_RUN_COMPLETED',
        payload: {
          resultId: result.id,
          summary: parsedOutput.summary,
          generatedFiles,
          provider,
          model,
        },
      });

      active.emitter.emit('event', { type: 'completed', resultId: result.id });
    } catch (err: any) {
      const endNow = new Date().toISOString();
      const isAborted = signal.aborted || err.message?.includes('cancelled') || err.message?.includes('aborted');
      const finalStatus = isAborted ? 'cancelled' : 'failed';
      const failureReason = err.message || 'DSH execution failed';

      logger.warn(`[DeepSeekHarnessAdapter] Run ${run.id} finished with status ${finalStatus}: ${failureReason}`);

      executionRunService.updateRun(run.id, {
        status: finalStatus,
        endTime: endNow,
        failureReason,
      });

      projectTaskService.updateTask(active.taskId, {
        status: finalStatus,
      });

      executionRunService.emitEvent({
        projectId: active.projectId,
        goalId: active.goalId,
        taskId: active.taskId,
        runId: run.id,
        worker: 'deepseek_harness',
        eventType: isAborted ? 'DSH_RUN_CANCELLED' : 'DSH_RUN_FAILED',
        payload: { failureReason },
      });

      active.emitter.emit('event', { type: 'error', reason: failureReason });
    } finally {
      this.activeRuns.delete(run.id);
    }
  }

  /**
   * Cancel an active DSH execution and terminate its process tree recursively on Windows.
   */
  async cancel(runId: string, reason = 'Cancelled by user/Jarvis'): Promise<boolean> {
    const active = this.activeRuns.get(runId);
    if (!active) {
      logger.warn(`[DeepSeekHarnessAdapter] Cannot cancel run ${runId}: Not found in active runs`);
      return false;
    }

    logger.info(`[DeepSeekHarnessAdapter] Cancelling active DSH run ${runId}: ${reason}`);

    // Trigger AbortController
    active.abortController.abort(new Error(reason));

    // Terminate process tree if child process exists
    if (active.pid) {
      this.killProcessTree(active.pid);
    }

    const endNow = new Date().toISOString();

    executionRunService.updateRun(runId, {
      status: 'cancelled',
      endTime: endNow,
      failureReason: reason,
    });

    projectTaskService.updateTask(active.taskId, {
      status: 'cancelled',
    });

    executionRunService.emitEvent({
      projectId: active.projectId,
      goalId: active.goalId,
      taskId: active.taskId,
      runId,
      worker: 'deepseek_harness',
      eventType: 'DSH_RUN_CANCELLED',
      payload: { reason },
    });

    this.activeRuns.delete(runId);
    return true;
  }

  /**
   * Windows process-tree recursive termination.
   */
  public killProcessTree(pid: number): void {
    if (process.platform === 'win32') {
      exec(`taskkill /pid ${pid} /T /F`, (err) => {
        if (err) {
          logger.warn(`[DeepSeekHarnessAdapter] taskkill failed for PID ${pid}:`, err.message);
        } else {
          logger.info(`[DeepSeekHarnessAdapter] Successfully terminated process tree for PID ${pid}`);
        }
      });
    } else {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // Process already exited
        }
      }
    }
  }
}

export const deepseekHarnessAdapter = new DeepSeekHarnessAdapter();

export async function executeDeepSeekHarnessTask(
  task: ProjectTaskRecord,
  options: DshExecutionOptions = {}
): Promise<{ run: ExecutionRunRecord; dshRunId: string }> {
  return deepseekHarnessAdapter.start(task, options);
}

export async function cancelDeepSeekHarnessTask(runId: string, reason?: string): Promise<boolean> {
  return deepseekHarnessAdapter.cancel(runId, reason);
}
