import { db } from '../db/index.js';
import { agentExecutions, agentPromptVersions } from '../db/schema.js';
import { logExecution } from '../services/evolution/executionLogger.js';
import { createChallengerPrompt, promotePromptVersion, rollbackPromptVersion } from '../services/evolution/promptManager.js';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';
import { describe, beforeAll, test, expect } from 'vitest';

describe('Evolution Lab', () => {
  const testAgentId = `agent-${crypto.randomUUID()}`;

  beforeAll(async () => {
    // Setup initial prompt
    await db.insert(agentPromptVersions).values({
      id: crypto.randomUUID(),
      agentId: testAgentId,
      versionNumber: 1,
      systemPrompt: 'Original Prompt',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  });

  test('executionLogger should persist runs to agent_executions and deduplicate', async () => {
    const idemKey = crypto.randomUUID();
    const execId = await logExecution({
      idempotencyKey: idemKey,
      agentId: testAgentId,
      input: { text: 'hello' },
      output: { text: 'world' },
      success: true,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      executionTimeMs: 1500
    });

    const result = await db.select().from(agentExecutions).where(eq(agentExecutions.id, execId));
    expect(result.length).toBe(1);
    expect(result[0].agentId).toBe(testAgentId);
    expect(result[0].executionTimeMs).toBe(1500);

    // Deduplication test (using same idempotencyKey)
    const execIdDup = await logExecution({
      idempotencyKey: idemKey, // same key
      agentId: testAgentId,
      input: { text: 'hello' },
      output: { text: 'world2' },
      success: true,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      executionTimeMs: 1500
    });
    
    // It should skip and not create another one with the same ID, returning the new uuid but not persisting it
    // Wait, the function generates a new UUID but the DB insert will throw UNIQUE constraint failure.
    // The insert will fail, caught by the catch block, but it returns the generated ID anyway.
    // We can verify that searching by idemKey yields exactly 1 result.
    const dedupResult = await db.select().from(agentExecutions).where(eq(agentExecutions.idempotencyKey, idemKey));
    expect(dedupResult.length).toBe(1);
  });

  test('executionLogger should record deterministic failure categorization', async () => {
    const execId = await logExecution({
      idempotencyKey: crypto.randomUUID(),
      agentId: testAgentId,
      input: { text: 'timeout test' },
      success: false,
      error: new Error('The request timed out'),
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });

    const result = await db.select().from(agentExecutions).where(eq(agentExecutions.id, execId));
    expect(result[0].primaryFailureCategory).toBe('timeout');
    expect(result[0].success).toBe(false);
  });

  test('createChallengerPrompt should clone active prompt as draft', async () => {
    const challenger = await createChallengerPrompt(testAgentId, 'Tester');
    expect(challenger.versionNumber).toBe(2);
    expect(challenger.status).toBe('draft');
    expect(challenger.systemPrompt).toBe('Original Prompt');
  });

  test('promotePromptVersion should retire old and activate new', async () => {
    // First create challenger
    const challenger = await createChallengerPrompt(testAgentId, 'Tester');
    
    // Promote it
    const promoted = await promotePromptVersion(challenger.id, 'Tester', 'Promotion Test');
    expect(promoted.status).toBe('active');

    // Check old is retired
    const oldVersions = await db.select().from(agentPromptVersions)
      .where(eq(agentPromptVersions.agentId, testAgentId));
    
    const activeVersions = oldVersions.filter(v => v.status === 'active');
    expect(activeVersions.length).toBe(1);
    expect(activeVersions[0].id).toBe(challenger.id);
  });

  test('rollbackPromptVersion should create a new version copying the old one', async () => {
    // We want to rollback to version 1
    const versions = await db.select().from(agentPromptVersions)
      .where(eq(agentPromptVersions.agentId, testAgentId));
    const v1 = versions.find(v => v.versionNumber === 1);

    const rollback = await rollbackPromptVersion(v1!.id, 'Tester', 'Emergency rollback');
    
    expect(rollback.versionNumber).toBeGreaterThan(v1!.versionNumber);
    expect(rollback.status).toBe('active');
    expect(rollback.systemPrompt).toBe(v1!.systemPrompt);
    expect(rollback.parentVersionId).toBe(v1!.id);
  });
});
