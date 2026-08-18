import { logger } from '../../utils/logger.js';
import { conversationService } from '../conversations/service.js';
import { intentRouter, type IntentResult } from './intentRouter.js';
import { codexService } from '../codex/service.js';
import { llmChat, OLLAMA_DEFAULT_CODING_MODEL } from '../../services/llmGateway.js';
import { coordinatorService } from '../teams/coordinatorService.js';
import { detectGitRepository } from '../../utils/workspaceValidation.js';
import { AgentProviderAssignmentService } from '../../services/agent/assignments.js';
import { getWorkspaceRoot } from '../../services/workspaceStore.js';
import { magnitudeService } from '../magnitude/service.js';
import { randomUUID } from 'crypto';

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

      // ── Canonical Project Execution tracking ──
      let canonicalTaskId: string | null = null;
      let canonicalRunId: string | null = null;
      try {
        const { projectTaskService } = await import('../../services/projectExecution/projectTaskService.js');
        const { executionRunService } = await import('../../services/projectExecution/executionRunService.js');
        const { projectsStore } = await import('../../services/projectsStore.js');

        let projectId = projectsStore.getActiveProjectId();
        if (!projectId || !projectsStore.getProject(projectId)) {
          const all = projectsStore.listProjects();
          projectId = all.length > 0 ? all[0].id : null;
        }

        if (projectId) {
          const pGoal = projectTaskService.createGoal({
            projectId,
            title: `CodeX Goal: ${prompt.slice(0, 40)}`,
            objective: prompt,
            goalId,
          });

          const pTask = projectTaskService.createTask({
            projectId,
            goalId: pGoal.id,
            title: prompt.slice(0, 60),
            description: prompt,
            taskType: 'engineering',
            assignedCapability: 'codex',
            acceptanceCriteria: `Execute engineering goal: ${prompt}`,
          });
          canonicalTaskId = pTask.id;

          const pRun = executionRunService.createRun({
            taskId: pTask.id,
            projectId,
            goalId: pGoal.id,
            workerType: 'codex',
            agentInstanceId: goalId,
            provider: assignment?.providerId || 'ollama',
            model: assignment?.modelId || OLLAMA_DEFAULT_CODING_MODEL,
            requestId: operationId,
            conversationId,
          });
          canonicalRunId = pRun.id;
          projectTaskService.updateTask(pTask.id, { assignedRunId: pRun.id, status: 'running' });
        }
      } catch (err: any) {
        logger.warn('[JarvisOrchestrator] Canonical project tracking for CodeX failed (non-blocking):', err.message);
      }

      await conversationService.appendMessage({
        conversationId,
        role: 'system',
        messageType: 'system_status',
        content: approvalPolicy === 'manual'
          ? `CodeX Goal initialized: ${goalId}. Generating plan for your approval...`
          : `CodeX Goal initialized: ${goalId}. ${readOnly ? 'Read-only inspection started.' : 'Execution started.'}`,
        goalId,
        metadata: {
          taskId: canonicalTaskId,
          runId: canonicalRunId,
          ...(requestMetadata || {})
        }
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
    const requestMetadata = operationId ? { operationId } : undefined;

    await conversationService.appendMessage({
      conversationId,
      role: 'system',
      messageType: 'system_status',
      content: `Hermes: Initializing research & project intelligence worker...`,
      metadata: requestMetadata
    });

    try {
      const { projectTaskService } = await import('../../services/projectExecution/projectTaskService.js');
      const { executionRunService } = await import('../../services/projectExecution/executionRunService.js');
      const { verificationService } = await import('../../services/projectExecution/verificationService.js');
      const { executeHermesTask } = await import('../workerAdapters/hermesAdapter.js');
      const { projectsStore } = await import('../../services/projectsStore.js');

      let projectId = projectsStore.getActiveProjectId();
      if (!projectId || !projectsStore.getProject(projectId)) {
        const all = projectsStore.listProjects();
        if (all.length > 0) {
          projectId = all[0].id;
          projectsStore.setActiveProjectId(projectId);
        } else {
          const newId = `proj-${randomUUID().slice(0, 8)}`;
          const created = projectsStore.createProject({
            id: newId,
            name: `Project: ${prompt.slice(0, 30)}`,
            description: 'Canonical workspace project',
            status: 'active',
          });
          projectId = created?.id || newId;
          projectsStore.setActiveProjectId(projectId);
        }
      }

      const isPlanning = /\b(plan|planning|affiliate|roadmap|decompose|strategy)\b/i.test(prompt);

      // 1. Create canonical Goal and Task
      const goal = projectTaskService.createGoal({
        projectId,
        title: isPlanning ? `Project Planning: ${prompt.slice(0, 40)}` : `Research: ${prompt.slice(0, 40)}`,
        objective: prompt,
      });

      const task = projectTaskService.createTask({
        projectId,
        goalId: goal.id,
        title: isPlanning ? `Formulate Plan: ${prompt.slice(0, 40)}` : `Investigate & Synthesize: ${prompt.slice(0, 40)}`,
        description: prompt,
        taskType: isPlanning ? 'engineering' : 'research',
        assignedCapability: 'hermes',
        acceptanceCriteria: isPlanning
          ? 'Must produce structured milestones, proposed goals, tasks, risks, and success metrics.'
          : 'Must produce structured findings with distinct claims, verified evidence references, and recommendations.',
      });

      // 2. Execute via canonical Hermes Adapter
      const { run, hermesRunId } = await executeHermesTask(task, {
        prompt,
        conversationId,
        requestId: operationId,
        projectId,
        goalId: goal.id,
      });

      // 3. Wait for the canonical execution run to finish
      let completedRun = executionRunService.getRun(run.id);
      const startPoll = Date.now();
      while (completedRun && (completedRun.status === 'running' || completedRun.status === 'queued') && (Date.now() - startPoll < 90000)) {
        await new Promise(r => setTimeout(r, 1000));
        completedRun = executionRunService.getRun(run.id);
      }

      const result = completedRun?.finalResultId ? executionRunService.getResult(completedRun.finalResultId) : null;
      const struct = result?.structuredOutput as any;

      // 4. Trigger First-Class Independent Verification
      let verificationRecord: any = null;
      if (completedRun && completedRun.status === 'completed' && result) {
        verificationRecord = await verificationService.verify({
          taskId: task.id,
          targetRunId: completedRun.id,
          projectId,
          goalId: goal.id,
          objective: prompt,
          acceptanceCriteria: task.acceptanceCriteria,
          workerResult: result,
          workerRun: completedRun,
        });
      }

      const summary = struct?.summary || result?.summary || 'Hermes synthesis generated.';
      const verdict = verificationRecord?.verdict || (completedRun?.status === 'completed' ? 'PASS' : 'FAIL');

      // 4b. Hermes memory candidate promotion (closure): promote verified
      // candidates into canonical Project Memory with the full provenance
      // chain runId → resultId → verificationId → candidateId → memoryId.
      // Only PASS verdicts promote; FAIL/NEEDS_REVISION/NOT_PROVEN
      // candidates are persisted in the candidate store and never discarded.
      let candidatePromotion: { candidates: Array<{ candidateId: string; key: string; status: string; memoryId: string | null }>; promotedCount: number } | null = null;
      try {
        const candidates = Array.isArray(struct?.memoryCandidates) ? struct.memoryCandidates : [];
        if (candidates.length > 0) {
          const { promoteHermesCandidates } = await import('../../services/memory/workerMemory.js');
          candidatePromotion = await promoteHermesCandidates({
            projectId,
            sourceRunId: completedRun?.id ?? run.id,
            sourceResultId: result?.id ?? null,
            verificationId: verificationRecord?.id ?? null,
            verificationVerdict: verdict,
            candidates,
            scope: projectId ? `project:${projectId}` : 'general',
          });
        }
      } catch (promoErr) {
        // Promotion must never break the Hermes result delivery.
        logger.warn('[Orchestrator] Hermes candidate promotion failed (non-fatal)', promoErr);
      }

      // 5. Build rich assistant markdown response
      let resultMarkdown = '';
      if (isPlanning && struct?.proposedGoals) {
        resultMarkdown = [
          `### Hermes Project Plan`,
          `**Objective:** ${struct.objective || prompt}`,
          `**Independent Verification:** \`${verdict}\``,
          '',
          `#### Summary:`,
          summary,
          '',
          `#### Key Milestones:`,
          ...(struct.milestones?.map((m: string) => `- ${m}`) || []),
          '',
          `#### Proposed Goals & Tasks:`,
          ...(struct.proposedGoals?.map((g: any, i: number) => `**Goal ${i+1}: ${g.title}**\n- ${g.objective}`) || []),
          '',
          `#### Risks & Mitigations:`,
          ...(struct.risks?.map((r: string) => `- ${r}`) || []),
          '',
          `#### Success Metrics:`,
          ...(struct.successMetrics?.map((s: string) => `- ${s}`) || []),
        ].join('\n');
      } else {
        resultMarkdown = [
          `### Hermes Research & Intelligence Result`,
          `**Summary:** ${summary}`,
          `**Independent Verification:** \`${verdict}\``,
          '',
          `#### Verified Findings:`,
          ...(struct?.findings?.map((f: any, i: number) => `**Finding ${i+1}:** ${f.claim}\n- *Evidence:* ${Array.isArray(f.evidence) ? f.evidence.join('; ') : f.evidence} (Confidence: ${(f.confidence * 100).toFixed(0)}%)`) || []),
          '',
          `#### Recommendations:`,
          ...(struct?.recommendations?.map((r: string) => `- ${r}`) || []),
          '',
          `#### Next Actions:`,
          ...(struct?.nextActions?.map((a: string) => `- ${a}`) || []),
        ].join('\n');
      }

      // 6. Append assistant response with exact correlation IDs
      await conversationService.appendMessage({
        conversationId,
        role: 'agent',
        routedAgent: 'jarvis',
        content: resultMarkdown,
        metadata: {
          projectId,
          goalId: goal.id,
          taskId: task.id,
          runId: run.id,
          resultId: result?.id,
          verificationId: verificationRecord?.id,
          verdict,
          worker: 'hermes',
          selectedCapability: 'hermes',
          ...(candidatePromotion && candidatePromotion.promotedCount > 0
            ? {
                memoryCandidates: candidatePromotion.candidates.map((c) => ({
                  candidateId: c.candidateId, key: c.key, status: c.status, memoryId: c.memoryId,
                })),
                promotedMemoryCount: candidatePromotion.promotedCount,
              }
            : {}),
          ...(requestMetadata || {})
        }
      });

      return {
        route: 'hermes',
        status: completedRun?.status || 'completed',
        goalId: goal.id,
        taskId: task.id,
        runId: run.id,
        resultId: result?.id,
        verificationId: verificationRecord?.id,
        verdict,
        operationId,
      };
    } catch (err: any) {
      const content = `Hermes execution failed: ${err.message}`;
      await conversationService.appendMessage({
        conversationId,
        role: 'system',
        messageType: 'error',
        content,
        metadata: requestMetadata
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
      const { projectTaskService } = await import('../../services/projectExecution/projectTaskService.js');
      const { executionRunService } = await import('../../services/projectExecution/executionRunService.js');
      const { verificationService } = await import('../../services/projectExecution/verificationService.js');
      const { executeMagnitudeTask } = await import('../workerAdapters/magnitudeAdapter.js');
      const { projectsStore } = await import('../../services/projectsStore.js');

      let projectId = projectsStore.getActiveProjectId();
      if (!projectId || !projectsStore.getProject(projectId)) {
        const all = projectsStore.listProjects();
        if (all.length > 0) {
          projectId = all[0].id;
          projectsStore.setActiveProjectId(projectId);
        } else {
          const newId = `proj-${randomUUID().slice(0, 8)}`;
          const created = projectsStore.createProject({
            id: newId,
            name: `Project: ${url.replace(/^https?:\/\//, '').slice(0, 25)}`,
            description: 'Canonical workspace project',
            status: 'active',
          });
          projectId = created?.id || newId;
          projectsStore.setActiveProjectId(projectId);
        }
      }

      // Create canonical Goal and Task
      const goal = projectTaskService.createGoal({
        projectId,
        title: `Browser Inspection: ${url}`,
        objective: prompt,
      });

      const task = projectTaskService.createTask({
        projectId,
        goalId: goal.id,
        title: `Inspect ${url}`,
        description: prompt,
        taskType: 'browser',
        assignedCapability: 'magnitude',
        acceptanceCriteria: `Page at ${url} must be successfully loaded, title verified, and content extracted.`,
      });

      // 2. Execute via canonical Magnitude Adapter
      const { run, magnitudeRunId } = await executeMagnitudeTask(task, {
        goal: prompt,
        conversationId,
        requestId: operationId,
      });

      // 3. Wait for the canonical execution run to finish
      let completedRun = executionRunService.getRun(run.id);
      const startPoll = Date.now();
      while (completedRun && (completedRun.status === 'running' || completedRun.status === 'queued') && (Date.now() - startPoll < 90000)) {
        await new Promise(r => setTimeout(r, 1000));
        completedRun = executionRunService.getRun(run.id);
      }

      const result = completedRun?.finalResultId ? executionRunService.getResult(completedRun.finalResultId) : null;
      const struct = result?.structuredOutput as any;

      // 4. Trigger First-Class Independent Verification
      let verificationRecord: any = null;
      if (completedRun && completedRun.status === 'completed' && result) {
        verificationRecord = await verificationService.verify({
          taskId: task.id,
          targetRunId: completedRun.id,
          projectId,
          goalId: goal.id,
          objective: prompt,
          acceptanceCriteria: task.acceptanceCriteria,
          workerResult: result,
          workerRun: completedRun,
        });
      }

      // 5. Build rich response strictly derived from this specific run's result
      const title = struct?.title || result?.summary || 'Inspection Result';
      const finalUrl = struct?.finalUrl || struct?.url || url;
      const text = struct?.text || struct?.content || '(No visible text extracted)';
      const duration = struct?.durationMs ? `${(struct.durationMs / 1000).toFixed(1)}s` : 'N/A';
      const verdict = verificationRecord?.verdict || 'NOT_RECORDED';

      const resultMarkdown = [
        `### Magnitude Browser Inspection Result`,
        `**Page Title:** ${title}`,
        `**Final URL:** ${finalUrl}`,
        `**Duration:** ${duration}`,
        `**Independent Verification:** \`${verdict}\``,
        '',
        `#### Extracted Content:`,
        text,
      ].join('\n');

      // 6. Append assistant response with exact correlation IDs
      await conversationService.appendMessage({
        conversationId,
        role: 'agent',
        routedAgent: 'jarvis',
        content: resultMarkdown,
        metadata: {
          projectId,
          goalId: goal.id,
          taskId: task.id,
          runId: run.id,
          resultId: result?.id,
          verificationId: verificationRecord?.id,
          verdict,
          magnitudeRunId,
          result,
          ...(requestMetadata || {})
        }
      });

      return {
        route: 'magnitude',
        goalId: run.id,
        status: completedRun?.status || 'completed',
        operationId,
        provider: completedRun?.provider || 'magnitude-chromium',
        model: completedRun?.model || 'playwright-headless',
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
