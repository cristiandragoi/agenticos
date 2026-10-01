/**
 * browserWorkerSupervisor.ts — Supervisor for managing isolated OS child process browser workers.
 *
 * Requirements:
 * - Browser workers are isolated OS child processes (NOT Node worker_threads).
 * - Spawns worker child processes and hooks up state-aware heartbeats via IPC.
 * - Graceful shutdown and forced termination after timeout.
 * - Detects unexpected process exit without crashing or terminating the supervisor.
 * - Supervisor global kill-switch design.
 * - Provider / account circuit-breaker handling.
 */

import { fork, ChildProcess } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { rawDb } from '../../../db/index.js';
import { logger } from '../../../utils/logger.js';
import type {
  BrowserWorkerStatus,
  CircuitBreakerState,
  SupervisorToWorkerMessage,
  WorkerToSupervisorMessage,
  StateAwareHeartbeatPayload,
} from './types.js';
import { ensureBrowserTables } from './browserTaskQueue.js';

export interface SpawnWorkerOptions {
  workerId?: string;
  providerAccountId: string;
  profilePath?: string;
  headless?: boolean;
  spawnTimeoutMs?: number;
}

export interface ManagedWorkerHandle {
  workerId: string;
  providerAccountId: string;
  pid: number | undefined;
  status: BrowserWorkerStatus;
  lastHeartbeatAt: string | null;
  lastHeartbeatPayload: StateAwareHeartbeatPayload | null;
  childProcess: ChildProcess;
  isAlive: boolean;
}

export class BrowserWorkerSupervisor {
  private db: Database.Database;
  private activeWorkers = new Map<string, ManagedWorkerHandle>();
  private globalKillSwitchActive = false;
  private killSwitchReason: string | null = null;

  constructor(db: Database.Database = rawDb) {
    this.db = db;
    ensureBrowserTables(this.db);
    this.setupProcessExitHandlers();
  }

  private setupProcessExitHandlers(): void {
    const cleanup = () => {
      for (const worker of this.activeWorkers.values()) {
        if (worker.isAlive) {
          try {
            worker.childProcess.kill('SIGKILL');
          } catch {}
        }
      }
    };

    // Ensure children terminate on parent process exit or signals
    process.once('exit', cleanup);
    process.once('SIGINT', () => {
      cleanup();
    });
    process.once('SIGTERM', () => {
      cleanup();
    });
  }


  // ── Global Kill-Switch (Requirement 9) ────────────────────────────────────

  isKillSwitchActive(): boolean {
    return this.globalKillSwitchActive;
  }

  getKillSwitchReason(): string | null {
    return this.killSwitchReason;
  }

