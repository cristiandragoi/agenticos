import {describe,it,expect,beforeEach,afterEach,vi} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {prepareGitPlan,GIT_EXECUTABLE,executeWorkerGit} from '../domains/localWorker/structuredGit.js';
import {setDedicatedWorkspaceRoot} from '../domains/localWorker/workspaceConfinement.js';
import {runSupervisorGit} from '../domains/securitySupervisor/gitSupervisor.js';
describe('structured Git confinement (disposable repository, no credentials)',()=>{
 let root:string,repo:string;
 beforeEach(()=>{
  root=fs.mkdtempSync(path.join(os.tmpdir(),'agenticos-git-policy-'));repo=path.join(root,'repository');
  fs.mkdirSync(path.join(repo,'.git'),{recursive:true});
  fs.writeFileSync(path.join(repo,'.git','config'),'[core]\nrepositoryformatversion = 0\nbare = false\n');
  fs.writeFileSync(path.join(repo,'.git','HEAD'),'ref: refs/heads/main\n');
  fs.mkdirSync(path.join(repo,'.git','objects'));fs.mkdirSync(path.join(repo,'.git','refs'));
  setDedicatedWorkspaceRoot(root);
 });
 afterEach(()=>{
  vi.useRealTimers();setDedicatedWorkspaceRoot(null);
  // Checked absolute test root, unique fixture only. No junction fixtures in this suite.
  if(path.dirname(root)!==os.tmpdir() || !path.basename(root).startsWith('agenticos-git-policy-'))throw Error('unsafe cleanup');
  fs.rmSync(root,{recursive:true,force:true});
 });
 it('pins absolute executable, fixed cwd, hooks policy and bounded resources',()=>{
  const p=prepareGitPlan('status');expect(p.executable).toBe(GIT_EXECUTABLE);expect(p.executableSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(p.cwd).toBe(repo);expect(p.shell).toBe(false);expect(p.args).toContain('core.hooksPath=NUL');
  expect(p.timeoutMs).toBe(10000);expect(p.maxOutputBytes).toBe(65536);
 });
 it('never inherits parent credentials, Git settings or loaders',()=>{
  vi.stubEnv('GIT_SSH_COMMAND','untrusted');vi.stubEnv('NODE_OPTIONS','untrusted');vi.stubEnv('FAKE_SECRET','fixture');
  try {const p=prepareGitPlan('status');expect(p.env).not.toHaveProperty('GIT_SSH_COMMAND');expect(p.env).not.toHaveProperty('NODE_OPTIONS');expect(p.env).not.toHaveProperty('FAKE_SECRET');}
  finally {vi.unstubAllEnvs();}
 });
 it.each(['cwd','args','executable','env','config','command','timeoutMs'])('rejects caller %s',key=>expect(()=>prepareGitPlan('status',{[key]:'arbitrary'})).toThrow('ARBITRARY_ARGUMENTS'));
 it.each(['clone','fetch','push','config','checkout','commit','submodule','!cmd'])('rejects %s',op=>expect(()=>prepareGitPlan(op)).toThrow('OPERATION_DISABLED'));
 it.each([0,-1,51,NaN,Infinity,'1;whoami'])('rejects count %s',count=>expect(()=>prepareGitPlan('log',{count})).toThrow('INVALID_COUNT'));
 it.each(['[include]\npath = other','[alias]\nx = !cmd','[core]\nfsmonitor = cmd','[filter "x"]\nsmudge = cmd'])('rejects unreviewed repo config %s',config=>{
  fs.writeFileSync(path.join(repo,'.git','config'),config);expect(()=>prepareGitPlan('status')).toThrow('UNREVIEWED_REPOSITORY_CONFIG');
 });
 it('rejects alternate object storage',()=>{
  fs.mkdirSync(path.join(repo,'.git','objects','info'));fs.writeFileSync(path.join(repo,'.git','objects','info','alternates'),'external');
  expect(()=>prepareGitPlan('status')).toThrow('EXTERNAL_OR_PARTIAL');
 });
 it.each(['status','diff','branch','log'])('executes fixed %s command in controlled fixture only',op=>{
  if(op==='log') {
   const object=(type:string,body:string)=>{const buffer=Buffer.from(`${type} ${Buffer.byteLength(body)}\0${body}`);const hash=createHash('sha1').update(buffer).digest('hex');const dir=path.join(repo,'.git','objects',hash.slice(0,2));fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,hash.slice(2)),deflateSync(buffer));return hash;};
   const tree=object('tree','');const commit=object('commit',`tree ${tree}\nauthor Fixture <fixture@example.invalid> 1 +0000\ncommitter Fixture <fixture@example.invalid> 1 +0000\n\nfixture\n`);
   fs.mkdirSync(path.join(repo,'.git','refs','heads'),{recursive:true});fs.writeFileSync(path.join(repo,'.git','refs','heads','main'),commit+'\n');
  }
  const p=prepareGitPlan(op);const result=spawnSync(p.executable,p.args,{cwd:p.cwd,env:p.env,shell:false,windowsHide:true,timeout:p.timeoutMs,maxBuffer:p.maxOutputBytes,encoding:'utf8'});
  expect(result.error).toBeUndefined();expect(result.status,result.stderr).toBe(0);
 });
 it('worker and supervisor refuse missing OS launcher',async()=>{
  await expect(executeWorkerGit('status',{})).rejects.toThrow('TRUSTED_SUPERVISOR_NOT_ENROLLED');
  await expect(runSupervisorGit('status',{})).rejects.toThrow('OS_JOB_BOUNDARY_UNAVAILABLE');
 });
 it('refuses an executable digest different from the signed scope before starting a job',async()=>{
  const run=vi.fn(async()=>0),terminateAndWait=vi.fn(async()=>{});
  await expect(runSupervisorGit('status',{}, {run,terminateAndWait},
   {executable:GIT_EXECUTABLE,executableSha256:'0'.repeat(64),repository:repo})).rejects.toThrow('APPROVAL_EXECUTABLE_OR_REPOSITORY_CHANGED');
  expect(run).not.toHaveBeenCalled();
 });
 it('bounds combined output and requests OS cleanup',async()=>{
  const cleanup=vi.fn(async()=>{});
  await expect(runSupervisorGit('status',{}, {run:async(_p,output)=>{output(Buffer.alloc(70000));return 0;},terminateAndWait:cleanup})).rejects.toThrow('OUTPUT_LIMIT');
  expect(cleanup).toHaveBeenCalledOnce();
 });
 it('times out and requests OS cleanup (synthetic adapter)',async()=>{
  vi.useFakeTimers();const cleanup=vi.fn(async()=>{});
  const running=runSupervisorGit('status',{}, {run:()=>new Promise(()=>{}),terminateAndWait:cleanup});
  const check=expect(running).rejects.toThrow('TIMEOUT');await vi.advanceTimersByTimeAsync(10001);await check;expect(cleanup).toHaveBeenCalledOnce();
 });
 it('bounds a stalled OS cleanup without claiming success',async()=>{
  vi.useFakeTimers();
  const running=runSupervisorGit('status',{}, {run:async()=>0,terminateAndWait:()=>new Promise(()=>{})});
  const check=expect(running).rejects.toThrow('CLEANUP_UNCONFIRMED');await vi.advanceTimersByTimeAsync(2001);await check;
 });
 it('does not return success if OS cleanup fails' ,async()=>{
  await expect(runSupervisorGit('status',{}, {run:async()=>0,terminateAndWait:async()=>{throw Error('cleanup unavailable');}})).rejects.toThrow('cleanup unavailable');
 });
});
