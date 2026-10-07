import { rawDb } from '../../../db/index.js';
import type { CanonicalExecutionIdentity } from './ExecutionIdentity.js';
import { verifyAndConsumeTrustedApproval } from './TrustedHumanApprovalBridge.js';

export interface ToolApprovalContext {
  identity?: CanonicalExecutionIdentity;
  tool?: string;
  args?: Record<string, unknown>;
  resourceScope?: string;
}

/**
 * The existing approval service records decisions in mcp_prepared_tasks.
 * Its responder is supplied by the HTTP caller, not an authenticated human.
 * Read it independently, but never upgrade those records into tool authority.
 * No environment flag, grant column or caller callback can enable this gate.
 * Replace this denial only with a reviewed, authenticated approval integration.
 */
export function assertTrustedToolApproval(
  approvalRef: string,
  context?: ToolApprovalContext
): void {
  // If the approval reference is from the TrustedHumanApprovalBridge (tha_ prefix)
  if (approvalRef && approvalRef.startsWith('tha_')) {
    if (!context || !context.identity || !context.tool || !context.args || !context.resourceScope) {
      throw new Error('TOOL_APPROVAL_CONTEXT_REQUIRED');
    }
    verifyAndConsumeTrustedApproval(
      approvalRef,
      context.identity,
      context.tool,
      context.args,
      context.resourceScope
    );
    return;
  }

  // Legacy mcp_prepared_tasks unauthenticated checks (strictly fail-closed)
  let decision: { approval_state: string; expires_at: string } | undefined;
  try {
    decision = rawDb.prepare(
      'SELECT approval_state, expires_at FROM mcp_prepared_tasks WHERE id = ?',
    ).get(approvalRef) as typeof decision;
  } catch {
    throw new Error('TOOL_APPROVAL_SERVICE_UNAVAILABLE');
  }
  if (!decision) throw new Error('TOOL_APPROVAL_NOT_FOUND');
  if (decision.approval_state !== 'approved') throw new Error('TOOL_APPROVAL_NOT_APPROVED');
  const expiry = Date.parse(decision.expires_at);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) throw new Error('TOOL_APPROVAL_EXPIRED');
  throw new Error('TOOL_APPROVAL_HUMAN_AUTHENTICATION_UNAVAILABLE');
}
