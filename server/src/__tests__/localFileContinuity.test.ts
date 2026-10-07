import {describe,it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {parseLocalFileRequest,executeLocalFileRequest} from '../domains/controlPlane/LocalFileOperations.js';
import {createTurnEnvelopeAsync} from '../domains/controlPlane/TurnEnvelope.js';
import {autonomousExecutionKernel} from '../domains/controlPlane/taskGraph/AutonomousExecutionKernel.js';
import {goalLifecycleManager} from '../domains/controlPlane/GoalLifecycle.js';
import {presentTaskState} from '../domains/controlPlane/TaskStatePresentation.js';
import {turnLifecycle} from '../domains/turnLifecycle/controller.js';
import {parseConcreteAppRequest} from '../domains/controlPlane/ConcreteVoiceRequests.js';
import {authoritativeInteractionContext} from '../domains/controlPlane/AuthoritativeInteractionContext.js';

describe('local file routing and verified task continuity',()=>{
 it.each([
  'Read it back and verify.',
  'Read it back, verify, read it back and confirm whether it contains match, match, match, match,',
  'Read that file back and confirm whether its contents match my request.',
 ])('keeps an unresolved read-back out of application discovery: %s',async text=>{
  const conversationId=randomUUID();
  const request=parseLocalFileRequest(text,conversationId);
  expect(request?.clarification).toContain('no verified file');
  expect(request?.query).toBe('');
  const envelope=await createTurnEnvelopeAsync({rawText:text,conversationId,source:'voice_text_injection'});
  expect(envelope.compiledIntent.target).toBe('clarify_execution_target');
 });
 it('binds read-back to a verified file only in the same conversation',()=>{
  const conversationId=randomUUID();
  const target=path.join(os.tmpdir(),'mission-check.txt');
  authoritativeInteractionContext.recordVerifiedStepSuccess(conversationId,0,{target,targetType:'CONTENT',capability:'FILESYSTEM',summary:'Located test file'});
  expect(parseLocalFileRequest('Read it back and verify.',conversationId)?.query).toBe(target);
  expect(parseLocalFileRequest('Read it back and verify.',randomUUID())?.clarification).toContain('no verified file');
 });
 it('does not turn application context into a file referent',()=>{
  const conversationId=randomUUID();
  authoritativeInteractionContext.recordVerifiedStepSuccess(conversationId,0,{target:'Notepad',targetType:'APPLICATION',capability:'APPLICATION',summary:'Test context'});
  expect(parseLocalFileRequest('Read it back.',conversationId)?.query).toBe('');
  expect(parseLocalFileRequest('Read it back in Notepad',conversationId)).toBeNull();
  expect(parseLocalFileRequest('Read it back from Telegram',conversationId)).toBeNull();
 });
 it.each(['Open HMS One','Open HMS1','Open Hermes One'])('retains the user-confirmed Hermes app name: %s',text=>expect(parseConcreteAppRequest(text)).toBe('Hermes One'));
 it.each(['Locate files inside my computer','Can you open files inside my laptop?'])('clarifies missing file names: %s',async text=>{
  expect(parseLocalFileRequest(text)?.clarification).toContain('Which file');
  const envelope=await createTurnEnvelopeAsync({rawText:text,conversationId:randomUUID(),source:'voice_text_injection'});
  expect(envelope.compiledIntent.target).toBe('clarify_execution_target');
 });
 it.each(['Open Word document','Read the content in Notepad','Read the last two messages in Telegram','Open YouTube'])('does not steal %s',text=>expect(parseLocalFileRequest(text)).toBeNull());
 it('locates a real file through the goal kernel and binds read it to that file',async()=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'jarvis-file-'));
  const filename=path.join(folder,'continuity-proof.txt'),body='This is the actual file body.\nThe second line is verified.';
  await fs.writeFile(filename,body);
  const conversationId=randomUUID();
  try {
   const text=`Locate continuity-proof.txt in "${folder}"`;
   const envelope=await createTurnEnvelopeAsync({rawText:text,conversationId,source:'voice_text_injection'});
   expect(envelope.structuredIntent?.executionMode).toBe('AUTONOMOUS_GOAL');
   const run=async(userGoal:string)=>autonomousExecutionKernel.executeGoal({userGoal,schemaVersion:'1',executionMode:'AUTONOMOUS_GOAL',confidence:1,needsClarification:false},{conversationId});
   const located=await run(text);
   expect(located.success).toBe(true);
   expect(parseLocalFileRequest('Read it',conversationId)?.query).toBe(filename);
   const read=await run('Read it back and verify.');
   expect(read.success).toBe(true);
   expect(read.goalRun.finalResponseText).toContain(body);
   expect(presentTaskState(conversationId,'What did you just do?')).toContain(body);
   const question='What did you just do?';
   const followup=await createTurnEnvelopeAsync({rawText:question,conversationId,source:'voice_text_injection'});
   await turnLifecycle.submit({text:question,conversationId,source:'voice_text_injection',envelope:followup},{speak:async()=>{}});
   expect(parseLocalFileRequest('Open it',conversationId)?.query).toBe(filename);
  }finally{await fs.rm(folder,{recursive:true,force:true});}
 });
 it('does not choose arbitrarily among same-name files',async()=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'jarvis-ambiguous-'));
  try {
   for(const sub of ['one','two']){await fs.mkdir(path.join(folder,sub));await fs.writeFile(path.join(folder,sub,'proof.txt'),'test');}
   const result=await autonomousExecutionKernel.executeGoal({userGoal:`Read proof.txt in "${folder}"`,schemaVersion:'1',executionMode:'AUTONOMOUS_GOAL',confidence:1,needsClarification:false},{conversationId:randomUUID()});
   expect(result.success).toBe(false);expect(result.error).toContain('Which one');
  }finally{await fs.rm(folder,{recursive:true,force:true});}
 });
 it('honors cancellation before file execution',async()=>{
  const controller=new AbortController();controller.abort();
  await expect(executeLocalFileRequest({action:'open',query:'not-real.txt',scope:'all'},randomUUID(),controller.signal)).rejects.toThrow();
 });
 it('routes what did you just do to the latest failed task',async()=>{
  const conversationId=randomUUID();
  const first=goalLifecycleManager.startGoal({conversationId,userInput:'Read Notepad'});
  goalLifecycleManager.transitionState(first.goalId,'CANCELLED',{summary:'Older Notepad result'});
  await new Promise(resolve=>setTimeout(resolve,5));
  const latest=goalLifecycleManager.startGoal({conversationId,userInput:'Open YouTube'});
  goalLifecycleManager.transitionState(latest.goalId,'BLOCKED_EXTERNAL',{summary:'Chrome connection unavailable'});
  const envelope=await createTurnEnvelopeAsync({rawText:'What did you just do?',conversationId,source:'voice_text_injection'});
  expect(envelope.compiledIntent.target).toBe('current_task_state');
  const result=presentTaskState(conversationId,'What did you just do?');
  expect(result).toContain('Chrome connection unavailable');expect(result).not.toContain('Older Notepad');
 });
});
