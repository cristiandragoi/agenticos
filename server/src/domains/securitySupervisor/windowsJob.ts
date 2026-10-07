/** Native process-lifetime boundary. Only a trusted supervisor may construct this adapter. */
import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {GitPlan} from '../localWorker/structuredGit.js';
import type {OsJob} from './gitSupervisor.js';
export interface NativeJobEvidence {
  reason: string; exitCode: number; pid: number; activeProcesses: number; totalProcesses: number;
  assignedBeforeResume: boolean; atomicJobList?: boolean; killOnClose: boolean; outputBase64: string; error?: string;
}
export class WindowsJob implements OsJob {
  private child?: ChildProcessWithoutNullStreams;
  private completion?: Promise<void>;
  private evidence?: NativeJobEvidence;
  constructor(private helper: string, private helperSha256: string) {}
  getEvidence(): Readonly<NativeJobEvidence> | undefined { return this.evidence; }
  async run(plan: GitPlan, onOutput: (chunk: Buffer)=>void): Promise<number> {
    if (this.child || this.completion) throw new Error('OS_JOB_SINGLE_USE');
    if (process.platform!=='win32' || !path.isAbsolute(this.helper) || fs.lstatSync(this.helper).isSymbolicLink() ||
      createHash('sha256').update(fs.readFileSync(this.helper)).digest('hex')!==this.helperSha256)
      throw new Error('OS_JOB_HELPER_IDENTITY_MISMATCH');
    const child=this.child=spawn(this.helper,[],{shell:false,windowsHide:true,env:{SystemRoot:'C:\\Windows',WINDIR:'C:\\Windows'},stdio:'pipe'});
    let buffer=Buffer.alloc(0), diagnostic=Buffer.alloc(0);
    this.completion=new Promise<void>((resolve,reject)=>{
      const deadline=setTimeout(()=>{child.kill();reject(new Error('OS_JOB_HELPER_TIMEOUT'));},plan.timeoutMs+6000);
      child.on('error',error=>{clearTimeout(deadline);reject(error);});
      child.stdout.on('data',(data:Buffer)=>{
        if(buffer.length+data.length>2_000_000){child.kill();reject(new Error('OS_JOB_PROTOCOL_LIMIT'));return;}
        buffer=Buffer.concat([buffer,data]);
      });
      child.stderr.on('data',(data:Buffer)=>{diagnostic=Buffer.concat([diagnostic,data]).subarray(0,4096);});
      child.on('close',()=>{
        clearTimeout(deadline);
        try {
          const result=JSON.parse(buffer.toString('utf8')) as NativeJobEvidence;
          if(!['EXITED','TIMEOUT','CANCELLED','OUTPUT_LIMIT'].includes(result.reason) || result.activeProcesses!==0 ||
            result.assignedBeforeResume!==true || result.killOnClose!==true) throw new Error('OS_JOB_CLEANUP_UNCONFIRMED');
          this.evidence=result;resolve();
        } catch {reject(new Error('OS_JOB_REFUSED_OR_CLEANUP_UNCONFIRMED'));}
      });
    });
    child.stdin.on('error',()=>{});
    child.stdin.write(JSON.stringify(plan)+'\n'); // keep alive until native helper closes
    await this.completion;
    const result=this.evidence!;
    const bytes=Buffer.from(result.outputBase64,'base64');
    if(bytes.length>plan.maxOutputBytes)throw new Error('OS_JOB_OUTPUT_PROTOCOL_LIMIT');
    onOutput(bytes);
    if(result.reason!=='EXITED')throw new Error(`OS_JOB_${result.reason}`);
    return result.exitCode;
  }
  async terminateAndWait(): Promise<void> {
    if (!this.completion) return;
    if(!this.evidence && this.child?.stdin.writable)this.child.stdin.end('cancel\n');
    await this.completion;
    if(this.evidence?.activeProcesses!==0)throw new Error('OS_JOB_CLEANUP_UNCONFIRMED');
  }
}
