/** Supervisor-only signed Git dispatch; no HTTP/tool registration or private key access. */
import {approvalHash,canonical,type ApprovalBinding,type ApprovalPayload,ApprovalVerifier} from './approvalVerifier.js';
import {prepareGitPlan} from '../localWorker/structuredGit.js';
import {runSupervisorGit,type OsJob} from './gitSupervisor.js';

export type SupervisorIdentity=Pick<ApprovalBinding,'goalId'|'graphId'|'nodeId'|'workerId'|'operation'|'attempt'>;
function context(identity:SupervisorIdentity,operation:string,input:Record<string,unknown>) {
  const plan=prepareGitPlan(operation,input);
  const scope={repository:plan.cwd,executable:plan.executable,executableSha256:plan.executableSha256};
  const args={operation,...input};
  const preview=`Read-only Git ${operation} in ${plan.cwd}`;
  const binding:ApprovalBinding={...identity,tool:`git.${operation}`,scopeHash:approvalHash(scope),argumentHash:approvalHash(args),previewHash:approvalHash(preview)};
  return {binding,scope,args,preview};
}
export class ApprovedGitSupervisor {
  constructor(private verifier:ApprovalVerifier,
    // Must resolve live supervisor-owned state, never request-supplied identity.
    private currentIdentity:()=>SupervisorIdentity,
    private createJob:()=>OsJob) {}
  prepare(operation:string,input:Record<string,unknown>={}) {
    const data=context(this.currentIdentity(),operation,input),now=Date.now();
    const challenge=this.verifier.challenge(data.binding,now);
    const payload:ApprovalPayload={...data.binding,...challenge,version:1,issuer:'agenticos-interactive-issuer',issuedAt:now,secondConfirmation:true};
    return {payload,canonical:canonical(payload),preview:data.preview,arguments:data.args,scope:data.scope};
  }
  async execute(operation:string,input:Record<string,unknown>,payload:ApprovalPayload,signature:string) {
    const before=context(this.currentIdentity(),operation,input);
    this.verifier.consume(payload,signature,before.binding);
    // Any failure after consumption burns the nonce; never refund an authorization.
    const after=context(this.currentIdentity(),operation,input);
    if(canonical(after.binding)!==canonical(before.binding))throw new Error('APPROVAL_CONTEXT_CHANGED_BEFORE_DISPATCH');
    return runSupervisorGit(operation,input,this.createJob(),before.scope);
  }
}
