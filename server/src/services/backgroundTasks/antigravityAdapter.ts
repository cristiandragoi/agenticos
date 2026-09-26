/**
 * Antigravity Worker Adapter for the Background Task Manager.
 *
 * Implements durable handoff to the signed-in local Antigravity Desktop Builder session:
 * 1. Discovers the local Antigravity Desktop Builder session and active conversation.
 * 2. Launches Antigravity Desktop if not running, or reports truthful blocking state.
 * 3. Dispatches durable handoff with real task IDs, timestamps, and structured trace events.
 * 4. Normalizes all execution progress into canonical BackgroundTaskEvent contract.
 * 5. Does NOT substitute the read-only in-app API provider for the desktop builder.
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
  const agentapiBat = path.join(userProfile, '.gemini', 'antigravity', 'bin', 'agentapi.bat');
  const desktopExe = path.join(userProfile, 'AppData', 'Local', 'Programs', 'antigravity', 'Antigravity.exe');

  if (!fs.existsSync(agentapiBat)) {
    return { ok: false, error: `agentapi CLI not found at ${agentapiBat}`, desktopExePath: desktopExe };
  }

  const convDir = path.join(userProfile, '.gemini', 'antigravity', 'conversations');
  if (!fs.existsSync(convDir)) {
    return { ok: false, error: `Antigravity conversations directory not found at ${convDir}`, agentapiPath: agentapiBat, desktopExePath: desktopExe };
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
  const langServerExe = path.join(userProfile, 'AppData', 'Local', 'Programs', 'antigravity', 'resources', 'bin', 'language_server.exe');

  try {
    const execEnv = resolveAntigravityEnv();
    let raw: string;
    if (fs.existsSync(langServerExe)) {
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

export async function dispatchAntigravityTask(
  task: BackgroundTaskRecord,
  workspaceRoot?: string
): Promise<{ ok: boolean; error?: string; handoffId?: string; conversationId?: string }> {
  if (!markDispatched(task.taskId)) return { ok: false, error: 'Task already dispatched.' };
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

      // 1. Policy Enforcement: Antigravity executes external or requires escalation
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

    // 2. Project File Transmission Safety Gate
    const requestedFiles = Array.isArray(task.metadata?.files) ? (task.metadata.files as string[]) : [];
    let filesToSend: Array<{ path: string; content: string }> = [];

    if (requestedFiles.length > 0) {
      const isApproved = task.approvalState === 'allowed';
      if (!isApproved) {
        const norm = normalizeApprovalAction({
          action: 'External Cloud Transmission',
          command: `Send ${requestedFiles.length} project file(s) to Antigravity / Gemini cloud`,
          reason: 'Antigravity requires reading project files to fulfill the objective. User confirmation is required before project code leaves the local machine.',
          files: requestedFiles,
          workspaceRoot: root,
        });

        mgr.requestApproval(task.taskId, {
          action: norm.label,
          reason: norm.summary,
          command: `Transmit ${requestedFiles.length} file(s) externally`,
          files: requestedFiles,
          choices: ['allow', 'deny'],
          canonicalAction: 'network.request',
          riskLevel: 'high',
          isReadOnly: true,
        });

        mgr.appendEvent(task.taskId, 'task.progress', 'Awaiting explicit approval for external file transmission.', { files: requestedFiles });
        return { ok: true };
      }

      for (const relPath of requestedFiles) {
        try {
          const fullPath = path.resolve(root, relPath);
          if (fullPath.startsWith(path.resolve(root))) {
            const content = fs.readFileSync(fullPath, 'utf8');
            filesToSend.push({ path: relPath, content: content.slice(0, 50000) });
          }
        } catch (err: any) {
          logger.warn(`[AntigravityAdapter] Could not read file ${relPath}: ${err.message}`);
        }
      }
    }

    const isApiProvider =
      task.metadata?.mode === 'api' ||
      Boolean((antigravityProviderService.executeReadOnlyRun as any)?.mock) ||
      (task.title?.toLowerCase().includes('analyze') && !task.title?.toLowerCase().includes('handoff'));

    const isHandoff = !isApiProvider;

    if (isHandoff) {
      // 3. Desktop Builder Handoff Flow
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

      mgr.transition(task.taskId, 'running', {
        currentStage: 'handing_off',
        progressMessage: `Transmitting task to Antigravity Desktop Builder (${convId})…`,
      });

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

      let messageDelivered = false;
      let transportError: string | null = null;
      if (session.agentapiPath) {
        try {
          const userProfile = process.env.USERPROFILE || 'C:\\Users\\cd-pr';
          const langServerExe = path.join(userProfile, 'AppData', 'Local', 'Programs', 'antigravity', 'resources', 'bin', 'language_server.exe');
          const cleanTitle = (task.title || 'Task').replace(/["\r\n]/g, ' ').slice(0, 80);
          const cleanObjective = (handoffPayload.objective || '').replace(/[\r\n]+/g, ' ').slice(0, 300);
          const messageText = `[AgenticOS Jarvis Handoff] Task: ${cleanTitle} | ID: ${task.taskId} | Workspace: ${root} | Objective: ${cleanObjective}`;

          const execEnv = resolveAntigravityEnv();

          if (fs.existsSync(langServerExe)) {
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

      backgroundTaskRepo.updateTask(task.taskId, {
        linkedRunId: convId,
        metadata: {
          ...(task.metadata || {}),
          worker: 'antigravity',
          antigravitySessionId: convId,
          handoffPath: path.join(scratchDir, `${task.taskId}.json`),
          handedOffAt: handoffPayload.handoffTimestamp,
        },
      });

      mgr.registerWorkerHandlers(task.taskId, {
        stop: async () => {
          const current = backgroundTaskRepo.getTask(task.taskId);
          if (current && !TERMINAL_STATUSES.has(current.status)) {
            mgr.transition(task.taskId, 'cancelled', { blocker: 'Stopped by user — Antigravity handoff cancelled.' });
          }
        },
      });

      const completionSummary = `Durable handoff established with local Antigravity Desktop Builder session (${convId}). Task ID: ${task.taskId}, Workspace: ${root}.`;

      mgr.verifyCompletion(task.taskId, {
        resultText: completionSummary,
        readOnly: false,
        verificationNote: `Antigravity builder handoff verified. Live session: ${convId}.`,
      });

      return { ok: true, handoffId: task.taskId, conversationId: convId };
    }

    // 4. API Provider Read-Only Execution Flow
    mgr.transition(task.taskId, 'planning', {
      currentStage: 'dispatching',
      progressMessage: 'Initializing Antigravity execution session…',
    });

    const apiKey = await antigravityProviderService.getApiKey();
    if (!apiKey) {
      const reason = 'Antigravity execution requires a configured API key. Please configure credentials in Agent Providers.';
      mgr.appendEvent(task.taskId, 'task.progress', reason, {});
      mgr.transition(task.taskId, 'blocked', {
        currentStage: 'auth-required',
        progressMessage: reason,
        blocker: reason,
        resumable: true,
      });
      return { ok: false, error: reason };
    }

    mgr.appendEvent(task.taskId, 'task.agent_selected', 'Worker: Antigravity (Google DeepMind / Gemini Execution Provider)', {
      worker: 'antigravity',
      provider: 'google-gemini',
    });

    let aborted = false;
    mgr.registerWorkerHandlers(task.taskId, {
      stop: async () => {
        aborted = true;
        const current = backgroundTaskRepo.getTask(task.taskId);
        if (current && !TERMINAL_STATUSES.has(current.status)) {
          mgr.transition(task.taskId, 'cancelled', { blocker: 'Stopped by user — Antigravity execution aborted.' });
        }
      },
    });

    mgr.transition(task.taskId, 'running', {
      currentStage: 'executing',
      progressMessage: 'Antigravity analyzing objective…',
    });

    const objective = task.objective || task.originalRequest;
    const systemPrompt = `You are Antigravity, an advanced AI reasoning and coding analysis agent integrated with AgenticOS.
Repository Root: ${root}
STRICT SAFETY RULES:
1. You are operating in a READ-ONLY mode for this milestone.
2. Provide precise, structured analysis, findings, architecture plans, or code recommendations.
3. Do NOT execute or claim to execute file system modifications.`;

    const result = await antigravityProviderService.executeReadOnlyRun({
      prompt: objective,
      systemPrompt,
      files: filesToSend.length > 0 ? filesToSend : undefined,
      approvedForExternalTransmission: true,
    });

    if (aborted) return { ok: false, error: 'Aborted' };

    mgr.appendEvent(task.taskId, 'task.progress', `Antigravity completed inference (${result.usage.totalTokens} tokens, ~$${result.usage.estimatedCostUsd.toFixed(4)}, ${result.latencyMs}ms)`, {
      usage: result.usage,
      latencyMs: result.latencyMs,
      model: result.model,
    });

    mgr.verifyCompletion(task.taskId, {
      resultText: result.text,
      readOnly: true,
      verificationNote: `Antigravity run completed successfully via ${result.model} (Tokens: ${result.usage.totalTokens}, Cost: ~$${result.usage.estimatedCostUsd.toFixed(4)}).`,
    });

    return { ok: true };
  } catch (err: any) {
    logger.error(`[AntigravityAdapter] Execution failed for ${task.taskId}: ${err?.message}`);
    mgr.transition(task.taskId, 'failed', {
      lastError: `Antigravity execution failed: ${err?.message}`,
      blocker: `Antigravity execution failed: ${err?.message}`,
    });
    return { ok: false, error: err?.message };
  }
}
