/** Controlled Phase 2 boundary. Not enrolled in runtime tool dispatch. No token/filesystem/network isolation. */
import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
export interface RuntimeIdentityRecord { runtime:{incarnation:string;workerId:string}; [key:string]:unknown }
export interface JobLimits {activeProcessLimit:number;processMemoryMb:number;jobMemoryMb:number;cpuTimeMs:number;cpuRate:number}
export interface JobPlan {executable:string;executableSha256:string;cwd:string;args:string[];env:Record<string,string>;timeoutMs:number;maxOutputBytes:number;limits:JobLimits}
export interface JobEvidence {reason:string;exitCode:number;activeProcesses:number;assignedBeforeResume:boolean;killOnClose:boolean;runtimeIncarnation:string;identityHash:string;outputBase64:string;[key:string]:unknown}
export const sha256=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
/** Supervisor-owned registry; caller must supply an independently validated Phase 1 record.
 * This phase tests that binding with synthetic Phase 1 validation, not installed identity assurance. */
export class IncarnationJobs {
 private invalid=new Set<string>(); private identities=new Map<string,string>();
 private active=new Map<string,Set<ContainedJob>>();
 constructor(private tombstoneDirectory:string){
  if(!path.isAbsolute(tombstoneDirectory))throw Error('TOMBSTONE_PATH_REQUIRED');
  fs.mkdirSync(tombstoneDirectory,{recursive:true});
 }
 private tombstone(id:string){return path.join(this.tombstoneDirectory,sha256(id)+'.revoked');}
 private revoked(id:string){return this.invalid.has(id)||fs.existsSync(this.tombstone(id));}
 register(record:RuntimeIdentityRecord,validate:(record:RuntimeIdentityRecord)=>boolean):string {
  const id=record?.runtime?.incarnation;
  if(!id||!record.runtime.workerId||this.revoked(id)||validate(structuredClone(record))!==true)throw Error('INCARNATION_REFUSED');
  const hash=sha256(JSON.stringify(canonical(record)));
  if(this.identities.has(id)&&this.identities.get(id)!==hash){void this.invalidate(id);throw Error('INCARNATION_CHANGED');}
  this.identities.set(id,hash);return hash;
 }
 create(id:string,helper:string,helperHash:string):ContainedJob {
  if(this.revoked(id)||!this.identities.has(id))throw Error('INCARNATION_INVALIDATED');
  const job=new ContainedJob(helper,helperHash,id,this.identities.get(id)!,()=>!this.revoked(id));
  if(!this.active.has(id))this.active.set(id,new Set());this.active.get(id)!.add(job);return job;
 }
 async invalidate(id:string):Promise<void>{
  this.invalid.add(id);let error:unknown;
  try{const fd=fs.openSync(this.tombstone(id),'a');try{fs.writeSync(fd,'REVOKED\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}catch(e){error=e;}
  await Promise.all([...this.active.get(id)||[]].map(j=>j.cancel()));if(error)throw error;
 }
}
export class ContainedJob {
 private child?:ChildProcessWithoutNullStreams;private done?:Promise<JobEvidence>;private used=false;
 constructor(private helper:string,private helperHash:string,private incarnation:string,private identityHash:string,private valid:()=>boolean){}
 async run(plan:JobPlan):Promise<JobEvidence>{
  if(this.used||!this.valid())throw Error('INCARNATION_OR_JOB_REFUSED');this.used=true;
  if(process.platform!=='win32'||!path.isAbsolute(this.helper)||fs.lstatSync(this.helper).isSymbolicLink()||sha256(fs.readFileSync(this.helper))!==this.helperHash)throw Error('HELPER_IDENTITY');
  const c=this.child=spawn(this.helper,[],{shell:false,windowsHide:true,env:{SystemRoot:'C:\\Windows',WINDIR:'C:\\Windows'},stdio:'pipe'});
  this.done=new Promise((resolve,reject)=>{
   let out=Buffer.alloc(0);const timer=setTimeout(()=>{c.kill();reject(Error('HELPER_TIMEOUT'));},plan.timeoutMs+6000);
   c.on('error',e=>{clearTimeout(timer);reject(e);});c.stdin.on('error',()=>{});
   c.stdout.on('data',(b:Buffer)=>{if(out.length+b.length>2000000){c.kill();reject(Error('PROTOCOL_LIMIT'));}else out=Buffer.concat([out,b]);});
   c.stderr.resume();c.on('close',()=>{clearTimeout(timer);try{
    const e=JSON.parse(out.toString()) as JobEvidence;
    if(e.reason==='REFUSED')throw Error('NATIVE_REFUSED');
    if(e.activeProcesses!==0||e.assignedBeforeResume!==true||e.killOnClose!==true||e.runtimeIncarnation!==this.incarnation||e.identityHash!==this.identityHash)throw Error('CLEANUP_OR_BINDING');
    resolve(e);
   }catch(e){reject(e);}});
  });
  c.stdin.write(JSON.stringify({...plan,...plan.limits,runtimeIncarnation:this.incarnation,identityHash:this.identityHash})+'\n');
  return this.done;
 }
 async cancel():Promise<void>{if(this.child?.stdin.writable)this.child.stdin.end('invalidate\n');if(this.done)await this.done;}
}
