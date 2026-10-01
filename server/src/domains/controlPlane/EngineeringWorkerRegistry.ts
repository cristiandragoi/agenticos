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

import { rawDb } from '../../db/index.js';

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
  | 'WORKER_ERROR'
  | 'VALIDATING'
  | 'ARGUS_VERIFYING'
  | 'COMPLETED';

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

export interface EngineeringWorkerSession {
  taskId: string;
  goalId?: string;
  workerId: string;
  antigravityConversationId: string;
  antigravitySessionId?: string;
  workspace: string;
  createdAt: string;
  lastHeartbeat: string;
  status: 'ONLINE' | 'BUSY' | 'DISCONNECTED' | 'COMPLETED' | 'FAILED' | string;
  transcriptPath?: string;
  title?: string;
  currentStage?: string;
  currentFile?: string;
  currentCommand?: string;
  lastOutput?: string;
  filesRead: string[];
  filesChanged: string[];
  testsPassed: number;
  testsFailed: number;
  buildStatus: 'idle' | 'running' | 'passed' | 'failed' | string;
  errors: string[];
  metadata: Record<string, any>;
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
  private sessions: Map<string, EngineeringWorkerSession> = new Map();
  private eventLog: EngineeringExecutionEvent[] = [];
  private readonly maxEvents = 1000;
  private tablesInitialized = false;

