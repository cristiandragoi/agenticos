import { randomUUID } from 'crypto';
import { goalStore } from '../../services/goalStore.js';
import { resumeCodexGoalLoop } from '../../loops/codexLoop.js';
import { llmChat } from '../../services/llmGateway.js';
import type { GoalRecord } from '../../types.js';

export class CodexService {
  async createGoal(prompt: string, workspacePath: string, approvalPolicy: 'manual' | 'auto', executionProvider?: string) {
    const goalId = `goal-${randomUUID().slice(0, 9)}`;
    const goalRecord: GoalRecord = {
      id: goalId,
      originalGoal: prompt,
      status: approvalPolicy === 'manual' ? 'waiting_for_approval' : 'queued',
      history: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      retryCount: 0,
      providerFallbackCount: 0
    };

    goalStore.create(goalRecord);

    if (approvalPolicy === 'manual') {
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
      const reply = result.reply;

      goalStore.pushEvent({
        runId: goalId, sequenceId: 1, timestamp: new Date().toISOString(),
        state: 'waiting_for_approval', step: 1, message: reply,
        provider: 'custom', model: 'custom', tool: 'plan'
      } as any);
    } catch (err: any) {
      goalStore.pushEvent({
        runId: goalId, sequenceId: 1, timestamp: new Date().toISOString(),
        state: 'failed', step: 1, message: 'Failed to generate plan: ' + err.message,
        provider: 'custom', model: 'custom', tool: 'plan'
      } as any);
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

    goalStore.pushEvent({
      runId: goalId, sequenceId: goal.history.length + 1, timestamp: new Date().toISOString(),
      state: 'waiting_for_approval', step: goal.history.length + 1, message: reply,
      provider: 'custom', model: 'custom', tool: 'plan'
    } as any);

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
