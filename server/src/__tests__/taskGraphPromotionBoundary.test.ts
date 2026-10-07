import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { taskGraphExecutor } from '../domains/controlPlane/taskGraph/TaskGraphExecutor.js';
import { goalLifecycleManager } from '../domains/controlPlane/GoalLifecycle.js';
import { rawDb } from '../db/index.js';
import { readGraphEvidence, verifyGraphEvidence } from '../domains/controlPlane/taskGraph/TaskGraphJournal.js';
import type { TaskGraph, TaskNode } from '../domains/controlPlane/taskGraph/types.js';
import { decideOutcome } from '../domains/turnLifecycle/respond.js';

function fixture(operation = 'PRESENT_RESULT') {
 const goal = goalLifecycleManager.startGoal({ conversationId:randomUUID(), userInput:'Controlled promotion regression' });
 goalLifecycleManager.transitionState(goal.goalId,'EXECUTING',{summary:'Isolated test'});
 const node:TaskNode = {id:randomUUID(),capability:'conversation',operation,inputs:{presentationText:'literal data'},outputs:{verified:true},dependsOn:[],status:'PENDING',retryPolicy:{maxRetries:0,backoffMs:0}};
 const graph:TaskGraph={graphId:randomUUID(),goalId:goal.goalId,userGoal:'Controlled regression',nodes:new Map([[node.id,node]]),status:'PENDING',createdAt:Date.now(),updatedAt:Date.now()};
 return {goal,node,graph};
}

describe('task graph promotion boundary',()=>{
 it('rejects failed execution despite a satisfied legacy verifier',()=>{
  const result=decideOutcome({kind:'answer'} as any,{allowed:true,reason:'test'},
   {executor:'self',attempted:true,completedWithoutError:false,startedAt:'',finishedAt:''},
   {verifier:'Argus',satisfied:true,observable:true,reason:'self assertion',evidence:[],checkedAt:''});
  expect(result.outcome).toBe('FAILED');
 });
 it('does not promote a legacy verifier boolean without bound evidence',()=>{
  const result=decideOutcome({kind:'answer'} as any,{allowed:true,reason:'test'},
   {executor:'self',attempted:true,completedWithoutError:true,startedAt:'',finishedAt:''},
   {verifier:'Argus',satisfied:true,observable:true,reason:'self assertion',evidence:[],checkedAt:''});
  expect(result.outcome).toBe('EXECUTED_UNVERIFIED');
 });
 it('handler success and a handler verified flag cannot promote a node',async()=>{
  const {graph,node}=fixture(); const result=await taskGraphExecutor.executeGraph(graph);
  expect(result.success).toBe(true); expect(node.status).toBe('SUCCEEDED');
  expect(node.workerId).toMatch(/^task-graph-supervisor:/);
  expect(node.executionPolicy).toEqual({reference:'task-graph-handler-result',version:1,approvalState:'NOT_REQUIRED'});
  expect(readGraphEvidence(graph.graphId).some(row=>row.event==='NODE_VERIFIED')).toBe(false);
  expect(verifyGraphEvidence(graph.graphId)).toBe(true);
 });
 it('permits only presentation to consume a nonverified result',async()=>{
  const {graph,node}=fixture();
  const dependent:TaskNode={...node,id:randomUUID(),dependsOn:[node.id],outputs:{}};
  graph.nodes.set(dependent.id,dependent);
  expect((await taskGraphExecutor.executeGraph(graph)).success).toBe(true);
  expect(dependent.status).toBe('SUCCEEDED');
 });
 it('blocks a dependent action when upstream is merely succeeded',async()=>{
  const {graph,node}=fixture();
  const dependent:TaskNode={...node,id:randomUUID(),operation:'UNSUPPORTED_GOAL',dependsOn:[node.id],outputs:{}};
  graph.nodes.set(dependent.id,dependent);
  expect((await taskGraphExecutor.executeGraph(graph)).success).toBe(false);
  expect(dependent.status).toBe('PENDING');
 });
 it('rejects the kernel Argus assertion as completion authority',()=>{
  const {goal}=fixture();
  expect(()=>goalLifecycleManager.transitionState(goal.goalId,'COMPLETED',{actor:'Argus',summary:'forged',detail:{verified:true}})).toThrow('independent verification');
  expect(goalLifecycleManager.transitionState(goal.goalId,'SUCCEEDED',{summary:'Handler succeeded'}).status).toBe('SUCCEEDED');
 });
 it('does not complete a cancelled operation',async()=>{
  const {graph,node}=fixture();const abort=new AbortController();abort.abort();
  expect((await taskGraphExecutor.executeGraph(graph,{signal:abort.signal})).success).toBe(false);
  expect(node.status).not.toBe('VERIFIED');expect(graph.status).toBe('CANCELLED');
 });
 it('rejects durable cancellation even when the in-memory goal was executing',()=>{
  const {goal}=fixture();
  rawDb.prepare("UPDATE goal_runs SET status='CANCELLED' WHERE goal_id=?").run(goal.goalId);
  expect(()=>goalLifecycleManager.transitionState(goal.goalId,'SUCCEEDED',{summary:'Late success'})).toThrow('CANCELLED');
  expect((rawDb.prepare('SELECT status FROM goal_runs WHERE goal_id=?').get(goal.goalId) as any).status).toBe('CANCELLED');
 });
});
