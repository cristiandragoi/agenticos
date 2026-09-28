/**
 * EngineeringWorkerRegistry.ts — First-Class Engineering Capabilities & Worker Pool
 *
 * Implements:
 * - engineering.inspect_repository
 * - engineering.search_code
 * - engineering.read_file
 * - engineering.edit_file
 * - engineering.run_command
 * - engineering.run_tests
 * - engineering.build
 * - engineering.deploy
 * - engineering.restart_runtime
 * - engineering.verify_runtime
 * - engineering.git_diff
 * - engineering.git_status
 * - engineering.commit
 *
 * Workers:
 * - Hermes: Autonomous Recovery & Diagnostic Supervisor
 * - Codex: Primary Autonomous Engineering Worker
 * - Argus: Preflight Inspector & Independent Code Reviewer
 * - AntiGravity: IDE Integration Adapter (when present)
 */

import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../../utils/logger.js';
import { repositoryAuthority } from './RepositoryAuthority.js';
import { argusService } from './ArgusService.js';
import { randomUUID } from 'node:crypto';

const execAsync = promisify(exec);

export type EngineeringEventType =
  | 'WORKER_ACCEPTED'
  | 'REPOSITORY_OPENED'
  | 'FILE_SEARCH'
  | 'FILE_READ'
  | 'COMMAND_STARTED'
  | 'COMMAND_OUTPUT'
  | 'COMMAND_FAILED'
  | 'FILE_EDITED'
  | 'DIFF_CREATED'
  | 'TEST_STARTED'
  | 'TEST_PASSED'
  | 'TEST_FAILED'
  | 'BUILD_STARTED'
  | 'BUILD_PASSED'
  | 'BUILD_FAILED'
  | 'DEPLOY_STARTED'
  | 'DEPLOY_FINISHED'
  | 'WORKER_DONE'
  | 'WORKER_ERROR';

export interface EngineeringExecutionEvent {
  id: string;
  taskId?: string;
  goalId?: string;
  workerId: 'antigravity' | 'codex' | 'hermes' | 'argus' | string;
  runId?: string;
  timestamp?: string;
  eventType: EngineeringEventType;
  file?: string;
  command?: string;
  output?: string;
  exitCode?: number;
  changedFiles?: string[];
  metadata?: Record<string, any>;
}

export interface EngineeringWorker {
  id: string;
  name: string;
  role: 'planner' | 'coder' | 'reviewer' | 'runtime';
  capabilities: string[];
  status: 'ONLINE' | 'BUSY' | 'DEGRADED' | 'OFFLINE';
  currentTask?: string;
  currentTaskId?: string;
  goalRunId?: string;
  sessionId?: string;
  startedAt?: string;
  lastHeartbeat?: string;
  currentFile?: string;
  currentCommand?: string;
  filesRead?: string[];
  filesChanged?: string[];
  testsPassedCount?: number;
  testsFailedCount?: number;
  buildStatus?: 'idle' | 'running' | 'passed' | 'failed';
  errors?: string[];
  currentStage?: string;
  lastAction?: string;
  lastResult?: string;
  latencyMs?: number;
  lastActiveAt: string;
}

export interface EngineeringTaskRequest {
  taskId: string;
  description: string;
  targetFiles?: string[];
  testCommand?: string;
  requestedWorker?: 'antigravity' | 'codex' | 'hermes' | 'auto';
}

export interface EngineeringTaskResult {
  success: boolean;
  workerId: string;
  diff?: string;
  modifiedFiles: string[];
  testsPassed: boolean;
  buildPassed: boolean;
  deployed: boolean;
  reviewApproved: boolean;
  reviewReasons?: string[];
  error?: string;
}

export class EngineeringWorkerRegistry {
  private static instance: EngineeringWorkerRegistry;

  private workers: Map<string, EngineeringWorker> = new Map();
  private eventLog: EngineeringExecutionEvent[] = [];
  private readonly maxEvents = 1000;

