/**
 * workerEntry.ts — Child-process execution skeleton for an isolated browser revenue worker.
 *
 * Requirements:
 * - Runs as an isolated OS child process.
 * - Communicates with supervisor exclusively via IPC.
 * - Emits state-aware heartbeats.
 * - Handles graceful shutdown and global kill signals.
 * - Does NOT perform autonomous site actions yet (Phase 1 skeleton).
 */

import type { SupervisorToWorkerMessage, WorkerToSupervisorMessage, BrowserWorkerStatus, StateAwareHeartbeatPayload } from './types.js';

let workerId: string = process.env.BROWSER_WORKER_ID || 'worker-unknown';
let providerAccountId: string = process.env.BROWSER_PROVIDER_ACCOUNT_ID || 'account-unknown';
let currentStatus: BrowserWorkerStatus = 'SPAWNING';
let heartbeatTimer: NodeJS.Timeout | null = null;
let currentTaskId: string | undefined;

function sendToSupervisor(msg: WorkerToSupervisorMessage): void {
  if (process.send) {
    process.send(msg);
  }
}

function updateStatus(newStatus: BrowserWorkerStatus): void {
  const previous = currentStatus;
  currentStatus = newStatus;
  sendToSupervisor({
    type: 'STATUS_CHANGE',
    workerId,
    previous,
    current: newStatus,
  });
}

function startHeartbeat(intervalMs = 5000): void {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    const memUsage = process.memoryUsage();
    const payload: StateAwareHeartbeatPayload = {
      state: currentStatus,
      currentTaskId,
      memMb: Math.round(memUsage.rss / (1024 * 1024)),
      timestamp: new Date().toISOString(),
    };
    sendToSupervisor({
      type: 'HEARTBEAT',
      workerId,
      payload,
    });
  }, intervalMs);
}

// IPC Message Router
process.on('message', async (message: SupervisorToWorkerMessage) => {
  try {
    switch (message.type) {
      case 'INIT': {
        workerId = message.workerId;
        providerAccountId = message.providerAccountId;
        updateStatus('IDLE');
        startHeartbeat(2000); // 2s heartbeat in worker skeleton
        sendToSupervisor({
          type: 'READY',
          workerId,
          pid: process.pid,
        });
        break;
      }

      case 'SHUTDOWN': {
        updateStatus('STOPPING');
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        sendToSupervisor({
          type: 'SHUTDOWN_ACK',
          workerId,
        });
        setTimeout(() => process.exit(0), 100);
        break;
      }

      case 'GLOBAL_KILL': {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        process.exit(137); // Simulated SIGKILL exit code
        break;
      }

      case 'EXECUTE_TEST_SUICIDE': {
        // Intentionally simulate an unexpected worker process crash
        process.exit(1);
        break;
      }
    }
  } catch (err: any) {
    sendToSupervisor({
      type: 'ERROR',
      workerId,
      error: err?.message || 'Worker runtime exception',
    });
  }
});

// Notify parent on uncaught errors
process.on('uncaughtException', (err) => {
  sendToSupervisor({
    type: 'ERROR',
    workerId,
    error: `Uncaught: ${err.message}`,
  });
  process.exit(1);
});

// If launched with env vars already set, emit ready
if (process.env.BROWSER_WORKER_ID) {
  updateStatus('IDLE');
  startHeartbeat(2000);
  sendToSupervisor({
    type: 'READY',
    workerId,
    pid: process.pid,
  });
}

// ── Orphan Prevention ───────────────────────────────────────────────────────
// If parent process terminates, IPC disconnects: exit immediately to prevent orphan processes
process.on('disconnect', () => {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  process.exit(0);
});

process.on('SIGTERM', () => {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  process.exit(0);
});

process.on('SIGINT', () => {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  process.exit(0);
});

