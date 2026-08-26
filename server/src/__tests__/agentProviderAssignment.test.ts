import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentProviderAssignmentService } from '../services/agent/assignments.js';
import { db } from '../db/index.js';
import { agentProviderAssignments } from '../db/schema.js';
import { eq } from 'drizzle-orm';

describe('Agent Provider Assignments', () => {
  const originalEnvModel = process.env.OPENROUTER_MODEL;

  beforeEach(() => {
    process.env.OPENROUTER_MODEL = 'gpt-oss:20b';
  });

  afterEach(() => {
    process.env.OPENROUTER_MODEL = originalEnvModel;
  });

  it('normalizes accidental forced emergency fallback assignment for agent-jarvis', async () => {
    // Simulate accidental forced fallback assignment in database
    db.insert(agentProviderAssignments).values({
      agentId: 'agent-jarvis',
      providerId: 'prov-ollama',
      modelId: 'llama3.2:3b',
      routingMode: 'forced',
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }).onConflictDoUpdate({
      target: agentProviderAssignments.agentId,
      set: {
        providerId: 'prov-ollama',
        modelId: 'llama3.2:3b',
        routingMode: 'forced',
        enabled: true,
        updatedAt: new Date().toISOString()
      }
    }).run();

    const assignment = await AgentProviderAssignmentService.getAssignment('agent-jarvis');
    expect(assignment).not.toBeNull();
    // Must NOT be forced to llama3.2:3b
    expect(assignment?.routingMode).toBe('preferred');
    expect(assignment?.modelId).not.toBe('llama3.2:3b');
  });

  it('preserves configured primary assignment when explicitly set', async () => {
    db.insert(agentProviderAssignments).values({
      agentId: 'agent-jarvis',
      providerId: 'prov-openrouter',
      modelId: 'gpt-oss:20b',
      routingMode: 'preferred',
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }).onConflictDoUpdate({
      target: agentProviderAssignments.agentId,
      set: {
        providerId: 'prov-openrouter',
        modelId: 'gpt-oss:20b',
        routingMode: 'preferred',
        enabled: true,
        updatedAt: new Date().toISOString()
      }
    }).run();

    const assignment = await AgentProviderAssignmentService.getAssignment('agent-jarvis');
    expect(assignment).not.toBeNull();
    expect(assignment?.modelId).toBe('gpt-oss:20b');
    expect(assignment?.routingMode).toBe('preferred');
  });

  it('maintains CodeX and Hermes provider assignments', async () => {
    const codex = await AgentProviderAssignmentService.getAssignment('agent-codex');
    expect(codex).not.toBeNull();
    expect(codex?.providerId).toBe('prov-deepseek');
    expect(codex?.modelId).toBe('deepseek-v4-flash');

    const hermes = await AgentProviderAssignmentService.getAssignment('agent-hermes');
    expect(hermes).not.toBeNull();
    expect(hermes?.routingMode).toBe('preferred');
  });
});
