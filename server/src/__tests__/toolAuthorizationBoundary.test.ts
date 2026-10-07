import {describe,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {rawDb} from '../db/index.js';
import {goalLifecycleManager} from '../domains/controlPlane/GoalLifecycle.js';
import {withNodeExecution} from '../domains/controlPlane/taskGraph/ExecutionIdentity.js';
import {bindExecutionIdentity,currentExecutionIdentity,assertExecutionActive} from '../domains/controlPlane/taskGraph/ExecutionIdentity.js';
import {leaseBrowserHandle} from '../domains/controlPlane/browser/BrowserHandleLease.js';
import {ensureToolAuthorizationSchema,toolScopeHash} from '../domains/controlPlane/taskGraph/ToolAuthorization.js';
import {ToolRegistry} from '../services/agent/toolRegistry.js';
import {assertSideEffectOwnership} from '../domains/jarvis/perception/turnOwnership.js';
import type {TaskGraph,TaskNode} from '../domains/controlPlane/taskGraph/types.js';

// These tests exercise grant accounting only. Real approval denial is covered
// separately; this mock must never be interpreted as human-approval acceptance.
vi.mock('../domains/controlPlane/taskGraph/TrustedToolApproval.js',()=>({assertTrustedToolApproval:vi.fn()}));

function setup(){
 ensureToolAuthorizationSchema();
 const goal=goalLifecycleManager.startGoal({conversationId:randomUUID(),userInput:'authorization fixture'});
 goalLifecycleManager.transitionState(goal.goalId,'PLANNING',{actor:'ControlPlane',summary:'fixture'});
 goalLifecycleManager.transitionState(goal.goalId,'EXECUTING',{actor:'ControlPlane',summary:'fixture'});
 const node:TaskNode={id:randomUUID(),capability:'fixture',operation:'READ',inputs:{},outputs:{},dependsOn:[],status:'RUNNING',retryCount:1};
 const graph:TaskGraph={graphId:randomUUID(),goalId:goal.goalId,userGoal:'fixture',nodes:new Map([[node.id,node]]),status:'RUNNING',createdAt:Date.now(),updatedAt:Date.now()};
 const handler=vi.fn(async()=> 'read result'),registry=new ToolRegistry();
 registry.register({name:'read_fixture',description:'fixture',parameters:[],handler});
 const scope={path:'fixture.txt'};
 const grant=(overrides:Record<string,unknown>={})=>{
  const row={id:randomUUID(),goal_id:graph.goalId,graph_id:graph.graphId,node_id:node.id,operation:node.operation,attempt:1,tool:'read_fixture',scope_hash:toolScopeHash(scope),approval_ref:'test-only-human-decision',approved_by:'test-fixture',approved_at:Date.now()-100,expires_at:Date.now()+60_000,revoked_at:null,uses_remaining:1,calls_per_minute:10,...overrides};
  rawDb.prepare(`INSERT INTO tool_authorization_grants (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(k=>'@'+k).join(',')})`).run(row);return row.id;
 };
 const run=(fn:()=>Promise<unknown>)=>withNodeExecution(graph,node,undefined,fn);
 return {graph,node,handler,registry,scope,grant,run};
}
describe('tool authorization enforcement',()=>{
 it('rejects legacy tools and side effects without canonical ownership',async()=>{
  const f=setup();
  await expect(f.registry.execute('read_fixture',f.scope)).rejects.toThrow('IDENTITY_REQUIRED');
  await expect(f.registry.get('read_fixture')!.handler(f.scope)).rejects.toThrow('IDENTITY_REQUIRED');
  await expect(f.registry.getAllEnabled()[0].handler(f.scope)).rejects.toThrow('IDENTITY_REQUIRED');
  expect(()=>assertSideEffectOwnership('desktop_launch','test')).toThrow('IDENTITY_REQUIRED');
  expect(f.handler).not.toHaveBeenCalled();
 });
 it('rejects caller metadata conflicts and escaped async work',async()=>{
  const f=setup();let release!:()=>void;let late!:Promise<unknown>;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  await f.run(async()=>{
   const identity=currentExecutionIdentity()!;
   expect(()=>bindExecutionIdentity({...identity,goalId:'another-goal'})).toThrow('PROVENANCE_CONFLICT');
   late=gate.then(()=>assertExecutionActive());
  });
  const assertion=expect(late).rejects.toThrow('SCOPE_CLOSED');release();await assertion;
 });
 it('binds browser facade to execution and session and checks each operation',async()=>{
  const a=setup(),b=setup();const click=vi.fn(()=>undefined);let session=true;
  await a.run(async()=>{
   const handle=leaseBrowserHandle({click},()=>session);
   expect(Object.getPrototypeOf(handle)).toBeNull();
   expect(handle.constructor).toBeUndefined();
   expect(()=>handle.click()).toThrow('AUTHORIZATION_REQUIRED');
   a.grant({tool:'browser.handle.click',scope_hash:toolScopeHash({handle:'page',arguments:[]})});
   handle.click();expect(click).toHaveBeenCalledTimes(1);
   await b.run(async()=>{expect(()=>handle.click()).toThrow('OWNERSHIP_MISMATCH');});
   session=false;expect(()=>handle.click()).toThrow('OWNERSHIP_MISMATCH');
  });
 });
 it('requires permission separately from identity and exact scope',async()=>{
  const f=setup();
  await f.run(async()=>{
   await expect(f.registry.execute('read_fixture',f.scope)).rejects.toThrow('AUTHORIZATION_REQUIRED');
   f.grant();
   await expect(f.registry.execute('read_fixture',{path:'another.txt'})).rejects.toThrow('AUTHORIZATION_REQUIRED');
   expect(await f.registry.execute('read_fixture',f.scope)).toBe('read result');
  });
  expect(f.handler).toHaveBeenCalledTimes(1);
 });
 it('denies expiry and durable revocation',async()=>{
  const f=setup();f.grant({expires_at:Date.now()-1});
  const id=f.grant();rawDb.prepare('UPDATE tool_authorization_grants SET revoked_at=? WHERE id=?').run(Date.now(),id);
  await f.run(async()=>{await expect(f.registry.execute('read_fixture',f.scope)).rejects.toThrow('AUTHORIZATION_REQUIRED');});
  expect(f.handler).not.toHaveBeenCalled();
 });
 it('consumes single-use permission atomically under concurrent replay',async()=>{
  const f=setup();f.grant();
  await f.run(async()=>{
   const results=await Promise.allSettled([f.registry.execute('read_fixture',f.scope),f.registry.execute('read_fixture',f.scope)]);
   expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  });
  expect(f.handler).toHaveBeenCalledTimes(1);
 });
 it('does not transfer grants across goals or retries',async()=>{
  const a=setup(),b=setup();a.grant();
  await b.run(async()=>{await expect(b.registry.execute('read_fixture',b.scope)).rejects.toThrow('AUTHORIZATION_REQUIRED');});
  a.node.retryCount=2;
  await a.run(async()=>{await expect(a.registry.execute('read_fixture',a.scope)).rejects.toThrow('AUTHORIZATION_REQUIRED');});
 });
 it('enforces durable rate limits independently of remaining uses',async()=>{
  const f=setup();f.grant({uses_remaining:2,calls_per_minute:1});
  await f.run(async()=>{
   await f.registry.execute('read_fixture',f.scope);
   await expect(f.registry.execute('read_fixture',f.scope)).rejects.toThrow('RATE_LIMITED');
  });
  expect(f.handler).toHaveBeenCalledTimes(1);
 });
 it('fails closed if an authorization query fails',async()=>{
  const f=setup();f.grant();
  await f.run(async()=>{
   const original=rawDb.prepare.bind(rawDb);
   const spy=vi.spyOn(rawDb,'prepare').mockImplementation(((sql:string)=>{
    if(sql.includes('SELECT * FROM tool_authorization_grants'))throw new Error('fixture storage unavailable');
    return original(sql);
   }) as any);
   try{await expect(f.registry.execute('read_fixture',f.scope)).rejects.toThrow('storage unavailable');}finally{spy.mockRestore();}
  });
  expect(f.handler).not.toHaveBeenCalled();
 });
});
