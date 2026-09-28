/**
 * Antigravity Worker Adapter for the Background Task Manager.
 *
 * Implements durable handoff to the signed-in local Antigravity Desktop Builder session:
 * 1. Discovers the local Antigravity Desktop Builder session and active conversation.
 * 2. Launches Antigravity Desktop if not running, or reports truthful blocking state.
 * 3. Dispatches durable handoff with real task IDs, timestamps, and structured trace events.
 * 4. Normalizes all execution progress into canonical BackgroundTaskEvent contract.
 * 5. Streams real tool calls and actions from transcript.jsonl into EngineeringWorkerRegistry.
 * 6. Enforces Phase 9 invariant: WORKER OUTPUT IS A CLAIM. EVIDENCE IS TRUTH.
 *    (WORKER_DONE transitions to VALIDATING_WORKER_OUTPUT, not completed).
 */

import { backgroundTaskManager } from './manager.js';
import { backgroundTaskRepo } from './store.js';
import { TERMINAL_STATUSES, type BackgroundTaskRecord } from './types.js';
import { antigravityProviderService } from '../antigravity/antigravityProviderService.js';
import { policyStore } from '../policy/policyStore.js';
import { mayLeaveMachine } from '../policy/policyService.js';
import { normalizeApprovalAction } from './approvalNormalization.js';
import { getWorkspaceRoot } from '../workspaceStore.js';
import { logger } from '../../utils/logger.js';
import { engineeringWorkerRegistry } from '../../domains/controlPlane/EngineeringWorkerRegistry.js';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export type ExecFileSyncFn = (file: string, args?: readonly string[], options?: any) => any;
export let execFileSyncRunner: ExecFileSyncFn = (file, args, options) => execFileSync(file, args as any, options);
export function setExecFileSyncRunnerForTesting(fn: ExecFileSyncFn): void {
  execFileSyncRunner = fn;
}

/** Guard against duplicate dispatch of the same task. */
const dispatchedAntigravity = new Set<string>();

export function clearAntigravityDispatchGuard(taskId: string): void {
  dispatchedAntigravity.delete(taskId);
  releaseAntigravityWorkerSlot(taskId);
}

export function resetAntigravityQueueForTesting(): void {
  dispatchedAntigravity.clear();
  activeAntigravityTaskId = null;
  antigravityDispatchQueue.length = 0;
  for (const [, p] of activeTranscriptPollers.entries()) {
    clearInterval(p);
  }
  activeTranscriptPollers.clear();
}

function markDispatched(taskId: string): boolean {
  if (dispatchedAntigravity.has(taskId)) return false;
  dispatchedAntigravity.add(taskId);
  return true;
}

export interface AntigravitySessionDiscovery {
  ok: boolean;
  activeConversationId?: string;
  agentapiPath?: string;
  desktopExePath?: string;
  error?: string;
  isDesktopRunning?: boolean;
}

/**
 * Resolves full environment for language_server.exe / agentapi, dynamically
 * extracting ANTIGRAVITY_LS_ADDRESS and ANTIGRAVITY_CSRF_TOKEN from logs if absent.
 */