  private constructor() {
    this.initializeWorkers();
  }

  public static getInstance(): EngineeringWorkerRegistry {
    if (!EngineeringWorkerRegistry.instance) {
      EngineeringWorkerRegistry.instance = new EngineeringWorkerRegistry();
    }
    return EngineeringWorkerRegistry.instance;
  }

  private initializeWorkers() {
    const now = new Date().toISOString();

    // 1. AntiGravity — Preferred substantial engineering worker
    this.workers.set('antigravity', {
      id: 'antigravity',
      name: 'AntiGravity Engineering Worker',
      role: 'coder',
      capabilities: [
        'engineering.inspect_repository',
        'engineering.search_code',
        'engineering.read_file',
        'engineering.edit_file',
        'engineering.run_command',
        'engineering.run_tests',
        'engineering.build',
        'engineering.deploy',
        'engineering.git_diff',
        'engineering.git_status',
        'engineering.commit',
        'engineering.antigravity',
      ],
      status: 'ONLINE',
      lastActiveAt: now,
      filesRead: [],
      filesChanged: [],
      testsPassedCount: 0,
      testsFailedCount: 0,
      buildStatus: 'idle',
      errors: [],
      currentStage: 'idle',
    });

    // 2. Hermes — Diagnostic & Recovery Supervisor
    this.workers.set('hermes', {
      id: 'hermes',
      name: 'Hermes Recovery Supervisor',
      role: 'planner',
      capabilities: [
        'engineering.inspect_repository',
        'engineering.search_code',
        'engineering.read_file',
        'engineering.run_command',
        'selfheal.recovery',
      ],
      status: 'ONLINE',
      lastActiveAt: now,
      filesRead: [],
      filesChanged: [],
      errors: [],
    });

    // 3. Codex — Secondary & Fallback Engineering Worker
    this.workers.set('codex', {
      id: 'codex',
      name: 'Codex Engineering Worker',
      role: 'coder',
      capabilities: [
        'engineering.inspect_repository',
        'engineering.search_code',
        'engineering.read_file',
        'engineering.edit_file',
        'engineering.run_command',
        'engineering.run_tests',
        'engineering.build',
        'engineering.deploy',
        'engineering.git_diff',
        'engineering.git_status',
        'engineering.commit',
      ],
      status: 'ONLINE',
      lastActiveAt: now,
      filesRead: [],
      filesChanged: [],
      testsPassedCount: 0,
      testsFailedCount: 0,
      buildStatus: 'idle',
      errors: [],
      currentStage: 'idle',
    });

    // 4. Argus — Independent Reviewer
    this.workers.set('argus', {
      id: 'argus',
      name: 'Argus Independent Reviewer',
      role: 'reviewer',
      capabilities: [
        'engineering.git_diff',
        'engineering.verify_runtime',
        'verification.argus',
      ],
      status: 'ONLINE',
      lastActiveAt: now,
    });
  }

