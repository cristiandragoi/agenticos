import { GitHubResearchClient } from './github.js';
import { hash, researchStore } from './store.js';
import type { ResearchSpec } from './specification.js';
import { createHash } from 'node:crypto';

export const REVIEW_VERSION = 'source-review-v1';
type Category = 'manifest' | 'architecture' | 'source' | 'test' | 'example' | 'ci';
export interface SourceFile { path: string; sha: string; category: Category; text: string; }
interface TreeEntry { path: string; sha: string; type: string; mode: string; size?: number; }
export interface Finding { kind: string; observation: string; path: string; line: number; url: string; }
const limits: Record<Category, number> = { manifest: 3, architecture: 2, source: 7, test: 2, example: 2, ci: 2 };
const codeExtension = /\.(?:py|ts|tsx|js|mjs|go|rs|java|cs)$/i;
function category(path: string): Category | undefined {
  if (/(?:^|\/)(?:package\.json|pyproject\.toml|requirements[^/]*\.txt|Cargo\.toml|go\.mod)$/i.test(path)) return 'manifest';
  if (/^\.github\/workflows\/[^/]+\.ya?ml$/i.test(path)) return 'ci';
  if (/(?:^|\/)(?:architecture|design|readme)[^/]*\.md$/i.test(path)) return 'architecture';
  if (codeExtension.test(path)) {
    if (/(?:^|\/)(?:tests?|__tests__|spec)(?:\/|_)|\.(?:test|spec)\./i.test(path)) return 'test';
    if (/(?:^|\/)(?:examples?|samples?|quickstart)(?:\/|_)/i.test(path)) return 'example';
    return 'source';
  }
  return undefined;
}
export function selectSourceFiles(tree: TreeEntry[]) {
  const counts = Object.fromEntries(Object.keys(limits).map(k=>[k,0])) as Record<Category,number>;
  const candidates = tree.filter(e => e.type === 'blob' && /^(?:100644|100755)$/.test(e.mode) && /^[a-f0-9]{40}$/i.test(e.sha)
    && typeof e.path === 'string' && e.path.length < 300 && !e.path.split('/').some(p=>p==='..'||p==='.')
    && !/[\\\x00-\x1f]/.test(e.path) && !e.path.startsWith('/')
    && !/(?:^|\/)(?:node_modules|vendor|dist|build|\.git|\.venv|fixtures|generated|secrets?)(?:\/|$)|(?:^|\/)\.env|(?:credentials|private[-_]?key)/i.test(e.path)
    && Number.isFinite(e.size) && e.size! <= 100_000 && category(e.path));
  // Prefer shallow manifests and relevant execution/provider modules, but reserve
  // independent slots for tests, examples and CI instead of letting source dominate.
  const priority = (p:string) => p.split('/').length * 10 - (/agent|router|orchestrat|provider|model|stream|parallel|mcp|client|server/i.test(p) ? 5 : 0);
  candidates.sort((a,b)=>priority(a.path)-priority(b.path)||a.path.localeCompare(b.path));
  return candidates.flatMap(e=> { const kind=category(e.path)!; return counts[kind]++ < limits[kind] ? [{...e, category:kind}] : []; });
}
export function analyzeSourceFiles(repository: string, commit: string, files: SourceFile[], spec: ResearchSpec) {
  const findings: Finding[]=[];
  const dependencies: {name:string; kind:string; path:string; line:number; url:string}[]=[];
  const url=(path:string,line:number)=>`https://github.com/${repository}/blob/${commit}/${path.split('/').map(encodeURIComponent).join('/')}#L${line}`;
  const add=(f:SourceFile,line:number,kind:string,observation:string)=>findings.push({kind,observation,path:f.path,line,url:url(f.path,line)});
  const dep=(f:SourceFile,name:string,line:number,kind:string)=>{
    if (/^[a-zA-Z0-9@][a-zA-Z0-9@/_.-]{0,100}$/.test(name) && dependencies.length<100) dependencies.push({name,kind,path:f.path,line,url:url(f.path,line)});
  };
  for(const f of files) {
    const lines=f.text.split(/\r?\n/);
    if(f.category==='manifest') {
      if(f.path.endsWith('package.json')) {
        try {
          const p=JSON.parse(f.text);
          for(const key of ['dependencies','peerDependencies','optionalDependencies','devDependencies']) {
            for(const name of Object.keys(p[key]||{})) dep(f,name,Math.max(1,lines.findIndex(l=>l.includes(JSON.stringify(name)))+1),key);
          }
          for(const key of ['preinstall','install','postinstall']) if(p.scripts?.[key]) add(f,Math.max(1,lines.findIndex(l=>l.includes(`"${key}"`))+1),'install-hook',`Package declares ${key}; command was not executed and requires sandbox review`);
          if(p.exports || p.main || p.module) add(f,1,'library-entry','Package declares a library entry point; public API compatibility is untested');
          if(p.bin) add(f,1,'cli-entry','Package declares a CLI entry point');
        } catch { add(f,1,'parse-warning','Package manifest could not be parsed; dependencies unknown'); }
      } else {
        // Conservative literal extraction only. Never evaluate setup.py, dynamic
        // metadata, TOML expressions or imported build configuration.
        let section=''; let pythonDependencies=false;
        lines.forEach((line,i)=>{
          const trimmed=line.trim();
          if(/^\[/.test(trimmed)) { section=trimmed; pythonDependencies=false; }
          if(/^dependencies\s*=\s*\[/.test(trimmed) && /pyproject/.test(f.path)) pythonDependencies=true;
          if(/requirements[^/]*\.txt$/.test(f.path)) {
            const name=/^([A-Za-z0-9][A-Za-z0-9_.-]*)(?:\[.*?\])?\s*(?:[<>=!~;]|$)/.exec(trimmed)?.[1]; if(name) dep(f,name,i+1,'requirement');
          } else if(/go\.mod$/.test(f.path)) {
            const name=/^(?:require\s+)?([\w.-]+\/[\w./-]+)\s+v\d/.exec(trimmed)?.[1]; if(name) dep(f,name,i+1,'go-module');
          } else if(/dependencies|dependency-group/.test(section) || pythonDependencies) {
            const literal=/^([\w.-]+)\s*=/.exec(trimmed)?.[1];
            if(literal && !pythonDependencies && /dependencies/.test(section) && literal!=='python') dep(f,literal,i+1,section);
            else for(const match of trimmed.matchAll(/["']([A-Za-z0-9][A-Za-z0-9_.-]*)(?:\[[^"']+\])?(?:[<>=!~;][^"']*)?["']/g)) dep(f,match[1],i+1,'literal-dependency');
          }
          if(pythonDependencies && (trimmed.startsWith(']') || /^dependencies\s*=.*\]\s*$/.test(trimmed))) pythonDependencies=false;
        });
      }
    }
    if(f.category==='test') add(f,1,'test-file','Selected test file inspected statically; tests were not executed');
    if(f.category==='example') add(f,1,'example-file','Selected example inspected statically; example was not executed');
    if(f.category==='ci') add(f,1,'ci-file','CI configuration inspected; no successful run is established');
    if(f.category==='architecture') {
      const index=lines.findIndex(l=>/\b(?:architecture|orchestrat|routing|retrieval|inference|provider|agent)\w*\b/i.test(l));
      if(index>=0) add(f,index+1,'architecture-documentation','Architecture/component terminology documented; source-level integration fit remains subject to review');
    }
    if(f.category!=='source' && f.category!=='example') continue;
    const signals: [string,RegExp,string][] = [
      ['http-api',/\b(?:FastAPI|Flask|express)\s*\(|@(?:app|router)\.(?:get|post|put|delete)\s*\(/,'HTTP API/server construct found; deployed interface and authentication untested'],
      ['retrieval',/\b(?:VectorStore|Chroma|QdrantClient|FAISS|Retriever)\b/,'Retrieval/vector-store reference found; retrieval behavior untested'],
      ['streaming',/\byield\b|\bReadableStream\b|\bStreamingResponse\b/,'Streaming/generator construct found; end-to-end streaming untested'],
      ['parallel',/asyncio\.(?:gather|TaskGroup)|Promise\.all(?:Settled)?|ThreadPoolExecutor|ProcessPoolExecutor/,'Concurrency primitive found; parallel execution behavior untested'],
      ['mcp',/(?:from|import|require).*\bmcp\b|\bFastMCP\b|\bMcpServer\b/,'MCP import or server construct found; interoperability untested'],
      ['provider',/(?:from|import|require).*(?:openai|anthropic|ollama)|\b(?:OpenAI|AsyncOpenAI|Anthropic)\s*\(/i,'Model-provider integration reference found; default routing requires review'],
      ['network',/\b(?:fetch|requests\.(?:get|post)|httpx\.(?:get|post)|axios\.(?:get|post))\s*\(/,'Network call construct found; destination and transmitted data are not audited'],
      ['dynamic-execution',/\b(?:eval|exec)\s*\(|subprocess\.|child_process|os\.system\s*\(/,'Dynamic/process execution construct found; manual security review required'],
    ];
    for(const [kind,pattern,observation] of signals) {
      const index=lines.findIndex(l=>!/^\s*(?:#|\/\/|\*)/.test(l) && pattern.test(l));
      if(index>=0) add(f,index+1,kind,observation);
    }
    let declarations=0;
    lines.forEach((line,index)=>{
      const symbol=/^\s*(?:export\s+)?(?:async\s+)?(?:class|def|function)\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(line)?.[1];
      if(symbol && declarations++<5) add(f,index+1,'declared-symbol',`Source declares ${symbol}; signature and caller compatibility require review`);
    });
  }
  const kinds=new Set(findings.map(f=>f.kind));
  const roleIndicators=[...(kinds.has('library-entry')?['Library entry point']:[]),...(kinds.has('cli-entry')?['Command-line application']:[]),...(kinds.has('provider')?['Model-provider integration']:[]),...(kinds.has('mcp')?['MCP integration']:[]),...(kinds.has('http-api')?['HTTP API/server']:[]),...(kinds.has('retrieval')?['Retrieval/vector-store integration']:[])];
  const unresolved=spec.features.filter(f=> !['mcp','streaming','parallel'].includes(f) || !kinds.has(f));
  return { findings, dependencies, roleIndicators,
    summary: `${files.filter(f=>f.category==='source').length} source files and ${files.filter(f=>f.category==='manifest').length} manifests inspected statically. ${dependencies.length} literal dependency declarations found. ${roleIndicators.join('; ') || 'Architecture role not established by the selected files'}.`,
    unresolvedFeatures:unresolved,
    cautions:['Bounded file sample; absence of a signal does not prove absence of a capability', 'Dependency versions, vulnerabilities, transitive dependencies and data flow are not audited', 'No installation, tests, examples or benchmarks were executed', 'Source constructs are indicators, not verified behavior'],
    decision: 'REQUIRES_REVIEW' as const,
    decisionReasons:[...(!files.some(f=>f.category==='source')?['No implementation source was available in the selected sample']:[]),
      ...(kinds.has('dynamic-execution')?['Process/dynamic execution requires security review']:[]),
      ...(kinds.has('install-hook')?['Installation hooks require isolated validation']:[]),
      ...(unresolved.length?[`Requested features remain unresolved: ${unresolved.join(', ')}`]:[]), 'Integration fit and performance require later validation'],
  };
}

export async function reviewRepositorySource(repository: string, commit: string, spec: ResearchSpec, client: GitHubResearchClient, signal?:AbortSignal) {
  signal?.throwIfAborted();
  if(!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[a-f0-9]{40}$/i.test(commit)) throw new Error('Source review requires a valid repository and pinned commit');
  const metadata=await client.get(`/repos/${repository}`,signal,0);
  if(!metadata || metadata.private!==false) throw new Error('Source review is restricted to verified public repositories');
  const tree=await client.get(`/repos/${repository}/git/trees/${commit}?recursive=1`,signal,7*86400000);
  if(!Array.isArray(tree?.tree)) throw new Error('Repository source tree unavailable');
  const selected=selectSourceFiles(tree.tree);
  const fingerprint=hash(JSON.stringify({repository,version:REVIEW_VERSION,features:spec.features,
    selected:selected.map(e=>[e.path,e.sha,e.mode]),truncated:Boolean(tree.truncated)}));
  const cached=researchStore.sourceReview(fingerprint);
  if(cached) return {...cached,reviewedCommit:commit,reused:true,coverage:{...cached.coverage,treeEntries:tree.tree.length}};
  const files:SourceFile[]=[]; const failures:{path:string;reason:string}[]=[]; let bytes=0;
  for(const entry of selected) {
    signal?.throwIfAborted();
    try {
      const blob=await client.get(`/repos/${repository}/git/blobs/${entry.sha}`,signal,7*86400000);
      if(blob?.encoding!=='base64' || typeof blob.content!=='string' || blob.size>100000) throw new Error('Unsupported or oversized text blob');
      const data=Buffer.from(blob.content,'base64'); bytes+=data.length;
      if(data.length>100000 || bytes>1000000 || data.includes(0)) throw new Error('Source text exceeds review bounds or is binary');
      const actualSha=createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
      if(actualSha!==entry.sha) throw new Error('Source blob does not match the pinned Git object');
      files.push({path:entry.path,sha:entry.sha,category:entry.category,text:data.toString('utf8')});
    } catch(error) {
      signal?.throwIfAborted();
      if(/rate limit|budget|HTTP 40[13]/i.test(String(error))) throw error;
      failures.push({path:entry.path,reason:error instanceof Error?error.message:'File unavailable'});
    }
  }
  const analysis=analyzeSourceFiles(repository,commit,files,spec);
  const result={repository,reviewedCommit:commit,evidenceCommit:commit,version:REVIEW_VERSION,fingerprint,reused:false,
    createdAt:new Date().toISOString(),...analysis,files:files.map(({text,...f})=>({...f,bytes:Buffer.byteLength(text)})),
    coverage:{treeEntries:tree.tree.length,selected:selected.length,read:files.length,treeTruncated:Boolean(tree.truncated),sampleOnly:true},
    incomplete:Boolean(tree.truncated)||failures.length>0||!files.some(f=>f.category==='source'),failures};
  signal?.throwIfAborted();
  if(!result.incomplete) researchStore.saveSourceReview(fingerprint,result);
  return result;
}
