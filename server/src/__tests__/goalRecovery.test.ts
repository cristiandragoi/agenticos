import { describe, it, expect, vi, afterEach } from 'vitest';
import { recoverGoalStep, recoveryResearchRequirement, type RecoveryContext } from '../domains/controlPlane/taskGraph/GoalRecovery.js';
import { autonomousExecutionKernel } from '../domains/controlPlane/taskGraph/AutonomousExecutionKernel.js';
import { appCapabilityAdapter } from '../domains/controlPlane/adapters/AppCapabilityAdapter.js';
import { taskGraphExecutor } from '../domains/controlPlane/taskGraph/TaskGraphExecutor.js';
import { isRepositoryResearchRequest } from '../domains/repositoryResearch/specification.js';
import { AuthoritativeIntentCompiler } from '../domains/controlPlane/AuthoritativeIntentCompiler.js';
import type { TaskGraph, TaskNode } from '../domains/controlPlane/taskGraph/types.js';
import * as research from '../domains/repositoryResearch/service.js';
import { windowsApplicationResolver } from '../domains/controlPlane/WindowsApplicationResolver.js';

afterEach(() => vi.restoreAllMocks());
function context(controller = new AbortController()): RecoveryContext {
  const node: TaskNode = { id: 'failed', capability: 'conversation', operation: 'UNSUPPORTED_GOAL', inputs: {}, dependsOn: [], status: 'FAILED' };
  const graph: TaskGraph = { graphId: 'graph', goalId: 'original', userGoal: 'Open Notepad',
    nodes: new Map([[node.id, node]]), status: 'FAILED', createdAt: Date.now(), updatedAt: Date.now() };
  return { graph, node, signal: controller.signal, conversationId: 'recovery-unit', progress: vi.fn() };
}
describe('same-goal recovery', () => {
  it('ignores a broken shortcut while retaining an independently discovered app', async () => {
    vi.spyOn(windowsApplicationResolver, 'discoverCandidates').mockResolvedValue([
      { name: 'Broken', source: 'shortcut', score: 1 },
      { name: 'Notepad', source: 'running_window', score: 1, processName: 'notepad' },
    ] as any);
    vi.spyOn(windowsApplicationResolver, 'launcherIdentity').mockRejectedValue(new Error('Unreadable shortcut'));
    const result = await windowsApplicationResolver.resolveWithConfidence('Notepad');
    expect(result.status).toBe('resolved'); expect(result.candidates[0].name).toBe('Notepad');
  });
  it('reuses a real compiled app adapter path and completes only after its verified result', async () => {
    const execute = vi.spyOn(appCapabilityAdapter, 'execute').mockResolvedValue({ stepId: 'open', action: 'OPEN_APPLICATION',
      requestedTarget: 'Notepad', success: true, verified: true, outputText: 'I have opened Notepad.' });
    const result = await autonomousExecutionKernel.executeGoal({ schemaVersion: '1', executionMode: 'AUTONOMOUS_GOAL',
      userGoal: 'Open Notepad', confidence: 1, needsClarification: false }, { conversationId: 'recovery-contract' });
    expect(result.success).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.goalRun.status).toBe('COMPLETED');
    expect(result.taskGraph.goalId).toBe(result.goalRun.goalId);
    expect(result.goalRun.originalUserInput).toBe('Open Notepad');
    expect(result.taskGraph.nodes.values().next().value?.operation).toBe('EXECUTE_COMPILED_PLAN');
    expect(result.goalRun.timeline.some(t => t.state === 'RECOVERING')).toBe(false);
    expect(result.outputText).toBe('I have opened Notepad.');
  });
  it('never activates a candidate that fails its test', async () => {
    const activate = vi.fn(); const resume = vi.fn();
    expect(await recoverGoalStep(context(), { discover: async () => [{ id: 'bad', test: async () => false, activate }], resume })).toBe(false);
    expect(activate).not.toHaveBeenCalled(); expect(resume).not.toHaveBeenCalled();
  });
  it('blocks unsupported work without unsolicited repository discovery', async () => {
    const discover = vi.spyOn(research, 'runRepositoryResearch').mockResolvedValue({ id: 'research-proof' } as any);
    const result = await autonomousExecutionKernel.executeGoal({ schemaVersion: '1', executionMode: 'AUTONOMOUS_GOAL',
      userGoal: 'Export an Excel document to a file', confidence: 1, needsClarification: false }, { conversationId: 'missing-contract' });
    expect(discover).not.toHaveBeenCalled();
    expect(result.success).toBe(false); expect(result.goalRun.status).toBe('BLOCKED_EXTERNAL');
    expect(result.error).toBe('NO_TESTED_EXECUTION_ADAPTER');
    expect(result.goalRun.timeline.at(-1)?.detail.graph.goalId).toBe(result.goalRun.goalId);
    expect(result.outputText).toContain('not started a repository search');
  });
  it('does not research new software when an existing adapter fails verification', async () => {
    vi.spyOn(appCapabilityAdapter, 'execute').mockResolvedValue({ stepId: 'open', action: 'OPEN_APPLICATION',
      requestedTarget: 'Notepad', success: true, verified: false, failureReason: 'Window verification failed' });
    const discover = vi.spyOn(research, 'runRepositoryResearch');
    const result = await autonomousExecutionKernel.executeGoal({ schemaVersion: '1', executionMode: 'AUTONOMOUS_GOAL',
      userGoal: 'Open Notepad', confidence: 1, needsClarification: false }, { conversationId: 'failed-verification' });
    expect(result.success).toBe(false); expect(result.goalRun.status).toBe('FAILED_EXHAUSTED');
    expect(discover).not.toHaveBeenCalled();
  });
  it('rolls back when verification of the resumed task fails', async () => {
    const rollback = vi.fn();
    const result = await recoverGoalStep(context(), { discover: async () => [{ id: 'candidate', test: async () => true,
      activate: async () => rollback }], resume: async () => false });
    expect(result).toBe(false); expect(rollback).toHaveBeenCalledTimes(1);
  });
  it('cancellation after activation rolls back and prevents resumption', async () => {
    const controller = new AbortController(); const rollback = vi.fn(); const resume = vi.fn();
    await expect(recoverGoalStep(context(controller), { discover: async () => [{ id: 'candidate', test: async () => true,
      activate: async () => { controller.abort(); return rollback; } }], resume })).rejects.toThrow();
    expect(rollback).toHaveBeenCalledOnce(); expect(resume).not.toHaveBeenCalled();
  });
  it('does not replay already verified upstream nodes on resume', async () => {
    const ctx = context(); ctx.graph.nodes.clear();
    ctx.graph.nodes.set('done', { id: 'done', capability: 'chat', operation: 'READ_MESSAGES', inputs: {},
      outputs: { messagesText: 'verified message' }, dependsOn: [], status: 'VERIFIED' });
    ctx.graph.nodes.set('present', { id: 'present', capability: 'conversation', operation: 'PRESENT_RESULT', inputs: {}, dependsOn: ['done'], status: 'PENDING' });
    const result = await taskGraphExecutor.executeGraph(ctx.graph);
    expect(result.success).toBe(true); expect(result.resultSummary).toBe('verified message');
  });
  it('does not send contacts or private paths to GitHub discovery', () => {
    const requirement = recoveryResearchRequirement('Read the Angie Rondini chat in WhatsApp and D:\\Private\\secret.pdf');
    expect(requirement).toContain('chat'); expect(requirement).not.toMatch(/Angie|Rondini|Private|secret/);
    expect(recoveryResearchRequirement('Create a cinematic camera advertisement')).toBeUndefined();
  });
  it('recognizes the user research phrasing without turning cancellation into research', () => {
    expect(isRepositoryResearchRequest('Can you pull up some GitHub repository useful for this task?')).toBe(true);
    expect(isRepositoryResearchRequest('Jarvis, do not research GitHub repositories')).toBe(false);
  });
  it('separates with from the contact and keeps WhatsApp and read count', () => {
    const plan = AuthoritativeIntentCompiler.compilePlan('locate the chat with Angie Rondini and read me the last message', { activeApplication: 'WhatsApp' });
    expect(plan.steps.map(s => s.action)).toEqual(['OPEN_CHAT', 'READ_MESSAGES']);
    expect(plan.steps.every(s => s.target === 'Angie Rondini' && s.application === 'WhatsApp')).toBe(true);
    expect(plan.steps[1].count).toBe(1);
  });
});