  private constructor() {
    this.ensurePersistenceTables();
    this.initializeWorkers();
    this.loadDurableState();
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

  private ensurePersistenceTables(): void {
    if (this.tablesInitialized) return;
    try {
      rawDb.exec(`
        CREATE TABLE IF NOT EXISTS engineering_worker_sessions (
          task_id TEXT PRIMARY KEY,
          goal_id TEXT,
          worker_id TEXT NOT NULL,
          antigravity_conversation_id TEXT NOT NULL,
          antigravity_session_id TEXT,
          workspace TEXT NOT NULL,
          created_at TEXT NOT NULL,
          last_heartbeat TEXT NOT NULL,
          status TEXT NOT NULL,
          transcript_path TEXT,
          title TEXT,
          current_stage TEXT,
          current_file TEXT,
          current_command TEXT,
          last_output TEXT,
          files_read TEXT NOT NULL DEFAULT '[]',
          files_changed TEXT NOT NULL DEFAULT '[]',
          tests_passed INTEGER NOT NULL DEFAULT 0,
          tests_failed INTEGER NOT NULL DEFAULT 0,
          build_status TEXT NOT NULL DEFAULT 'idle',
          errors TEXT NOT NULL DEFAULT '[]',
          metadata TEXT NOT NULL DEFAULT '{}'
        );

        CREATE TABLE IF NOT EXISTS engineering_execution_events (
          id TEXT PRIMARY KEY,
          task_id TEXT,
          goal_id TEXT,
          worker_id TEXT NOT NULL,
          run_id TEXT,
          timestamp TEXT NOT NULL,
          event_type TEXT NOT NULL,
          file TEXT,
          command TEXT,
          output TEXT,
          exit_code INTEGER,
          changed_files TEXT,
          metadata TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_eng_events_task ON engineering_execution_events(task_id, timestamp);
      `);
      this.tablesInitialized = true;
    } catch (err: any) {
      logger.warn('[EngineeringWorkerRegistry] Failed to initialize SQLite tables:', err?.message);
    }
  }

  public loadDurableState(): void {
    try {
      if (!this.tablesInitialized) this.ensurePersistenceTables();
      // 1. Hydrate sessions
      const rows = rawDb.prepare(`
        SELECT * FROM engineering_worker_sessions ORDER BY created_at DESC LIMIT 100
      `).all() as any[];

      for (const row of rows) {
        const session: EngineeringWorkerSession = {
          taskId: row.task_id,
          goalId: row.goal_id || undefined,
          workerId: row.worker_id,
          antigravityConversationId: row.antigravity_conversation_id,
          antigravitySessionId: row.antigravity_session_id || undefined,
          workspace: row.workspace,
          createdAt: row.created_at,
          lastHeartbeat: row.last_heartbeat,
          status: row.status,
          transcriptPath: row.transcript_path || undefined,
          title: row.title || undefined,
          currentStage: row.current_stage || undefined,
          currentFile: row.current_file || undefined,
          currentCommand: row.current_command || undefined,
          lastOutput: row.last_output || undefined,
          filesRead: JSON.parse(row.files_read || '[]'),
          filesChanged: JSON.parse(row.files_changed || '[]'),
          testsPassed: row.tests_passed || 0,
          testsFailed: row.tests_failed || 0,
          buildStatus: row.build_status || 'idle',
          errors: JSON.parse(row.errors || '[]'),
          metadata: JSON.parse(row.metadata || '{}'),
        };
        this.sessions.set(session.taskId, session);
      }

      // 2. Hydrate recent events
      const eventRows = rawDb.prepare(`
        SELECT * FROM engineering_execution_events ORDER BY timestamp DESC LIMIT 200
      `).all() as any[];

      const loadedEvents: EngineeringExecutionEvent[] = eventRows.reverse().map(r => ({
        id: r.id,
        taskId: r.task_id || undefined,
        goalId: r.goal_id || undefined,
        workerId: r.worker_id,
        runId: r.run_id || undefined,
        timestamp: r.timestamp,
        eventType: r.event_type as EngineeringEventType,
        file: r.file || undefined,
        command: r.command || undefined,
        output: r.output || undefined,
        exitCode: r.exit_code !== null ? r.exit_code : undefined,
        changedFiles: r.changed_files ? JSON.parse(r.changed_files) : undefined,
        metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
      }));

      if (loadedEvents.length > 0) {
        this.eventLog = [...loadedEvents, ...this.eventLog].slice(-this.maxEvents);
      }

      logger.info(`[EngineeringWorkerRegistry] Hydrated ${this.sessions.size} durable sessions and ${loadedEvents.length} events from SQLite.`);
    } catch (err: any) {
      logger.warn('[EngineeringWorkerRegistry] Failed to hydrate durable state from SQLite:', err?.message);
    }
  }

  public registerWorkerSession(session: EngineeringWorkerSession): EngineeringWorkerSession {
    return this.upsertSession(session);
  }

  public upsertSession(session: EngineeringWorkerSession): EngineeringWorkerSession {
    this.sessions.set(session.taskId, session);
    try {
      if (!this.tablesInitialized) this.ensurePersistenceTables();
      const stmt = rawDb.prepare(`
        INSERT INTO engineering_worker_sessions (
          task_id, goal_id, worker_id, antigravity_conversation_id, antigravity_session_id,
          workspace, created_at, last_heartbeat, status, transcript_path, title,
          current_stage, current_file, current_command, last_output, files_read,
          files_changed, tests_passed, tests_failed, build_status, errors, metadata
        ) VALUES (
          @taskId, @goalId, @workerId, @antigravityConversationId, @antigravitySessionId,
          @workspace, @createdAt, @lastHeartbeat, @status, @transcriptPath, @title,
          @currentStage, @currentFile, @currentCommand, @lastOutput, @filesRead,
          @filesChanged, @testsPassed, @testsFailed, @buildStatus, @errors, @metadata
        )
        ON CONFLICT(task_id) DO UPDATE SET
          goal_id = excluded.goal_id,
          worker_id = excluded.worker_id,
          antigravity_conversation_id = excluded.antigravity_conversation_id,
          antigravity_session_id = excluded.antigravity_session_id,
          workspace = excluded.workspace,
          last_heartbeat = excluded.last_heartbeat,
          status = excluded.status,
          transcript_path = excluded.transcript_path,
          title = excluded.title,
          current_stage = excluded.current_stage,
          current_file = excluded.current_file,
          current_command = excluded.current_command,
          last_output = excluded.last_output,
          files_read = excluded.files_read,
          files_changed = excluded.files_changed,
          tests_passed = excluded.tests_passed,
          tests_failed = excluded.tests_failed,
          build_status = excluded.build_status,
          errors = excluded.errors,
          metadata = excluded.metadata
      `);

      stmt.run({
        taskId: session.taskId,
        goalId: session.goalId || null,
        workerId: session.workerId,
        antigravityConversationId: session.antigravityConversationId,
        antigravitySessionId: session.antigravitySessionId || null,
        workspace: session.workspace,
        createdAt: session.createdAt,
        lastHeartbeat: session.lastHeartbeat,
        status: session.status,
        transcriptPath: session.transcriptPath || null,
        title: session.title || null,
        currentStage: session.currentStage || null,
        currentFile: session.currentFile || null,
        currentCommand: session.currentCommand || null,
        lastOutput: session.lastOutput || null,
        filesRead: JSON.stringify(session.filesRead || []),
        filesChanged: JSON.stringify(session.filesChanged || []),
        testsPassed: session.testsPassed || 0,
        testsFailed: session.testsFailed || 0,
        buildStatus: session.buildStatus || 'idle',
        errors: JSON.stringify(session.errors || []),
        metadata: JSON.stringify(session.metadata || {}),
      });
    } catch (err: any) {
      logger.warn(`[EngineeringWorkerRegistry] Failed to persist session ${session.taskId}:`, err?.message);
    }
    return session;
  }

  public getSession(taskId: string): EngineeringWorkerSession | undefined {
    return this.sessions.get(taskId);
  }

  public getSessions(limit = 50): EngineeringWorkerSession[] {
    return this.getAllSessions(limit);
  }

  public getAllSessions(limit = 50): EngineeringWorkerSession[] {
    const list = Array.from(this.sessions.values());
    list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return list.slice(0, limit);
  }

  public getActiveSession(workerId = 'antigravity'): EngineeringWorkerSession | undefined {
    // Prefer running/busy sessions, then most recent
    const sessions = this.getAllSessions(20).filter(s => s.workerId === workerId);
    const active = sessions.find(s => s.status === 'BUSY' || s.status === 'ONLINE');
    return active || sessions[0];
  }

  public updateWorkerStatus(workerId: string, status: 'ONLINE' | 'BUSY' | 'DEGRADED' | 'OFFLINE'): void {
    const worker = this.workers.get(workerId);
    if (worker) {
      worker.status = status;
      worker.lastActiveAt = new Date().toISOString();
    }
  }

  /**
   * Append a structured execution event from any engineering worker.
   * Updates the worker's live heartbeat and telemetry snapshot, and persists to SQLite.
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

    // Persist event to SQLite
    try {
      if (!this.tablesInitialized) this.ensurePersistenceTables();
      rawDb.prepare(`
        INSERT INTO engineering_execution_events (
          id, task_id, goal_id, worker_id, run_id, timestamp, event_type,
          file, command, output, exit_code, changed_files, metadata
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?
        )
      `).run(
        event.id,
        event.taskId || null,
        event.goalId || null,
        event.workerId,
        event.runId || null,
        event.timestamp,
        event.eventType,
        event.file || null,
        event.command || null,
        event.output ? event.output.slice(0, 2000) : null,
        event.exitCode !== undefined ? event.exitCode : null,
        event.changedFiles ? JSON.stringify(event.changedFiles) : null,
        event.metadata ? JSON.stringify(event.metadata) : null
      );
    } catch (err: any) {
      // Log warning but continue in-memory
      logger.warn('[EngineeringWorkerRegistry] Failed to persist event to SQLite:', err?.message);
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
        case 'VALIDATING':
          worker.currentStage = 'validating';
          worker.lastAction = 'Validating worker output & evidence';
          break;
        case 'ARGUS_VERIFYING':
          worker.currentStage = 'argus_verifying';
          worker.lastAction = 'Argus independent verification in progress';
          break;
        case 'WORKER_DONE':
          worker.status = 'ONLINE';
          worker.currentStage = 'worker_done';
          worker.lastAction = 'Worker execution finished';
          break;
        case 'COMPLETED':
          worker.status = 'ONLINE';
          worker.currentStage = 'completed';
          worker.lastAction = 'Task completed';
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

    // Update session snapshot if linked to a task
    if (event.taskId) {
      let session = this.sessions.get(event.taskId);
      if (!session) {
        session = {
          taskId: event.taskId,
          goalId: event.goalId,
          workerId: event.workerId,
          antigravityConversationId: event.runId || '',
          workspace: 'D:\\AgenticOS',
          createdAt: event.timestamp || new Date().toISOString(),
          lastHeartbeat: event.timestamp || new Date().toISOString(),
          status: 'BUSY',
          filesRead: [],
          filesChanged: [],
          testsPassed: 0,
          testsFailed: 0,
          buildStatus: 'idle',
          errors: [],
          metadata: {},
        };
      }

      session.lastHeartbeat = event.timestamp || new Date().toISOString();
      if (worker?.currentStage) session.currentStage = worker.currentStage;
      if (worker?.currentFile) session.currentFile = worker.currentFile;
      if (worker?.currentCommand) session.currentCommand = worker.currentCommand;
      if (event.output) session.lastOutput = event.output.slice(0, 1000);
      if (worker?.filesRead) session.filesRead = [...worker.filesRead];
      if (worker?.filesChanged) session.filesChanged = [...worker.filesChanged];
      if (worker?.testsPassedCount !== undefined) session.testsPassed = worker.testsPassedCount;
      if (worker?.testsFailedCount !== undefined) session.testsFailed = worker.testsFailedCount;
      if (worker?.buildStatus) session.buildStatus = worker.buildStatus;
      if (worker?.errors) session.errors = [...worker.errors];

      if (event.eventType === 'WORKER_DONE' || event.eventType === 'COMPLETED') {
        session.status = 'COMPLETED';
      } else if (event.eventType === 'WORKER_ERROR') {
        session.status = 'FAILED';
      }

      this.upsertSession(session);
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
    sessions: EngineeringWorkerSession[];
    activeSession: EngineeringWorkerSession | undefined;
  } {
    return {
      worker: this.workers.get(workerId),
      events: this.getWorkerEvents(workerId, 50),
      allWorkers: this.getAllWorkers(),
      sessions: this.getAllSessions(20),
      activeSession: this.getActiveSession(workerId),
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
