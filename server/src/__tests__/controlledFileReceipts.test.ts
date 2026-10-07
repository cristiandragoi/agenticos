import {describe,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {rawDb} from '../db/index.js';
import {goalLifecycleManager} from '../domains/controlPlane/GoalLifecycle.js';
import {withNodeExecution} from '../domains/controlPlane/taskGraph/ExecutionIdentity.js';
import type {TaskGraph,TaskNode} from '../domains/controlPlane/taskGraph/types.js';
import {claimFileReceipt,finishFileReceipt,findFileReceipt,abandonFileReceipt} from '../domains/controlPlane/ControlledFileReceipts.js';

async function scoped<T>(conversationId:string, fn:(goalId:string)=>Promise<T>) {
 const goal=goalLifecycleManager.startGoal({conversationId,userInput:'receipt regression'});
 goalLifecycleManager.transitionState(goal.goalId,'EXECUTING',{summary:'fixture'});
 const node:TaskNode={id:randomUUID(),operation:'LOCAL_FILE_OPERATION',capability:'filesystem',inputs:{},outputs:{},dependsOn:[],status:'RUNNING',retryCount:1};
 const graph:TaskGraph={goalId:goal.goalId,graphId:randomUUID(),userGoal:'receipt regression',nodes:new Map([[node.id,node]]),status:'RUNNING',createdAt:Date.now(),updatedAt:Date.now()};
 return withNodeExecution(graph,node,undefined,()=>fn(goal.goalId),'fixture-worker');
}
async function create(conversationId:string) {
 await scoped(conversationId,async()=>{const claim=claimFileReceipt(conversationId,{action:'create',query:'test.txt'});finishFileReceipt(claim,'controlled/test.txt','literal data');});
 return findFileReceipt(conversationId)!;
}
describe('controlled producer receipt lifecycle',()=>{
 it('binds a consumed receipt to exact source identity without claiming independent evidence',async()=>{
  const id=randomUUID(),receipt=await create(id),binding=JSON.parse(receipt.binding_json);
  expect(binding.workerId).toBe('fixture-worker');expect(binding.independent).toBe(false);
  expect(binding.sourceId).toBe('ControlledFileWorkflow/producer-v2');
  expect(binding.policyVersion).toBe(2);expect(binding.evidenceVersion).toBe(receipt.generation);
  await scoped(id,async()=>{const next=claimFileReceipt(id,{action:'verify',query:receipt.file_path,receiptVersion:receipt.generation});finishFileReceipt(next,receipt.file_path,receipt.expected);});
  expect(findFileReceipt(id)?.generation).toBe(2);
 });
 it('refuses expiry',async()=>{
  const id=randomUUID(),receipt=await create(id);
  rawDb.prepare('UPDATE controlled_file_receipts_v2 SET expires_at=0 WHERE conversation_id=?').run(id);
  await scoped(id,async()=>{expect(()=>claimFileReceipt(id,{action:'verify',query:receipt.file_path,receiptVersion:receipt.generation})).toThrow('EXPIRED');});
 });
 it('refuses replay of a consumed operation',async()=>{
  const id=randomUUID();await scoped(id,async()=>{
   const claim=claimFileReceipt(id,{action:'create',query:'test.txt'});finishFileReceipt(claim,'controlled/test.txt','data');
   expect(()=>finishFileReceipt(claim,'controlled/test.txt','data')).toThrow('REPLAY');
   expect(()=>claimFileReceipt(id,{action:'create',query:'test.txt'})).toThrow();
  });
 });
 it('refuses evidence completion after its issuance validity window',async()=>{
  const id=randomUUID();await scoped(id,async()=>{
   const claim=claimFileReceipt(id,{action:'create',query:'test.txt'});
   const clock=vi.spyOn(Date,'now').mockReturnValue(claim.binding.expiresAt+1);
   try {expect(()=>finishFileReceipt(claim,'controlled/test.txt','data')).toThrow('EXPIRED');}
   finally {clock.mockRestore();abandonFileReceipt(claim);}
  });
 });
 it('refuses continuity from a subsequently cancelled source operation',async()=>{
  const id=randomUUID(),receipt=await create(id),source=JSON.parse(receipt.binding_json);
  rawDb.prepare("UPDATE goal_runs SET status='CANCELLED' WHERE goal_id=?").run(source.goalId);
  await scoped(id,async()=>{expect(()=>claimFileReceipt(id,{action:'verify',query:receipt.file_path,receiptVersion:receipt.generation})).toThrow('BINDING_MISMATCH');});
 });
 it('refuses stale versions and altered content evidence',async()=>{
  const id=randomUUID(),receipt=await create(id);
  await scoped(id,async()=>{expect(()=>claimFileReceipt(id,{action:'verify',query:receipt.file_path,receiptVersion:0})).toThrow('STALE_VERSION');});
  rawDb.prepare('UPDATE controlled_file_receipts_v2 SET expected=? WHERE conversation_id=?').run('contradiction',id);
  await scoped(id,async()=>{expect(()=>claimFileReceipt(id,{action:'verify',query:receipt.file_path,receiptVersion:receipt.generation})).toThrow('BINDING_MISMATCH');});
 });
 it('refuses a producer receipt without its consumed source record',async()=>{
  const id=randomUUID(),receipt=await create(id);
  rawDb.prepare("UPDATE controlled_file_receipt_uses SET state='ABANDONED' WHERE conversation_id=?").run(id);
  await scoped(id,async()=>{expect(()=>claimFileReceipt(id,{action:'verify',query:receipt.file_path,receiptVersion:receipt.generation})).toThrow('BINDING_MISMATCH');});
 });
 it('serializes competing claims and rejects an abandoned late commit',async()=>{
  const id=randomUUID();let release!:()=>void;let entered!:()=>void;
  const waiting=new Promise<void>(r=>release=r),ready=new Promise<void>(r=>entered=r);
  const first=scoped(id,async()=>{const claim=claimFileReceipt(id,{action:'create',query:'test.txt'});entered();await waiting;abandonFileReceipt(claim);expect(()=>finishFileReceipt(claim,'controlled/test.txt','data')).toThrow('REPLAY');});
  await ready;
  try {await scoped(id,async()=>{expect(()=>claimFileReceipt(id,{action:'create',query:'other.txt'})).toThrow('CONCURRENT_OPERATION');});}
  finally {release();await first;}
 });
 it('rejects late producer evidence after durable cancellation',async()=>{
  const id=randomUUID();await expect(scoped(id,async goalId=>{
   const claim=claimFileReceipt(id,{action:'create',query:'test.txt'});
   rawDb.prepare("UPDATE goal_runs SET status='CANCELLED' WHERE goal_id=?").run(goalId);
   expect(()=>finishFileReceipt(claim,'controlled/test.txt','data')).toThrow('CANONICAL_TASK_NOT_EXECUTABLE');
   abandonFileReceipt(claim);
  })).rejects.toThrow('CANONICAL_TASK_NOT_EXECUTABLE');
  expect(findFileReceipt(id)?.file_path).toBe('');
 });
 it('rejects caller mutation of a claimed binding',async()=>{
  const id=randomUUID();await scoped(id,async()=>{const claim=claimFileReceipt(id,{action:'create',query:'test.txt'});claim.binding.argumentHash='forged';expect(()=>finishFileReceipt(claim,'controlled/test.txt','data')).toThrow('BINDING_MISMATCH');abandonFileReceipt(claim);});
 });
});
