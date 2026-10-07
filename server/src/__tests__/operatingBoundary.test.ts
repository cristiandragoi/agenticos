import {describe,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {ToolRegistry} from '../services/agent/toolRegistry.js';
import {capabilityPermissionStore} from '../domains/controlPlane/CapabilityPermissionStore.js';
import {rawDb} from '../db/index.js';
import {appendGraphEvidence,readGraphEvidence,verifyGraphEvidence} from '../domains/controlPlane/taskGraph/TaskGraphJournal.js';
import {autonomousExecutionKernel} from '../domains/controlPlane/taskGraph/AutonomousExecutionKernel.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

describe('operating boundaries',()=>{
 it('rechecks disabled and revoked tools even when a model has an old schema',async()=>{
  const registry=new ToolRegistry(),handler=vi.fn(async()=> 'done');let enabled=true;
  registry.register({name:'fixture',description:'test',parameters:[],enabled:()=>enabled,handler});
  expect(registry.getToolSchemas()).toHaveLength(1);enabled=false;
  await expect(registry.execute('fixture',{})).rejects.toThrow('disabled');
  enabled=true;registry.revoke('fixture');
  await expect(registry.execute('fixture',{})).rejects.toThrow('Unknown');expect(handler).not.toHaveBeenCalled();
 });
 it('rejects invalid arguments before handler invocation',async()=>{
  const registry=new ToolRegistry(),handler=vi.fn(async()=> 'done');
  registry.register({name:'fixture',description:'test',parameters:[{name:'path',type:'string',description:'path',required:true}],handler});
  await expect(registry.execute('fixture',{path:3})).rejects.toThrow('Invalid');
  await expect(registry.execute('fixture',{})).rejects.toThrow('Missing');expect(handler).not.toHaveBeenCalled();
 });
 it('denies unknown capability and observes durable revocation without restarting',()=>{
  const name=`test.${randomUUID()}`;
  expect(capabilityPermissionStore.isAllowed(name)).toBe(false);
  rawDb.prepare('INSERT INTO capability_permissions VALUES (?,?,?)').run(name,'allowed',new Date().toISOString());
  expect(capabilityPermissionStore.isAllowed(name)).toBe(true);
  rawDb.prepare('UPDATE capability_permissions SET state=? WHERE capability=?').run('denied',name);
  expect(capabilityPermissionStore.isAllowed(name)).toBe(false);
 });
 it('records actual file execution in ordered immutable graph evidence',async()=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'jarvis-journal-')),file=path.join(folder,'proof.txt');
  try{
   await fs.writeFile(file,'Journal fixture body');
   const result=await autonomousExecutionKernel.executeGoal({userGoal:`Read "${file}"`,schemaVersion:'1',executionMode:'AUTONOMOUS_GOAL',confidence:1,needsClarification:false},{conversationId:randomUUID()});
   expect(result.success).toBe(true);
   const rows=readGraphEvidence(result.taskGraph.graphId);
   expect(rows[0].event).toBe('EXECUTION_REQUESTED');
   expect(rows.at(-1)?.event).toBe('EXECUTION_RETURNED');
   expect(JSON.parse(rows.at(-1)!.snapshot).status).toBe('COMPLETED');
   expect(rows.every(r=>r.goal_id===result.goalRun.goalId)).toBe(true);
   expect(verifyGraphEvidence(result.taskGraph.graphId)).toBe(true);
   expect(()=>rawDb.prepare('DELETE FROM task_graph_journal WHERE graph_id=?').run(result.taskGraph.graphId)).toThrow('append-only');
   expect(()=>rawDb.prepare('UPDATE task_graph_journal SET event=? WHERE graph_id=?').run('altered',result.taskGraph.graphId)).toThrow('append-only');
   result.taskGraph.nodes.values().next().value!.inputs.apiKey='secret-fixture';
   appendGraphEvidence(result.taskGraph,'REDACTION_TEST');
   expect(readGraphEvidence(result.taskGraph.graphId).at(-1)!.snapshot).not.toContain('secret-fixture');
  }finally{await fs.rm(folder,{recursive:true,force:true});}
 });
});
