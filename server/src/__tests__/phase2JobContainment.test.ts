// @ts-nocheck — controlled Windows native fixtures; no application/bootstrap imports.
import {test,expect,beforeAll,afterAll} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {IncarnationJobs,sha256} from '../domains/securitySupervisor/phase2JobBoundary.js';
import {specimen,validateIdentity} from '../../../scripts/contracts/phase1-runtime-identity.mjs';
const root=path.resolve('.tmp/phase2-job-object'),helper=path.join(root,'JobRunner.exe'),probe=path.join(root,'ContainmentProbe.exe');
const hash=p=>sha256(fs.readFileSync(p));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
const nativeEvidence=[];
afterAll(()=>fs.writeFileSync(path.resolve('evidence/phase2-native-evidence.json'),JSON.stringify({scope:'Controlled native fixtures only',helperSha256:hash(helper),fixtureSha256:hash(probe),observations:nativeEvidence},null,2)+'\n'));
beforeAll(()=>{expect(process.platform).toBe('win32');for(const f of [helper,probe,path.join(root,'AssignmentFailure.exe')])expect(fs.existsSync(f)).toBe(true);});
function fixture(mode,limits={}){
 const cwd=fs.mkdtempSync(path.join(root,'case-')),registry=new IncarnationJobs(path.join(cwd,'identity-ledger')),record=specimen();
 registry.register(record,r=>{validateIdentity(r);return true;});
 const job=registry.create(record.runtime.incarnation,helper,hash(helper));
 const original=job.run.bind(job);job.run=async plan=>{const evidence=await original(plan);nativeEvidence.push({mode,cwd,evidence});return evidence;};
 const plan={executable:probe,executableSha256:hash(probe),cwd,args:[mode],env:{SystemRoot:'C:\\Windows',WINDIR:'C:\\Windows'},timeoutMs:8000,maxOutputBytes:65536,
  limits:{activeProcessLimit:4,processMemoryMb:128,jobMemoryMb:256,cpuTimeMs:3000,cpuRate:2000,...limits}};
 return {cwd,registry,record,job,plan};
}
function output(e){return Buffer.from(e.outputBase64,'base64').toString();}
async function pids(cwd,count){for(let i=0;i<200;i++){const a=fs.readdirSync(cwd).filter(n=>/^pid-\d+\.txt$/.test(n));if(a.length>=count)return a.map(n=>Number(n.slice(4,-4)));await delay(10);}throw Error('FIXTURE_NOT_READY');}
test('suspended assignment and all native limit readbacks succeed',async()=>{const f=fixture('marker'),e=await f.job.run(f.plan);expect(e).toMatchObject({reason:'EXITED',exitCode:0,activeProcesses:0,assignedBeforeResume:true,killOnClose:true,uiRestrictions:255,limitFlags:8974});expect(fs.existsSync(path.join(f.cwd,'executed.txt'))).toBe(true);});
test('bounded fork-bomb fixture exceeds active-process limit',async()=>{const f=fixture('saturate'),e=await f.job.run(f.plan);expect(e.exitCode).toBe(0);expect(output(e)).toContain('ADMITTED:3 DENIED:9');expect(e.activeProcesses).toBe(0);});
test('per-process memory exhaustion is refused',async()=>{const f=fixture('memory',{processMemoryMb:64,jobMemoryMb:128}),e=await f.job.run(f.plan);expect(e.exitCode).toBe(0);expect(output(e)).toMatch(/MEMORY_DENIED:/);expect(Number(output(e).split(':')[1])).toBeLessThan(64*1048576);});
test('aggregate job memory exhausts below per-process allowance',async()=>{const f=fixture('jobmemory',{processMemoryMb:128,jobMemoryMb:128}),e=await f.job.run(f.plan);expect(e.exitCode).toBe(0);expect(output(e)).toContain('MEMORY_DENIED:');expect(Number(output(e).split(':')[1])).toBeLessThan(96*1048576);});
test('CPU spin is terminated by CPU time limit before wall timeout',async()=>{const f=fixture('spin',{cpuTimeMs:500,cpuRate:5000}),e=await f.job.run(f.plan);expect(e.reason).toBe('EXITED');expect(e.exitCode).not.toBe(0);expect(e.activeProcesses).toBe(0);},15000);
test('CREATE_BREAKAWAY_FROM_JOB is denied',async()=>{const f=fixture('breakaway'),e=await f.job.run(f.plan);expect(e.exitCode).toBe(0);expect(output(e)).toContain('BREAKAWAY:-5');});
test('grandchild remains in job and all generations die on cancellation',async()=>{const f=fixture('grandparent'),running=f.job.run(f.plan);const ids=await pids(f.cwd,3);expect(ids.every(pid=>fs.readFileSync(path.join(f.cwd,`pid-${pid}.txt`),'utf8').endsWith(':True'))).toBe(true);await f.job.cancel();const e=await running;expect(e.reason).toBe('CANCELLED');expect(ids.some(alive)).toBe(false);});
test('killing owning supervisor kills root, child and grandchild',async()=>{const f=fixture('grandparent'),c=spawn(helper,[],{windowsHide:true,stdio:'pipe',env:{SystemRoot:'C:\\Windows'}});c.stdin.on('error',()=>{});c.stdout.resume();c.stderr.resume();c.stdin.write(JSON.stringify({...f.plan,...f.plan.limits,runtimeIncarnation:f.record.runtime.incarnation,identityHash:'a'.repeat(64)})+'\n');try{const ids=await pids(f.cwd,3);c.kill();for(let i=0;i<200&&ids.some(alive);i++)await delay(10);expect(ids.some(alive)).toBe(false);}finally{c.kill();}});
test('real assignment failure does not execute one instruction of fixture entrypoint',async()=>{const f=fixture('marker'),fault=path.join(root,'AssignmentFailure.exe'),j=f.registry.create(f.record.runtime.incarnation,fault,hash(fault));await expect(j.run(f.plan)).rejects.toThrow('NATIVE_REFUSED');expect(fs.readdirSync(f.cwd)).toEqual(['identity-ledger']);});
test('identity invalidation terminates job and refuses relaunch or re-registration',async()=>{const f=fixture('sleep'),running=f.job.run(f.plan),ids=await pids(f.cwd,1);await f.registry.invalidate(f.record.runtime.incarnation);expect((await running).reason).toBe('CANCELLED');expect(ids.some(alive)).toBe(false);expect(()=>f.registry.create(f.record.runtime.incarnation,helper,hash(helper))).toThrow();expect(()=>f.registry.register(f.record,()=>true)).toThrow();});
test('clipboard and desktop API access is denied without physical interaction',async()=>{const f=fixture('ui'),e=await f.job.run(f.plan);expect(e.exitCode,output(e)).toBe(0);expect(output(e)).toContain('CLIPBOARD_HANDLE:0 ERROR:5 DESKTOP_HANDLE:0 ERROR:5');});
test('invalid identity refuses job creation',()=>{const r=new IncarnationJobs(fs.mkdtempSync(path.join(root,'ledger-')));expect(()=>r.register(specimen(),()=>false)).toThrow();expect(()=>r.create('runtime-1',helper,hash(helper))).toThrow();});
test('invalidation survives registry reconstruction and restored identity bytes',async()=>{const f=fixture('marker');await f.registry.invalidate(f.record.runtime.incarnation);const reconstructed=new IncarnationJobs(path.join(f.cwd,'identity-ledger'));expect(()=>reconstructed.register(f.record,()=>true)).toThrow('INCARNATION_REFUSED');});
