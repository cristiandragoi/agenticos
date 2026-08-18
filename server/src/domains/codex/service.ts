import { randomUUID } from 'crypto';
import { goalStore, goalControllers } from '../../services/goalStore.js';
import { resumeCodexGoalLoop } from '../../loops/codexLoop.js';
import { llmChat } from '../../services/llmGateway.js';
import { AgentProviderAssignmentService } from '../../services/agent/assignments.js';
import type { GoalRecord, ExecutionOptions } from '../../types.js';

function isRepositoryOnlyTask(prompt: string, workspacePath?: string): boolean {
  if (!workspacePath) return false;
  const task = prompt.trim().replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
  const repo = workspacePath.trim().replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
  return task === repo;
}

const MUTATING_INTENT_RE = /\b(write|modify|edit|update|change|create|delete|remove|patch|replace|append|insert|install|deploy|configure|execute|run)\b/i;
const READ_ONLY_INTENT_RE = /\b(inspect|analy[sz]e|explain|read|search|list|review|summari[sz]e|describe|look at)\b/i;

function stripProtectiveReadOnlyClauses(prompt: string): string {
  return prompt
    .replace(/\bdo not\s+(?:modify|write|edit|change|create|delete|remove|patch|replace|append|insert|run|execute|deploy|configure)\b[^.?!]*/gi, '')
    .replace(/\bwithout\s+(?:modifying|writing|editing|changing|creating|deleting|removing|patching|replacing|appending|inserting|running|executing|deploying|configuring)\b[^.?!]*/gi, '');
}

export function isReadOnlyCodexTask(prompt: string): boolean {
  const trimmed = prompt.trim();
  if (!trimmed) return false;
  const intentText = stripProtectiveReadOnlyClauses(trimmed);
  return READ_ONLY_INTENT_RE.test(trimmed) && !MUTATING_INTENT_RE.test(intentText);
}

export class CodexService {
  async createGoal(prompt: string, workspacePath: string, approvalPolicy?: string, executionProvider?: string, conversationId?: string, workspaceId?: string, executionOptions?: ExecutionOptions) {
    if (!prompt?.trim() || isRepositoryOnlyTask(prompt, workspacePath)) {
      throw Object.assign(new Error('Describe what you want CodeX to do.'), { status: 400 });
    }
    // Normalize the UI vocabulary ('auto' | 'strict') to backend values.
    // Anything that is not an explicit 'auto' requires manual approval —
    // actions needing review must never be silently auto-approved.
    const policy: 'manual' | 'auto' = approvalPolicy === 'auto' || isReadOnlyCodexTask(prompt) || executionOptions?.requiresApproval === false ? 'auto' : 'manual';

    // The `executionProvider` parameter must ACTUALLY route the goal: the
    // loop reads goal.executionOptions.executionProviderId. Merge it in so a
    // caller-provided provider is never silently ignored.
    const mergedExecutionOptions: ExecutionOptions = {
      ...(executionProvider ? { executionProviderId: executionProvider } : {}),
      ...(executionOptions || {}),
    };

    const goalId = `goal-${randomUUID().slice(0, 9)}`;
    const goalRecord: GoalRecord = {
      id: goalId,
      workspacePath,
      conversationId,
      workspaceId,
      originalGoal: prompt,
      status: policy === 'manual' ? 'waiting_for_approval' : 'queued',
      history: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      retryCount: 0,
      providerFallbackCount: 0,
      executionOptions: mergedExecutionOptions
    };

    goalStore.create(goalRecord);

    if (policy === 'manual') {
      // Background planning
      this.generatePlan(goalId, prompt, workspacePath).catch(console.error);
    } else {
      resumeCodexGoalLoop(goalId).catch(console.error);
    }

    return goalId;
  }

