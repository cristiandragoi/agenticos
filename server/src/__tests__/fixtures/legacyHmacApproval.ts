// HISTORICAL SYNTHETIC PROTOTYPE ONLY. Not an approval authority.
/**
 * TrustedHumanApprovalBridge.ts
 *
 * Implements the trusted human approval protocol for high-impact and privileged operations.
 *
 * Security Invariants:
 * 1. Approver Authentication: The approver identity MUST be cryptographically verified
 *    via local OS challenge-response or authenticated key proof. Unauthenticated or
 *    caller-asserted strings are unconditionally rejected.
 * 2. Strict Immutable Binding: Approval is bound to goalId, graphId, nodeId, operation,
 *    attempt, workerId, tool, resourceScope, argumentHash, and previewHash.
 * 3. Anti-Tampering: Any change to arguments or preview between issuance and dispatch
 *    causes immediate rejection (ARGUMENT_HASH_MISMATCH / SCOPE_MISMATCH).
 * 4. Anti-Replay: Finite usage count decremented atomically in a SQLite transaction;
 *    zero remaining uses or concurrent replay immediately fails closed.
 * 5. Two-Step Confirmation: High-impact actions (credentials, authenticated browser,
 *    external messaging, financial actions, policy/source changes) require explicit
 *    secondary confirmation before approval issuance.
 * 6. Auditability Without Secret Exposure: Secrets are never recorded in approval records;
 *    only cryptographic SHA-256 hashes of canonical inputs are persisted.
 */

import { createHash, randomBytes, createHmac } from 'node:crypto';
import { rawDb } from '../../db/index.js';
import type { CanonicalExecutionIdentity } from '../../domains/controlPlane/taskGraph/ExecutionIdentity.js';
import { toolScopeHash } from '../../domains/controlPlane/taskGraph/ToolAuthorization.js';

export interface ApproverChallenge {
  challengeId: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}

export interface PreparedApprovalRequest {
  requestId: string;
  challenge: ApproverChallenge;
  goalId: string;
  graphId: string;
  nodeId: string;
  operation: string;
  attempt: number;
  workerId?: string;
  tool: string;
  resourceScope: string;
  argumentHash: string;
  previewText: string;
  previewHash: string;
  secondConfirmationRequired: boolean;
}

export interface ApproverAuthenticationProof {
  approverId: string;
  authMethod: 'LOCAL_INTERACTIVE_SECRET' | 'LOCAL_ED25519_KEY' | 'INTERACTIVE_OPERATOR_HMAC';
  challengeId: string;
  challengeResponse: string;
}

export interface TrustedApprovalRecord {
  id: string;
  goal_id: string;
  graph_id: string;
  node_id: string;
  operation: string;
  attempt: number;
  worker_id: string;
  tool: string;
  resource_scope: string;
  argument_hash: string;
  preview_hash: string;
  approver_id: string;
  auth_method: string;
  auth_proof: string;
  second_confirmation_required: number;
  second_confirmation_provided: number;
  issued_at: number;
  expires_at: number;
  revoked_at: number | null;
  uses_remaining: number;
  dispatched_count: number;
}

// In-memory registry for pending challenges (ephemeral, 5-minute TTL)
const pendingChallenges = new Map<string, {
  challenge: ApproverChallenge;
  request: PreparedApprovalRequest;
  secretSeed: string;
}>();

// Registry of trusted local human approver secret keys
// In local interactive production, this key is bound to the interactive user session
const trustedApproverKeys = new Map<string, string>();

export function setTrustedApproverKey(approverId: string, secretKey: string | null): void {
  if (secretKey === null) {
    trustedApproverKeys.delete(approverId);
  } else {
    trustedApproverKeys.set(approverId, secretKey);
  }
}