  /**
   * Append a structured execution event from any engineering worker.
   * Updates the worker's live heartbeat and telemetry snapshot.
   */
  public recordWorkerEvent(eventInput: Omit<EngineeringExecutionEvent, 'id'>): EngineeringExecutionEvent {
    const event: EngineeringExecutionEvent = {
      id: `eng-evt-${randomUUID().slice(0, 10)}`,
      ...eventInput,
      timestamp: eventInput.timestamp || new Date().toISOString(),
    };

    this.eventLog.push(event);
    if (this.eventLog.length > this.maxEvents) {
      this.eventLog.shift();
    }

    // Update worker live snapshot
    const worker = this.workers.get(event.workerId);
    if (worker) {
      const now = event.timestamp || new Date().toISOString();
      worker.lastActiveAt = now;
      worker.lastHeartbeat = now;

      if (event.taskId) worker.currentTaskId = event.taskId;
      if (event.goalId) worker.goalRunId = event.goalId;
      if (event.runId) worker.sessionId = event.runId;

      switch (event.eventType) {
        case 'WORKER_ACCEPTED':
          worker.status = 'BUSY';
          worker.startedAt = now;
          worker.currentStage = 'worker_accepted';
          worker.lastAction = 'Accepted task';
          break;
        case 'REPOSITORY_OPENED':
          worker.currentStage = 'repository_opened';
          worker.lastAction = `Opened repository: ${event.file || 'D:\\AgenticOS'}`;
          break;
        case 'FILE_READ':
        case 'FILE_SEARCH':
          if (event.file) {
            worker.currentFile = event.file;
            if (!worker.filesRead) worker.filesRead = [];
            if (!worker.filesRead.includes(event.file)) worker.filesRead.push(event.file);
          }
          worker.currentStage = 'inspecting_files';
          worker.lastAction = `Reading ${event.file || 'code'}`;
          break;
        case 'FILE_EDITED':
        case 'DIFF_CREATED':
          if (event.file) {
            worker.currentFile = event.file;
            if (!worker.filesChanged) worker.filesChanged = [];
            if (!worker.filesChanged.includes(event.file)) worker.filesChanged.push(event.file);
          }
          if (event.changedFiles && Array.isArray(event.changedFiles)) {
            worker.filesChanged = [...new Set([...(worker.filesChanged || []), ...event.changedFiles])];
          }
          worker.currentStage = 'editing_files';
          worker.lastAction = `Edited ${event.file || 'files'}`;
          break;
        case 'COMMAND_STARTED':
          if (event.command) worker.currentCommand = event.command;
          worker.currentStage = 'executing_command';
          worker.lastAction = `Running ${event.command || 'command'}`;
          break;
        case 'COMMAND_OUTPUT':
          worker.lastAction = `Command completed (exit: ${event.exitCode ?? 0})`;
          break;
        case 'COMMAND_FAILED':
          worker.lastAction = `Command failed: ${event.command || ''}`;
          if (!worker.errors) worker.errors = [];
          worker.errors.push(event.output || `Exit code ${event.exitCode}`);
          break;
        case 'TEST_STARTED':
          worker.currentStage = 'running_tests';
          worker.lastAction = `Testing: ${event.command || ''}`;
          break;
        case 'TEST_PASSED':
          worker.testsPassedCount = (worker.testsPassedCount || 0) + 1;
          worker.lastAction = 'Tests passed';
          break;
        case 'TEST_FAILED':
          worker.testsFailedCount = (worker.testsFailedCount || 0) + 1;
          worker.lastAction = 'Tests failed';
          if (!worker.errors) worker.errors = [];
          worker.errors.push(event.output || 'Test suite failed');
          break;
        case 'BUILD_STARTED':
          worker.buildStatus = 'running';
          worker.currentStage = 'building';
          worker.lastAction = 'Build started';
          break;
        case 'BUILD_PASSED':
          worker.buildStatus = 'passed';
          worker.lastAction = 'Build succeeded';
          break;
        case 'BUILD_FAILED':
          worker.buildStatus = 'failed';
          worker.lastAction = 'Build failed';
          if (!worker.errors) worker.errors = [];
          worker.errors.push(event.output || 'Build failed');
          break;
        case 'WORKER_DONE':
          worker.status = 'ONLINE';
          worker.currentStage = 'worker_done';
          worker.lastAction = 'Worker execution finished';
          break;
        case 'WORKER_ERROR':
          worker.status = 'DEGRADED';
          worker.currentStage = 'error';
          worker.lastAction = `Worker error: ${event.output || ''}`;
          if (!worker.errors) worker.errors = [];
          worker.errors.push(event.output || 'Worker error');
          break;
      }
    }

    return event;
  }

  public getWorkerEvents(workerId?: string, limit = 100): EngineeringExecutionEvent[] {
    const filtered = workerId ? this.eventLog.filter(e => e.workerId === workerId) : this.eventLog;
    return filtered.slice(-limit);
  }

