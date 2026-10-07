import fs from 'node:fs/promises';
import { currentExecutionIdentity, assertExecutionActive } from './taskGraph/ExecutionIdentity.js';
import path from 'node:path';
import { filesystemExecutor } from '../jarvis/execution/executors/filesystemExecutor.js';
import { authoritativeInteractionContext } from './AuthoritativeInteractionContext.js';
import { targetResolver } from './TargetResolver.js';
import { normalizeFileCommand, parseControlledFileRequest, executeControlledFileRequest, type ControlledFileRequest } from './ControlledFileWorkflow.js';

export interface LocalFileRequest { action: 'locate'|'read'|'open'; query: string; scope: string; clarification?: string }
export function parseLocalFileRequest(text: string, conversationId?: string): LocalFileRequest | ControlledFileRequest | null {
  const controlled = parseControlledFileRequest(text.trim(),conversationId);
  if(controlled) return controlled;
  const raw=normalizeFileCommand(text);
  const ctx=conversationId ? authoritativeInteractionContext.getContext(conversationId) : null;
  // A read-back follow-up is not an application name. In particular, never
  // let a missing file referent fall through to window discovery as "it back".
  const readBack=/^read\s+(?:it|this|that file|this file|the file)\s+back\b/i.test(raw)
    && !/\b(?:in|from|using|on)\s+\S/i.test(raw);
  if(readBack) {
    if(ctx?.activeCapability==='FILESYSTEM' && ctx.activeTarget)
      return {action:'read',query:ctx.activeTarget,scope:'all'};
    return {action:'read',query:'',scope:'all',clarification:'There is no verified file from the preceding task to read back. The file task has not completed, so I cannot confirm that its contents match your request.'};
  }
  if (/^(?:read|open)\s+(?:it|that file|the file)[.!?]*$/i.test(raw) && ctx?.activeCapability==='FILESYSTEM' && ctx.activeTarget)
    return {action:/^read/i.test(raw)?'read':'open',query:ctx.activeTarget,scope:'all'};
  const match=raw.match(/^(locate|find|search for|read|open)\s+(?:me\s+|for me\s+)?(?:the\s+)?(?:files?\b\s*|(["'][A-Za-z]:[\\/].+["'])|([^\r\n]+\.(?:txt|md|csv|json|log|pdf|docx|xlsx)\b.*))/i);
  if (!match) return null;
  const action=/^(locate|find|search)/i.test(raw)?'locate':/^read/i.test(raw)?'read':'open';
  let query=match[2]||match[3]||raw.slice(match[0].length);
  query=query.replace(/^(?:named|called)\s+/i,'').replace(/[.!?]+$/,'').trim();
  const scoped=query.match(/\s+(?:in|inside|on)\s+(?:my\s+|the\s+)?(desktop|downloads|documents|"[A-Za-z]:[\\/][^"]+")$/i);
  const scope=scoped ? scoped[1].replace(/^"|"$/g,'') : 'all';
  if(scoped)query=query.slice(0,scoped.index).trim();
  query=query.replace(/^["']|["']$/g,'');
  if (!query || /^(?:inside|on|in)\s+(?:my|the)\s+(?:computer|laptop|pc)$/i.test(query))
    return {action,query:'',scope,clarification:'Which file should I locate? Tell me its name or part of its name, and a folder if you know it.'};
  return {action,query,scope};
}

export async function executeLocalFileRequest(request: LocalFileRequest | ControlledFileRequest, conversationId: string, signal?: AbortSignal) {
  if(request.scope==='controlled-test') return executeControlledFileRequest(request as ControlledFileRequest,conversationId,signal);
  assertExecutionActive();
  signal?.throwIfAborted();
  if(request.clarification)return {success:false,error:request.clarification};
  const matches=path.isAbsolute(request.query)
    ? await fs.stat(request.query).then(s=>s.isFile()?[{path:request.query,name:path.basename(request.query)}]:[]).catch(()=>[])
    : await filesystemExecutor.locateFileOrFolder(request.query,{scope:request.scope,targetType:'file'});
  signal?.throwIfAborted();
  if(!matches.length)return {success:false,error:`I could not find a file matching ${request.query} in the searched folders.`};
  if(matches.length>1)return {success:false,error:`I found ${matches.length} matching files. Which one do you mean: ${matches.slice(0,5).map(m=>m.name).join(', ')}? Please specify its folder if the names are the same.`};
  const selected=matches[0];
  let presentationText=`I found ${selected.name}.`;
  if(request.action==='read') {
    if(!/\.(?:txt|md|csv|json|log)$/i.test(selected.path))return {success:false,error:`I located ${selected.name}, but direct text extraction for this file format is not available in this path.`};
    const stat=await fs.stat(selected.path);
    if(stat.size>100000)return {success:false,error:'The file is too large for a single read. Please specify the section you need.'};
    const result=await filesystemExecutor.executeStep({action:'read',parameters:{path:selected.path}} as any,{} as any);
    if(!result.success)return {success:false,error:'The file was located, but I could not read its contents.'};
    presentationText=String((result.data as any)?.content||'The file is empty.');
  } else if(request.action==='open') {
    signal?.throwIfAborted();
    const opened=await filesystemExecutor.openFile(selected.path);
    if(!opened.success)return {success:false,error:`I could not open ${selected.name}.`};
    let verified=false;
    const deadline=Date.now()+4000;
    do {
      signal?.throwIfAborted();
      const windows=await targetResolver.getOpenWindows();
      verified=windows.some(w=>w.title.toLowerCase().includes(selected.name.toLowerCase()));
      if(verified)break;
      await new Promise(resolve=>setTimeout(resolve,200));
    } while(Date.now()<deadline);
    if(!verified)
      return {success:false,error:`I requested opening ${selected.name}, but could not verify its application window.`};
    presentationText=`I opened ${selected.name}.`;
  }
  signal?.throwIfAborted();
  authoritativeInteractionContext.recordSucceededFileOperation(conversationId,selected.path,presentationText);
  return {success:true,outputs:{status:'SUCCEEDED',verified:false,presentationText,filePath:selected.path}};
}