export function resolveAntigravityEnv(): Record<string, string> {
  const userProfile = process.env.USERPROFILE || 'C:\\Users\\cd-pr';
  const localAppData = process.env.LOCALAPPDATA || path.join(userProfile, 'AppData', 'Local');
  const appData = process.env.APPDATA || path.join(userProfile, 'AppData', 'Roaming');

  let lsAddress = process.env.ANTIGRAVITY_LS_ADDRESS;
  let csrfToken = process.env.ANTIGRAVITY_CSRF_TOKEN;

  if (!lsAddress || !csrfToken) {
    try {
      const logsDir = path.join(appData, 'Antigravity', 'logs');
      if (fs.existsSync(logsDir)) {
        if (!lsAddress) {
          const lsLog = path.join(logsDir, 'language_server.log');
          if (fs.existsSync(lsLog)) {
            const content = fs.readFileSync(lsLog, 'utf8');
            const matches = [...content.matchAll(/Language server listening on random port at (\d+) for HTTP/g)];
            const last = matches[matches.length - 1];
            if (last && last[1]) {
              lsAddress = `127.0.0.1:${last[1]}`;
            }
          }
        }
        if (!csrfToken) {
          const mainLog = path.join(logsDir, 'main.log');
          if (fs.existsSync(mainLog)) {
            const content = fs.readFileSync(mainLog, 'utf8');
            const matches = [...content.matchAll(/--csrf_token[ =]([a-f0-9-]+)/gi)];
            const last = matches[matches.length - 1];
            if (last && last[1]) {
              csrfToken = last[1];
            }
          }
        }
      }
    } catch { /* best effort */ }
  }

  return {
    ...process.env,
    USERPROFILE: userProfile,
    LOCALAPPDATA: localAppData,
    APPDATA: appData,
    ...(lsAddress ? { ANTIGRAVITY_LS_ADDRESS: lsAddress } : {}),
    ...(csrfToken ? { ANTIGRAVITY_CSRF_TOKEN: csrfToken } : {}),
  } as Record<string, string>;
}

/**
 * Discovers the local signed-in Antigravity Desktop Builder session.
 */