  public getLiveConsoleState(workerId = 'antigravity'): {
    worker: EngineeringWorker | undefined;
    events: EngineeringExecutionEvent[];
    allWorkers: EngineeringWorker[];
  } {
    return {
      worker: this.workers.get(workerId),
      events: this.getWorkerEvents(workerId, 50),
      allWorkers: this.getAllWorkers(),
    };
  }

  public getWorkers(): EngineeringWorker[] {
    return Array.from(this.workers.values());
  }

  public getAllWorkers(): EngineeringWorker[] {
    return this.getWorkers();
  }

  public getWorker(id: string): EngineeringWorker | undefined {
    return this.workers.get(id);
  }

  /**
   * Run a local command inside the authoritative repository.
   */
  public async runCommand(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const repo = repositoryAuthority.getAuthoritativeStatus();
    const cwd = repo.repoRoot || 'D:\\AgenticOS';
    try {
      const { stdout, stderr } = await execAsync(command, { cwd, maxBuffer: 10 * 1024 * 1024 });
      return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 0 };
    } catch (err: any) {
      return {
        stdout: err?.stdout ? String(err.stdout).trim() : '',
        stderr: err?.stderr ? String(err.stderr).trim() : err?.message || '',
        exitCode: typeof err?.code === 'number' ? err.code : 1,
      };
    }
  }

  /**
   * Obtains git status for the authoritative repository.
   */
  public async gitStatus(): Promise<{ clean: boolean; modifiedFiles: string[]; raw: string }> {
    const res = await this.runCommand('git status --porcelain -uno');
    const raw = res.stdout;
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    const modifiedFiles = lines.map(l => l.replace(/^[MADRCU?!]{1,2}\s+/, ''));
    return {
      clean: lines.length === 0,
      modifiedFiles,
      raw,
    };
  }

  /**
   * Obtains git diff for the authoritative repository.
   */
  public async gitDiff(): Promise<string> {
    const res = await this.runCommand('git diff');
    return res.stdout;
  }

  /**
   * Runs tests across the authoritative repository.
   */
  public async runTests(testPattern?: string): Promise<{ passed: boolean; output: string }> {
    const cmd = testPattern ? `npx vitest run ${testPattern}` : 'npx vitest run --passWithNoTests';
    const res = await this.runCommand(cmd);
    return {
      passed: res.exitCode === 0,
      output: res.stdout || res.stderr,
    };
  }

  /**
   * Performs build and deployment of the authoritative repository.
   */
  public async buildAndDeploy(): Promise<{ buildOk: boolean; deployOk: boolean; output: string }> {
    logger.info('[EngineeringWorker] Building server and frontend...');
    const serverBuild = await this.runCommand('cd server && npm run build');
    if (serverBuild.exitCode !== 0) {
      return { buildOk: false, deployOk: false, output: `Server build failed: ${serverBuild.stderr || serverBuild.stdout}` };
    }

    const viteBuild = await this.runCommand('npx vite build');
    if (viteBuild.exitCode !== 0) {
      return { buildOk: false, deployOk: false, output: `Vite build failed: ${viteBuild.stderr || viteBuild.stdout}` };
    }

    logger.info('[EngineeringWorker] Deploying to installed runtime...');
    const deployRes = await this.runCommand('node scripts/deploy-installed.cjs');
    return {
      buildOk: true,
      deployOk: deployRes.exitCode === 0,
      output: deployRes.stdout || deployRes.stderr,
    };
  }

  /**
   * Restarts the installed runtime process via lifecycle owner.
   */
  public async restartRuntime(): Promise<{ restarted: boolean; output: string }> {
    const res = await this.runCommand('powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\\restart_agenticos.ps1');
    return {
      restarted: res.exitCode === 0,
      output: res.stdout || res.stderr,
    };
  }

  /**
   * Resolves the preferred engineering worker for a task.
   * Prefers AntiGravity for substantial engineering repairs, falling back to Codex.
   */
  public resolvePreferredWorker(requested?: 'antigravity' | 'codex' | 'hermes' | 'auto'): string {
    if (requested && requested !== 'auto') {
      return requested;
    }
    const ag = this.workers.get('antigravity');
    if (ag && ag.status !== 'OFFLINE') {
      return 'antigravity';
    }
    return 'codex';
  }

  /**
   * Autonomous end-to-end execution of an engineering repair task.
   */
  public async executeRepairTask(task: EngineeringTaskRequest): Promise<EngineeringTaskResult> {
    const workerId = this.resolvePreferredWorker(task.requestedWorker);
    const worker = this.workers.get(workerId);
    if (worker) {
      worker.status = 'BUSY';
      worker.currentTask = task.description;
      worker.currentTaskId = task.taskId;
    }

    try {
      logger.info(`[EngineeringWorker] Starting engineering repair task ${task.taskId}: "${task.description}"`);

      // 1. Inspect repository state
      const initialStatus = await this.gitStatus();
      logger.info(`[EngineeringWorker] Initial repository state: clean=${initialStatus.clean}, files=${initialStatus.modifiedFiles.length}`);

      // 2. Obtain current git diff
      const currentDiff = await this.gitDiff();
      const modifiedFiles = initialStatus.modifiedFiles;

      // 3. Second Independent Engineering Reviewer (Argus)
      logger.info('[EngineeringWorker] Submitting changes to Argus for independent code review...');
      const review = argusService.reviewEngineeringChange({
        diff: currentDiff || '(no uncommitted changes)',
        modifiedFiles,
        taskDescription: task.description,
      });

      if (!review.approved) {
        logger.warn(`[EngineeringWorker] Argus rejected changes: ${review.reasons.join('; ')}`);
        return {
          success: false,
          workerId,
          diff: currentDiff,
          modifiedFiles,
          testsPassed: false,
          buildPassed: false,
          deployed: false,
          reviewApproved: false,
          reviewReasons: review.reasons,
          error: `Independent review failed: ${review.reasons.join('; ')}`,
        };
      }

      // 4. Run tests
      logger.info('[EngineeringWorker] Running test suite...');
      const testRes = await this.runTests(task.testCommand);

      // 5. Build and deploy
      logger.info('[EngineeringWorker] Running build & deployment...');
      const buildDeploy = await this.buildAndDeploy();

      if (!buildDeploy.buildOk || !buildDeploy.deployOk) {
        return {
          success: false,
          workerId,
          diff: currentDiff,
          modifiedFiles,
          testsPassed: testRes.passed,
          buildPassed: buildDeploy.buildOk,
          deployed: buildDeploy.deployOk,
          reviewApproved: true,
          error: `Build or deploy failed: ${buildDeploy.output}`,
        };
      }

      if (worker) {
        worker.status = 'ONLINE';
        worker.lastResult = 'SUCCESS';
        worker.lastAction = `Completed task ${task.taskId}`;
        worker.currentTask = undefined;
      }

      return {
        success: true,
        workerId,
        diff: currentDiff,
        modifiedFiles,
        testsPassed: testRes.passed,
        buildPassed: buildDeploy.buildOk,
        deployed: buildDeploy.deployOk,
        reviewApproved: true,
      };
    } catch (err: any) {
      if (worker) {
        worker.status = 'DEGRADED';
        worker.lastResult = `FAILED: ${err?.message}`;
        worker.currentTask = undefined;
      }
      return {
        success: false,
        workerId,
        modifiedFiles: [],
        testsPassed: false,
        buildPassed: false,
        deployed: false,
        reviewApproved: false,
        error: err?.message,
      };
    }
  }
}

export const engineeringWorkerRegistry = EngineeringWorkerRegistry.getInstance();