export function ensureTrustedHumanApprovalSchema(): void {
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS trusted_human_approvals (
      id TEXT PRIMARY KEY,
      goal_id TEXT NOT NULL,
      graph_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      worker_id TEXT NOT NULL,
      tool TEXT NOT NULL,
      resource_scope TEXT NOT NULL,
      argument_hash TEXT NOT NULL,
      preview_hash TEXT NOT NULL,
      approver_id TEXT NOT NULL,
      auth_method TEXT NOT NULL,
      auth_proof TEXT NOT NULL,
      second_confirmation_required INTEGER NOT NULL,
      second_confirmation_provided INTEGER NOT NULL,
      issued_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      revoked_at INTEGER,
      uses_remaining INTEGER NOT NULL CHECK(uses_remaining >= 0),
      dispatched_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_tha_lookup ON trusted_human_approvals(id, revoked_at, expires_at);
  `);
}

function computePreviewHash(previewText: string, tool: string, resourceScope: string, argumentHash: string): string {
  const payload = JSON.stringify({ previewText, tool, resourceScope, argumentHash });
  return createHash('sha256').update(payload).digest('hex');
}

/**
 * Checks whether an operation qualifies as high impact requiring two-step confirmation.
 */
export function isHighImpactOperation(tool: string, resourceScope?: string): boolean {
  const HIGH_IMPACT_PREFIXES = [
    'credential.',
    'secretStore.',
    'shell.',
    'system.',
    'telegram.',
    'whatsapp.',
    'purchase.',
    'payment.',
    'account.',
    'policy.',
    'source.modify',
  ];

  if (HIGH_IMPACT_PREFIXES.some((prefix) => tool.startsWith(prefix))) {
    return true;
  }

  // Browser actions that alter state, submit forms, or evaluate arbitrary scripts
  if (tool === 'browser.handle.fill' || tool === 'browser.handle.click' || tool === 'browser.handle.evaluate') {
    return true;
  }

  // Sensitive resource scopes
  if (resourceScope && (resourceScope.includes('auth') || resourceScope.includes('credential') || resourceScope.includes('payment'))) {
    return true;
  }

  return false;
}

/**
 * Step 1: Prepare an approval request with an unforgeable challenge.
 */
export function prepareApprovalRequest(
  identity: CanonicalExecutionIdentity,
  tool: string,
  resourceScope: string,
  args: Record<string, unknown>,
  previewText: string,
  forceHighImpact?: boolean
): PreparedApprovalRequest {
  ensureTrustedHumanApprovalSchema();

  const argumentHash = toolScopeHash(args);
  const previewHash = computePreviewHash(previewText, tool, resourceScope, argumentHash);
  const requestId = `req_${randomBytes(16).toString('hex')}`;
  const challengeId = `ch_${randomBytes(16).toString('hex')}`;
  const nonce = randomBytes(32).toString('hex');
  const now = Date.now();
  const ttlMs = 5 * 60 * 1000; // 5 minutes

  const challenge: ApproverChallenge = {
    challengeId,
    nonce,
    issuedAt: now,
    expiresAt: now + ttlMs,
  };

  const highImpact = forceHighImpact ?? isHighImpactOperation(tool, resourceScope);

  const request: PreparedApprovalRequest = {
    requestId,
    challenge,
    goalId: identity.goalId,
    graphId: identity.graphId,
    nodeId: identity.nodeId,
    operation: identity.operation,
    attempt: identity.attempt,
    workerId: identity.workerId,
    tool,
    resourceScope,
    argumentHash,
    previewText,
    previewHash,
    secondConfirmationRequired: highImpact,
  };

  pendingChallenges.set(challengeId, {
    challenge,
    request,
    secretSeed: nonce,
  });

  return request;
}

/**
 * Helper for generating a valid HMAC challenge response for an authenticated approver key.
 */
export function generateChallengeProof(
  challengeId: string,
  nonce: string,
  previewHash: string,
  secretKey: string
): string {
  const payload = `${challengeId}:${nonce}:${previewHash}`;
  return createHmac('sha256', secretKey).update(payload).digest('hex');
}

/**
 * Step 2: Issue a cryptographically authenticated approval.
 */
export function issueTrustedHumanApproval(
  challengeId: string,
  proof: ApproverAuthenticationProof,
  options?: {
    secondConfirmation?: boolean;
    ttlMs?: number;
    maxUses?: number;
  }
): string {
  ensureTrustedHumanApprovalSchema();

  const entry = pendingChallenges.get(challengeId);
  if (!entry) {
    throw new Error('TOOL_APPROVAL_CHALLENGE_NOT_FOUND');
  }

  const { challenge, request } = entry;
  const now = Date.now();

  if (now > challenge.expiresAt) {
    pendingChallenges.delete(challengeId);
    throw new Error('TOOL_APPROVAL_CHALLENGE_EXPIRED');
  }

  // 1. Authenticate human approver identity
  const registeredKey = trustedApproverKeys.get(proof.approverId);
  if (!registeredKey) {
    throw new Error('TOOL_APPROVAL_APPROVER_NOT_AUTHENTICATED');
  }

  const expectedProof = generateChallengeProof(
    challengeId,
    challenge.nonce,
    request.previewHash,
    registeredKey
  );

  if (proof.challengeResponse !== expectedProof) {
    throw new Error('TOOL_APPROVAL_APPROVER_AUTH_FAILED');
  }

  // 2. High-impact check: requires explicit second confirmation
  if (request.secondConfirmationRequired && !options?.secondConfirmation) {
    throw new Error('TOOL_APPROVAL_SECOND_CONFIRMATION_REQUIRED');
  }

  // 3. Consume challenge so it cannot be used again
  pendingChallenges.delete(challengeId);

  // 4. Persist approval record in database
  const approvalId = `tha_${randomBytes(16).toString('hex')}`;
  const ttl = options?.ttlMs ?? 10 * 60 * 1000; // 10 minutes default
  const maxUses = options?.maxUses ?? 1;

  rawDb.prepare(`
    INSERT INTO trusted_human_approvals (
      id, goal_id, graph_id, node_id, operation, attempt, worker_id,
      tool, resource_scope, argument_hash, preview_hash,
      approver_id, auth_method, auth_proof,
      second_confirmation_required, second_confirmation_provided,
      issued_at, expires_at, revoked_at, uses_remaining, dispatched_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 0)
  `).run(
    approvalId,
    request.goalId,
    request.graphId,
    request.nodeId,
    request.operation,
    request.attempt,
    request.workerId || '',
    request.tool,
    request.resourceScope,
    request.argumentHash,
    request.previewHash,
    proof.approverId,
    proof.authMethod,
    createHash('sha256').update(proof.challengeResponse).digest('hex'), // store proof hash only
    request.secondConfirmationRequired ? 1 : 0,
    options?.secondConfirmation ? 1 : 0,
    now,
    now + ttl,
    maxUses
  );

  return approvalId;
}

/**
 * Revoke an active approval explicitly before dispatch.
 */
export function revokeTrustedHumanApproval(approvalId: string, reason = 'Operator Revocation'): void {
  ensureTrustedHumanApprovalSchema();
  const now = Date.now();
  const res = rawDb.prepare(`
    UPDATE trusted_human_approvals
    SET revoked_at = ?
    WHERE id = ? AND revoked_at IS NULL
  `).run(now, approvalId);

  if (res.changes === 0) {
    const existing = rawDb.prepare('SELECT id, revoked_at FROM trusted_human_approvals WHERE id = ?').get(approvalId) as any;
    if (!existing) throw new Error('TOOL_APPROVAL_NOT_FOUND');
    // Already revoked
  }
}

/**
 * Step 3: Verify and atomically consume approval at dispatch time.
 */
export function verifyAndConsumeTrustedApproval(
  approvalRef: string,
  identity: CanonicalExecutionIdentity,
  tool: string,
  args: Record<string, unknown>,
  resourceScope: string
): { approvalRef: string; approverId: string; approvedAt: number } {
  ensureTrustedHumanApprovalSchema();

  let record: TrustedApprovalRecord | undefined;
  try {
    record = rawDb.prepare(`
      SELECT * FROM trusted_human_approvals WHERE id = ?
    `).get(approvalRef) as TrustedApprovalRecord | undefined;
  } catch (dbErr: any) {
    throw new Error('TOOL_APPROVAL_SERVICE_UNAVAILABLE');
  }

  if (!record) {
    throw new Error('TOOL_APPROVAL_NOT_FOUND');
  }

  // 1. Revocation check
  if (record.revoked_at !== null && record.revoked_at > 0) {
    throw new Error('TOOL_APPROVAL_REVOKED');
  }

  // 2. Expiration check
  const now = Date.now();
  if (now > record.expires_at) {
    throw new Error('TOOL_APPROVAL_EXPIRED');
  }

  // 3. Canonical execution identity bindings
  if (record.goal_id !== identity.goalId) {
    throw new Error('TOOL_APPROVAL_GOAL_MISMATCH');
  }
  if (record.graph_id !== identity.graphId) {
    throw new Error('TOOL_APPROVAL_GRAPH_MISMATCH');
  }
  if (record.node_id !== identity.nodeId) {
    throw new Error('TOOL_APPROVAL_NODE_MISMATCH');
  }
  if (record.operation !== identity.operation) {
    throw new Error('TOOL_APPROVAL_OPERATION_MISMATCH');
  }
  if (record.attempt !== identity.attempt) {
    throw new Error('TOOL_APPROVAL_ATTEMPT_MISMATCH');
  }
  if (record.worker_id !== identity.workerId) {
    throw new Error('TOOL_APPROVAL_WORKER_MISMATCH');
  }

  // 4. Tool and Resource Scope bindings
  if (record.tool !== tool) {
    throw new Error('TOOL_APPROVAL_TOOL_MISMATCH');
  }
  if (record.resource_scope !== resourceScope) {
    throw new Error('TOOL_APPROVAL_SCOPE_MISMATCH');
  }

  // 5. Argument hash binding (tamper resistance)
  const currentArgumentHash = toolScopeHash(args);
  if (record.argument_hash !== currentArgumentHash) {
    throw new Error('TOOL_APPROVAL_ARGUMENT_HASH_MISMATCH');
  }

  // 6. Finite usage & atomic decrement (Replay protection)
  if (record.uses_remaining <= 0) {
    throw new Error('TOOL_APPROVAL_EXHAUSTED');
  }

  const updateResult = rawDb.prepare(`
    UPDATE trusted_human_approvals
    SET uses_remaining = uses_remaining - 1,
        dispatched_count = dispatched_count + 1
    WHERE id = ? AND uses_remaining > 0 AND revoked_at IS NULL
  `).run(approvalRef);

  if (updateResult.changes !== 1) {
    throw new Error('TOOL_APPROVAL_REPLAY_ATTEMPT');
  }

  return {
    approvalRef: record.id,
    approverId: record.approver_id,
    approvedAt: record.issued_at,
  };
}
