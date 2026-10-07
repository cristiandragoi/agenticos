import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';

export function evidenceHash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
export interface VerificationBinding {
 goalId:string; graphId:string; nodeId:string; operation:string; attempt:number; workerId:string;
 producer:{actorId:string;executionPath:string}; policyRef:string; policyVersion:number;
 approval:{required:boolean;state:'NOT_REQUIRED'|'VERIFIED';reference?:string};
 postcondition:{id:string;definition:string;expectedHash:string};
 argumentHash:string;resourceHash:string;evidenceVersion:number;expiresAt:number;
}
export interface IndependentObservation { hash:string;sourceId:string;observedAt:number;validUntil:number;version:number; }
export interface IndependentObserver { id:string;actorId:string;executionPath:string;observe(binding:Readonly<VerificationBinding>):Promise<IndependentObservation>; }
export interface VerificationProof { receiptId:string;binding:VerificationBinding;observer:{id:string;actorId:string;executionPath:string};evidence:IndependentObservation;verifiedAt:number; }
const issuedProofs=new WeakMap<object,()=>boolean>();
export function isCurrentVerificationProof(proof:unknown,goalId:string):proof is VerificationProof {
 if(!proof||typeof proof!=='object'||(proof as VerificationProof).binding?.goalId!==goalId)return false;
 try{return issuedProofs.get(proof)?.()===true;}catch{return false;}
}
type Row={id:string;binding:string;state:string;generation:number;pending:number;created_at:number;evidence:string|null;observer:string|null};
const fail=(why:string):never=>{throw new Error(`INDEPENDENT_VERIFICATION_${why}`);};
const nonempty=(v:unknown)=>typeof v==='string'&&v.trim().length>0;
const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);