export function discoverAntigravityDesktopSession(): AntigravitySessionDiscovery {
  const userProfile = process.env.USERPROFILE || 'C:\\Users\\cd-pr';

  const candidateAgentapis = [
    path.join(userProfile, '.gemini', 'antigravity-ide', 'bin', 'agentapi.bat'),
    path.join(userProfile, '.gemini', 'antigravity', 'bin', 'agentapi.bat'),
  ];
  const agentapiBat = candidateAgentapis.find(p => fs.existsSync(p)) || candidateAgentapis[0];

  const candidateDesktopExes = [
    path.join(userProfile, 'AppData', 'Local', 'Programs', 'Antigravity IDE', 'Antigravity.exe'),
    path.join(userProfile, 'AppData', 'Local', 'Programs', 'antigravity', 'Antigravity.exe'),
  ];
  const desktopExe = candidateDesktopExes.find(p => fs.existsSync(p)) || candidateDesktopExes[0];

  if (!fs.existsSync(agentapiBat)) {
    return { ok: false, error: `agentapi CLI not found at ${agentapiBat}`, desktopExePath: desktopExe };
  }

  const candidateConvDirs = [
    path.join(userProfile, '.gemini', 'antigravity-ide', 'conversations'),
    path.join(userProfile, '.gemini', 'antigravity', 'conversations'),
  ];
  const convDir = candidateConvDirs.find(d => fs.existsSync(d));
  if (!convDir) {
    return { ok: false, error: `Antigravity conversations directory not found in candidate paths`, agentapiPath: agentapiBat, desktopExePath: desktopExe };
  }

  let files: Array<{ name: string; mtime: number }> = [];
  try {
    files = fs.readdirSync(convDir)
      .filter(f => f.endsWith('.db'))
      .map(f => {
        try {
          return { name: f, mtime: fs.statSync(path.join(convDir, f)).mtime.getTime() };
        } catch {
          return { name: f, mtime: 0 };
        }
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch (err: any) {
    return { ok: false, error: `Failed to read Antigravity conversations: ${err?.message}`, agentapiPath: agentapiBat, desktopExePath: desktopExe };
  }

  if (files.length === 0) {
    return { ok: false, error: 'No Antigravity conversation sessions found', agentapiPath: agentapiBat, desktopExePath: desktopExe };
  }

  const activeConvId = files[0].name.replace(/\.db$/, '');

  const candidateLangServers = [
    path.join(userProfile, 'AppData', 'Local', 'Programs', 'Antigravity IDE', 'resources', 'app', 'extensions', 'antigravity', 'bin', 'language_server_windows_x64.exe'),
    path.join(userProfile, 'AppData', 'Local', 'Programs', 'antigravity', 'resources', 'bin', 'language_server.exe'),
  ];
  const langServerExe = candidateLangServers.find(p => fs.existsSync(p));

  try {
    const execEnv = resolveAntigravityEnv();
    let raw: string;
    if (langServerExe && fs.existsSync(langServerExe)) {
      raw = execFileSyncRunner(langServerExe, ['agentapi', 'get-conversation-metadata', activeConvId], {
        encoding: 'utf8',
        timeout: 8000,
        cwd: path.dirname(langServerExe),
        env: execEnv,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } else {
      raw = execFileSyncRunner(agentapiBat, ['get-conversation-metadata', activeConvId], {
        encoding: 'utf8',
        timeout: 8000,
        cwd: path.dirname(agentapiBat),
        env: execEnv,
        shell: true,
      });
    }
    const parsed = JSON.parse(raw);
    const rootId = parsed.response?.conversationMetadata?.metadata?.rootConversationId || activeConvId;
    return {
      ok: true,
      activeConversationId: rootId,
      agentapiPath: agentapiBat,
      desktopExePath: desktopExe,
      isDesktopRunning: true,
    };
  } catch (err: any) {
    logger.warn('[AntigravityAdapter] Failed to query Antigravity session', {
      activeConvId,
      error: err?.message,
      status: err?.status,
      signal: err?.signal,
      stderr: String(err?.stderr || '').trim(),
      stdout: String(err?.stdout || '').trim(),
    });
    return {
      ok: false,
      error: `Failed to query Antigravity session ${activeConvId}: ${err?.message || err} (status: ${err?.status}, stderr: ${String(err?.stderr || '').trim()})`,
      activeConversationId: activeConvId,
      agentapiPath: agentapiBat,
      desktopExePath: desktopExe,
      isDesktopRunning: false,
    };
  }
}

export const antigravitySessionDiscoveryProvider = {
  discover: discoverAntigravityDesktopSession,
};

/**
 * Resolves the structured transcript log file for an AntiGravity session.
 */
export function resolveTranscriptPath(convId: string): string | null {
  const userProfile = process.env.USERPROFILE || 'C:\\Users\\cd-pr';
  const candidateDirs = [
    path.join(userProfile, '.gemini', 'antigravity-ide', 'brain', convId, '.system_generated', 'logs', 'transcript.jsonl'),
    path.join(userProfile, '.gemini', 'antigravity', 'brain', convId, '.system_generated', 'logs', 'transcript.jsonl'),
  ];
  for (const p of candidateDirs) {
    if (fs.existsSync(p)) return p;
  }
  return candidateDirs[0];
}

/** Active pollers for live transcript event streaming */
const activeTranscriptPollers = new Map<string, NodeJS.Timeout>();

/**
 * Attaches a real-time transcript streaming listener to observe live AntiGravity execution.
 * Normalizes tool calls (view_file, run_command, replace_file_content) into canonical
 * task events and persists them into the EngineeringWorkerRegistry.
 */
export function attachAntigravityTranscriptListener(taskId: string, convId: string): void {
  // Clear any existing poller for this task
  if (activeTranscriptPollers.has(taskId)) {
    clearInterval(activeTranscriptPollers.get(taskId)!);
    activeTranscriptPollers.delete(taskId);
  }

  const transcriptPath = resolveTranscriptPath(convId);
  if (!transcriptPath) {
    logger.warn(`[AntigravityAdapter] Cannot resolve transcript path for session ${convId}`);
    return;
  }

  let lastLineCount = 0;
  if (fs.existsSync(transcriptPath)) {
    try {
      const initialContent = fs.readFileSync(transcriptPath, 'utf8');
      lastLineCount = initialContent.split('\n').filter(Boolean).length;
    } catch {
      lastLineCount = 0;
    }
  }

  const mgr = backgroundTaskManager;

  const poller = setInterval(async () => {
    try {
      const task = backgroundTaskRepo.getTask(taskId);
      if (!task || TERMINAL_STATUSES.has(task.status)) {
        clearInterval(poller);
        activeTranscriptPollers.delete(taskId);
        return;
      }

      if (!fs.existsSync(transcriptPath)) return;

      const content = fs.readFileSync(transcriptPath, 'utf8');
      const lines = content.split('\n').filter(Boolean);
      if (lines.length <= lastLineCount) return;

      const newLines = lines.slice(lastLineCount);
      lastLineCount = lines.length;

      for (const line of newLines) {
        try {
          const entry = JSON.parse(line.trim());
          const now = entry.created_at || new Date().toISOString();

          // 1. Tool Call Parsing (PLANNER_RESPONSE with tool_calls)
          if (entry.type === 'PLANNER_RESPONSE' && Array.isArray(entry.tool_calls) && entry.tool_calls.length > 0) {
            for (const tc of entry.tool_calls) {
              const toolName = tc.name || '';
              const args = tc.args || {};

              if (toolName === 'view_file' || toolName === 'read_url_content') {
                const targetPath = args.AbsolutePath || args.Url || '';
                engineeringWorkerRegistry.recordWorkerEvent({
                  taskId,
                  goalId: (task.metadata as any)?.goalId,
                  workerId: 'antigravity',
                  runId: convId,
                  eventType: 'FILE_READ',
                  file: targetPath,
                  timestamp: now,
                  metadata: { stepIndex: entry.step_index, tool: toolName },
                });
                mgr.appendEvent(taskId, 'task.file_read', `AntiGravity inspecting: ${path.basename(targetPath)}`, {
                  file: targetPath,
                  stepIndex: entry.step_index,
                });
              } else if (toolName === 'grep_search' || toolName === 'list_dir') {
                const searchTarget = args.SearchPath || args.DirectoryPath || '';
                engineeringWorkerRegistry.recordWorkerEvent({
                  taskId,
                  goalId: (task.metadata as any)?.goalId,
                  workerId: 'antigravity',
                  runId: convId,
                  eventType: 'FILE_SEARCH',
                  file: searchTarget,
                  command: args.Query,
                  timestamp: now,
                  metadata: { stepIndex: entry.step_index, query: args.Query },
                });
                mgr.appendEvent(taskId, 'task.file_read', `AntiGravity searching: ${args.Query || searchTarget}`, {
                  target: searchTarget,
                  query: args.Query,
                });
              } else if (toolName === 'run_command') {
                const cmd = args.CommandLine || '';
                const isTest = /vitest|jest|pytest|npm test|go test/i.test(cmd);
                const isBuild = /npm run build|vite build|tsc|npm run compile/i.test(cmd);

                const eventType = isTest ? 'TEST_STARTED' : isBuild ? 'BUILD_STARTED' : 'COMMAND_STARTED';
                engineeringWorkerRegistry.recordWorkerEvent({
                  taskId,
                  goalId: (task.metadata as any)?.goalId,
                  workerId: 'antigravity',
                  runId: convId,
                  eventType,
                  command: cmd,
                  file: args.Cwd,
                  timestamp: now,
                  metadata: { stepIndex: entry.step_index },
                });

                const taskEventKind = isTest ? 'task.test_started' : isBuild ? 'task.build_started' : 'task.command';
                mgr.appendEvent(taskId, taskEventKind, `AntiGravity executing: ${cmd.slice(0, 120)}`, {
                  command: cmd,
                  cwd: args.Cwd,
                  stepIndex: entry.step_index,
                });
              } else if (toolName === 'replace_file_content' || toolName === 'multi_replace_file_content' || toolName === 'write_to_file') {
                const targetFile = args.TargetFile || '';
                engineeringWorkerRegistry.recordWorkerEvent({
                  taskId,
                  goalId: (task.metadata as any)?.goalId,
                  workerId: 'antigravity',
                  runId: convId,
                  eventType: 'FILE_EDITED',
                  file: targetFile,
                  timestamp: now,
                  metadata: { stepIndex: entry.step_index, description: args.Description },
                });

                const currentTask = backgroundTaskRepo.getTask(taskId);
                if (currentTask && targetFile) {
                  const merged = [...new Set([...(currentTask.filesChanged || []), String(targetFile)])];
                  backgroundTaskRepo.updateTask(taskId, { filesChanged: merged });
                }

                mgr.appendEvent(taskId, 'task.file_changed', `AntiGravity edited: ${path.basename(targetFile)}`, {
                  file: targetFile,
                  description: args.Description,
                });
              }
            }
          }

          // 2. Command Execution Output
          if (entry.type === 'RUN_COMMAND') {
            const exitCode = entry.exit_code ?? 0;
            const isSuccess = exitCode === 0;

            engineeringWorkerRegistry.recordWorkerEvent({
              taskId,
              goalId: (task.metadata as any)?.goalId,
              workerId: 'antigravity',
              runId: convId,
              eventType: isSuccess ? 'COMMAND_OUTPUT' : 'COMMAND_FAILED',
              output: typeof entry.content === 'string' ? entry.content.slice(0, 500) : '',
              exitCode,
              timestamp: now,
              metadata: { stepIndex: entry.step_index },
            });

            mgr.appendEvent(taskId, 'task.progress', `Command finished (exit code ${exitCode})`, {
              exitCode,
              stepIndex: entry.step_index,
            });
          }

          // 3. Worker Concludes Execution Turn (PLANNER_RESPONSE without further tool calls)
          if (entry.type === 'PLANNER_RESPONSE' && (!entry.tool_calls || entry.tool_calls.length === 0)) {
            const resultSummary = typeof entry.content === 'string' ? entry.content : 'AntiGravity completed turn.';

            engineeringWorkerRegistry.recordWorkerEvent({
              taskId,
              goalId: (task.metadata as any)?.goalId,
              workerId: 'antigravity',
              runId: convId,
              eventType: 'WORKER_DONE',
              output: resultSummary.slice(0, 300),
              timestamp: now,
              metadata: { stepIndex: entry.step_index },
            });

            mgr.appendEvent(taskId, 'task.worker_done', 'AntiGravity finished execution — transitioning to validation.', {
              resultSummary: resultSummary.slice(0, 500),
            });

            // Phase 9: WORKER OUTPUT IS A CLAIM. EVIDENCE IS TRUTH.
            // Transition to validating_worker_output, NOT completed.
            mgr.transition(taskId, 'validating_worker_output', {
              currentStage: 'validating_worker_output',
              progressMessage: 'Validating AntiGravity worker execution evidence…',
            });

            clearInterval(poller);
            activeTranscriptPollers.delete(taskId);
            releaseAntigravityWorkerSlot(taskId);

            // Trigger CompletionContract evaluation
            mgr.verifyCompletion(taskId, {
              resultText: resultSummary,
              readOnly: false,
              verificationNote: `AntiGravity execution finished in session ${convId}. Validating contract.`,
            });
          }
        } catch {
          // ignore corrupted single lines
        }
      }
    } catch (err: any) {
      logger.warn(`[AntigravityAdapter] Poller error for ${taskId}: ${err?.message}`);
    }
  }, 400);

  activeTranscriptPollers.set(taskId, poller);
}

// ── Task Isolation: Serialized Worker Queue ──────────────────────────────────
interface AntigravityQueueItem {
  taskId: string;
  run: () => Promise<{ ok: boolean; error?: string; handoffId?: string; conversationId?: string }>;
  resolve: (val: { ok: boolean; error?: string; handoffId?: string; conversationId?: string }) => void;
  reject: (err: any) => void;
}

const antigravityDispatchQueue: AntigravityQueueItem[] = [];
let activeAntigravityTaskId: string | null = null;

function processNextInQueue(): void {
  if (activeAntigravityTaskId || antigravityDispatchQueue.length === 0) return;
  const next = antigravityDispatchQueue.shift();
  if (!next) return;

  activeAntigravityTaskId = next.taskId;
  next.run()
    .then((res) => {
      next.resolve(res);
      if (!res.ok) {
        releaseAntigravityWorkerSlot(next.taskId);
      }
    })
    .catch((err) => {
      releaseAntigravityWorkerSlot(next.taskId);
      next.reject(err);
    });
}

export function releaseAntigravityWorkerSlot(taskId?: string): void {
  if (!taskId || activeAntigravityTaskId === taskId) {
    activeAntigravityTaskId = null;
    processNextInQueue();
  }
}

export function getAntigravityQueueStatus(): { activeTaskId: string | null; queueLength: number } {
  return {
    activeTaskId: activeAntigravityTaskId,
    queueLength: antigravityDispatchQueue.length,
  };
}

export function dispatchAntigravityTask(
  task: BackgroundTaskRecord,
  workspaceRoot?: string
): Promise<{ ok: boolean; error?: string; handoffId?: string; conversationId?: string }> {
  if (!markDispatched(task.taskId)) return Promise.resolve({ ok: false, error: 'Task already dispatched.' });

  return new Promise((resolve, reject) => {
    antigravityDispatchQueue.push({
      taskId: task.taskId,
      run: () => executeAntigravityDispatch(task, workspaceRoot),
      resolve,
      reject,
    });
    processNextInQueue();
  });
}

async function executeAntigravityDispatch(
  task: BackgroundTaskRecord,
  workspaceRoot?: string
): Promise<{ ok: boolean; error?: string; handoffId?: string; conversationId?: string }> {
  const mgr = backgroundTaskManager;

  try {
    const root = workspaceRoot || task.workspaceRoot || getWorkspaceRoot();
    const policy = (policyStore as any).getEffectivePolicy
      ? (policyStore as any).getEffectivePolicy(task.projectId)
      : policyStore.getPolicy(task.projectId);

    if (policy) {
      const policyTruth = {
        privacy: policy.privacy,
        runtime: policy.runtime,
        cloudEscalation: policy.cloudEscalation,
        escalationAllowed: mayLeaveMachine(policy),
        localOnly: policy.runtime === 'localOnly',
        recordedAt: new Date().toISOString(),
      };

      backgroundTaskRepo.updateTask(task.taskId, {
        metadata: { ...(task.metadata || {}), policy: policyTruth, worker: 'antigravity' },
      });

      // 1. Policy Enforcement
      if (!mayLeaveMachine(policy)) {
        const reason = policy.runtime === 'localOnly'
          ? 'Policy violation blocked: runtime=localOnly but Antigravity executes on cloud-hosted Gemini infrastructure.'
          : `Policy violation blocked: privacy=${policy.privacy} content may not leave the machine.`;

        mgr.appendEvent(task.taskId, 'task.progress', reason, { policy: policyTruth });
        mgr.transition(task.taskId, 'blocked', {
          currentStage: 'policy-block',
          progressMessage: reason,
          blocker: reason,
          resumable: true,
        });
        return { ok: false, error: reason };
      }
    }

    // 2. Discover Desktop Builder Session
    mgr.transition(task.taskId, 'planning', {
      currentStage: 'discovering_session',
      progressMessage: 'Discovering local Antigravity Desktop Builder session…',
    });

    let session = antigravitySessionDiscoveryProvider.discover();

    if (!session.ok && session.desktopExePath && fs.existsSync(session.desktopExePath)) {
      try {
        logger.info(`[AntigravityAdapter] Attempting to launch Antigravity Desktop at ${session.desktopExePath}`);
        const child = spawn(session.desktopExePath, [], { detached: true, stdio: 'ignore' });
        child.unref();
        await new Promise(r => setTimeout(r, 2000));
        session = antigravitySessionDiscoveryProvider.discover();
      } catch (launchErr: any) {
        logger.warn(`[AntigravityAdapter] Could not launch Antigravity Desktop: ${launchErr?.message}`);
      }
    }

    if (!session.ok || !session.activeConversationId) {
      const reason = `Antigravity Desktop Builder session is unavailable: ${session.error || 'Not running'}. Please launch Antigravity Desktop to connect.`;
      mgr.appendEvent(task.taskId, 'task.progress', reason, {
        sessionDiscovery: session,
      });
      mgr.transition(task.taskId, 'blocked', {
        currentStage: 'session_unavailable',
        progressMessage: reason,
        blocker: reason,
        resumable: true,
      });
      return { ok: false, error: reason };
    }

    const convId = session.activeConversationId;

    mgr.appendEvent(task.taskId, 'task.agent_selected', 'Worker: Antigravity Desktop Builder (Local Signed-In Session)', {
      worker: 'antigravity',
      sessionMode: 'desktop_builder',
      conversationId: convId,
      agentapiPath: session.agentapiPath,
      workspaceRoot: root,
    });

    const handoffPayload = {
      taskId: task.taskId,
      title: task.title,
      objective: task.objective || task.originalRequest,
      workspaceRoot: root,
      handoffTimestamp: new Date().toISOString(),
      conversationId: convId,
    };

    mgr.appendEvent(task.taskId, 'task.handoff_initiated', `Initiating durable handoff of task ${task.taskId} to Antigravity session ${convId}`, handoffPayload);

    const scratchDir = path.join(root, '.agentic', 'handoffs');
    try {
      if (!fs.existsSync(scratchDir)) {
        fs.mkdirSync(scratchDir, { recursive: true });
      }
      fs.writeFileSync(
        path.join(scratchDir, `${task.taskId}.json`),
        JSON.stringify(handoffPayload, null, 2),
        'utf8'
      );
    } catch { /* best effort */ }

    // 3. Deliver message over language server agentapi transport
    let messageDelivered = false;
    let transportError: string | null = null;
    if (session.agentapiPath) {
      try {
        const userProfile = process.env.USERPROFILE || 'C:\\Users\\cd-pr';
        const candidateLangServers = [
          path.join(userProfile, 'AppData', 'Local', 'Programs', 'Antigravity IDE', 'resources', 'app', 'extensions', 'antigravity', 'bin', 'language_server_windows_x64.exe'),
          path.join(userProfile, 'AppData', 'Local', 'Programs', 'antigravity', 'resources', 'bin', 'language_server.exe'),
        ];
        const langServerExe = candidateLangServers.find(p => fs.existsSync(p));

        const cleanTitle = (task.title || 'Task').replace(/["\r\n]/g, ' ').slice(0, 80);
        const cleanObjective = (handoffPayload.objective || '').replace(/[\r\n]+/g, ' ').slice(0, 300);
        const messageText = `[AgenticOS Jarvis Handoff] Task: ${cleanTitle} | ID: ${task.taskId} | Workspace: ${root} | Objective: ${cleanObjective}`;

        const execEnv = resolveAntigravityEnv();

        if (langServerExe && fs.existsSync(langServerExe)) {
          execFileSyncRunner(langServerExe, ['agentapi', 'send-message', `--title=${cleanTitle}`, convId, messageText], {
            encoding: 'utf8',
            timeout: 12000,
            cwd: path.dirname(langServerExe),
            env: execEnv,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
          });
        } else {
          execFileSyncRunner(session.agentapiPath, ['send-message', `"--title=${cleanTitle}"`, convId, `"${messageText}"`], {
            encoding: 'utf8',
            timeout: 10000,
            cwd: path.dirname(session.agentapiPath),
            env: execEnv,
            shell: true,
          });
        }
        messageDelivered = true;
        mgr.appendEvent(task.taskId, 'task.handoff_delivered', `Handoff message delivered via agentapi to Antigravity session ${convId}`, {
          conversationId: convId,
          taskId: task.taskId,
        });
      } catch (err: any) {
        transportError = err?.message || String(err);
        logger.warn(`[AntigravityAdapter] agentapi send-message failed: ${transportError}`);
      }
    }

    if (!messageDelivered) {
      const blockReason = `Antigravity handoff blocked: failed to deliver message over language-server transport (${transportError || 'agentapi transport failed'}).`;
      mgr.appendEvent(task.taskId, 'task.progress', blockReason, { transportError });
      mgr.transition(task.taskId, 'blocked', {
        currentStage: 'transport_failed',
        progressMessage: blockReason,
        blocker: blockReason,
        resumable: true,
      });
      return { ok: false, error: blockReason };
    }

    // 4. Record WORKER_ACCEPTED and REPOSITORY_OPENED in EngineeringWorkerRegistry
    engineeringWorkerRegistry.recordWorkerEvent({
      taskId: task.taskId,
      goalId: (task.metadata as any)?.goalId,
      workerId: 'antigravity',
      runId: convId,
      eventType: 'WORKER_ACCEPTED',
      metadata: { conversationId: convId, taskId: task.taskId },
    });

    engineeringWorkerRegistry.recordWorkerEvent({
      taskId: task.taskId,
      goalId: (task.metadata as any)?.goalId,
      workerId: 'antigravity',
      runId: convId,
      eventType: 'REPOSITORY_OPENED',
      file: root,
      metadata: { workspaceRoot: root },
    });

    // 5. Update Task Record & Transition to WORKER_ACCEPTED then EXECUTING
    backgroundTaskRepo.updateTask(task.taskId, {
      linkedRunId: convId,
      resumable: true,
      metadata: {
        ...(task.metadata || {}),
        worker: 'antigravity',
        antigravitySessionId: convId,
        handoffPath: path.join(scratchDir, `${task.taskId}.json`),
        handedOffAt: handoffPayload.handoffTimestamp,
      },
    });

    mgr.appendEvent(task.taskId, 'task.worker_accepted', `AntiGravity accepted task in session ${convId}`, {
      conversationId: convId,
      workspaceRoot: root,
    });

    mgr.transition(task.taskId, 'worker_accepted', {
      currentStage: 'worker_accepted',
      progressMessage: `AntiGravity accepted task in session ${convId}`,
    });

    mgr.transition(task.taskId, 'executing', {
      currentStage: 'executing',
      progressMessage: `AntiGravity executing task in session ${convId}…`,
    });

    // Register user controls
    mgr.registerWorkerHandlers(task.taskId, {
      stop: async () => {
        if (activeTranscriptPollers.has(task.taskId)) {
          clearInterval(activeTranscriptPollers.get(task.taskId)!);
          activeTranscriptPollers.delete(task.taskId);
        }
        const current = backgroundTaskRepo.getTask(task.taskId);
        if (current && !TERMINAL_STATUSES.has(current.status)) {
          mgr.transition(task.taskId, 'cancelled', { blocker: 'Stopped by user — Antigravity execution cancelled.' });
        }
      },
      pause: async () => {
        // Pauses listener event ingestion
        if (activeTranscriptPollers.has(task.taskId)) {
          clearInterval(activeTranscriptPollers.get(task.taskId)!);
          activeTranscriptPollers.delete(task.taskId);
        }
        mgr.transition(task.taskId, 'paused', { blocker: 'Paused by user.' });
      },
      resume: async () => {
        mgr.transition(task.taskId, 'executing', { progressMessage: 'Resumed AntiGravity execution monitoring.' });
        attachAntigravityTranscriptListener(task.taskId, convId);
      },
    });

    // 6. Attach real-time transcript streaming listener
    attachAntigravityTranscriptListener(task.taskId, convId);

    return { ok: true, handoffId: task.taskId, conversationId: convId };
  } catch (err: any) {
    logger.error(`[AntigravityAdapter] Dispatch failed for ${task.taskId}: ${err?.message}`);
    mgr.transition(task.taskId, 'failed', {
      lastError: `Antigravity dispatch failed: ${err?.message}`,
      blocker: `Antigravity dispatch failed: ${err?.message}`,
    });
    return { ok: false, error: err?.message };
  }
}
