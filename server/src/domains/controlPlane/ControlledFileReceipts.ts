import { createHash, randomUUID } from 'node:crypto';
import { rawDb } from '../../db/index.js';
import { assertExecutionActive, type ExecutionIdentity } from './taskGraph/ExecutionIdentity.js';

// Producer continuity receipts are NOT independent verification evidence.
export const FILE_RECEIPT_POLICY = 'controlled-file-data/v2';
export const FILE_RECEIPT_TTL = 5 * 60_000;
export interface FileReceipt {
  conversation_id:string; file_path:string; expected:string; generation:number;
  expires_at:number; owner_token:string|null; binding_json:string;
}
export function contentHash(value:string):string { return createHash('sha256').update(value).digest('hex'); }
function canonical(value:any):any {
  if(Array.isArray(value))return value.map(canonical);
  if(value && typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>[k,canonical(value[k])]));
  return value;
}
export function argumentHash(value:unknown):string {return contentHash(JSON.stringify(canonical(value)));}
function schema() {
  rawDb.exec(`CREATE TABLE IF NOT EXISTS controlled_file_receipts_v2 (
    conversation_id TEXT PRIMARY KEY, file_path TEXT NOT NULL, expected TEXT NOT NULL,
    generation INTEGER NOT NULL, expires_at INTEGER NOT NULL, owner_token TEXT,
    binding_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS controlled_file_receipt_uses (
    execution_key TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, token TEXT NOT NULL UNIQUE,
    binding_json TEXT NOT NULL, state TEXT NOT NULL, created_at INTEGER NOT NULL);`);
}
export function findFileReceipt(conversationId:string):FileReceipt|undefined {
  if(!rawDb.prepare("SELECT 1 FROM sqlite_master WHERE name='controlled_file_receipts_v2'").get())return undefined;
  return rawDb.prepare('SELECT * FROM controlled_file_receipts_v2 WHERE conversation_id=?').get(conversationId) as FileReceipt|undefined;
}
function active(identity:Readonly<ExecutionIdentity>,conversationId:string) {
  const current=assertExecutionActive();
  if(argumentHash(current)!==argumentHash(identity) || !identity.workerId)throw new Error('FILE_RECEIPT_WORKER_IDENTITY_REQUIRED');
  const goal=rawDb.prepare('SELECT conversation_id,status FROM goal_runs WHERE goal_id=?').get(identity.goalId) as any;
  if(goal?.conversation_id!==conversationId || !['EXECUTING','RETRYING_ORIGINAL_GOAL','RECOVERING'].includes(goal.status))throw new Error('FILE_RECEIPT_CANCELLED_OR_WRONG_GOAL');
}
export interface FileReceiptClaim { token:string; executionKey:string; conversationId:string; generation:number; prior?:FileReceipt; identity:Readonly<ExecutionIdentity>; binding:Record<string,any> }
export function claimFileReceipt(conversationId:string,request:any):FileReceiptClaim {
  const identity=assertExecutionActive();schema();
  return rawDb.transaction(()=>{
    active(identity,conversationId);
    const now=Date.now(), prior=findFileReceipt(conversationId);
    if(prior?.owner_token && prior.expires_at>now)throw new Error('FILE_RECEIPT_CONCURRENT_OPERATION');
    if(request.action!=='create') {
      if(!prior || !prior.file_path || prior.expires_at<=now)throw new Error('FILE_RECEIPT_MISSING_OR_EXPIRED');
      if(request.receiptVersion!==prior.generation || request.query!==prior.file_path)throw new Error('FILE_RECEIPT_STALE_VERSION');
      const source=JSON.parse(prior.binding_json);
      const consumed=rawDb.prepare("SELECT binding_json,conversation_id,state FROM controlled_file_receipt_uses WHERE execution_key=?").get(source.sourceExecutionKey) as any;
      const sourceGoal=rawDb.prepare('SELECT status FROM goal_runs WHERE goal_id=?').get(source.goalId) as {status:string}|undefined;
      if(source.policyRef!==FILE_RECEIPT_POLICY || source.policyVersion!==2 || source.evidenceVersion!==prior.generation ||
        source.resourceHash!==contentHash(prior.file_path) || source.contentHash!==contentHash(prior.expected) ||
        !['goalId','graphId','nodeId','operation','workerId'].every(key=>typeof source[key]==='string'&&source[key].length>0) ||
        !Number.isInteger(source.attempt)||source.attempt<1||source.sourceId!=='ControlledFileWorkflow/producer-v2' ||
        source.independent!==false || source.approval?.state!=='NOT_REQUIRED' || source.approval?.reference!==FILE_RECEIPT_POLICY+'#controlled-local-data' ||
        source.expiresAt!==prior.expires_at || source.issuedAt>Date.now() || source.expiresAt<=source.issuedAt ||
        !sourceGoal || sourceGoal.status==='CANCELLED' || !consumed || consumed.state!=='CONSUMED' || consumed.conversation_id!==conversationId || consumed.binding_json!==prior.binding_json)
          throw new Error('FILE_RECEIPT_BINDING_MISMATCH');
    }
    const executionKey=argumentHash(identity),token=randomUUID(),generation=(prior?.generation||0)+1;
    const binding={...identity,argumentHash:argumentHash(request),resourceHash:request.action==='create'?null:contentHash(request.query),
      policyRef:FILE_RECEIPT_POLICY,policyVersion:2,approval:{state:'NOT_REQUIRED',reference:FILE_RECEIPT_POLICY+'#controlled-local-data'},
      evidenceVersion:generation,issuedAt:now,expiresAt:now+FILE_RECEIPT_TTL,predecessorVersion:prior?.generation||0,independent:false,
      sourceId:'ControlledFileWorkflow/producer-v2',sourceExecutionKey:executionKey};
    rawDb.prepare('INSERT INTO controlled_file_receipt_uses VALUES (?,?,?,?,?,?)').run(executionKey,conversationId,token,JSON.stringify(binding),'CLAIMED',now);
    // Reserve one generation atomically; failure/cancellation never revives older data.
    rawDb.prepare('INSERT INTO controlled_file_receipts_v2 VALUES (?,?,?,?,?,?,?) ON CONFLICT(conversation_id) DO UPDATE SET file_path=excluded.file_path,expected=excluded.expected,generation=excluded.generation,expires_at=excluded.expires_at,owner_token=excluded.owner_token,binding_json=excluded.binding_json')
      .run(conversationId,'','',generation,binding.expiresAt,token,JSON.stringify(binding));
    return {token,executionKey,conversationId,generation,prior,identity,binding};
  }).immediate();
}
export function finishFileReceipt(claim:FileReceiptClaim,target:string,expected:string):void {
  rawDb.transaction(()=>{
    active(claim.identity,claim.conversationId);
    const use=rawDb.prepare('SELECT * FROM controlled_file_receipt_uses WHERE execution_key=? AND token=?').get(claim.executionKey,claim.token) as any;
    if(!use || use.state!=='CLAIMED')throw new Error('FILE_RECEIPT_REPLAY');
    const issued=JSON.parse(use.binding_json);
    if(claim.executionKey!==argumentHash(claim.identity) || use.conversation_id!==claim.conversationId ||
      argumentHash(issued)!==argumentHash(claim.binding) || issued.evidenceVersion!==claim.generation)throw new Error('FILE_RECEIPT_BINDING_MISMATCH');
    if(issued.expiresAt<=Date.now())throw new Error('FILE_RECEIPT_EXPIRED');
    const binding={...issued,resourceHash:contentHash(target),contentHash:contentHash(expected)};
    const changed=rawDb.prepare('UPDATE controlled_file_receipts_v2 SET file_path=?,expected=?,owner_token=NULL,binding_json=? WHERE conversation_id=? AND generation=? AND owner_token=? AND expires_at>?')
      .run(target,expected,JSON.stringify(binding),claim.conversationId,claim.generation,claim.token,Date.now());
    if(changed.changes!==1)throw new Error('FILE_RECEIPT_STALE_COMMIT');
    if(rawDb.prepare("UPDATE controlled_file_receipt_uses SET state='CONSUMED',binding_json=? WHERE execution_key=? AND token=? AND state='CLAIMED'").run(JSON.stringify(binding),claim.executionKey,claim.token).changes!==1)throw new Error('FILE_RECEIPT_REPLAY');
  }).immediate();
}
export function abandonFileReceipt(claim:FileReceiptClaim):void {
  rawDb.transaction(()=>{
    rawDb.prepare('UPDATE controlled_file_receipts_v2 SET file_path=?,expected=?,owner_token=NULL,expires_at=0 WHERE conversation_id=? AND generation=? AND owner_token=?').run('','',claim.conversationId,claim.generation,claim.token);
    rawDb.prepare("UPDATE controlled_file_receipt_uses SET state='ABANDONED' WHERE execution_key=? AND token=? AND state='CLAIMED'").run(claim.executionKey,claim.token);
  }).immediate();
}
