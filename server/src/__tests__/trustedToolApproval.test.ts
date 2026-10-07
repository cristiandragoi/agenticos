import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { rawDb } from '../db/index.js';
import { goalLifecycleManager } from '../domains/controlPlane/GoalLifecycle.js';
import { withNodeExecution } from '../domains/controlPlane/taskGraph/ExecutionIdentity.js';
import { authorizeToolDispatch, ensureToolAuthorizationSchema, toolScopeHash } from '../domains/controlPlane/taskGraph/ToolAuthorization.js';
import type { TaskGraph, TaskNode } from '../domains/controlPlane/taskGraph/types.js';

describe('untrusted approval records cannot grant tool authority', () => {
  it.each([
    ['missing', null, null, 'NOT_FOUND'],
    ['pending', 'pending', 60_000, 'NOT_APPROVED'],
    ['rejected/revoked', 'rejected', 60_000, 'NOT_APPROVED'],
    ['expired', 'approved', -1000, 'EXPIRED'],
    ['malformed expiry', 'approved', NaN, 'EXPIRED'],
    ['caller-asserted human', 'approved', 60_000, 'HUMAN_AUTHENTICATION_UNAVAILABLE'],
    ['storage failure', 'approved', 60_000, 'SERVICE_UNAVAILABLE'],
  ])('%s is refused before consuming a grant or dispatching', async (label, state, offset, error) => {
    ensureToolAuthorizationSchema();
    // Minimal fixture of the existing service's persistence contract, isolated DB.
    rawDb.exec('CREATE TABLE IF NOT EXISTS mcp_prepared_tasks (id TEXT PRIMARY KEY, approval_state TEXT, expires_at TEXT)');
    const ref=randomUUID(), grantId=randomUUID();
    if(state) rawDb.prepare('INSERT INTO mcp_prepared_tasks(id,approval_state,expires_at) VALUES (?,?,?)')
      .run(ref,state,Number.isFinite(offset) ? new Date(Date.now()+Number(offset)).toISOString() : 'invalid');
    const goal=goalLifecycleManager.startGoal({conversationId:randomUUID(),userInput:'approval denial fixture'});
    goalLifecycleManager.transitionState(goal.goalId,'PLANNING',{actor:'ControlPlane',summary:'fixture'});
    goalLifecycleManager.transitionState(goal.goalId,'EXECUTING',{actor:'ControlPlane',summary:'fixture'});
    const node:TaskNode={id:randomUUID(),capability:'fixture',operation:'READ',inputs:{},outputs:{},dependsOn:[],status:'RUNNING',retryCount:1};
    const graph:TaskGraph={graphId:randomUUID(),goalId:goal.goalId,userGoal:'fixture',nodes:new Map([[node.id,node]]),status:'RUNNING',createdAt:Date.now(),updatedAt:Date.now()};
    rawDb.prepare('INSERT INTO tool_authorization_grants VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(grantId,goal.goalId,graph.graphId,node.id,'READ',1,'fixture',toolScopeHash({}),ref,'claimed-human',Date.now()-1,Date.now()+60_000,null,1,10);
    let spy: ReturnType<typeof vi.spyOn> | undefined;
    if(label==='storage failure') {
      const original=rawDb.prepare.bind(rawDb);
      spy=vi.spyOn(rawDb,'prepare').mockImplementation(((sql:string)=>{
        if(sql.includes('SELECT approval_state')) throw new Error('private database details');
        return original(sql);
      }) as any);
    }
    try {
      await expect(withNodeExecution(graph,node,undefined,async()=>authorizeToolDispatch('fixture',{}))).rejects.toThrow('TOOL_APPROVAL_'+error);
    } finally { spy?.mockRestore(); }
    expect(rawDb.prepare('SELECT uses_remaining FROM tool_authorization_grants WHERE id=?').get(grantId)).toEqual({uses_remaining:1});
    expect(rawDb.prepare('SELECT COUNT(*) AS n FROM tool_authorization_dispatches WHERE grant_id=?').get(grantId)).toEqual({n:0});
  });
});
