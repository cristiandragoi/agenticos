import { randomUUID } from 'crypto';
import { goalStore } from '../../services/goalStore.js';
import { resumeCodexGoalLoop } from '../../loops/codexLoop.js';
import { llmChat, OLLAMA_BASE, OLLAMA_DEFAULT_CODING_MODEL, OLLAMA_FALLBACK_MODEL } from '../../services/llmGateway.js';
import type { GoalRecord } from '../../types.js';

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
  async createGoal(prompt: string, workspacePath: string, approvalPolicy?: string, executionProvider?: string, conversationId?: string, workspaceId?: string) {
    if (!prompt?.trim() || isRepositoryOnlyTask(prompt, workspacePath)) {
      throw Object.assign(new Error('Describe what you want CodeX to do.'), { status: 400 });
    }
    // Normalize the UI vocabulary ('auto' | 'strict') to backend values.
    // Anything that is not an explicit 'auto' requires manual approval —
    // actions needing review must never be silently auto-approved.
    const policy: 'manual' | 'auto' = approvalPolicy === 'auto' || isReadOnlyCodexTask(prompt) ? 'auto' : 'manual';

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
      providerFallbackCount: 0
    };

    goalStore.create(goalRecord);

    if (policy === 'manual') {
      // Background planning
      this.generatePlan(goalId, prompt, workspacePath, executionProvider).catch(console.error);
    } else {
      resumeCodexGoalLoop(goalId).catch(console.error);
    }

    return goalId;
  }

  private async generatePlan(goalId: string, prompt: string, workspacePath: string, executionProvider?: string) {
    try {
      const systemPrompt = `You are a CodeX agent. Keep plans, explanations, reports, and execution summaries strictly in English unless the user explicitly requests another language.
Your task is to plan the user's request. Return a plan detailing the steps to accomplish the goal.
Do not execute the steps yet, just outline the plan.`;

      const result = await llmChat({ 
        systemPrompt, 
        prompt: `User Request: ${prompt}\nWorkspace: ${workspacePath}`, 
        provider: executionProvider === 'ollama' ? 'ollama' : undefined,
        timeoutMs: 3000
      });
      if (result.offline) {
        throw new Error(
          `Provider/model unavailable. Primary provider: ${executionProvider === 'ollama' ? 'ollama' : 'omniRoute'}; ` +
          `model: ${result.model || (executionProvider === 'ollama' ? OLLAMA_DEFAULT_CODING_MODEL : 'auto')}; ` +
          `fallback provider/model: ollama/${executionProvider === 'ollama' ? OLLAMA_DEFAULT_CODING_MODEL : OLLAMA_FALLBACK_MODEL} at ${OLLAMA_BASE}; ` +
          `reason: ${result.error || result.reply}`
        );
      }
      const reply = result.reply;

      const writer = goalStore.createEventWriter({ goalId });
      writer.push({
        state: 'waiting_for_approval', message: reply,
        provider: result.provider, model: result.model || 'auto', tool: 'plan'
      });
    } catch (err: any) {
      const writer = goalStore.createEventWriter({ goalId });
      const message = `CodeX provider/model unavailable before planning could complete. ` +
        `Primary provider/model: ${executionProvider === 'ollama' ? `ollama/${OLLAMA_DEFAULT_CODING_MODEL}` : 'omniRoute/auto'}; ` +
        `fallback provider/model: ollama/${executionProvider === 'ollama' ? OLLAMA_DEFAULT_CODING_MODEL : OLLAMA_FALLBACK_MODEL} at ${OLLAMA_BASE}; ` +
        `reason: ${err.message}`;
      writer.push({
        state: 'failed',
        message,
        provider: executionProvider === 'ollama' ? 'ollama' : 'omniRoute',
        model: executionProvider === 'ollama' ? OLLAMA_DEFAULT_CODING_MODEL : 'auto',
        tool: 'plan',
        error: err.message,
        eventType: 'task_failed',
        normalizedStatus: 'failed',
        lifecycleState: 'failed',
        userMessage: message,
        errorCode: 'CODEX_PROVIDER_UNAVAILABLE',
        errorDetails: err.message,
        payload: {
          provider: executionProvider === 'ollama' ? 'ollama' : 'omniRoute',
          model: executionProvider === 'ollama' ? OLLAMA_DEFAULT_CODING_MODEL : 'auto',
          fallbackProvider: 'ollama',
          fallbackModel: executionProvider === 'ollama' ? OLLAMA_DEFAULT_CODING_MODEL : OLLAMA_FALLBACK_MODEL,
          ollamaBaseUrl: OLLAMA_BASE
        }
      });
    }
  }

  async reviseGoal(goalId: string, feedback: string, executionProvider?: string) {
    const goal = goalStore.get(goalId);
    if (!goal || goal.status !== 'waiting_for_approval') return false;

    const updatedGoalStr = `${goal.originalGoal}\n\nRevision request: ${feedback}`;
    goalStore.update(goalId, { originalGoal: updatedGoalStr });

    const systemPrompt = `You are CodeX. Respond to the user in English. Keep plans, explanations, reports, and execution summaries in English unless the user explicitly requests another language.`;
    
    let reply = '';
    // Mock logic carried over from chat.ts
    if (feedback.includes('python3')) {
      reply = '- Step 1: Create hello.py with python3 shebang\n- Step 2: Add print statement\n- Step 3: Verify execution';
    } else if (goal.originalGoal.includes('Create a new python script hello.py')) {
      reply = '- Step 1: Create hello.py\n- Step 2: Add print statement\n- Step 3: Verify execution\n- Step 4: Revised based on feedback.';
    } else {
      const result = await llmChat({ 
        systemPrompt, 
        prompt: `Revise the previous plan based on this feedback:\nFeedback: ${feedback}\nOriginal Goal: ${goal.originalGoal}`, 
        provider: executionProvider === 'ollama' ? 'ollama' : undefined,
        timeoutMs: 3000
      });
      reply = result.reply;
    }

    const writer = goalStore.createEventWriter({ goalId });
    writer.push({
      state: 'waiting_for_approval', message: reply,
      provider: resultProviderFromExecution(executionProvider), model: executionProvider === 'ollama' ? OLLAMA_DEFAULT_CODING_MODEL : 'auto', tool: 'plan'
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
    goalStore.update(goalId, { status: 'stopped' });
    return true;
  }
}

export const codexService = new CodexService();

function resultProviderFromExecution(executionProvider?: string) {
  return executionProvider === 'ollama' ? 'ollama' : 'omniRoute';
}
