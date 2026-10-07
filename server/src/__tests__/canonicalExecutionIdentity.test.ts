import { describe,it,expect } from 'vitest';
import { rawDb } from '../db/index.js';
import { goalLifecycleManager } from '../domains/controlPlane/GoalLifecycle.js';
import { withNodeExecution,currentExecutionIdentity,assertExecutionActive } from '../domains/controlPlane/taskGraph/ExecutionIdentity.js';
import { ToolRegistry } from '../services/agent/toolRegistry.js';
import type {TaskGraph,TaskNode} from '../domains/controlPlane/taskGraph/types.js';

function fixture() {
 const goal=goalLifecycleManager.startGoal({conversationId:crypto.randomUUID(),userInput:'identity test'});
 goalLifecycleManager.transitionState(goal.goalId,'PLANNING',{actor:'ControlPlane',summary:'test'});
 goalLifecycleManager.transitionState(goal.goalId,'EXECUTING',{actor:'ControlPlane',summary:'test'});
 const node:TaskNode={id:crypto.randomUUID(),capability:'test',operation:'test',inputs:{},outputs:{},dependsOn:[],status:'RUNNING',retryCount:1};
 const graph:TaskGraph={graphId:crypto.randomUUID(),goalId:goal.goalId,userGoal:'test',nodes:new Map([[node.id,node]]),status:'RUNNING',createdAt:Date.now(),updatedAt:Date.now()};
 return {node,graph};
}
describe('canonical execution ownership',()=>{
 it('isolates concurrent async calls and keeps retry identity stable',async()=>{
  const fixtures=[fixture(),fixture()];
  await Promise.all(fixtures.map(async({graph,node})=>{
   for(let attempt=1;attempt<=2;attempt++){
    node.retryCount=attempt;
    await withNodeExecution(graph,node,undefined,async()=>{
     await new Promise(resolve=>setTimeout(resolve,10));
     expect(currentExecutionIdentity()).toEqual({goalId:graph.goalId,graphId:graph.graphId,nodeId:node.id,operation:'test',attempt});
    });
   }
  }));
  expect(currentExecutionIdentity()).toBeUndefined();
  expect(()=>assertExecutionActive()).toThrow('IDENTITY_REQUIRED');
 });
 it('refuses durable cancellation before nested tool handler dispatch',async()=>{
  const {graph,node}=fixture(); let dispatched=false;
  const tools=new ToolRegistry();tools.register({name:'probe',description:'test',parameters:[],handler:async()=>{dispatched=true;return 'done';}});
  await expect(withNodeExecution(graph,node,undefined,async()=>{
   rawDb.prepare('UPDATE goal_runs SET status=? WHERE goal_id=?').run('CANCELLED',graph.goalId);
   await expect(tools.execute('probe',{})).rejects.toThrow('NOT_EXECUTABLE');
  })).rejects.toThrow('NOT_EXECUTABLE');
 expect(dispatched).toBe(false);
 });
 it('does not accept a returned success after durable goal cancellation',async()=>{
  const {graph,node}=fixture();
  await expect(withNodeExecution(graph,node,undefined,async()=>{
   rawDb.prepare('UPDATE goal_runs SET status=? WHERE goal_id=?').run('CANCELLED',graph.goalId);
   return {success:true};
  })).rejects.toThrow('NOT_EXECUTABLE');
 });
 it('refuses unknown goals, substituted nodes, and aborted ownership',async()=>{
  const {graph,node}=fixture();
  await expect(withNodeExecution({...graph,goalId:'missing'},node,undefined,async()=>true)).rejects.toThrow('NOT_EXECUTABLE');
  await expect(withNodeExecution(graph,{...node},undefined,async()=>true)).rejects.toThrow('MISMATCH');
  const abort=new AbortController();abort.abort();
  await expect(withNodeExecution(graph,node,abort.signal,async()=>true)).rejects.toThrow('CANCELLED');
 });
});
