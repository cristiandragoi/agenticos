import { conversationService } from '../conversations/service.js';
import { intentRouter, type IntentResult } from './intentRouter.js';
import { codexService } from '../codex/service.js';
import { llmChat, OLLAMA_DEFAULT_CODING_MODEL } from '../../services/llmGateway.js';
import { coordinatorService } from '../teams/coordinatorService.js';
import { detectGitRepository } from '../../utils/workspaceValidation.js';
import { AgentProviderAssignmentService } from '../../services/agent/assignments.js';

import { z } from 'zod';

const TeamPreviewMetadataSchema = z.object({
  teamId: z.string(),
  conversationId: z.string(),
  previewStatus: z.string(),
  teamSheet: z.any(),
  createdAt: z.string()
});

const NO_WORKSPACE_ERROR = 'No repository selected. Choose a valid workspace in the workspace bar before starting CodeX or Agent Team work.';

export interface OrchestratorResult {
  route: string;
  goalId?: string;
  teamId?: string;
  status?: string;
  error?: string;
  operationId?: string;
  provider?: string;
  model?: string;
  fallbackProvider?: string;
  fallbackModel?: string;
}

export class JarvisOrchestrator {
  
  async handleMessage(
    conversationId: string,
    prompt: string,
    workspacePath: string,
    approvalPolicy: 'manual' | 'auto',
    operationId?: string,
    preclassifiedIntent?: IntentResult
  ): Promise<OrchestratorResult> {
    const requestMetadata = operationId ? { operationId } : undefined;

    // 1. Append user message
    await conversationService.appendMessage({
      conversationId,
      role: 'user',
      content: prompt,
      metadata: requestMetadata
    });

    // 2. Route intent (context-aware: recent turns resolve deictic refs).
    let recentText = '';
    try {
      const msgs = await conversationService.getMessages(conversationId);
      recentText = (Array.isArray(msgs) ? msgs : []).slice(-8)
        .map((m: any) => `${m.role || 'system'}: ${typeof m.content === 'string' ? m.content : ''}`)
        .join('\n');
    } catch { /* context optional */ }
    const intent = preclassifiedIntent || await intentRouter.routeIntent(prompt, { recentText });

    // Append routing event
    await conversationService.appendMessage({
      conversationId,
      role: 'system',
      messageType: 'routing_event',
      content: `Intent routed to ${intent.route.toUpperCase()} (Confidence: ${(intent.confidence * 100).toFixed(0)}%) - ${intent.reason}`,
      metadata: { intent, ...(requestMetadata || {}) }
    });

    // 3. Dispatch
    switch (intent.route) {
      case 'codex':
        return this.handleCodex(
          conversationId,
          prompt,
          workspacePath,
          intent.requiresApproval === false ? 'auto' : approvalPolicy,
          operationId,
          intent.requiresApproval === false
        );
      case 'agent_teams':
        return this.handleAgentTeams(conversationId, prompt, workspacePath, approvalPolicy, operationId);
      case 'hermes':
        return this.handleHermes(conversationId, prompt, operationId);
      case 'memory':
        return this.handleMemory(conversationId, prompt, operationId);
      case 'clarification_required':
        return this.handleClarification(conversationId, prompt, operationId);
      case 'direct':
      default:
        return this.handleDirect(conversationId, prompt, operationId);
    }
  }

  /**
   * Validate the workspace for routes that create real work.
   * Returns an error string when invalid, or null when the workspace is usable.
   */
  private validateWorkspace(workspacePath: string): string | null {
    if (!workspacePath || workspacePath === 'default') {
      return NO_WORKSPACE_ERROR;
    }
    const { isValid, errorMessage } = detectGitRepository(workspacePath);
    if (!isValid) {
      return `Invalid workspace root: ${errorMessage || 'not a git repository'}. Select a valid repository in the workspace bar.`;
    }
    return null;
  }