  private async generatePlan(goalId: string, prompt: string, workspacePath: string) {
    let currentProvider = 'unassigned';
    let currentModel = 'unassigned';
    const startTime = Date.now();
    try {
      const assignment = await AgentProviderAssignmentService.getAssignment('agent-codex');
      // Recovery/execution pinning (RecoveryPolicy V1): the goal's explicit
      // overrides WIN over the assignment — EFFECTIVE model truth, never a
      // rewrite of the ASSIGNED model.
      const execOpts = goalStore.get(goalId)?.executionOptions || {};
      if (assignment) {
        currentProvider = execOpts.providerOverride || assignment.providerId;
        currentModel = execOpts.modelOverride || assignment.modelId || 'auto';
      }

      const systemPrompt = `You are a CodeX agent. Keep plans, explanations, reports, and execution summaries strictly in English unless the user explicitly requests another language.
Your task is to plan the user's request. Return a plan detailing the steps to accomplish the goal.
Do not execute the steps yet, just outline the plan.`;

      const result = await llmChat({ 
        systemPrompt, 
        prompt: `User Request: ${prompt}\nWorkspace: ${workspacePath}`, 
        agentId: 'agent-codex',
        timeoutMs: 3000000,
        // Pinning: pass the recovery-effective provider/model into the REAL
        // LLM call (llmChat routes ChatRequest.modelId when model is set).
        ...(execOpts.providerOverride ? { provider: execOpts.providerOverride } : {}),
        ...(execOpts.modelOverride ? { model: execOpts.modelOverride } : {}),
      });
      
      const durationMs = Date.now() - startTime;

      if (result.offline) {
        throw new Error(result.error || result.reply || 'Provider/model unavailable');
      }

      currentProvider = result.provider;
      currentModel = result.model || currentModel;
      
      const reply = result.reply;

      const writer = goalStore.createEventWriter({ goalId });
      writer.push({
        state: 'waiting_for_approval', message: reply,
        provider: currentProvider, model: currentModel, tool: 'plan',
        durationMs
      });
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      const writer = goalStore.createEventWriter({ goalId });
      let errorCode = 'CODEX_PROVIDER_UNAVAILABLE';
      let msg = err.message.toLowerCase();
      if (msg.includes('timeout') || msg.includes('aborted')) errorCode = 'timeout';
      else if (msg.includes('not found')) errorCode = 'model-not-found';
      else if (msg.includes('fetch') || msg.includes('econnrefused')) errorCode = 'ollama-unreachable';
      else if (msg.includes('circuit')) errorCode = 'circuit-open';
      else if (msg.includes('parse')) errorCode = 'malformed-response';
      else if (msg.includes('capability')) errorCode = 'capability-mismatch';

      const userMessage = `${currentProvider} failed after ${Math.round(durationMs / 1000)} seconds. Reason: ${err.message}`;

      writer.push({
        state: 'failed',
        message: err.message,
        provider: currentProvider,
        model: currentModel,
        tool: 'plan',
        error: err.message,
        eventType: 'task_failed',
        normalizedStatus: 'failed',
        lifecycleState: 'failed',
        userMessage,
        errorCode,
        errorDetails: err.message,
        durationMs,
        payload: {
          provider: currentProvider,
          model: currentModel,
          durationMs
        }
      });
    }
  }

  async reviseGoal(goalId: string, feedback: string) {
    const goal = goalStore.get(goalId);
    if (!goal || goal.status !== 'waiting_for_approval') return false;

    const updatedGoalStr = `${goal.originalGoal}\n\nRevision request: ${feedback}`;
    goalStore.update(goalId, { originalGoal: updatedGoalStr });

    const systemPrompt = `You are CodeX. Respond to the user in English. Keep plans, explanations, reports, and execution summaries in English unless the user explicitly requests another language.`;
    
    let currentProvider = 'unassigned';
    let currentModel = 'unassigned';

    let reply = '';
    const result = await llmChat({ 
      systemPrompt, 
      prompt: `Revise the previous plan based on this feedback:\nFeedback: ${feedback}\nOriginal Goal: ${goal.originalGoal}`, 
      agentId: 'agent-codex',
      timeoutMs: 120000
    });
    reply = result.reply;
    currentProvider = result.provider;
    currentModel = result.model || currentModel;

    const writer = goalStore.createEventWriter({ goalId });
    writer.push({
      state: 'waiting_for_approval', message: reply,
      provider: currentProvider, model: currentModel, tool: 'plan'
    });

    return true;
  }

  async approveAndResume(goalId: string) {
    const goal = goalStore.get(goalId);
    if (!goal || goal.status !== 'waiting_for_approval') return false;
    goalStore.update(goalId, { status: 'queued' });
    resumeCodexGoalLoop(goalId).catch(console.error);
    return true;
  }

  async abortGoal(goalId: string) {
    // Abort the in-flight loop FIRST (interrupts a pending model request),
    // then persist the terminal state. Stop must work even mid-llmChat.
    goalControllers.get(goalId)?.abort();
    goalStore.update(goalId, { status: 'stopped' });
    return true;
  }
}

export const codexService = new CodexService();

function resultProviderFromExecution(executionProvider?: string) {
  return executionProvider || 'ollama';
}
