import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { goalLifecycleManager } from '../domains/controlPlane/GoalLifecycle.js';
import { presentTaskState } from '../domains/controlPlane/TaskStatePresentation.js';
import { autonomousPlanner } from '../domains/controlPlane/taskGraph/AutonomousPlanner.js';
import { createTurnEnvelopeAsync } from '../domains/controlPlane/TurnEnvelope.js';
import { turnLifecycle } from '../domains/turnLifecycle/controller.js';
import { autonomousExecutionKernel } from '../domains/controlPlane/taskGraph/AutonomousExecutionKernel.js';
import { taskGraphExecutor } from '../domains/controlPlane/taskGraph/TaskGraphExecutor.js';

describe('cross-capability task continuity', () => {
  it('reports liveness without blocking execution and stops the timer on completion', async () => {
    vi.useFakeTimers();
    let finish: (value: any) => void = () => {};
    const execution=vi.spyOn(taskGraphExecutor,'executeGraph').mockImplementation(graph=>new Promise(resolve=>{finish=()=>resolve({success:false,graph,resultSummary:'Blocked',error:'Blocked'});}));
    const speech=vi.fn(()=>new Promise<void>(()=>{}));
    try {
      const run=autonomousExecutionKernel.executeGoal({userGoal:'Open Notepad',executionMode:'AUTONOMOUS_GOAL',schemaVersion:'1',confidence:1,needsClarification:false},{conversationId:randomUUID(),onUserMilestone:speech});
      await vi.advanceTimersByTimeAsync(20_000);
      expect(speech).toHaveBeenCalledOnce();
      finish(null); await run;
      await vi.advanceTimersByTimeAsync(40_000);
      expect(speech).toHaveBeenCalledOnce();
    } finally { execution.mockRestore(); vi.useRealTimers(); }
  });
  it.each(['Open Notepad', 'Open https://example.com', 'Read the content in Acrobat'])('reuses compiled installed operations for %s', userGoal => {
    const graph = autonomousPlanner.planGoal({userGoal,executionMode:'AUTONOMOUS_GOAL',schemaVersion:'1',confidence:1,needsClarification:false});
    expect([...graph.nodes.values()][0].operation).toBe('EXECUTE_COMPILED_PLAN');
    expect([...graph.nodes.values()][0].retryPolicy?.maxRetries).toBe(0);
  });
  it.each(['Open Notepad','Read Telegram messages','Locate a file','Open a browser page'])('reports real lifecycle state for %s without executing another task', async userInput => {
    const conversationId=randomUUID();
    const goal=goalLifecycleManager.startGoal({conversationId,userInput});
    goalLifecycleManager.transitionState(goal.goalId,'EXECUTING',{summary:'Executing the requested operation'});
    const text='What is the result?';
    const envelope=await createTurnEnvelopeAsync({rawText:text,conversationId,source:'voice_text_injection'});
    expect(envelope.compiledIntent.target).toBe('current_task_state');
    const spoken:string[]=[];
    await turnLifecycle.submit({text,conversationId,source:'voice_text_injection',envelope},{speak:async t=>{spoken.push(t);}});
    expect(spoken.join(' ')).toContain('still in progress');
    expect(goalLifecycleManager.getLatestGoalForConversation(conversationId)?.goalId).toBe(goal.goalId);
    goalLifecycleManager.transitionState(goal.goalId,'CANCELLED',{summary:'User cancelled'});
    expect(presentTaskState(conversationId,'And?')).toContain('cancelled');
  });
  it('asks for task context instead of fabricating a failure when none exists',()=>{
    expect(presentTaskState(randomUUID(),'What is the result?')).toContain('Which task');
  });
});
