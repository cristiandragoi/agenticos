import crypto from 'node:crypto';
import {rawDb} from '../../../db/index.js';
import type {TaskGraph} from './types.js';

// Evidence projection only. GoalLifecycle and the existing executor retain
// exclusive ownership of task state; this journal cannot dispatch or resume work.
function ensureSchema() {
  rawDb.exec(`CREATE TABLE IF NOT EXISTS task_graph_journal (
    graph_id TEXT NOT NULL, goal_id TEXT NOT NULL, version INTEGER NOT NULL,
    event TEXT NOT NULL, at TEXT NOT NULL, snapshot TEXT NOT NULL,
    previous_hash TEXT NOT NULL, hash TEXT NOT NULL,
    PRIMARY KEY(graph_id,version));
    CREATE INDEX IF NOT EXISTS task_graph_journal_goal ON task_graph_journal(goal_id);
    CREATE TRIGGER IF NOT EXISTS task_graph_journal_no_update BEFORE UPDATE ON task_graph_journal
    BEGIN SELECT RAISE(ABORT,'Task graph audit is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS task_graph_journal_no_delete BEFORE DELETE ON task_graph_journal
    BEGIN SELECT RAISE(ABORT,'Task graph audit is append-only'); END;`);
}
function redact(value: unknown, depth=0): unknown {
  if(depth>20)return '[DEPTH_LIMIT]';
  if(typeof value==='string')return value.replace(/\b(?:Bearer\s+\S+|gh[pousr]_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{16,})/gi,'[REDACTED]');
  if(Array.isArray(value))return value.map(v=>redact(v,depth+1));
  if(value && typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,/password|secret|token|authorization|cookie|api.?key/i.test(k)?'[REDACTED]':redact(v,depth+1)]));
  return value;
}
function digest(row: {graph_id:string;goal_id:string;version:number;event:string;at:string;snapshot:string;previous_hash:string}) {
  return crypto.createHash('sha256').update(JSON.stringify([row.graph_id,row.goal_id,row.version,row.event,row.at,row.snapshot,row.previous_hash])).digest('hex');
}
export function appendGraphEvidence(graph:TaskGraph,event:string):number {
  ensureSchema();
  return rawDb.transaction(()=>{
    const previous=rawDb.prepare('SELECT version,hash FROM task_graph_journal WHERE graph_id=? ORDER BY version DESC LIMIT 1').get(graph.graphId) as any;
    const row={graph_id:graph.graphId,goal_id:graph.goalId,version:(previous?.version||0)+1,event,at:new Date().toISOString(),
      snapshot:JSON.stringify(redact({...graph,nodes:[...graph.nodes.values()]})),previous_hash:previous?.hash||''};
    rawDb.prepare('INSERT INTO task_graph_journal VALUES (@graph_id,@goal_id,@version,@event,@at,@snapshot,@previous_hash,@hash)').run({...row,hash:digest(row)});
    return row.version;
  })();
}
export function readGraphEvidence(graphId:string) {
  ensureSchema();
  return rawDb.prepare('SELECT * FROM task_graph_journal WHERE graph_id=? ORDER BY version').all(graphId) as Array<{graph_id:string;goal_id:string;version:number;event:string;at:string;snapshot:string;previous_hash:string;hash:string}>;
}
export function verifyGraphEvidence(graphId:string):boolean {
  const rows=readGraphEvidence(graphId);let previous='';let version=0;
  for(const row of rows){if(row.version!==++version||row.previous_hash!==previous||digest(row)!==row.hash)return false;previous=row.hash;}
  return rows.length>0;
}

/** Corrections are append-only overlays; callers must retain the historical status separately. */
export function readGoalVerificationCorrection(goalId:string): {effectiveStatus:'SUCCEEDED_WITHOUT_INDEPENDENT_VERIFICATION'; correction:Record<string,unknown>; journalHash:string; journalVersion:number} | undefined {
  ensureSchema();
  const rows=rawDb.prepare("SELECT * FROM task_graph_journal WHERE goal_id=? AND event='VERIFICATION_CORRECTED' ORDER BY at DESC,version DESC").all(goalId) as ReturnType<typeof readGraphEvidence>;
  for(const row of rows){
    if(!verifyGraphEvidence(row.graph_id)) throw new Error('CORRECTION_JOURNAL_CHAIN_INVALID');
    const snapshot=JSON.parse(row.snapshot);
    if(snapshot.effectiveStatus==='SUCCEEDED_WITHOUT_INDEPENDENT_VERIFICATION' && snapshot.correction?.goalId===goalId && snapshot.correction?.graphId===row.graph_id){
      const original=readGraphEvidence(row.graph_id).find(entry=>entry.version===snapshot.correction.originalVersion);
      if(!original || original.hash!==snapshot.correction.originalHash || original.version>=row.version || snapshot.correction.to!==snapshot.effectiveStatus) throw new Error('CORRECTION_REFERENCE_INVALID');
      return {effectiveStatus:snapshot.effectiveStatus,correction:snapshot.correction,journalHash:row.hash,journalVersion:row.version};
    }
  }
  return undefined;
}