  /**
   * Activates the global kill-switch: immediately halts all active workers and prevents new spawns.
   */
  async tripGlobalKillSwitch(reason: string): Promise<void> {
    this.globalKillSwitchActive = true;
    this.killSwitchReason = reason;
    logger.error(`[BrowserSupervisor] GLOBAL KILL-SWITCH TRIPPED: ${reason}`);

    const terminationPromises = Array.from(this.activeWorkers.values()).map(async (worker) => {
      try {
        if (worker.isAlive) {
          if (worker.childProcess.connected) {
            worker.childProcess.send({ type: 'GLOBAL_KILL', reason } satisfies SupervisorToWorkerMessage);
          }
          // Give brief 200ms grace then force terminate
          await new Promise((r) => setTimeout(r, 200));
          if (worker.isAlive) {
            worker.childProcess.kill('SIGKILL');
          }
        }
      } catch (err: any) {
        logger.warn(`[BrowserSupervisor] Error terminating worker ${worker.workerId} during global kill: ${err.message}`);
      }
    });

    await Promise.all(terminationPromises);

    for (const worker of this.activeWorkers.values()) {
      worker.isAlive = false;
      worker.status = 'TERMINATED';
    }
    this.activeWorkers.clear();

    // Update DB
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE revenue_browser_workers
      SET status = 'TERMINATED',
          terminated_at = ?,
          last_error = ?
      WHERE status NOT IN ('TERMINATED', 'FAILED')
    `).run(now, `Global Kill-Switch: ${reason}`);
  }


  resetGlobalKillSwitch(): void {
    this.globalKillSwitchActive = false;
    this.killSwitchReason = null;
    logger.info('[BrowserSupervisor] Global kill-switch reset.');
  }

  // ── Provider Account Circuit-Breaker (Requirement 8) ──────────────────────

  getCircuitBreakerState(providerAccountId: string): CircuitBreakerState {
    const row = this.db.prepare(
      'SELECT circuit_breaker_state FROM revenue_browser_provider_accounts WHERE id = ?'
    ).get(providerAccountId) as any;

    if (!row || !row.circuit_breaker_state) {
      return { tripped: false, failureCount: 0 };
    }
    return typeof row.circuit_breaker_state === 'string'
      ? JSON.parse(row.circuit_breaker_state)
      : row.circuit_breaker_state;
  }

  setCircuitBreaker(providerAccountId: string, tripped: boolean, reason?: string, cooldownMinutes = 15): void {
    const now = new Date().toISOString();
    const cooldownUntil = tripped
      ? new Date(Date.now() + cooldownMinutes * 60_000).toISOString()
      : undefined;

    const state: CircuitBreakerState = {
      tripped,
      reason,
      trippedAt: tripped ? now : undefined,
      cooldownUntil,
      failureCount: tripped ? 5 : 0,
    };

    this.db.prepare(`
      UPDATE revenue_browser_provider_accounts
      SET circuit_breaker_state = ?,
          status = ?,
          updated_at = ?
      WHERE id = ?
    `).run(JSON.stringify(state), tripped ? 'circuit_broken' : 'active', now, providerAccountId);

    logger.info(`[BrowserSupervisor] Account '${providerAccountId}' circuit-breaker set to tripped=${tripped}.`);
  }

  // ── Worker Child-Process Lifecycle Management ──────────────────────────────

  /**
   * Spawns an isolated OS child process running the worker entrypoint.
   */
  async spawnWorker(options: SpawnWorkerOptions): Promise<ManagedWorkerHandle> {
    if (this.globalKillSwitchActive) {
      throw new Error(`Cannot spawn worker: Global Kill-Switch is ACTIVE (${this.killSwitchReason}).`);
    }

    const cb = this.getCircuitBreakerState(options.providerAccountId);
    if (cb.tripped) {
      if (cb.cooldownUntil && new Date(cb.cooldownUntil).getTime() > Date.now()) {
        throw new Error(
          `Cannot spawn worker: Circuit-breaker is TRIPPED for account '${options.providerAccountId}' until ${cb.cooldownUntil} (${cb.reason})`
        );
      } else {
        // Cooldown passed, auto-reset
        this.setCircuitBreaker(options.providerAccountId, false);
      }
    }

    const workerId = options.workerId ?? `bworker-${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    // 1. Record worker in DB
    this.db.prepare(`
      INSERT INTO revenue_browser_workers (
        id, provider_account_id, pid, status, consecutive_failures, spawned_at, created_at, updated_at
      ) VALUES (?, ?, NULL, 'SPAWNING', 0, ?, ?, ?)
    `).run(workerId, options.providerAccountId, now, now, now);

    // 2. Resolve worker entrypoint
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const tsEntry = path.join(currentDir, 'workerEntry.ts');
    const jsEntry = path.join(currentDir, 'workerEntry.js');
    const scriptToRun = fs.existsSync(tsEntry) ? tsEntry : jsEntry;

    let execArgv: string[] = [];
    if (scriptToRun.endsWith('.ts')) {
      try {
        const { createRequire } = await import('module');
        const { pathToFileURL } = await import('url');
        const req = createRequire(import.meta.url);
        const tsxResolved = req.resolve('tsx');
        execArgv = ['--import', pathToFileURL(tsxResolved).href];
      } catch {
        execArgv = ['--import', 'tsx'];
      }
    }

    // 3. Spawn OS child process via fork (Requirement 1: Isolated OS child process)
    const child = fork(scriptToRun, [], {
      execArgv,
      env: {
        ...process.env,
        BROWSER_WORKER_ID: workerId,
        BROWSER_PROVIDER_ACCOUNT_ID: options.providerAccountId,
      },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });


    const handle: ManagedWorkerHandle = {
      workerId,
      providerAccountId: options.providerAccountId,
      pid: child.pid,
      status: 'SPAWNING',
      lastHeartbeatAt: null,
      lastHeartbeatPayload: null,
      childProcess: child,
      isAlive: true,
    };

    this.activeWorkers.set(workerId, handle);

    // Update PID in DB
    if (child.pid) {
      this.db.prepare(`UPDATE revenue_browser_workers SET pid = ? WHERE id = ?`).run(child.pid, workerId);
    }

    child.stderr?.on('data', (d) => {
      console.error(`[Worker ${workerId} STDERR]`, d.toString());
    });
    child.stdout?.on('data', (d) => {
      console.log(`[Worker ${workerId} STDOUT]`, d.toString());
    });


    // 4. Wire IPC Message Handlers
    child.on('message', (msg: WorkerToSupervisorMessage) => {
      this.handleWorkerMessage(workerId, msg);
    });

    // 5. Wire Exit Handler (Requirement 6: Worker crash must NOT terminate supervisor)
    child.on('exit', (code, signal) => {
      handle.isAlive = false;
      const isExpected = handle.status === 'STOPPING' || handle.status === 'TERMINATED';
      const finalStatus: BrowserWorkerStatus = isExpected ? 'TERMINATED' : 'FAILED';
      handle.status = finalStatus;

      const exitNow = new Date().toISOString();
      try {
        this.db.prepare(`
          UPDATE revenue_browser_workers
          SET status = ?,
              terminated_at = ?,
              exit_code = ?,
              exit_signal = ?,
              updated_at = ?
          WHERE id = ?
        `).run(finalStatus, exitNow, code, signal ? String(signal) : null, exitNow, workerId);
      } catch (err: any) {
        logger.warn(`[BrowserSupervisor] DB update on exit error: ${err.message}`);
      }

      logger.info(
        `[BrowserSupervisor] Worker ${workerId} exited (code=${code}, signal=${signal}, expected=${isExpected}). Supervisor healthy.`
      );
    });

    child.on('error', (err) => {
      logger.error(`[BrowserSupervisor] Worker ${workerId} child process error: ${err.message}`);
      try {
        this.db.prepare(`
          UPDATE revenue_browser_workers
          SET last_error = ?, updated_at = ?
          WHERE id = ?
        `).run(err.message, new Date().toISOString(), workerId);
      } catch {}
    });

    // Wait for READY message from child (bounded timeout), checking if already ready
    if (handle.status !== 'IDLE') {
      const spawnTimeoutMs = options.spawnTimeoutMs ?? 5000;
      await new Promise<void>((resolve, reject) => {
        if (handle.status === 'IDLE') {
          resolve();
          return;
        }

        const timeout = setTimeout(() => {
          if (handle.status === 'SPAWNING') {
            handle.childProcess.kill('SIGKILL');
            reject(new Error(`Timed out waiting for worker ${workerId} to initialize (${spawnTimeoutMs}ms).`));
          }
        }, spawnTimeoutMs);

        const checkReady = (msg: WorkerToSupervisorMessage) => {
          if (msg.type === 'READY' && msg.workerId === workerId) {
            clearTimeout(timeout);
            child.off('message', checkReady);
            resolve();
          }
        };

        child.on('message', checkReady);
      });
    }

    // Send INIT config
    if (child.connected) {
      child.send({
        type: 'INIT',
        workerId,
        providerAccountId: options.providerAccountId,
        profilePath: options.profilePath || path.join('data', 'browser_profiles', options.providerAccountId),
        headless: options.headless ?? true,
      } satisfies SupervisorToWorkerMessage);
    }

    return handle;

  }

  /**
   * Processes state-aware heartbeats and messages from child process workers.
   */
  private handleWorkerMessage(workerId: string, msg: WorkerToSupervisorMessage): void {
    const worker = this.activeWorkers.get(workerId);
    const now = new Date().toISOString();

    switch (msg.type) {
      case 'READY': {
        if (worker) {
          worker.status = 'IDLE';
          worker.pid = msg.pid;
        }
        this.db.prepare(`
          UPDATE revenue_browser_workers
          SET status = 'IDLE', pid = ?, updated_at = ?
          WHERE id = ?
        `).run(msg.pid, now, workerId);
        break;
      }

      case 'HEARTBEAT': {
        if (worker) {
          worker.status = msg.payload.state;
          worker.lastHeartbeatAt = now;
          worker.lastHeartbeatPayload = msg.payload;
        }
        this.db.prepare(`
          UPDATE revenue_browser_workers
          SET status = ?,
              last_heartbeat_at = ?,
              heartbeat_payload = ?,
              updated_at = ?
          WHERE id = ?
        `).run(msg.payload.state, now, JSON.stringify(msg.payload), now, workerId);
        break;
      }

      case 'STATUS_CHANGE': {
        if (worker) {
          worker.status = msg.current;
        }
        this.db.prepare(`
          UPDATE revenue_browser_workers
          SET status = ?, updated_at = ?
          WHERE id = ?
        `).run(msg.current, now, workerId);
        break;
      }

      case 'SHUTDOWN_ACK': {
        if (worker) {
          worker.status = 'STOPPING';
        }
        break;
      }

      case 'ERROR': {
        if (worker) {
          worker.status = 'FAILED';
        }
        this.db.prepare(`
          UPDATE revenue_browser_workers
          SET last_error = ?, status = 'FAILED', updated_at = ?
          WHERE id = ?
        `).run(msg.error, now, workerId);
        break;
      }
    }
  }

  /**
   * Gracefully requests worker shutdown and waits for exit before timing out.
   */
  async requestGracefulShutdown(workerId: string, timeoutMs = 5000): Promise<boolean> {
    const worker = this.activeWorkers.get(workerId);
    if (!worker || !worker.isAlive || worker.childProcess.exitCode !== null) {
      this.activeWorkers.delete(workerId);
      return true;
    }

    worker.status = 'STOPPING';

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (worker.isAlive) {
          logger.warn(`[BrowserSupervisor] Worker ${workerId} did not exit within ${timeoutMs}ms. Force-killing.`);
          this.forceTerminate(workerId);
        }
        this.activeWorkers.delete(workerId);
        resolve(false);
      }, timeoutMs);

