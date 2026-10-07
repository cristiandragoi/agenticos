import {describe,it,expect,beforeEach,afterEach} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {WindowsJob} from '../domains/securitySupervisor/windowsJob.js';
import type {GitPlan} from '../domains/localWorker/structuredGit.js';
import {setDedicatedWorkspaceRoot} from '../domains/localWorker/workspaceConfinement.js';
import {runSupervisorGit} from '../domains/securitySupervisor/gitSupervisor.js';

const helper=path.resolve('../.tmp/security-native/JobRunner.exe');
const hash=(p:string)=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const alive=(pid:number)=>{try{process.kill(pid,0);return true;}catch{return false;}};
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
describe('actual Windows Job Object boundary (controlled fixtures)',()=>{
 let scratch:string;
 beforeEach(()=>{scratch=fs.mkdtempSync(path.join(os.tmpdir(),'agenticos-job-test-'));});
 afterEach(()=>{
  setDedicatedWorkspaceRoot(null);
  if(path.dirname(scratch)!==os.tmpdir() || !path.basename(scratch).startsWith('agenticos-job-test-'))throw Error('unsafe cleanup');
  fs.rmSync(scratch,{recursive:true,force:true});
 });
 function plan(code:string,timeoutMs=2000,maxOutputBytes=65536):GitPlan {
  const script=path.join(scratch,'fixture.cjs');fs.writeFileSync(script,code);
  return {executable:process.execPath,executableSha256:hash(process.execPath),cwd:scratch,args:[script],
   env:{SystemRoot:'C:\\Windows'},timeoutMs,maxOutputBytes,shell:false,windowsHide:true};
 }
 it('assigns suspended child before resume and reports zero active processes',async()=>{
  const job=new WindowsJob(helper,hash(helper));let output='';
  expect(await job.run(plan('process.stdout.write("fixture-ok")'),b=>output+=b)).toBe(0);
  await job.terminateAndWait();expect(output).toBe('fixture-ok');
  expect(job.getEvidence()).toMatchObject({assignedBeforeResume:true,atomicJobList:true,killOnClose:true,activeProcesses:0});
  expect(job.getEvidence()!.totalProcesses).toBeGreaterThanOrEqual(1);
 });
 it('creates process atomically inside job via PROC_THREAD_ATTRIBUTE_JOB_LIST with zero pre-assignment execution',async()=>{
  const job=new WindowsJob(helper,hash(helper));let output='';
  const canary=path.join(scratch,'canary.txt');
  const code=`require('fs').writeFileSync(${JSON.stringify(canary)},'executed');process.stdout.write('atomic-ok');`;
  expect(await job.run(plan(code),b=>output+=b)).toBe(0);
  expect(output).toBe('atomic-ok');
  expect(fs.existsSync(canary)).toBe(true);
  expect(job.getEvidence()).toMatchObject({assignedBeforeResume:true,atomicJobList:true,killOnClose:true,activeProcesses:0});
 });
 it('refuses executable substitution before launch',async()=>{
  const p=plan('process.exit(0)');p.executableSha256='0'.repeat(64);
  await expect(new WindowsJob(helper,hash(helper)).run(p,()=>{})).rejects.toThrow('REFUSED');
 });
 it('bounds stdout and stderr together using the OS job',async()=>{
  const job=new WindowsJob(helper,hash(helper));
  await expect(job.run(plan('for(let i=0;i<1000;i++)process.stderr.write("x".repeat(4096))',2000,8192),()=>{})).rejects.toThrow('OUTPUT_LIMIT');
  expect(job.getEvidence()?.activeProcesses).toBe(0);
  expect(Buffer.from(job.getEvidence()!.outputBase64,'base64').length).toBe(8192);
 });
 it('kills descendants on timeout',async()=>{
  const job=new WindowsJob(helper,hash(helper));
  const code='const {spawn}=require("child_process");const c=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});require("fs").writeFileSync("child.pid",String(c.pid));setInterval(()=>{},1000)';
  await expect(job.run(plan(code,1200),()=>{})).rejects.toThrow('TIMEOUT');
  const pid=Number(fs.readFileSync(path.join(scratch,'child.pid'),'utf8'));
  expect(alive(pid)).toBe(false);expect(job.getEvidence()!.totalProcesses).toBeGreaterThanOrEqual(2);
 });
 it('kills surviving descendants after root exits normally',async()=>{
  const job=new WindowsJob(helper,hash(helper));
  const code='const c=require("child_process").spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});require("fs").writeFileSync("child.pid",String(c.pid));c.unref();';
  expect(await job.run(plan(code),()=>{})).toBe(0);
  expect(alive(Number(fs.readFileSync(path.join(scratch,'child.pid'),'utf8')))).toBe(false);
 });
 it('cancels through supervisor pipe and confirms OS cleanup',async()=>{
  const job=new WindowsJob(helper,hash(helper));const running=job.run(plan('setInterval(()=>{},1000)',5000),()=>{});
  const check=expect(running).rejects.toThrow('CANCELLED');await delay(200);await job.terminateAndWait();await check;
  expect(job.getEvidence()?.activeProcesses).toBe(0);
 });
 it('kill-on-close removes descendants if the helper crashes',async()=>{
  const p=plan('const c=require("child_process").spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});require("fs").writeFileSync("pids.json",JSON.stringify([process.pid,c.pid]));setInterval(()=>{},1000)',5000);
  const child=spawn(helper,[],{windowsHide:true,env:{SystemRoot:'C:\\Windows'},stdio:'pipe'});
  child.stdin.on('error',()=>{});child.stdin.write(JSON.stringify(p)+'\n');
  try {
   for(let i=0;i<100 && !fs.existsSync(path.join(scratch,'pids.json'));i++)await delay(20);
   const pids=JSON.parse(fs.readFileSync(path.join(scratch,'pids.json'),'utf8')) as number[];
   child.kill();
   for(let i=0;i<100 && pids.some(alive);i++)await delay(20);
   expect(pids.some(alive)).toBe(false);
  } finally {child.kill();}
 });
 it('supervisor disconnect cancels the job',async()=>{
  const p=plan('setInterval(()=>{},1000)',5000);
  const child=spawn(helper,[],{windowsHide:true,env:{SystemRoot:'C:\\Windows'},stdio:'pipe'});
  let text='';child.stdout.on('data',b=>text+=b);child.stdin.on('error',()=>{});
  const closed=new Promise<void>(resolve=>child.on('close',()=>resolve()));
  child.stdin.end(JSON.stringify(p)+'\n');await closed;
  expect(JSON.parse(text)).toMatchObject({reason:'CANCELLED',activeProcesses:0});
 });
 it('refuses native CREATE_BREAKAWAY_FROM_JOB',async()=>{
  const probe=path.resolve('../.tmp/security-native/ProcessProbe.exe');
  const p=plan('');p.executable=probe;p.executableSha256=hash(probe);p.args=[];
  const job=new WindowsJob(helper,hash(helper));let output='';
  expect(await job.run(p,b=>output+=b)).toBe(0);expect(output).toContain('BREAKAWAY_REFUSED:5');
 });
 it('supports nested jobs while retaining outer cleanup ownership',async()=>{
  const inner=plan('process.stdout.write("nested-ok")');
  const code=`const c=require('child_process').spawn(${JSON.stringify(helper)},[],{windowsHide:true,stdio:'pipe'});c.stdout.pipe(process.stdout);c.stdin.on('error',()=>{});c.stdin.write(${JSON.stringify(JSON.stringify(inner)+'\n')});`;
  const outer=plan(code,5000); // use a different fixture for inner execution
  inner.args=[path.join(scratch,'inner.cjs')];fs.writeFileSync(inner.args[0],'process.stdout.write("nested-ok")');
  fs.writeFileSync(outer.args[0],`const c=require('child_process').spawn(${JSON.stringify(helper)},[],{windowsHide:true,stdio:'pipe'});c.stdout.pipe(process.stdout);c.stdin.on('error',()=>{});c.stdin.write(${JSON.stringify(JSON.stringify(inner)+'\n')});`);
  const job=new WindowsJob(helper,hash(helper));let output='';
  expect(await job.run(outer,b=>output+=b)).toBe(0);
  expect(JSON.parse(output)).toMatchObject({reason:'EXITED',activeProcesses:0,assignedBeforeResume:true});
 });
 it('runs structured Git through the real native job adapter',async()=>{
  const repo=path.join(scratch,'repository'),git=path.join(repo,'.git');
  fs.mkdirSync(path.join(git,'objects'),{recursive:true});fs.mkdirSync(path.join(git,'refs'));
  fs.writeFileSync(path.join(git,'HEAD'),'ref: refs/heads/main\n');
  fs.writeFileSync(path.join(git,'config'),'[core]\nrepositoryformatversion = 0\nbare = false\n');
  setDedicatedWorkspaceRoot(scratch);
  const job=new WindowsJob(helper,hash(helper));const result=await runSupervisorGit('status',{},job);
  expect(result).toMatchObject({exitCode:0,cleanup:'OS_JOB_CONFIRMED'});
  expect(job.getEvidence()?.activeProcesses).toBe(0);
 });
 it('limits simultaneous processes and cleans every admitted child',async()=>{
  const probe=path.resolve('../.tmp/security-native/ProcessProbe.exe');
  const code=`const {spawn}=require('child_process');let errors=0;const pids=[];for(let i=0;i<12;i++){try{const c=spawn(${JSON.stringify(probe)},['sleep'],{stdio:'ignore',windowsHide:true});c.on('error',()=>errors++);if(c.pid)pids.push(c.pid);}catch{errors++;}}setTimeout(()=>{require('fs').writeFileSync('admitted.json',JSON.stringify(pids));console.log(JSON.stringify({errors,pids}));process.exit(0)},400);`;
  const job=new WindowsJob(helper,hash(helper));let output='';
  expect(await job.run(plan(code,5000),b=>output+=b),output).toBe(0);
  const result=JSON.parse(output);expect(result.errors).toBeGreaterThan(0);
  expect(result.pids.length).toBeLessThan(8);expect(result.pids.some(alive)).toBe(false);
 });
});
