import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { rawDb } from '../db/index.js';
import type { CanonicalExecutionIdentity } from '../domains/controlPlane/taskGraph/ExecutionIdentity.js';
import {
  prepareApprovalRequest,
  issueTrustedHumanApproval,
  revokeTrustedHumanApproval,
  verifyAndConsumeTrustedApproval,
  setTrustedApproverKey,
  generateChallengeProof,
  ensureTrustedHumanApprovalSchema,
  isHighImpactOperation,
} from './fixtures/legacyHmacApproval.js';

describe('Historical HMAC prototype (synthetic only, no production authority)', () => {
  const approverId = 'interactive-operator-test';
  const approverKey = 'test-operator-hmac-secret-key-32bytes';

  const defaultIdentity: CanonicalExecutionIdentity = {
    goalId: 'goal_test_001',
    graphId: 'graph_test_001',
    nodeId: 'node_test_001',
    operation: 'EXECUTE',
    attempt: 1,
    workerId: 'worker_jarvis_001',
  };

  beforeEach(() => {
    ensureTrustedHumanApprovalSchema();
    setTrustedApproverKey(approverId, approverKey);
  });

  afterEach(() => {
    setTrustedApproverKey(approverId, null);
    vi.restoreAllMocks();
  });

  function createValidApproval(
    overrides?: Partial<CanonicalExecutionIdentity>,
    tool = 'synthetic.safe.tool',
    resourceScope = 'synthetic:resource:001',
    args: Record<string, unknown> = { query: 'test-query' },
    secondConfirmation = false
  ) {
    const identity = { ...defaultIdentity, ...overrides };
    const request = prepareApprovalRequest(
      identity,
      tool,
      resourceScope,
      args,
      'Preview: running synthetic operation',
      false
    );

    const challengeProof = generateChallengeProof(
      request.challenge.challengeId,
      request.challenge.nonce,
      request.previewHash,
      approverKey
    );

    const approvalRef = issueTrustedHumanApproval(
      request.challenge.challengeId,
      {
        approverId,
        authMethod: 'INTERACTIVE_OPERATOR_HMAC',
        challengeId: request.challenge.challengeId,
        challengeResponse: challengeProof,
      },
      { secondConfirmation }
    );

    return { approvalRef, request, identity, args, resourceScope, tool };
  }

  it('1. missing approval throws TOOL_APPROVAL_NOT_FOUND', () => {
    expect(() =>
      verifyAndConsumeTrustedApproval(
        'tha_non_existent_approval_id',
        defaultIdentity,
        'synthetic.safe.tool',
        { query: 'test' },
        'scope:001'
      )
    ).toThrow('TOOL_APPROVAL_NOT_FOUND');
  });

  it('2. unauthenticated approver is refused before issuance', () => {
    const request = prepareApprovalRequest(
      defaultIdentity,
      'synthetic.tool',
      'resource:001',
      { foo: 'bar' },
      'Preview text'
    );

    expect(() =>
      issueTrustedHumanApproval(request.challenge.challengeId, {
        approverId: 'unregistered-rogue-actor',
        authMethod: 'INTERACTIVE_OPERATOR_HMAC',
        challengeId: request.challenge.challengeId,
        challengeResponse: 'fake-signature',
      })
    ).toThrow('TOOL_APPROVAL_APPROVER_NOT_AUTHENTICATED');
  });

  it('3. invalid challenge response signature is refused', () => {
    const request = prepareApprovalRequest(
      defaultIdentity,
      'synthetic.tool',
      'resource:001',
      { foo: 'bar' },
      'Preview text'
    );

    expect(() =>
      issueTrustedHumanApproval(request.challenge.challengeId, {
        approverId,
        authMethod: 'INTERACTIVE_OPERATOR_HMAC',
        challengeId: request.challenge.challengeId,
        challengeResponse: 'tampered-signature-bytes',
      })
    ).toThrow('TOOL_APPROVAL_APPROVER_AUTH_FAILED');
  });

  it('4. mismatched goal ID throws TOOL_APPROVAL_GOAL_MISMATCH', () => {
    const { approvalRef, identity, tool, args, resourceScope } = createValidApproval();
    const wrongIdentity = { ...identity, goalId: 'goal_other_attacker' };

    expect(() =>
      verifyAndConsumeTrustedApproval(approvalRef, wrongIdentity, tool, args, resourceScope)
    ).toThrow('TOOL_APPROVAL_GOAL_MISMATCH');
  });

  it('5. mismatched graph ID throws TOOL_APPROVAL_GRAPH_MISMATCH', () => {
    const { approvalRef, identity, tool, args, resourceScope } = createValidApproval();
    const wrongIdentity = { ...identity, graphId: 'graph_subgraph_different' };

    expect(() =>
      verifyAndConsumeTrustedApproval(approvalRef, wrongIdentity, tool, args, resourceScope)
    ).toThrow('TOOL_APPROVAL_GRAPH_MISMATCH');
  });

  it('6. mismatched node ID throws TOOL_APPROVAL_NODE_MISMATCH', () => {
    const { approvalRef, identity, tool, args, resourceScope } = createValidApproval();
    const wrongIdentity = { ...identity, nodeId: 'node_different' };

    expect(() =>
      verifyAndConsumeTrustedApproval(approvalRef, wrongIdentity, tool, args, resourceScope)
    ).toThrow('TOOL_APPROVAL_NODE_MISMATCH');
  });

  it('7. mismatched operation throws TOOL_APPROVAL_OPERATION_MISMATCH', () => {
    const { approvalRef, identity, tool, args, resourceScope } = createValidApproval();
    const wrongIdentity = { ...identity, operation: 'WRITE' };

    expect(() =>
      verifyAndConsumeTrustedApproval(approvalRef, wrongIdentity, tool, args, resourceScope)
    ).toThrow('TOOL_APPROVAL_OPERATION_MISMATCH');
  });

  it('8. mismatched attempt count throws TOOL_APPROVAL_ATTEMPT_MISMATCH', () => {
    const { approvalRef, identity, tool, args, resourceScope } = createValidApproval();
    const wrongIdentity = { ...identity, attempt: 2 };

    expect(() =>
      verifyAndConsumeTrustedApproval(approvalRef, wrongIdentity, tool, args, resourceScope)
    ).toThrow('TOOL_APPROVAL_ATTEMPT_MISMATCH');
  });

  it('9. mismatched worker ID throws TOOL_APPROVAL_WORKER_MISMATCH', () => {
    const { approvalRef, identity, tool, args, resourceScope } = createValidApproval();
    const wrongIdentity = { ...identity, workerId: 'worker_unauthorized_hijacker' };

    expect(() =>
      verifyAndConsumeTrustedApproval(approvalRef, wrongIdentity, tool, args, resourceScope)
    ).toThrow('TOOL_APPROVAL_WORKER_MISMATCH');
  });

  it('10. mismatched tool name throws TOOL_APPROVAL_TOOL_MISMATCH', () => {
    const { approvalRef, identity, args, resourceScope } = createValidApproval();

    expect(() =>
      verifyAndConsumeTrustedApproval(
        approvalRef,
        identity,
        'synthetic.escalated.tool',
        args,
        resourceScope
      )
    ).toThrow('TOOL_APPROVAL_TOOL_MISMATCH');
  });

  it('11. mismatched resource scope throws TOOL_APPROVAL_SCOPE_MISMATCH', () => {
    const { approvalRef, identity, tool, args } = createValidApproval();

    expect(() =>
      verifyAndConsumeTrustedApproval(
        approvalRef,
        identity,
        tool,
        args,
        'synthetic:resource:different_scope'
      )
    ).toThrow('TOOL_APPROVAL_SCOPE_MISMATCH');
  });

  it('12. mismatched argument hash throws TOOL_APPROVAL_ARGUMENT_HASH_MISMATCH', () => {
    const { approvalRef, identity, tool, resourceScope } = createValidApproval();
    const alteredArgs = { query: 'test-query', injectedFlag: true };

    expect(() =>
      verifyAndConsumeTrustedApproval(approvalRef, identity, tool, alteredArgs, resourceScope)
    ).toThrow('TOOL_APPROVAL_ARGUMENT_HASH_MISMATCH');
  });

  it('13. expired approval throws TOOL_APPROVAL_EXPIRED', () => {
    const identity = { ...defaultIdentity };
    const request = prepareApprovalRequest(
      identity,
      'synthetic.tool',
      'resource:001',
      { a: 1 },
      'Preview'
    );

    const proof = generateChallengeProof(
      request.challenge.challengeId,
      request.challenge.nonce,
      request.previewHash,
      approverKey
    );

    // Issue with -1000ms TTL (already expired)
    const approvalRef = issueTrustedHumanApproval(
      request.challenge.challengeId,
      {
        approverId,
        authMethod: 'INTERACTIVE_OPERATOR_HMAC',
        challengeId: request.challenge.challengeId,
        challengeResponse: proof,
      },
      { ttlMs: -1000 }
    );

    expect(() =>
      verifyAndConsumeTrustedApproval(
        approvalRef,
        identity,
        'synthetic.tool',
        { a: 1 },
        'resource:001'
      )
    ).toThrow('TOOL_APPROVAL_EXPIRED');
  });

  it('14. revoked approval throws TOOL_APPROVAL_REVOKED', () => {
    const { approvalRef, identity, tool, args, resourceScope } = createValidApproval();

    // Explicit revocation before dispatch
    revokeTrustedHumanApproval(approvalRef, 'Operator cancelled workflow');

    expect(() =>
      verifyAndConsumeTrustedApproval(approvalRef, identity, tool, args, resourceScope)
    ).toThrow('TOOL_APPROVAL_REVOKED');
  });

  it('15. single-use approval cannot be replayed (anti-replay check)', () => {
    const { approvalRef, identity, tool, args, resourceScope } = createValidApproval();

    // First consumption succeeds
    const res = verifyAndConsumeTrustedApproval(approvalRef, identity, tool, args, resourceScope);
    expect(res.approvalRef).toBe(approvalRef);

    // Second consumption attempt throws TOOL_APPROVAL_EXHAUSTED
    expect(() =>
      verifyAndConsumeTrustedApproval(approvalRef, identity, tool, args, resourceScope)
    ).toThrow('TOOL_APPROVAL_EXHAUSTED');
  });

  it('16. finite-use exhaustion on multi-use grant', () => {
    const identity = { ...defaultIdentity };
    const request = prepareApprovalRequest(
      identity,
      'synthetic.tool',
      'resource:001',
      { k: 'v' },
      'Multi-use preview'
    );

    const proof = generateChallengeProof(
      request.challenge.challengeId,
      request.challenge.nonce,
      request.previewHash,
      approverKey
    );

    const approvalRef = issueTrustedHumanApproval(
      request.challenge.challengeId,
      {
        approverId,
        authMethod: 'INTERACTIVE_OPERATOR_HMAC',
        challengeId: request.challenge.challengeId,
        challengeResponse: proof,
      },
      { maxUses: 2 }
    );

    // 1st use
    verifyAndConsumeTrustedApproval(approvalRef, identity, 'synthetic.tool', { k: 'v' }, 'resource:001');
    // 2nd use
    verifyAndConsumeTrustedApproval(approvalRef, identity, 'synthetic.tool', { k: 'v' }, 'resource:001');
    // 3rd use -> exhausted
    expect(() =>
      verifyAndConsumeTrustedApproval(approvalRef, identity, 'synthetic.tool', { k: 'v' }, 'resource:001')
    ).toThrow('TOOL_APPROVAL_EXHAUSTED');
  });

  it('17. storage failure fails closed with TOOL_APPROVAL_SERVICE_UNAVAILABLE', () => {
    const { approvalRef, identity, tool, args, resourceScope } = createValidApproval();

    const originalPrepare = rawDb.prepare.bind(rawDb);
    vi.spyOn(rawDb, 'prepare').mockImplementation((sql: string) => {
      if (sql.includes('SELECT * FROM trusted_human_approvals')) {
        throw new Error('SIMULATED_SQLITE_STORAGE_CORRUPTION');
      }
      return originalPrepare(sql);
    });

    expect(() =>
      verifyAndConsumeTrustedApproval(approvalRef, identity, tool, args, resourceScope)
    ).toThrow('TOOL_APPROVAL_SERVICE_UNAVAILABLE');
  });

  it('18. browser session/tab isolation: approval for tab-A cannot be used for tab-B', () => {
    const { approvalRef, identity, tool, args } = createValidApproval(
      undefined,
      'browser.handle.click',
      'tab:browser_session_alpha_123',
      { selector: '#submit-btn' },
      true
    );

    // Attempting to dispatch against tab:browser_session_beta_999 throws
    expect(() =>
      verifyAndConsumeTrustedApproval(
        approvalRef,
        identity,
        tool,
        args,
        'tab:browser_session_beta_999'
      )
    ).toThrow('TOOL_APPROVAL_SCOPE_MISMATCH');
  });

  it('19. credential provider isolation: approval for provider-A cannot be used for provider-B', () => {
    const { approvalRef, identity, tool, args } = createValidApproval(
      undefined,
      'credential.read',
      'provider:synthetic_provider_A',
      { key: 'api_key' },
      true
    );

    // Attempting to dispatch against provider:synthetic_provider_B throws
    expect(() =>
      verifyAndConsumeTrustedApproval(
        approvalRef,
        identity,
        tool,
        args,
        'provider:synthetic_provider_B'
      )
    ).toThrow('TOOL_APPROVAL_SCOPE_MISMATCH');
  });

  it('20. high-impact actions require second confirmation before issuance', () => {
    const identity = { ...defaultIdentity };
    const request = prepareApprovalRequest(
      identity,
      'credential.retrieve',
      'provider:openai',
      { scope: 'llm' },
      'High-impact credential access'
    );

    expect(request.secondConfirmationRequired).toBe(true);

    const proof = generateChallengeProof(
      request.challenge.challengeId,
      request.challenge.nonce,
      request.previewHash,
      approverKey
    );

    // Issuing without secondConfirmation throws
    expect(() =>
      issueTrustedHumanApproval(
        request.challenge.challengeId,
        {
          approverId,
          authMethod: 'INTERACTIVE_OPERATOR_HMAC',
          challengeId: request.challenge.challengeId,
          challengeResponse: proof,
        },
        { secondConfirmation: false }
      )
    ).toThrow('TOOL_APPROVAL_SECOND_CONFIRMATION_REQUIRED');

    // Issuing WITH secondConfirmation succeeds
    const approvalRef = issueTrustedHumanApproval(
      request.challenge.challengeId,
      {
        approverId,
        authMethod: 'INTERACTIVE_OPERATOR_HMAC',
        challengeId: request.challenge.challengeId,
        challengeResponse: proof,
      },
      { secondConfirmation: true }
    );
    expect(approvalRef.startsWith('tha_')).toBe(true);
  });

  it('21. argument changes after preview generation invalidate issuance', () => {
    const identity = { ...defaultIdentity };
    const initialArgs = { cmd: 'git status' };
    const request = prepareApprovalRequest(
      identity,
      'shell.execute',
      'workspace',
      initialArgs,
      'Previewing: git status'
    );

    // Malicious actor modifies arguments, computing a different preview hash
    const alteredPreviewHash = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
    const fakeProof = generateChallengeProof(
      request.challenge.challengeId,
      request.challenge.nonce,
      alteredPreviewHash,
      approverKey
    );

    // Challenge response will not match because bridge evaluates against stored request.previewHash
    expect(() =>
      issueTrustedHumanApproval(request.challenge.challengeId, {
        approverId,
        authMethod: 'INTERACTIVE_OPERATOR_HMAC',
        challengeId: request.challenge.challengeId,
        challengeResponse: fakeProof,
      }, { secondConfirmation: true })
    ).toThrow('TOOL_APPROVAL_APPROVER_AUTH_FAILED');
  });

  it('22. production dispatch refuses historical HMAC approval without consuming grant', async () => {
    const { goalLifecycleManager } = await import('../domains/controlPlane/GoalLifecycle.js');
    const { withNodeExecution } = await import('../domains/controlPlane/taskGraph/ExecutionIdentity.js');
    const { authorizeToolDispatch, ensureToolAuthorizationSchema, toolScopeHash } = await import(
      '../domains/controlPlane/taskGraph/ToolAuthorization.js'
    );
    const { randomUUID } = await import('node:crypto');

    ensureToolAuthorizationSchema();

    const goal = goalLifecycleManager.startGoal({
      conversationId: randomUUID(),
      userInput: 'e2e trusted human approval test',
    });
    goalLifecycleManager.transitionState(goal.goalId, 'PLANNING', { actor: 'ControlPlane', summary: 'test' });
    goalLifecycleManager.transitionState(goal.goalId, 'EXECUTING', { actor: 'ControlPlane', summary: 'test' });

    const nodeId = randomUUID();
    const node: any = {
      id: nodeId,
      capability: 'synthetic.capability',
      operation: 'EXECUTE',
      inputs: {},
      outputs: {},
      dependsOn: [],
      status: 'RUNNING',
      retryCount: 1,
    };
    const graph: any = {
      graphId: randomUUID(),
      goalId: goal.goalId,
      userGoal: 'test',
      nodes: new Map([[node.id, node]]),
      status: 'RUNNING',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const identity: CanonicalExecutionIdentity = {
      goalId: goal.goalId,
      graphId: graph.graphId,
      nodeId: node.id,
      operation: 'EXECUTE',
      attempt: 1,
      workerId: 'worker_local_001',
      };

    const tool = 'synthetic.capability';
    const toolArgs = { action: 'safe-synthetic-step', resourceScope: 'default' };
    const scopeHash = toolScopeHash(toolArgs);

    // 1. Prepare and issue trusted human approval
    const request = prepareApprovalRequest(
      identity,
      tool,
      'default',
      toolArgs,
      'Preview: running safe-synthetic-step',
      false
    );

    const challengeProof = generateChallengeProof(
      request.challenge.challengeId,
      request.challenge.nonce,
      request.previewHash,
      approverKey
    );

    const approvalRef = issueTrustedHumanApproval(
      request.challenge.challengeId,
      {
        approverId,
        authMethod: 'INTERACTIVE_OPERATOR_HMAC',
        challengeId: request.challenge.challengeId,
        challengeResponse: challengeProof,
      },
      { secondConfirmation: false }
    );

    // 2. Insert corresponding grant in tool_authorization_grants
    const grantId = randomUUID();
    rawDb.prepare(`
      INSERT INTO tool_authorization_grants VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      grantId,
      goal.goalId,
      graph.graphId,
      node.id,
      'EXECUTE',
      1,
      tool,
      scopeHash,
      approvalRef,
      approverId,
      Date.now() - 100,
      Date.now() + 60_000,
      null,
      1,
      10
    );

    // Historical HMAC approvals must never authorize production dispatch.
    await expect(withNodeExecution(graph, node, undefined, async () => {
      return authorizeToolDispatch(tool, toolArgs);
    }, identity.workerId)).rejects.toThrow('TOOL_APPROVAL_HUMAN_AUTHENTICATION_UNAVAILABLE');
    const grantRow = rawDb.prepare('SELECT uses_remaining FROM tool_authorization_grants WHERE id=?').get(grantId) as any;
    expect(grantRow.uses_remaining).toBe(1);
  });
});
