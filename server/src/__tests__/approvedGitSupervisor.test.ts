import {describe,it,expect,beforeEach,afterEach} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,createPublicKey} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import Database from 'better-sqlite3';
import {ApprovalVerifier} from '../domains/securitySupervisor/approvalVerifier.js';
import {ApprovedGitSupervisor} from '../domains/securitySupervisor/approvedGit.js';
import {WindowsJob} from '../domains/securitySupervisor/windowsJob.js';
import {setDedicatedWorkspaceRoot} from '../domains/localWorker/workspaceConfinement.js';
const helper=path.resolve('../.tmp/security-native/JobRunner.exe');
const helperHash=createHash('sha256').update(fs.readFileSync(helper)).digest('hex');
describe('signed approval to native Git dispatch (synthetic issuer identity)',()=>{
 let root:string,db:Database.Database,identity:any,enrolled:ReturnType<typeof createPublicKey>|undefined;
 let verifier:ApprovalVerifier,supervisor:ApprovedGitSupervisor,launches:number;
 beforeEach(()=>{
  root=fs.mkdtempSync(path.join(os.tmpdir(),'agenticos-approved-git-'));const git=path.join(root,'repository','.git');
  fs.mkdirSync(path.join(git,'objects'),{recursive:true});fs.mkdirSync(path.join(git,'refs'));
  fs.writeFileSync(path.join(git,'config'),'[core]\nrepositoryformatversion = 0\nbare = false\n');
  fs.writeFileSync(path.join(git,'HEAD'),'ref: refs/heads/main\n');setDedicatedWorkspaceRoot(root);
  db=new Database(path.join(root,'approvals.sqlite'));enrolled=undefined;launches=0;
  verifier=new ApprovalVerifier(db,()=>enrolled);
  identity={goalId:'fixture-goal',graphId:'fixture-graph',nodeId:'fixture-node',workerId:'fixture-worker',operation:'READ',attempt:1};
  supervisor=new ApprovedGitSupervisor(verifier,()=>({...identity}),()=>{launches++;return new WindowsJob(helper,helperHash);});
 });
 afterEach(()=>{
  db.close();setDedicatedWorkspaceRoot(null);
  if(path.dirname(root)!==os.tmpdir() || !path.basename(root).startsWith('agenticos-approved-git-'))throw Error('unsafe cleanup');
  fs.rmSync(root,{recursive:true,force:true});
 });
 function approve() {
  const request=supervisor.prepare('status');
  const result=spawnSync(path.resolve('../.tmp/security-native/ApprovalProbe.exe'),[],{input:JSON.stringify({...request,now:Date.now()})+'\n',
   env:{SystemRoot:'C:\\Windows'},windowsHide:true,encoding:'utf8',timeout:5000,maxBuffer:65536});
  expect(result.status,result.stderr).toBe(0);const response=JSON.parse(result.stdout),b=Buffer.from(response.publicBlob,'base64');
  enrolled=createPublicKey({key:{kty:'EC',crv:'P-256',x:b.subarray(8,40).toString('base64url'),y:b.subarray(40,72).toString('base64url')},format:'jwk'});
  return {payload:request.payload,signature:response.signature};
 }
 it('verifies native signature, executes native job once, and rejects replay before launch',async()=>{
  const approval=approve();expect(await supervisor.execute('status',{},approval.payload,approval.signature)).toMatchObject({exitCode:0,cleanup:'OS_JOB_CONFIRMED'});
  await expect(supervisor.execute('status',{},approval.payload,approval.signature)).rejects.toThrow('REPLAY');expect(launches).toBe(1);
 });
 it('blocks cross-worker substitution before creating a job',async()=>{
  const approval=approve();identity.workerId='other-worker';
  await expect(supervisor.execute('status',{},approval.payload,approval.signature)).rejects.toThrow('BINDING_MISMATCH');expect(launches).toBe(0);
 });
 it('blocks revocation before creating a job',async()=>{
  const approval=approve();verifier.revoke(approval.payload.nonce);
  await expect(supervisor.execute('status',{},approval.payload,approval.signature)).rejects.toThrow('REVOKED');expect(launches).toBe(0);
 });
 it('blocks key unavailability before creating a job',async()=>{
  const approval=approve();enrolled=undefined;
  await expect(supervisor.execute('status',{},approval.payload,approval.signature)).rejects.toThrow('KEY_UNAVAILABLE');expect(launches).toBe(0);
 });
 it('retains consumed nonce across database close and reopen',async()=>{
  const approval=approve();await supervisor.execute('status',{},approval.payload,approval.signature);
  db.close();db=new Database(path.join(root,'approvals.sqlite'));
  const reopened=new ApprovalVerifier(db,()=>enrolled);
  const next=new ApprovedGitSupervisor(reopened,()=>({...identity}),()=>{launches++;return new WindowsJob(helper,helperHash);});
  await expect(next.execute('status',{},approval.payload,approval.signature)).rejects.toThrow('REPLAY');expect(launches).toBe(1);
 });
});
