import { conversationService } from '../conversations/service.js';
import { intentRouter, type IntentResult } from './intentRouter.js';
import { codexService } from '../codex/service.js';
import { llmChat, OLLAMA_DEFAULT_CODING_MODEL } from '../../services/llmGateway.js';
import { coordinatorService } from '../teams/coordinatorService.js';
import { detectGitRepository } from '../../utils/workspaceValidation.js';
import { AgentProviderAssignmentService } from '../../services/agent/assignments.js';
import { getWorkspaceRoot } from '../../services/workspaceStore.js';
import { magnitudeService } from '../magnitude/service.js';

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
      case 'magnitude':
        return this.handleMagnitude(conversationId, prompt, operationId);
      case 'agent_teams':
        return this.handleAgentTeams(conversationId, prompt, workspacePath, approvalPolicy, operationId);
      case 'hermes':
        return this.handleHermes(conversationId, prompt, operationId);
      case 'memory':
        return this.handleMemory(conversationId, prompt, operationId);
      case 'investigate':
        return this.handleInvestigate(conversationId, prompt, operationId);
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
    // §1: ONE canonical workspace. When the request omits a repository, fall
    // back to the canonical workspaceStore root — never fail with "select a
    // repository" while one is already selected.
    const effectiveWorkspace = (workspacePath && workspacePath !== 'default')
      ? workspacePath
      : getWorkspaceRoot();
    const workspaceError = this.validateWorkspace(effectiveWorkspace);
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

      const goalId = await codexService.createGoal(codexPrompt, effectiveWorkspace, approvalPolicy, executionProvider, conversationId);
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
      let _activeProjectId: string | null = null;
      try {
        const { projectsStore } = await import('../../services/projectsStore.js');
        _activeProjectId = projectsStore.getActiveProjectId();
      } catch { /* best effort */ }
      const { task, error } = backgroundTaskManager.createTask({
        title,
        objective: prompt,
        originalRequest: prompt,
        route: 'hermes',
        selectedAgent: 'Hermes',
        worker: 'hermes',
        conversationId,
        resumable: false,
        projectId: _activeProjectId || undefined,
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
    try {
      let activeProjectId: string | null = null;
      try {
        const { projectsStore } = await import('../../services/projectsStore.js');
        activeProjectId = projectsStore.getActiveProjectId();
        if (activeProjectId && !projectsStore.getProject(activeProjectId)) activeProjectId = null;
      } catch { /* project store unavailable — global memory only */ }
      const {
        isMemoryStore, handleMemoryStore, isMemoryRecall, isDecisionStatement,
        handleMemoryRecall, handleDecisionStatement,
      } = await import('./memoryRecall.js');
      const { isContinuationRequest, resolveContinuation, formatContinuation } = await import('./projectMemory.js');

      let reply: string;
      if (isContinuationRequest(prompt)) {
        reply = formatContinuation(resolveContinuation(activeProjectId));
      } else if (isMemoryStore(prompt)) {
        reply = handleMemoryStore(prompt, activeProjectId).reply;
      } else if (isDecisionStatement(prompt)) {
        reply = await handleDecisionStatement(prompt, activeProjectId);
      } else if (isMemoryRecall(prompt)) {
        reply = await handleMemoryRecall(prompt, activeProjectId);
      } else {
        reply = 'I do not have a memory matching that yet. Try "remember that …" to store a fact, or ask "what do you remember about …".';
      }
      await conversationService.appendMessage({
        conversationId,
        role: 'agent',
        content: reply,
        routedAgent: 'jarvis',
        metadata: { ...(operationId ? { operationId } : {}), provider: 'agentic-os', model: 'memory', intent: { type: 'memory' } }
      });
      return { route: 'memory', status: 'completed', operationId };
    } catch (err: any) {
      const content = `Memory lookup failed: ${err?.message}`;
      await conversationService.appendMessage({
        conversationId,
        role: 'system',
        messageType: 'error',
        content,
        metadata: operationId ? { operationId } : undefined
      });
      return { route: 'memory', status: 'failed', error: content, operationId };
    }
  }

  /**
   * Evidence-based investigation (§6/§8). Problem reports — "the interface
   * is wrong", "why is this still happening", "continue" after an
   * investigation — run the READ-ONLY inspection pipeline and stream an
   * evidence report. Never a generic "Could you clarify?" or a claim of
   * success without inspection.
   */
  private async handleInvestigate(conversationId: string, prompt: string, operationId?: string) {
    try {
      const { investigateAgenticState } = await import('./investigation.js');
      let reply: string;
      try {
        reply = await investigateAgenticState(conversationId, prompt);
      } catch (err: any) {
        reply = `I attempted a read-only inspection but it failed: ${err?.message || err}. Nothing was changed.`;
      }
      await conversationService.appendMessage({
        conversationId,
        role: 'agent',
        content: reply,
        routedAgent: 'jarvis',
        metadata: { ...(operationId ? { operationId } : {}), provider: 'agentic-os', model: 'registry', intent: { type: 'investigate' } }
      });
      return { route: 'investigate', operationId };
    } catch (err: any) {
      const content = `Investigation failed: ${err?.message}`;
      await conversationService.appendMessage({
        conversationId,
        role: 'system',
        messageType: 'error',
        content,
        metadata: operationId ? { operationId } : undefined
      });
      return { route: 'investigate', error: content, operationId };
    }
  }

  private async handleDirect(conversationId: string, prompt: string, operationId?: string) {
    try {
      // Capability-grounding + ONE conversation context object (§3/§7).
      // The model receives real runtime context (workspace, active task,
      // provider, capabilities) so it never claims it lacks a capability
      // that AgenticOS actually has, and never answers follow-ups as if
      // they were isolated questions.
      const { assembleConversationContext, contextToSystemPrompt } = await import('./conversationContext.js');
      let ctx: any = null;
      try {
        ctx = await assembleConversationContext(conversationId, prompt);
      } catch { /* context optional */ }

      const systemPrompt = `You are Jarvis, the core orchestration agent of Agentic OS. Keep answers short, direct, and conversational.
You have LIVE INSPECTION capability: AgenticOS tracks real runtime state (active model and provider, gateway-resolved model/provider, selected frontend model, what the UI is displaying, Hermes/Ollama/OpenRouter health, active and last streams, background tasks, recent errors) and exposes it through the investigation pipeline. Do NOT claim you lack access to inspect the current model configuration or UI state. If a request is about current AgenticOS runtime/UI state, say you will inspect it (or report what the investigation found) — the inspection pipeline handles those requests.
AgenticOS can delegate engineering work through CodeX and Agent Teams. Do NOT say "I cannot modify the UI" or "I don't have the capability to change the interface": if the user asks to change something in the UI/codebase, you can inspect it and delegate the change to the engineering system per approval rules. Distinguish "I personally answer the conversation" from "I can delegate this change to the engineering system".
You can also: inspect the selected workspace/repository, search/read repository files (CodeX), delegate research, use Hermes for background tasks, inspect task/run state, retrieve relevant memories, and request approval when required.
If you do not know something, say so explicitly. Never invent facts, values, or prior decisions.
Never claim that you are speaking, spoke, or will speak aloud, and never append delivery notes like "(spoken aloud)" — audio delivery is handled by the system outside your text. Just answer the question.
Never emit tool-call markup (do not include <tool_call>...</tool_call> or function-call syntax in your reply) — if a request needs an investigation or a delegation, describe it in plain words and the system will perform it.
Answer concisely and directly. Do not repeat yourself. Do not comment on your own responses. Do not announce or describe actions you did not take. For simple questions, answer simply.
Use the conversation history to keep the subject across turns: if the user says "that", "it", "this", "continue", "fix it", they are referring to the recent conversation subject — resolve it from the prior turns rather than asking what they mean.
Never answer "Is Hermes finished?" / "Is the task done?" / "What happened?" with generic text — report the ACTUAL task state from the context block below, distinguishing ACTIVE vs HISTORICAL.${ctx ? contextToSystemPrompt(ctx) : ''}`;

      // Conversation history (bounded window) — same as the streaming path.
      let history: { role: 'user' | 'assistant'; content: string }[] = [];
      try {
        const msgs = await conversationService.getMessages(conversationId);
        const arr = Array.isArray(msgs) ? msgs : [];
        const current = prompt;
        for (let i = arr.length - 1; i >= 0 && history.length < 12; i--) {
          const m = arr[i];
          const role = m?.role;
          const content = typeof m?.content === 'string' ? m.content : '';
          if (!content) continue;
          if (role === 'system') continue;
          if (role === 'user' && content === current) continue;
          if (role !== 'user' && role !== 'agent') continue;
          history.unshift({ role: role === 'agent' ? 'assistant' : 'user', content });
        }
      } catch {
        // best effort — a failed history read must not break direct chat
      }
      const result = await llmChat({ systemPrompt, prompt, history });

      // Strip any stray tool-call markup the model may still emit (§18).
      const cleaned = stripToolCallMarkup(result.reply);

      await conversationService.appendMessage({
        conversationId,
        role: 'agent',
        content: cleaned,
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
    // §5/§14: clarification is LAST RESORT. Before asking, check whether
    // recent context now resolves the request (the user may have just
    // supplied additional information after a previous clarification).
    let reply = 'I didn\'t quite understand your request. Could you rephrase it?';
    try {
      const { assembleConversationContext } = await import('./conversationContext.js');
      const ctx = await assembleConversationContext(conversationId, prompt);
      // If the user gave new information and we previously asked, attempt
      // interpretation instead of a second canned clarification.
      if (ctx.previousWasClarification && ctx.previousUserMessage) {
        reply = 'Got it — let me work with that new information rather than asking again.';
      } else if (ctx.activeTask) {
        reply = `I need a bit more detail before acting. Right now I'm ${ctx.activeTask.status.replace(/_/g, ' ')} on ${ctx.activeTask.title.slice(0, 60)} — could you clarify what you want me to do next?`;
      }
    } catch { /* keep default */ }
    await conversationService.appendMessage({
      conversationId,
      role: 'agent',
      content: reply,
      routedAgent: 'jarvis',
      metadata: operationId ? { operationId } : undefined
    });
    return { route: 'clarification_required', operationId };
  }

  private async handleMagnitude(conversationId: string, prompt: string, operationId?: string): Promise<OrchestratorResult> {
    const requestMetadata = operationId ? { operationId } : undefined;
    const { url, error: urlError } = magnitudeService.extractAndValidateUrl(prompt);

    if (urlError || !url) {
      const errorContent = `Magnitude cannot proceed: ${urlError || 'No valid HTTP/HTTPS URL provided in prompt.'}`;
      await conversationService.appendMessage({
        conversationId,
        role: 'system',
        messageType: 'error',
        content: errorContent,
        metadata: requestMetadata
      });
      return { route: 'magnitude', status: 'failed', error: errorContent, operationId };
    }

    // 1. Emit live status in conversation
    await conversationService.appendMessage({
      conversationId,
      role: 'system',
      messageType: 'system_status',
      content: `Magnitude: Launching browser worker to inspect ${url}...`,
      metadata: requestMetadata
    });

    try {
      // 2. Create Magnitude Run
      const run = magnitudeService.createRun(prompt, 'inspect', conversationId);

      // 3. Execute Browser Inspection
      const result = await magnitudeService.executeInspect(run.id);

      // 4. Build rich response
      const resultMarkdown = [
        `### Magnitude Browser Inspection Result`,
        `**Page Title:** ${result.title}`,
        `**Final URL:** ${result.finalUrl}`,
        `**Duration:** ${(result.durationMs / 1000).toFixed(1)}s`,
        '',
        `#### Extracted Content:`,
        result.text || '(No visible text extracted)',
      ].join('\n');

      // 5. Append assistant response
      await conversationService.appendMessage({
        conversationId,
        role: 'agent',
        routedAgent: 'jarvis',
        content: resultMarkdown,
        metadata: {
          runId: run.id,
          result,
          ...(requestMetadata || {})
        }
      });

      return {
        route: 'magnitude',
        goalId: run.id,
        status: 'completed',
        operationId
      };
    } catch (err: any) {
      const errorMsg = `Magnitude execution failed: ${err.message || 'Browser inspection error'}`;
      await conversationService.appendMessage({
        conversationId,
        role: 'system',
        messageType: 'error',
        content: errorMsg,
        metadata: requestMetadata
      });
      return {
        route: 'magnitude',
        status: 'failed',
        error: errorMsg,
        operationId
      };
    }
  }
}

/**
 * Strip tool-call / function-call markup the model may emit as literal text.
 * The system prompt forbids it; this is a safety net so the user never sees
 * raw `<tool_call>…</tool_call>` in a reply (§18 — no fake success, no
 * leaked plumbing).
 */
function stripToolCallMarkup(text: string): string {
  if (!text) return text;
  return text
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
    .replace(/<invoke>[\s\S]*?<\/invoke>/gi, '')
    .replace(/<function[^>]*>[\s\S]*?<\/function>/gi, '')
    .replace(/```(?:json|xml)?\s*[\s\S]*?```/g, '')
    .trim();
}

export const jarvisOrchestrator = new JarvisOrchestrator();