  private async handleCodex(conversationId: string, prompt: string, workspacePath: string, approvalPolicy: 'manual' | 'auto', operationId?: string, readOnly = false) {
    const requestMetadata = operationId ? { operationId } : undefined;
    const workspaceError = this.validateWorkspace(workspacePath);
    if (workspaceError) {
      await conversationService.appendMessage({
        conversationId,
        role: 'system',
        messageType: 'error',
        content: workspaceError,
        metadata: requestMetadata
      });
      return { route: 'codex', error: workspaceError, operationId };
    }

    try {
      const codexPrompt = readOnly
        ? [
          'READ-ONLY CODEX TASK.',
          'Inspect, analyze, read, and report only.',
          'Do not write, patch, delete, run side-effect commands, deploy, or change configuration.',
          '',
          prompt
        ].join('\n')
        : prompt;

      const assignment = await AgentProviderAssignmentService.getAssignment('agent-codex');
      const executionProvider = assignment?.providerId;

      const goalId = await codexService.createGoal(codexPrompt, workspacePath, approvalPolicy, executionProvider, conversationId);
      const status = approvalPolicy === 'manual' ? 'waiting_for_approval' : 'queued';

      await conversationService.appendMessage({
        conversationId,
        role: 'system',
        messageType: 'system_status',
        content: approvalPolicy === 'manual'
          ? `CodeX Goal initialized: ${goalId}. Generating plan for your approval...`
          : `CodeX Goal initialized: ${goalId}. ${readOnly ? 'Read-only inspection started.' : 'Execution started.'}`,
        goalId,
        metadata: requestMetadata
      });

      return {
        goalId,
        route: 'codex',
        status,
        operationId,
        provider: assignment?.providerId || 'ollama',
        model: assignment?.modelId || OLLAMA_DEFAULT_CODING_MODEL,
        fallbackProvider: 'ollama',
        fallbackModel: OLLAMA_DEFAULT_CODING_MODEL
      };
    } catch (err: any) {
      const content = `Failed to initialize CodeX Goal: ${err.message}`;
      await conversationService.appendMessage({
        conversationId,
        role: 'system',
        messageType: 'error',
        content,
        metadata: requestMetadata
      });
      return {
        route: 'codex',
        status: 'failed',
        error: content,
        operationId,
        provider: 'ollama', // Unknown at this point if it threw earlier, default
        model: OLLAMA_DEFAULT_CODING_MODEL,
        fallbackProvider: 'ollama',
        fallbackModel: OLLAMA_DEFAULT_CODING_MODEL
      };
    }
  }

  private async handleAgentTeams(conversationId: string, prompt: string, workspacePath: string, approvalPolicy: 'manual' | 'auto', operationId?: string) {
    const requestMetadata = operationId ? { operationId } : undefined;
    const workspaceError = this.validateWorkspace(workspacePath);
    if (workspaceError) {
      await conversationService.appendMessage({
        conversationId,
        role: 'system',
        messageType: 'error',
        content: workspaceError,
        metadata: requestMetadata
      });
      return { route: 'agent_teams', error: workspaceError, operationId };
    }

    try {
      await conversationService.appendMessage({
        conversationId,
        role: 'system',
        messageType: 'system_status',
        content: `Analyzing task and assembling Agent Team. Generating Team Sheet...`,
        metadata: requestMetadata
      });

      const { teamId, teamSheet } = await coordinatorService.createTeam(prompt, workspacePath, approvalPolicy);
      
      const metadata = TeamPreviewMetadataSchema.parse({
        teamId,
        conversationId,
        previewStatus: 'awaiting_approval',
        teamSheet,
        createdAt: new Date().toISOString()
      });

      await conversationService.appendMessage({
        conversationId,
        role: 'system',
        messageType: 'team_preview',
        content: `Team successfully designed. Awaiting your approval.`,
        metadata: { ...metadata, ...(requestMetadata || {}) }
      });

      return { teamId, route: 'agent_teams', status: 'awaiting_approval', operationId };
    } catch (err: any) {
      const content = `Failed to initialize Agent Team: ${err.message}`;
      await conversationService.appendMessage({
        conversationId,
        role: 'system',
        messageType: 'error',
        content,
        metadata: requestMetadata
      });
      return { route: 'agent_teams', error: content, operationId };
    }
  }

