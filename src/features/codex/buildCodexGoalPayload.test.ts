import { describe, it, expect } from 'vitest';
import { buildCodexGoalPayload } from './buildCodexGoalPayload';

describe('buildCodexGoalPayload', () => {
  it('omits validationProvider when set to auto', () => {
    const payload = buildCodexGoalPayload({
      goal: 'test',
      repositoryRoot: '/test',
      approvalPolicy: 'strict',
      validationProvider: 'auto'
    });
    expect(payload.validationProvider).toBeUndefined();
  });

  it('includes validationProvider when explicitly configured', () => {
    const payload = buildCodexGoalPayload({
      goal: 'test',
      repositoryRoot: '/test',
      approvalPolicy: 'strict',
      validationProvider: 'omniRoute'
    });
    expect(payload.validationProvider).toBe('omniRoute');
  });

  it('produces a backend-authoritative default payload when missing assignment', () => {
    const payload = buildCodexGoalPayload({
      goal: 'test',
      repositoryRoot: '/test',
      approvalPolicy: 'strict'
    });
    expect(payload.routing).toBeUndefined();
    expect(payload.executionOptions).toBeUndefined();
    expect(payload.agentId).toBe('agent-codex');
  });

  it('automatic routing mode omits routing and does not set disableFallback true', () => {
    const payload = buildCodexGoalPayload({
      goal: 'test',
      repositoryRoot: '/test',
      approvalPolicy: 'strict',
      explicitRoutingOverride: true,
      assignment: { providerId: 'prov-ollama', routingMode: 'automatic', enabled: true }
    });
    expect(payload.routing).toBeUndefined();
    expect(payload.executionOptions).toBeUndefined();
  });

  it('preferred routing includes routing intent and does not set disableFallback true', () => {
    const payload = buildCodexGoalPayload({
      goal: 'test',
      repositoryRoot: '/test',
      approvalPolicy: 'strict',
      explicitRoutingOverride: true,
      assignment: { providerId: 'prov-ollama', modelId: 'qwen3.5:4b', routingMode: 'preferred', enabled: true }
    });
    expect(payload.routing).toEqual({
      mode: 'preferred',
      providerId: 'prov-ollama',
      modelId: 'qwen3.5:4b'
    });
    expect(payload.executionOptions).toBeUndefined();
  });

  it('forced routing sets disableFallback true', () => {
    const payload = buildCodexGoalPayload({
      goal: 'test',
      repositoryRoot: '/test',
      approvalPolicy: 'strict',
      explicitRoutingOverride: true,
      assignment: { providerId: 'prov-ollama', modelId: 'qwen3.5:4b', routingMode: 'forced', enabled: true }
    });
    expect(payload.routing).toEqual({
      mode: 'forced',
      providerId: 'prov-ollama',
      modelId: 'qwen3.5:4b'
    });
    expect(payload.executionOptions).toEqual({ disableFallback: true });
  });

  it('disabled assignment is not submitted as an active override', () => {
    const payload = buildCodexGoalPayload({
      goal: 'test',
      repositoryRoot: '/test',
      approvalPolicy: 'strict',
      explicitRoutingOverride: true,
      assignment: { providerId: 'prov-ollama', routingMode: 'preferred', enabled: false }
    });
    expect(payload.routing).toBeUndefined();
    expect(payload.executionOptions).toBeUndefined();
  });

  it('strict approval does not imply forced provider routing', () => {
    const payload = buildCodexGoalPayload({
      goal: 'test',
      repositoryRoot: '/test',
      approvalPolicy: 'strict',
      explicitRoutingOverride: true,
      assignment: { providerId: 'prov-ollama', routingMode: 'preferred', enabled: true }
    });
    expect(payload.approvalPolicy).toBe('strict');
    expect(payload.executionOptions).toBeUndefined(); // Fallback is NOT disabled
  });
});
