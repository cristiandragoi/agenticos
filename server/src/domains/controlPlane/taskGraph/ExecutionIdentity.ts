import { AsyncLocalStorage } from 'node:async_hooks';
import { rawDb } from '../../../db/index.js';
import type { TaskGraph, TaskNode } from './types.js';

export interface ExecutionIdentity {
  readonly goalId: string;
  readonly graphId: string;
  readonly nodeId: string;
  readonly operation: string;
  readonly attempt: number;
  readonly workerId?: string;
}
export type CanonicalExecutionIdentity = ExecutionIdentity;
const context = new AsyncLocalStorage<{ identity: Readonly<ExecutionIdentity>; signal?: AbortSignal; closed: boolean }>();

/** Identity projection only: GoalLifecycle remains the sole goal state owner. */
export function currentExecutionIdentity(): Readonly<ExecutionIdentity> | undefined {
  return context.getStore()?.identity;
}
export function bindExecutionIdentity(claim?: ExecutionIdentity): Readonly<ExecutionIdentity> {
  const identity=assertExecutionActive();
  if(claim && (Object.keys(claim).length!==Object.keys(identity).length ||
    Object.entries(identity).some(([key,value])=>(claim as any)[key]!==value)))
    throw new Error('CALLER_PROVENANCE_CONFLICT');
  return identity;
}
export function assertExecutionActive(): Readonly<ExecutionIdentity> {
  const frame = context.getStore();
  if (!frame) throw new Error('CANONICAL_TASK_IDENTITY_REQUIRED');
  if (frame.closed) throw new Error('CANONICAL_EXECUTION_SCOPE_CLOSED');
  if (frame.signal?.aborted) throw new Error('CANONICAL_TASK_CANCELLED');
  // Read durable state rather than accepting task status supplied by a model or cached caller.
  const goal = rawDb.prepare('SELECT status FROM goal_runs WHERE goal_id=?').get(frame.identity.goalId) as {status:string}|undefined;
  if (!goal || !['EXECUTING', 'RETRYING_ORIGINAL_GOAL', 'RECOVERING'].includes(goal.status))
    throw new Error('CANONICAL_TASK_NOT_EXECUTABLE');
  return frame.identity;
}
export async function withNodeExecution<T>(graph: TaskGraph, node: TaskNode, signal: AbortSignal|undefined, execute:()=>Promise<T>, workerId?: string): Promise<T> {
  if (graph.nodes.get(node.id) !== node || graph.status !== 'RUNNING' || node.status !== 'RUNNING')
    throw new Error('CANONICAL_NODE_IDENTITY_MISMATCH');
  const identity: ExecutionIdentity = Object.freeze({
    goalId: graph.goalId,
    graphId: graph.graphId,
    nodeId: node.id,
    operation: node.operation,
    attempt: node.retryCount || 1,
    ...(workerId || (node as any).workerId ? { workerId: workerId || (node as any).workerId } : {}),
  });
  const frame={identity,signal,closed:false};
  return context.run(frame,async()=>{
    try {
    assertExecutionActive();
    const result = await execute();
    // A completed transport call cannot promote a cancelled goal to VERIFIED.
    assertExecutionActive();
    return result;
    } finally { frame.closed=true; }
  });
}