  private async handleHermes(conversationId: string, prompt: string, operationId?: string) {
    // Hermes is a live internal AgenticOS worker — delegate through the
    // Background Task Manager so the run persists independently of this
    // conversation turn and streams real events.
    try {
      const { backgroundTaskManager } = await import('../../services/backgroundTasks/manager.js');
      const { dispatchTask } = await import('../../services/backgroundTasks/adapters.js');
      const { taskShortId } = await import('../../services/backgroundTasks/types.js');

      const title = prompt.length > 64 ? `${prompt.slice(0, 61)}…` : prompt;
      const { task, error } = backgroundTaskManager.createTask({
        title,
        objective: prompt,
        originalRequest: prompt,
        route: 'hermes',
        selectedAgent: 'Hermes',
        worker: 'hermes',
        conversationId,
        resumable: false,
        metadata: { operationId },
      });
      if (!task) {
        await conversationService.appendMessage({
          conversationId,
          role: 'system',
          messageType: 'error',
          content: error || 'Could not create the background task.',
          metadata: operationId ? { operationId } : undefined
        });
        return { route: 'hermes', status: 'failed', error, operationId };
      }

      // Fire-and-forget dispatch — the task now owns the run, not this turn.
      dispatchTask(task).catch(() => { /* adapter records its own failure */ });

      const shortId = taskShortId(task.taskId);
      const reply = `I started task ${shortId}. Hermes is working on it in the background — you can keep talking to me, and ask "show task ${shortId}" for progress.`;
      await conversationService.appendMessage({
        conversationId,
        role: 'agent',
        content: reply,
        routedAgent: 'jarvis',
        metadata: { taskId: task.taskId, ...(operationId ? { operationId } : {}) }
      });
      return { route: 'hermes', status: 'queued', goalId: task.taskId, operationId };
    } catch (err: any) {
      const content = `Hermes task creation failed: ${err?.message}`;
      await conversationService.appendMessage({
        conversationId,
        role: 'system',
        messageType: 'error',
        content,
        metadata: operationId ? { operationId } : undefined
      });
      return { route: 'hermes', status: 'failed', error: content, operationId };
    }
  }

  private async handleMemory(conversationId: string, prompt: string, operationId?: string) {
    const content = 'Memory indexing service is currently offline.';
    await conversationService.appendMessage({
      conversationId,
      role: 'system',
      messageType: 'error',
      content,
      metadata: operationId ? { operationId } : undefined
    });
    return { route: 'memory', status: 'unavailable', error: content, operationId };
  }

  private async handleDirect(conversationId: string, prompt: string, operationId?: string) {
    try {
      // Capability-grounding: Jarvis has a LIVE INSPECTION pipeline that reads
      // real runtime + frontend diagnostic state (active model/provider,
      // gateway health, Hermes/Ollama/OpenRouter, UI display state, tasks,
      // errors). The model must never claim it lacks that access — requests
      // about current AgenticOS state are routed to INVESTIGATE, and any that
      // reach direct chat should be answered from that capability.
      const systemPrompt = `You are Jarvis, the core orchestration agent of Agentic OS. Keep answers short, direct, and conversational.
You have LIVE INSPECTION capability: AgenticOS tracks real runtime state (active model and provider, gateway-resolved model/provider, selected frontend model, what the UI is displaying, Hermes/Ollama/OpenRouter health, active and last streams, background tasks, recent errors) and exposes it through the investigation pipeline. Do NOT claim you lack access to inspect the current model configuration or UI state. If a request is about current AgenticOS runtime/UI state, say you will inspect it (or report what the investigation found) — the inspection pipeline handles those requests.`;
      const result = await llmChat({ systemPrompt, prompt });

      await conversationService.appendMessage({
        conversationId,
        role: 'agent',
        content: result.reply,
        routedAgent: 'jarvis',
        metadata: operationId ? { operationId } : undefined
      });
      return { route: 'direct', operationId };
    } catch (err: any) {
      const content = `Direct chat failed: ${err.message}`;
      await conversationService.appendMessage({
        conversationId,
        role: 'system',
        messageType: 'error',
        content,
        metadata: operationId ? { operationId } : undefined
      });
      return { route: 'direct', error: content, operationId };
    }
  }
  private async handleClarification(conversationId: string, prompt: string, operationId?: string) {
    await conversationService.appendMessage({
      conversationId,
      role: 'agent',
      content: 'I didn\'t quite understand your request. Could you rephrase it?',
      routedAgent: 'jarvis',
      metadata: operationId ? { operationId } : undefined
    });
    return { route: 'clarification_required', operationId };
  }
}

export const jarvisOrchestrator = new JarvisOrchestrator();
