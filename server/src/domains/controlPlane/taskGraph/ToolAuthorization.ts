import { createHash, randomUUID } from 'node:crypto';
import { rawDb } from '../../../db/index.js';
import { assertExecutionActive } from './ExecutionIdentity.js';
import { assertTrustedToolApproval } from './TrustedToolApproval.js';

// Authorization records only, never task state. No model-facing grant issuer.
export function ensureToolAuthorizationSchema() {
  rawDb.exec(`CREATE TABLE IF NOT EXISTS tool_authorization_grants (
    id TEXT PRIMARY KEY, goal_id TEXT NOT NULL, graph_id TEXT NOT NULL,
    node_id TEXT NOT NULL, operation TEXT NOT NULL, attempt INTEGER NOT NULL,
    tool TEXT NOT NULL, scope_hash TEXT NOT NULL, approval_ref TEXT NOT NULL,
    approved_by TEXT NOT NULL, approved_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
    revoked_at INTEGER, uses_remaining INTEGER NOT NULL CHECK(uses_remaining >= 0),
    calls_per_minute INTEGER NOT NULL CHECK(calls_per_minute > 0));
    CREATE TABLE IF NOT EXISTS tool_authorization_dispatches (
    id TEXT PRIMARY KEY, grant_id TEXT NOT NULL, goal_id TEXT NOT NULL,
    tool TEXT NOT NULL, dispatched_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS tool_dispatch_rate ON tool_authorization_dispatches(goal_id,tool,dispatched_at);`);
}

function canonical(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && Object.getPrototypeOf(value) === Object.prototype)
    return '{' + Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical((value as Record<string,unknown>)[k])).join(',') + '}';
  throw new Error('AUTHORIZATION_SCOPE_INVALID');
}
/** Exact invocation scope. Values stay out of the dispatch log. */
export function toolScopeHash(args: Record<string, unknown>): string {
  return createHash('sha256').update(canonical(args)).digest('hex');
}

export function authorizeToolDispatch(tool: string, args: Record<string,unknown>) {
  const identity=assertExecutionActive();
  ensureToolAuthorizationSchema();
  const now=Date.now(), scope=toolScopeHash(args);
  return rawDb.transaction(()=>{
    const grant=rawDb.prepare(`SELECT * FROM tool_authorization_grants WHERE
      goal_id=? AND graph_id=? AND node_id=? AND operation=? AND attempt=? AND tool=? AND scope_hash=?
      AND revoked_at IS NULL AND expires_at>? AND approved_at<=? AND uses_remaining>0
      AND length(approval_ref)>0 AND length(approved_by)>0 ORDER BY approved_at DESC LIMIT 1`)
      .get(identity.goalId,identity.graphId,identity.nodeId,identity.operation,identity.attempt,tool,scope,now,now) as any;
    if(!grant)throw new Error('TOOL_AUTHORIZATION_REQUIRED');
    // Grant metadata is not evidence that a human approved execution.
    assertTrustedToolApproval(grant.approval_ref, {
      identity,
      tool,
      args,
      resourceScope: (args as any)?.resourceScope || (args as any)?.handle || 'default',
    });
    const count=rawDb.prepare('SELECT COUNT(*) AS n FROM tool_authorization_dispatches WHERE goal_id=? AND tool=? AND dispatched_at>?')
      .get(identity.goalId,tool,now-60_000) as {n:number};
    if(count.n>=grant.calls_per_minute)throw new Error('TOOL_RATE_LIMITED');
    const result=rawDb.prepare('UPDATE tool_authorization_grants SET uses_remaining=uses_remaining-1 WHERE id=? AND uses_remaining>0 AND revoked_at IS NULL').run(grant.id);
    if(result.changes!==1)throw new Error('TOOL_AUTHORIZATION_REPLAY');
    const dispatchId=randomUUID();
    rawDb.prepare('INSERT INTO tool_authorization_dispatches VALUES (?,?,?,?,?)').run(dispatchId,grant.id,identity.goalId,tool,now);
    return Object.freeze({dispatchId,grantId:grant.id,approvalRef:grant.approval_ref,identity});
  }).immediate();
}
