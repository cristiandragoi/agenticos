/**
 * Antigravity Worker Adapter for the Background Task Manager.
 *
 * Implements the separate execution-provider abstraction for Antigravity:
 * 1. Policy & file-transmission safety: requires explicit approval before project files leave the machine.
 * 2. Strict read-only enforcement: cannot modify files or mutate git repository.
 * 3. Enforces configurable limits: max tokens, max cost, timeout, 0 retries.
 * 4. Normalizes all execution progress into canonical BackgroundTaskEvent contract.
 */

import { backgroundTaskManager } from './manager.js';
import { backgroundTaskRepo } from './store.js';
import { TERMINAL_STATUSES, type BackgroundTaskRecord } from './types.js';
import { antigravityProviderService } from '../antigravity/antigravityProviderService.js';
import { policyStore } from '../policy/policyStore.js';
import { mayLeaveMachine } from '../policy/policyService.js';
import { getWorkspaceRoot } from '../workspaceStore.js';
import { logger } from '../../utils/logger.js';
import { normalizeApprovalAction } from './approvalNormalization.js';
import fs from 'node:fs';
import path from 'node:path';

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

export async function dispatchAntigravityTask(
  task: BackgroundTaskRecord,
  workspaceRoot?: string
): Promise<{ ok: boolean; error?: string }> {
  if (!markDispatched(task.taskId)) return { ok: false, error: 'Task already dispatched.' };
  const mgr = backgroundTaskManager;

  try {
    const root = workspaceRoot || task.workspaceRoot || getWorkspaceRoot();
    const policy = policyStore.getPolicy(task.projectId);
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

    // 1. Policy Enforcement: Antigravity is a cloud execution provider
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

    mgr.transition(task.taskId, 'planning', {
      currentStage: 'dispatching',
      progressMessage: 'Initializing Antigravity execution session…',
    });

    // 2. Check Credential Configuration
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

    // 3. Project File Transmission Safety Gate:
    // If files are to be sent externally, require explicit user approval.
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

      // If approved, safely read the files inside workspace root
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

    // 4. Register worker stop handler
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

    // 5. Execute read-only Antigravity run
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

    // 6. Complete and verify task
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
