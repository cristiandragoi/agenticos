/** Supervisor-only execution contract. Native WindowsJob is implemented; production enrollment is separate. */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { prepareGitPlan, type GitPlan } from '../localWorker/structuredGit.js';
export interface OsJob {
  // A native implementation must create suspended, assign to kill-on-close job, then resume.
  run(plan: GitPlan, onOutput: (chunk: Buffer) => void): Promise<number>;
  terminateAndWait(): Promise<void>;
}
export interface GitResult { exitCode: number; output: string; cleanup: 'OS_JOB_CONFIRMED'; }
export async function runSupervisorGit(operation: string, input: Record<string,unknown>, job?: OsJob,
  expected?: {executable:string;executableSha256:string;repository:string}): Promise<GitResult> {
  if (!job) throw new Error('GIT_OS_JOB_BOUNDARY_UNAVAILABLE');
  const plan=prepareGitPlan(operation,input);
  if(expected && (plan.executable!==expected.executable || plan.executableSha256!==expected.executableSha256 || plan.cwd!==expected.repository))
    throw new Error('APPROVAL_EXECUTABLE_OR_REPOSITORY_CHANGED');
  if (createHash('sha256').update(fs.readFileSync(plan.executable)).digest('hex') !== plan.executableSha256)
    throw new Error('GIT_EXECUTABLE_CHANGED');
  const chunks: Buffer[]=[]; let size=0; let timer: ReturnType<typeof setTimeout> | undefined;
  let failed: Error | undefined;
  let rejectLimit!: (error: Error) => void;
  const limit = new Promise<never>((_,reject)=>{ rejectLimit=reject; });
  const fail=(message: string)=>{ failed ??= new Error(message); rejectLimit(failed); };
  try {
    timer=setTimeout(()=>fail('GIT_TIMEOUT'),plan.timeoutMs);
    const exitCode=await Promise.race([limit,job.run(plan,chunk=>{
      if (failed) return;
      const remaining=plan.maxOutputBytes-size;
      chunks.push(Buffer.from(chunk.subarray(0,Math.max(0,remaining)))); size+=Math.min(remaining,chunk.length);
      if (chunk.length>remaining) fail('GIT_OUTPUT_LIMIT');
    })]);
    if (failed) throw failed;
    return {exitCode,output:Buffer.concat(chunks).toString('utf8'),cleanup:'OS_JOB_CONFIRMED'};
  } finally {
    if(timer) clearTimeout(timer);
    // Adapter contract must be bounded and acknowledge termination of ALL descendants, including on success.
    // Synthetic adapters test the contract; WindowsJob tests exercise actual OS job accounting.
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([job.terminateAndWait(),new Promise<never>((_,reject)=>{
        cleanupTimer=setTimeout(()=>reject(new Error('GIT_OS_CLEANUP_UNCONFIRMED')),2000);
      })]);
    } finally { if(cleanupTimer)clearTimeout(cleanupTimer); }
  }
}
