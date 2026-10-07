import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { rawDb } from '../../db/index.js';
import { assertExecutionActive } from './taskGraph/ExecutionIdentity.js';
import { authoritativeInteractionContext } from './AuthoritativeInteractionContext.js';
import { isSensitivePattern } from '../localWorker/workspaceConfinement.js';
import { findFileReceipt, claimFileReceipt, finishFileReceipt, abandonFileReceipt, type FileReceiptClaim } from './ControlledFileReceipts.js';

export interface ControlledFileRequest {
  action: 'create' | 'verify' | 'replace-step'; query: string; scope: 'controlled-test';
  content?: string; step?: number; replacement?: string; clarification?: string; validationError?: string; receiptVersion?:number;
}
export function parseControlledFileRequest(text: string, conversationId?: string): ControlledFileRequest | null {
  text = normalizeFileCommand(text);
  const create = text.match(/^(?:in (?:the )?designated test workspace[, .]+)?create (?:a )?file (?:called |named )?["']?(.+?(?:\.txt|\s+dot\s+t\s*x\s*t))["']?[, ]+(?:in (?:the )?designated test workspace[, ]+)?(?:containing|with) (\d+|three) number(?:ed)? steps[.:, ]+(.+)$/i);
  if (create && /\bdesignated test workspace\b/i.test(text)) {
    const query = create[1].replace(/[ ,]+(?:minus|hyphen|dash)[ ,]+/gi, '-').replace(/[ ,]+slash[ ,]+/gi, '/').replace(/\s+dot\s+t\s*x\s*t$/i, '.txt').replace(/^["']|["']$/g, '');
    const body = create[3].replace(/[.]\s*Read (?:it|this|that file|this file|the file) back(?: and (?:verify|confirm(?: whether| that)? (?:its |the )?contents match (?:my |the )?request))?[.!?]*$/i,'');
    const parts = body.replace(/[.,\s]+$/, '').split(/\s*[,;]\s*/).map(s => s.trim());
    const count = create[2].toLowerCase() === 'three' ? 3 : Number(create[2]);
    // Split a final unpunctuated conjunction only when the declared count needs
    // exactly one more item. Preserve conjunctions inside already-counted steps.
    if (parts.length > 1 && parts.length === count - 1) {
      const final = parts[parts.length - 1].split(/\s+and\s+/i);
      if (final.length === 2 && final.every(Boolean)) parts.splice(parts.length - 1, 1, ...final);
    }
    if (parts.length > 1) parts[parts.length - 1] = parts[parts.length - 1].replace(/^and\s+/i, '');
    if (parts.length !== count || count < 1 || count > 20 || parts.some(s => !s || /[\r\n]|\bread (?:it|this|that file|this file|the file) back\b/i.test(s)))
      return { action: 'create', query, scope: 'controlled-test', validationError: 'The numbered steps could not be parsed unambiguously; no file was written.' };
    return { action: 'create', query, scope: 'controlled-test', content: parts.map((s,i) => `${i+1}. ${s}`).join('\n')+'\n' };
  }
  if (/\bdesignated test workspace\b/i.test(text) && /\bcreate\s+(?:a\s+)?file\b/i.test(text))
    return {action:'create',query:'',scope:'controlled-test',validationError:'The controlled file request could not be parsed unambiguously; no file was written. A text filename and an explicit numbered-step list are required.'};
  const replace = text.match(/^change only step (two|\d+) to ["'“]?(.+?)["'”]?[.]?\s*(?:keep (?:everything else|the rest|rest).*|,?\s*(?:and )?verify.*)$/i);
  const read = /^read\s+(?:it|this|that file|this file|the file)(?:\s+back\b|[.!?]*$)/i.test(text) && !/\b(?:in|from|using|on)\s+\S/i.test(text);
  if (!replace && !read) return null;
  const known = conversationId ? findFileReceipt(conversationId) : undefined;
  const context = conversationId ? authoritativeInteractionContext.getContext(conversationId) : undefined;
  if (known && (!known.file_path || known.expires_at<=Date.now() || known.owner_token)) return {action:replace?'replace-step':'verify',query:'',scope:'controlled-test',clarification:'There is no available file receipt for the latest controlled file request. It is incomplete, expired or in use; independent verification has not been performed.'};
  if (!known || (context?.activeTarget && context.activeTarget !== known.file_path)) {
    return replace ? {action:'replace-step',query:'',scope:'controlled-test',clarification:'There is no verified controlled file in this conversation to modify.'} : null;
  }
  return replace
    ? {action:'replace-step',query:known.file_path,scope:'controlled-test',receiptVersion:known.generation,step:replace[1].toLowerCase()==='two'?2:Number(replace[1]),replacement:replace[2].replace(/["'”.\s]+$/, '')}
    : {action:'verify',query:known.file_path,scope:'controlled-test',receiptVersion:known.generation};
}
/** Strip only conversational address/correction scaffolding, never arbitrary instructions. */
export function normalizeFileCommand(text: string): string {
  return text.trim()
    .replace(/^(?:(?:so|yes|hello|jarvis|okay|please)[, .]+)+/i, '')
    .replace(/^I said\s+(?=in (?:the )?designated test workspace\b)/i, '')
    .replace(/^(in (?:the )?designated test workspace)[.]\s*(?:he|she|it) doesn't really understand[.]\s*(?=create\b)/i, '$1, ')
    .replace(/^(?:can|could|would) you\s+/i, '');
}
export function getControlledFileWorkspace(): string {
  // This supervisor-owned fixture does not run as the isolated worker account.
  // Keep its files beside the canonical app database, never in the protected
  // worker workspace and never change that workspace's root or ACLs.
  const configured = process.env.AGENTICOS_CONTROLLED_FILE_WORKSPACE;
  if (configured) {
    if (!path.isAbsolute(configured)) throw new Error('CONTROLLED_FILE_WORKSPACE_MUST_BE_ABSOLUTE');
    return path.resolve(configured);
  }
  if (!path.isAbsolute(rawDb.name)) throw new Error('CONTROLLED_FILE_CANONICAL_DATA_DIRECTORY_REQUIRED');
  return path.join(path.dirname(rawDb.name),'controlled-file-workspace');
}
function sessionRoot(conversationId: string) {
  return path.join(getControlledFileWorkspace(), 'controlled-file-tasks', createHash('sha256').update(conversationId).digest('hex'));
}
async function validate(target: string, conversationId: string): Promise<string> {
  const root = sessionRoot(conversationId);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('CONTROLLED_FILE_SCOPE_VIOLATION');
  const canonical = path.resolve(target);
  if (isSensitivePattern(canonical) || relative.split(/[\\/]/).some(part=>!part || part==='..' || part==='.' || /[:\0]|[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(part))) throw new Error('CONTROLLED_FILE_INVALID_PATH');
  // Check ancestors above the workspace too, including dangling links.
  for (let dir = canonical; ; dir = path.dirname(dir)) {
    try {
      const stat = await fs.lstat(dir);
      if (stat.isSymbolicLink() || (dir===canonical && stat.nlink !== 1)) throw new Error('CONTROLLED_FILE_LINK_FORBIDDEN');
      if (dir!==canonical && !stat.isDirectory()) throw new Error('CONTROLLED_FILE_INVALID_ANCESTOR');
    }
    catch (error: any) { if (error.code !== 'ENOENT') throw error; }
    if (dir === path.dirname(dir)) break;
  }
  return canonical;
}
async function readControlledFile(target: string, conversationId: string) {
  const canonical = await validate(target,conversationId);
  const handle = await fs.open(canonical,'r');
  try {
    const stat=await handle.stat(), current=await fs.lstat(canonical);
    if (!stat.isFile() || stat.nlink!==1 || current.isSymbolicLink() || current.nlink!==1 || current.ino!==stat.ino || current.dev!==stat.dev) throw new Error('CONTROLLED_FILE_CHANGED');
    if (stat.size>10000) throw new Error('CONTROLLED_FILE_TOO_LARGE');
    await validate(canonical,conversationId);
    // Bounded descriptor read also rejects growth beyond the expected maximum.
    const buffer=Buffer.alloc(10001);
    const {bytesRead}=await handle.read(buffer,0,buffer.length,0);
    if(bytesRead>10000)throw new Error('CONTROLLED_FILE_TOO_LARGE');
    return {content:buffer.subarray(0,bytesRead).toString('utf8'),totalBytes:bytesRead};
  } finally { await handle.close(); }
}
// A conversation's create/read/change sequence is serialized. Expectations are
// durable, while this queue only excludes concurrent in-process modifications.
const pending = new Map<string, Promise<unknown>>();
export async function executeControlledFileRequest(request: ControlledFileRequest, conversationId: string, signal?: AbortSignal) {
  assertExecutionActive();
  const previous = pending.get(conversationId) || Promise.resolve();
  const operation = previous.catch(()=>{}).then(()=>executeRequest(request,conversationId,signal));
  pending.set(conversationId,operation);
  try { return await operation; } finally { if (pending.get(conversationId) === operation) pending.delete(conversationId); }
}
async function executeRequest(request: ControlledFileRequest, conversationId: string, signal?: AbortSignal) {
  const identity = assertExecutionActive();
  const goal = rawDb.prepare('SELECT conversation_id FROM goal_runs WHERE goal_id=?').get(identity.goalId) as {conversation_id:string} | undefined;
  if (goal?.conversation_id !== conversationId) throw new Error('CONTROLLED_FILE_CONVERSATION_IDENTITY_MISMATCH');
  const active = () => { assertExecutionActive(); signal?.throwIfAborted(); };
  active();
  if (request.clarification) return {success:false,error:request.clarification};
  let claim:FileReceiptClaim|undefined;
  try {
    claim=claimFileReceipt(conversationId,request);
    const prior=claim.prior;
    let target: string, expected: string;
    if (request.action === 'create') {
      // The transactional claim has invalidated the previous generation.
      if (request.validationError) throw new Error(request.validationError);
      if (!request.content || Buffer.byteLength(request.content) > 10000 || !/^[\w /.-]+\.txt$/i.test(request.query) || request.query.split(/[\\/]/).some(p=>p==='..'||p==='.'||/[. ]$/.test(p)) || path.isAbsolute(request.query)) throw new Error('CONTROLLED_FILE_INVALID_REQUEST');
      target = await validate(path.join(sessionRoot(conversationId),request.query),conversationId);
      expected = request.content;
      await fs.mkdir(path.dirname(target),{recursive:true});
      await validate(target,conversationId); active();
      const handle = await fs.open(target,'wx');
      try { active(); await handle.writeFile(expected,'utf8'); await handle.sync(); } finally { await handle.close(); }
    } else {
      if (!prior || prior.file_path !== request.query) throw new Error('CONTROLLED_FILE_RECEIPT_REQUIRED');
      target = await validate(prior.file_path,conversationId);
      expected = prior.expected;
      const before = await readControlledFile(target,conversationId);
      if (before.totalBytes > 10000 || before.content !== expected) throw new Error('CONTROLLED_FILE_CONTENT_MISMATCH: file differs from the verified request');
      if (request.action === 'replace-step') {
        const lines = expected.split('\n');
        if (!Number.isInteger(request.step) || request.step! < 1 || request.step! >= lines.length || !request.replacement || /[\r\n\0]/.test(request.replacement) || request.replacement.length > 1000) throw new Error('CONTROLLED_FILE_INVALID_STEP');
        lines[request.step!-1] = `${request.step}. ${request.replacement}`;
        expected = lines.join('\n');
        await validate(target,conversationId); active();
        const handle = await fs.open(target,'r+');
        try {
          const stat = await handle.stat(), current = await fs.lstat(target);
          if (!stat.isFile() || stat.nlink !== 1 || current.isSymbolicLink() || stat.ino !== current.ino || await handle.readFile('utf8') !== prior.expected) throw new Error('CONTROLLED_FILE_CHANGED');
          active(); await handle.write(Buffer.from(expected),0,Buffer.byteLength(expected),0); await handle.truncate(Buffer.byteLength(expected)); await handle.sync();
        } finally { await handle.close(); }
      }
    }
    active();
    const actual = await readControlledFile(target,conversationId);
    if (actual.content !== expected || actual.totalBytes !== Buffer.byteLength(expected)) throw new Error('CONTROLLED_FILE_VERIFICATION_FAILED');
    active();
    finishFileReceipt(claim,target,expected);
    const presentationText = `${request.action==='create'?'Created':request.action==='replace-step'?'Updated':'Read back'} ${target}. The handler's comparison matched the requested contents; independent verification has not been performed:\n${actual.content}`;
    authoritativeInteractionContext.recordSucceededFileOperation(conversationId,target,presentationText);
    return {success:true,outputs:{status:'SUCCEEDED',verified:false,independentVerification:'NOT_PERFORMED',receiptVersion:claim.generation,presentationText,filePath:target,content:actual.content}};
  } catch(error:any) {
    if(claim)abandonFileReceipt(claim);
    return {success:false,error:`Controlled file task failed: ${error.message}`};
  }
}
