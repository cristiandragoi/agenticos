import {describe,it,expect,beforeAll,afterAll} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {parseLocalFileRequest,executeLocalFileRequest} from '../domains/controlPlane/LocalFileOperations.js';
import {autonomousExecutionKernel} from '../domains/controlPlane/taskGraph/AutonomousExecutionKernel.js';
import {getDedicatedWorkspaceRoot} from '../domains/localWorker/workspaceConfinement.js';
import {getControlledFileWorkspace} from '../domains/controlPlane/ControlledFileWorkflow.js';
import {rawDb} from '../db/index.js';
import {createTurnEnvelope} from '../domains/controlPlane/TurnEnvelope.js';
import {isAutonomousGoalEnvelope} from '../domains/turnLifecycle/autonomousGoalMode.js';
import {turnLifecycle} from '../domains/turnLifecycle/controller.js';
let root:string;
const previousWorkspace=process.env.AGENTICOS_CONTROLLED_FILE_WORKSPACE;
const create=(name='mission-check.txt')=>`In the designated test workspace, create a file called ${name}, containing three numbered steps. Inspect, execute, verify`;
const run=(userGoal:string,conversationId:string)=>autonomousExecutionKernel.executeGoal({userGoal,schemaVersion:'1',executionMode:'AUTONOMOUS_GOAL',confidence:1,needsClarification:false},{conversationId});
describe('controlled file creation, continuity and exact verification',()=>{
 beforeAll(async()=>{root=await fs.mkdtemp(path.join(os.tmpdir(),'controlled-file-'));process.env.AGENTICOS_CONTROLLED_FILE_WORKSPACE=root;});
 afterAll(async()=>{if(previousWorkspace===undefined)delete process.env.AGENTICOS_CONTROLLED_FILE_WORKSPACE;else process.env.AGENTICOS_CONTROLLED_FILE_WORKSPACE=previousWorkspace;await fs.rm(root,{recursive:true,force:true});});
 it('uses the canonical application data workspace by default without changing the worker root',async()=>{
  const workerRoot=getDedicatedWorkspaceRoot();
  delete process.env.AGENTICOS_CONTROLLED_FILE_WORKSPACE;
  try {
   expect(getControlledFileWorkspace()).toBe(path.join(path.dirname(rawDb.name),'controlled-file-workspace'));
   const conversationId=randomUUID(), created=await run(create(),conversationId);
   expect(created.success,created.error).toBe(true);
   const request=parseLocalFileRequest('Read it back and verify.',conversationId)!;
   expect(request.query.startsWith(getControlledFileWorkspace()+path.sep)).toBe(true);
   expect(await fs.readFile(request.query,'utf8')).toBe('1. Inspect\n2. execute\n3. verify\n');
  } finally {process.env.AGENTICOS_CONTROLLED_FILE_WORKSPACE=root;}
  expect(getDedicatedWorkspaceRoot()).toBe(workerRoot);
  expect(getControlledFileWorkspace()).toBe(root);
 });
 it.each(['mission-check.txt','mission slash check.txt'])('completes create/read/update/read for %s without application tools',async name=>{
  const conversationId=randomUUID();
  expect(parseLocalFileRequest(create(name),conversationId)?.action).toBe('create');
  const created=await run(create(name),conversationId);
  expect(created.success,created.error).toBe(true);
  const request=parseLocalFileRequest('Read it back and verify.',conversationId)!;
  expect(request.action).toBe('verify');
  expect(request.query.endsWith(name.includes('slash')?path.join('mission','check.txt'):'mission-check.txt')).toBe(true);
  expect(await fs.readFile(request.query,'utf8')).toBe('1. Inspect\n2. execute\n3. verify\n');
  expect((await run('Read it back and verify.',conversationId)).success).toBe(true);
  const updated=await run('Change only step two to "execute safely". Keep everything else unchanged, and verify the result.',conversationId);
  expect(updated.success,updated.error).toBe(true);
  expect(await fs.readFile(request.query,'utf8')).toBe('1. Inspect\n2. execute safely\n3. verify\n');
  expect((await run('Read it back and verify.',conversationId)).success).toBe(true);
  expect(parseLocalFileRequest('Read it back and verify.',randomUUID())?.clarification).toMatch(/no (?:available file receipt|verified file)/);
 });
 it('executes synchronous typed-chat create/read/update through the canonical lifecycle',async()=>{
  const conversationId=randomUUID();
  const spoken:string[]=[];
  for(const text of [create(),'Read it back and verify.','Change only step two to "execute safely". Keep everything else unchanged, and verify the result.']) {
   const envelope=createTurnEnvelope({rawText:text,conversationId,source:'typed_chat'});
   expect(envelope.structuredIntent).toBeUndefined();
   expect(isAutonomousGoalEnvelope(envelope)).toBe(true);
   const result=await turnLifecycle.submit({text,conversationId,source:'typed_chat',envelope,externalTurnId:randomUUID()},{speak:async text=>{spoken.push(text);}});
   expect(result.duplicate).toBe(false);
   if(!result.duplicate) {
    expect(result.record.outcome,result.record.error).toBe('EXECUTED_UNVERIFIED');
    expect(result.record.handler).toBe('controlPlane.AutonomousExecutionKernel');
   }
  }
  const request=parseLocalFileRequest('Read it back and verify.',conversationId)!;
  expect(await fs.readFile(request.query,'utf8')).toBe('1. Inspect\n2. execute safely\n3. verify\n');
  expect(spoken.at(-1)).toContain('2. execute safely');
  const missing=createTurnEnvelope({rawText:'Read it back and verify.',conversationId:randomUUID(),source:'typed_chat'});
  expect(missing.compiledIntent.target).toBe('clarify_execution_target');
  expect(isAutonomousGoalEnvelope(missing)).toBe(false);
 });
 it('preserves the actual voice transcript filename and content',()=>{
  const parsed=parseLocalFileRequest('Yes, hello Jarvis. In the designated test workspace, create a file called mission slash check.txt, containing three number steps. Inspect, execute, verify,',randomUUID());
  expect(parsed?.query).toBe('mission/check.txt'); expect(parsed?.action).toBe('create');
 });
 it.each([
  ['So, Jarvis, in the designated test workspace, create a file called Voice slash Check dot TXT containing three numbered steps: Inspect, Execute, and Verify.',path.join('Voice','Check.txt'),'1. Inspect\n2. Execute\n3. Verify\n'],
  ["I said in the designated test workspace. He doesn't really understand. Create a file called Voice, Minus, Check.TXT, containing three number steps. Inspect, execute, and verify.",'Voice-Check.TXT','1. Inspect\n2. execute\n3. verify\n'],
  ['In the designated test workspace, create a file called Voice minus Check dot TXT containing three numbered steps: Inspect, Execute, and Verify.','Voice-Check.txt','1. Inspect\n2. Execute\n3. Verify\n']
 ])('executes spoken filename and exact follow-up via canonical voice ingress: %s',async(text,filename,content)=>{
  const conversationId=randomUUID();
  for (const utterance of [text,"So Jarvis, read it back and confirm that it's contents match my request.",'So, Jarvis, read this back and confirm that its contents match my request.','Read this file back and verify.']) {
   const envelope=createTurnEnvelope({rawText:utterance,conversationId,source:'voice'});
   expect(isAutonomousGoalEnvelope(envelope)).toBe(true);
   const result=await turnLifecycle.submit({text:utterance,conversationId,source:'voice',envelope,externalTurnId:randomUUID()});
   expect(result.duplicate).toBe(false);
   if(!result.duplicate) {
    expect(result.record.outcome,result.record.error).toBe('EXECUTED_UNVERIFIED');
    expect(result.record.handler).toBe('controlPlane.AutonomousExecutionKernel');
    expect(result.record.responseText).toContain(content);
   }
  }
  const file=parseLocalFileRequest('Read this back and verify.',conversationId)!;
  expect(file.query.endsWith(filename)).toBe(true);
  expect(await fs.readFile(file.query,'utf8')).toBe(content);
 });
 it('uses the declared step count to disambiguate final list conjunctions',()=>{
  const parsed=parseLocalFileRequest(create().replace('Inspect, execute, verify','Inspect, execute and verify'),randomUUID()) as any;
  expect(parsed.content).toBe('1. Inspect\n2. execute\n3. verify\n');
  const intrinsic=parseLocalFileRequest(create().replace('Inspect, execute, verify','Inspect and record, execute, verify'),randomUUID()) as any;
  expect(intrinsic.content).toBe('1. Inspect and record\n2. execute\n3. verify\n');
 });
 it('rejects recognizable unsupported controlled creates and invalidates an older receipt',async()=>{
  const conversationId=randomUUID();await run(create(),conversationId);
  const text='In the designated test workspace, create a file called broken PDF containing some steps.';
  expect((parseLocalFileRequest(text,conversationId) as any)?.validationError).toContain('unambiguously');
  const result=await run(text,conversationId);
  expect(result.success).toBe(false);
  expect(parseLocalFileRequest('Read this back and verify.',conversationId)?.clarification).toMatch(/no (?:available file receipt|verified file)/);
 });
 it.each(['So Jarvis, read it back and confirm that its contents match my request.','Read this back and verify.'])('keeps missing voice file references away from application/window discovery: %s',text=>{
  const envelope=createTurnEnvelope({rawText:text,conversationId:randomUUID(),source:'voice'});
  expect(envelope.compiledIntent.target).toBe('clarify_execution_target');
  expect(parseLocalFileRequest(text,randomUUID())?.clarification).toMatch(/no (?:available file receipt|verified file)/);
 });
 it('parses quoted filenames and a bounded compound verification suffix',()=>{
  const parsed=parseLocalFileRequest(create('"mission-check.txt"').replace('containing','with')+'. Read it back and confirm whether its contents match my request.',randomUUID());
  expect(parsed?.query).toBe('mission-check.txt'); expect((parsed as any)?.content).toBe('1. Inspect\n2. execute\n3. verify\n');
  const unsupported=parseLocalFileRequest(create()+'. Read it back and upload everything.',randomUUID());
  expect((unsupported as any)?.validationError).toContain('unambiguously');
  const compound=parseLocalFileRequest(create()+'. Read this file back and confirm that its contents match my request.',randomUUID()) as any;
  expect(compound.content).toBe('1. Inspect\n2. execute\n3. verify\n');
  expect((parseLocalFileRequest(create()+'. Read this back and upload everything.',randomUUID()) as any)?.validationError).toContain('unambiguously');
 });
 it('refuses overwrite and external edits',async()=>{
  const conversationId=randomUUID(); await run(create(),conversationId);
  const request=parseLocalFileRequest('Read it back and verify.',conversationId)!;
  await fs.writeFile(request.query,'unexpected content');
  const verified=await run('Read it back and verify.',conversationId);
  expect(verified.success).toBe(false);expect(verified.error).toContain('CONTENT_MISMATCH');
  expect((await run('Change only step two to "execute safely". Keep everything else unchanged, and verify.',conversationId)).success).toBe(false);
  expect(await fs.readFile(request.query,'utf8')).toBe('unexpected content');
 });
 it('refuses overwrite and invalidates the previous file referent after failed create',async()=>{
  const conversationId=randomUUID();await run(create(),conversationId);
  expect((await run(create(),conversationId)).success).toBe(false);
  expect(parseLocalFileRequest('Read it back and verify.',conversationId)?.clarification).toMatch(/no (?:available file receipt|verified file)/);
 });
 it('invalidates the previous receipt for malformed new numbered steps',async()=>{
  const conversationId=randomUUID();await run(create(),conversationId);
  const invalid=await run(create().replace('Inspect, execute, verify','Inspect, execute'),conversationId);
  expect(invalid.success).toBe(false);expect(invalid.error).toContain('unambiguously');
  expect(parseLocalFileRequest('Read it back and verify.',conversationId)?.clarification).toMatch(/no (?:available file receipt|verified file)/);
 });
 it.each(['../escape.txt','C:/escape.txt','mission/../../escape.txt','CON.txt'])('rejects unsafe filename %s',async name=>{
  const result=await run(create(name),randomUUID());expect(result.success).toBe(false);
 });
 it('rejects hardlink substitution',async()=>{
  const conversationId=randomUUID();await run(create(),conversationId);
  const request=parseLocalFileRequest('Read it back and verify.',conversationId)!;
  await fs.link(request.query,path.join(root,randomUUID()+'.txt'));
  expect((await run('Read it back and verify.',conversationId)).success).toBe(false);
 });
 it('refuses receipts outside a newly configured controlled workspace',async()=>{
  const conversationId=randomUUID();await run(create(),conversationId);
  process.env.AGENTICOS_CONTROLLED_FILE_WORKSPACE=path.join(root,'different-workspace');
  try {
   const result=await run('Read it back and verify.',conversationId);
   expect(result.success).toBe(false);expect(result.error).toContain('SCOPE_VIOLATION');
  } finally {process.env.AGENTICOS_CONTROLLED_FILE_WORKSPACE=root;}
 });
 it('rejects an ancestor directory junction before creating a file',async()=>{
  const linked=path.join(root,'linked-workspace'),outside=await fs.mkdtemp(path.join(os.tmpdir(),'controlled-file-outside-'));
  await fs.symlink(outside,linked,'junction');
  process.env.AGENTICOS_CONTROLLED_FILE_WORKSPACE=linked;
  try {
   const result=await run(create(),randomUUID());
   expect(result.success).toBe(false);expect(result.error).toContain('LINK_FORBIDDEN');
   expect(await fs.readdir(outside)).toEqual([]);
  } finally {process.env.AGENTICOS_CONTROLLED_FILE_WORKSPACE=root;await fs.unlink(linked);await fs.rm(outside,{recursive:true,force:true});}
 });
 it('requires canonical identity and refuses missing content',async()=>{
  await expect(executeLocalFileRequest({action:'create',query:'x.txt',scope:'controlled-test',content:'test'},randomUUID())).rejects.toThrow('CANONICAL_TASK_IDENTITY_REQUIRED');
  expect((parseLocalFileRequest(create().replace('Inspect, execute, verify','Inspect, execute'),randomUUID()) as any)?.validationError).toContain('unambiguously');
 });
});


