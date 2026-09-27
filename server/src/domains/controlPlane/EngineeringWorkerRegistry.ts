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

const execAsync = promisify(exec);

export interface EngineeringWorker {
  id: string;
  name: string;
  role: 'planner' | 'coder' | 'reviewer' | 'runtime';
  capabilities: string[];
  status: 'ONLINE' | 'BUSY' | 'DEGRADED' | 'OFFLINE';
  currentTask?: string;
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
  requestedWorker?: 'codex' | 'hermes' | 'auto';
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
    });

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
    });

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
   * Autonomous end-to-end execution of an engineering repair task.
   */
  public async executeRepairTask(task: EngineeringTaskRequest): Promise<EngineeringTaskResult> {
    const workerId = task.requestedWorker === 'hermes' ? 'hermes' : 'codex';
    const worker = this.workers.get(workerId);
    if (worker) {
      worker.status = 'BUSY';
      worker.currentTask = task.description;
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