/** Supervisor-only service. Never expose construction, observer registration or callbacks to a worker/RPC. */
export class IndependentVerificationGate {
 private readonly observers:Map<string,IndependentObserver>;
 private readonly now:()=>number;
 constructor(private readonly db:Database.Database, private readonly options:{observers:IndependentObserver[];now?:()=>number;validateBinding?:(binding:VerificationBinding)=>boolean;resolvePolicy?:(reference:string,version:number)=>{approvalRequired:boolean;approvalReference:string}|undefined;validateApproval?:(binding:VerificationBinding)=>boolean}) {
  this.now=options.now??Date.now;this.observers=new Map();
  for(const observer of options.observers){if(!nonempty(observer.id)||!nonempty(observer.actorId)||!nonempty(observer.executionPath)||this.observers.has(observer.id))fail('OBSERVER_REGISTRY_INVALID');this.observers.set(observer.id,Object.freeze({...observer}));}
  db.exec(`CREATE TABLE IF NOT EXISTS independent_verification_receipts(id TEXT PRIMARY KEY,binding TEXT NOT NULL,state TEXT NOT NULL,generation INTEGER NOT NULL,pending INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,evidence TEXT,observer TEXT);
   CREATE UNIQUE INDEX IF NOT EXISTS independent_verification_operation ON independent_verification_receipts(json_extract(binding,'$.goalId'),json_extract(binding,'$.graphId'),json_extract(binding,'$.nodeId'),json_extract(binding,'$.operation'),json_extract(binding,'$.attempt'));
   CREATE TABLE IF NOT EXISTS independent_verification_cancellations(goal_id TEXT PRIMARY KEY,cancelled_at INTEGER NOT NULL);`);
 }
 private validate(b:VerificationBinding) {
  if(!b||!['goalId','graphId','nodeId','operation','workerId','policyRef','argumentHash','resourceHash'].every(k=>nonempty((b as any)[k]))||!Number.isInteger(b.attempt)||b.attempt<1||!Number.isInteger(b.policyVersion)||b.policyVersion<1||!Number.isInteger(b.evidenceVersion)||b.evidenceVersion<1)fail('BINDING_MISSING');
  if(!nonempty(b.producer?.actorId)||!nonempty(b.producer?.executionPath)||!nonempty(b.postcondition?.id)||!nonempty(b.postcondition?.definition)||!hash(b.postcondition.expectedHash)||!hash(b.argumentHash)||!hash(b.resourceHash))fail('POSTCONDITION_OR_HASH_MISSING');
  const policy=this.options.resolvePolicy?.(b.policyRef,b.policyVersion);
  if(!policy||typeof policy.approvalRequired!=='boolean'||!nonempty(policy.approvalReference))fail('POLICY_UNVERIFIED');
  if(!b.approval||typeof b.approval.required!=='boolean'||!nonempty(b.approval.reference)||b.approval.required!==policy!.approvalRequired||(b.approval.required?(b.approval.state!=='VERIFIED'||this.options.validateApproval?.(b)!==true):(b.approval.state!=='NOT_REQUIRED'||b.approval.reference!==policy!.approvalReference)))fail('APPROVAL_UNVERIFIED');
  if(this.options.validateBinding?.(JSON.parse(JSON.stringify(b)))!==true)fail('CANONICAL_BINDING_UNVERIFIED');
  if(!Number.isFinite(b.expiresAt)||b.expiresAt<=this.now())fail('EXPIRED');
 }
 private active(row:Row) {
  const b=JSON.parse(row.binding) as VerificationBinding;this.validate(b);
  if(this.db.prepare('SELECT 1 FROM independent_verification_cancellations WHERE goal_id=?').get(b.goalId))fail('CANCELLED');
  if(this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='goal_runs'").get()) {
   const goal=this.db.prepare('SELECT status FROM goal_runs WHERE goal_id=?').get(b.goalId) as {status:string}|undefined;
   if(goal&&/CANCEL|SUPERSEDED/.test(goal.status))fail('CANCELLED');
  }
  if(row.state==='VERIFIED')fail('REPLAY');if(row.state==='CANCELLED')fail('CANCELLED');if(row.state==='CONTRADICTORY')fail('CONTRADICTORY');return b;
 }
 private row(id:string):Row {return (this.db.prepare('SELECT * FROM independent_verification_receipts WHERE id=?').get(id) as Row)||fail('RECEIPT_UNKNOWN');}
 private validateEvidence(evidence:IndependentObservation,b:VerificationBinding,r:Row) {
  if(!evidence||!hash(evidence.hash)||!nonempty(evidence.sourceId)||!Number.isFinite(evidence.observedAt)||!Number.isFinite(evidence.validUntil))fail('EVIDENCE_MISSING');
  if(evidence.version!==b.evidenceVersion||evidence.observedAt<r.created_at||evidence.observedAt>this.now()||evidence.validUntil<=this.now()||evidence.validUntil>b.expiresAt||evidence.validUntil<=evidence.observedAt)fail('STALE_EVIDENCE');
 }
 begin(binding:VerificationBinding):string {
  return this.db.transaction(()=>{this.validate(binding);const id=randomUUID();const row:Row={id,binding:JSON.stringify(binding),state:'PENDING',generation:0,pending:0,created_at:this.now(),evidence:null,observer:null};this.active(row);this.db.prepare('INSERT INTO independent_verification_receipts(id,binding,state,generation,created_at) VALUES(?,?,?,?,?)').run(id,row.binding,row.state,0,row.created_at);return id;}).immediate();
 }
 recordSuccess(id:string):'SUCCEEDED' {return this.db.transaction(()=>{const r=this.row(id);this.active(r);if(r.state!=='PENDING')fail('REPLAY');this.db.prepare("UPDATE independent_verification_receipts SET state='SUCCEEDED' WHERE id=?").run(id);return 'SUCCEEDED' as const;}).immediate();}
 async runObserver(id:string,observerId:string):Promise<void> {
  const observer=this.observers.get(observerId)||fail('OBSERVER_UNKNOWN');
  const snapshot=this.db.transaction(()=>{const r=this.row(id);const b=this.active(r);if(r.state!=='SUCCEEDED')fail('HANDLER_NOT_SUCCEEDED');if(observer.actorId===b.producer.actorId||observer.executionPath===b.producer.executionPath)fail('SELF_VERIFICATION');this.db.prepare('UPDATE independent_verification_receipts SET pending=pending+1 WHERE id=?').run(id);return {r,b};}).immediate();
  let evidence:IndependentObservation; try { evidence=await observer.observe(JSON.parse(JSON.stringify(snapshot.b))); } catch(error) { this.db.prepare("UPDATE independent_verification_receipts SET pending=pending-1 WHERE id=?").run(id); throw error; }
  try { const error=this.db.transaction(()=>{
   const r=this.row(id);const b=this.active(r);
   this.validateEvidence(evidence,b,r);
   if(evidence.hash!==b.postcondition.expectedHash){this.db.prepare("UPDATE independent_verification_receipts SET state='CONTRADICTORY',generation=generation+1 WHERE id=?").run(id);return 'CONTRADICTORY';}
   if(r.generation!==snapshot.r.generation)fail('STALE_GENERATION');
   this.db.prepare('UPDATE independent_verification_receipts SET evidence=?,observer=?,generation=generation+1 WHERE id=?').run(JSON.stringify(evidence),JSON.stringify({id:observer.id,actorId:observer.actorId,executionPath:observer.executionPath}),id);return null;
  }).immediate();if(error)fail(error); } finally { this.db.prepare("UPDATE independent_verification_receipts SET pending=pending-1 WHERE id=?").run(id); }
 }
 promote(id:string,commit?:(proof:VerificationProof)=>void):VerificationProof {
  if(commit?.constructor.name==='AsyncFunction')fail('ASYNC_COMMIT_FORBIDDEN');
  const proof=this.db.transaction(()=>{const r=this.row(id);const b=this.active(r);if(r.pending>0)fail('OBSERVER_PENDING');if(r.state!=='SUCCEEDED'||!r.evidence||!r.observer)fail('INDEPENDENT_EVIDENCE_MISSING');const evidence=JSON.parse(r.evidence!) as IndependentObservation;const observer=JSON.parse(r.observer!);
   this.validateEvidence(evidence,b,r);
   if(evidence.hash!==b.postcondition.expectedHash)fail('CONTRADICTORY');
   const registered=this.observers.get(observer?.id);
   if(!registered||observer.actorId!==registered.actorId||observer.executionPath!==registered.executionPath||observer.actorId===b.producer.actorId||observer.executionPath===b.producer.executionPath)fail('SELF_VERIFICATION');
   const proof={receiptId:id,binding:b,observer,evidence,verifiedAt:this.now()};this.db.prepare("UPDATE independent_verification_receipts SET state='VERIFIED',generation=generation+1 WHERE id=? AND state='SUCCEEDED'").run(id);const result=commit?.(proof) as unknown;if(result&&typeof (result as any).then==='function')fail('ASYNC_COMMIT_FORBIDDEN');return proof;
  }).immediate();
  // Structural objects or caller-supplied actor labels cannot become proof capabilities.
  const frozen=JSON.stringify(proof);
  issuedProofs.set(proof,()=>{const row=this.row(id);if(JSON.stringify(proof)!==frozen||row.state!=='VERIFIED'||row.pending!==0||row.binding!==JSON.stringify(proof.binding)||row.evidence!==JSON.stringify(proof.evidence)||row.observer!==JSON.stringify(proof.observer))return false;const binding=this.active({...row,state:'SUCCEEDED'});this.validateEvidence(proof.evidence,binding,row);return true;});
  return proof;
 }
 cancelGoal(goalId:string):void {this.db.transaction(()=>{this.db.prepare('INSERT OR IGNORE INTO independent_verification_cancellations VALUES(?,?)').run(goalId,this.now());this.db.prepare("UPDATE independent_verification_receipts SET state='CANCELLED',generation=generation+1 WHERE json_extract(binding,'$.goalId')=?").run(goalId);}).immediate();}
 status(id:string):string{return this.row(id).state;}
}