      worker.childProcess.once('exit', () => {
        clearTimeout(timer);
        this.activeWorkers.delete(workerId);
        resolve(true);
      });

      if (worker.childProcess.connected) {
        worker.childProcess.send({
          type: 'SHUTDOWN',
          reason: 'Graceful shutdown requested by supervisor',
        } satisfies SupervisorToWorkerMessage);
      } else {
        worker.childProcess.kill('SIGTERM');
      }
    });
  }


  /**
   * Force terminates a worker process immediately.
   */
  forceTerminate(workerId: string): void {
    const worker = this.activeWorkers.get(workerId);
    if (!worker) return;

    if (worker.isAlive) {
      try {
        worker.childProcess.kill('SIGKILL');
      } catch {}
    }
    worker.isAlive = false;
    worker.status = 'TERMINATED';
    this.activeWorkers.delete(workerId);

    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE revenue_browser_workers
      SET status = 'TERMINATED', terminated_at = ?, updated_at = ?
      WHERE id = ?
    `).run(now, now, workerId);
  }

  getWorker(workerId: string): ManagedWorkerHandle | undefined {
    return this.activeWorkers.get(workerId);
  }

  listActiveWorkers(): ManagedWorkerHandle[] {
    return Array.from(this.activeWorkers.values());
  }

  /**
   * Gracefully shuts down all active worker processes.
   */
  async shutdownAll(timeoutMs = 5000): Promise<void> {
    const workerIds = Array.from(this.activeWorkers.keys());
    await Promise.all(workerIds.map((id) => this.requestGracefulShutdown(id, timeoutMs)));
  }
}

