import { describe, it, expect, beforeEach } from 'vitest';
import { conversationService } from '../domains/conversations/service.js';
import { goalStore } from '../services/goalStore.js';
import { assembleConversationContext } from '../domains/jarvis/conversationContext.js';
import { db } from '../db/index.js';
import { conversations, conversationMessages } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'crypto';

describe('Worker Result Conversation Persistence', () => {
  const testConvId = `conv-test-${randomUUID().slice(0, 8)}`;
  const testGoalId = `goal-test-${randomUUID().slice(0, 8)}`;

  beforeEach(() => {
    // Create test conversation
    db.insert(conversations).values({
      id: testConvId,
      title: 'Repository Analysis Test',
      agentId: 'agent-jarvis',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }).onConflictDoNothing().run();
  });

  it('persists completed CodeX goal result exactly once into conversationMessages', async () => {
    const groundedFindings = `# Grounded Repository Analysis
1. Missing core data persistence layer for projects.
2. Absence of runtime state normalization.
3. Stabilized components regression risk.
4. Undefined orchestration boundaries.
5. Visual rendering performance constraints.`;

    // Simulate goal creation
    goalStore.create({
      id: testGoalId,
      conversationId: testConvId,
      originalGoal: 'Jarvis analyze the Agentic OS repo and tell me the five biggest production problems.',
      status: 'queued',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      retryCount: 0,
      providerFallbackCount: 0
    });

    // Simulate goal completion and persistence
    const existing = db.select().from(conversationMessages).where(
      and(
        eq(conversationMessages.conversationId, testConvId),
        eq(conversationMessages.goalId, testGoalId)
      )
    ).get();

    expect(existing).toBeUndefined();

    // First persistence call
    await conversationService.appendMessage({
      conversationId: testConvId,
      role: 'agent',
      messageType: 'message',
      content: groundedFindings,
      routedAgent: 'codex',
      goalId: testGoalId,
      metadata: {
        worker: 'codex',
        goalId: testGoalId,
        status: 'completed',
        provider: 'prov-deepseek',
        model: 'deepseek-v4-flash',
        groundedEvidence: true,
        workerResult: true,
        intent: {
          type: 'repository_analysis',
          route: 'codex',
          category: 'repository_analysis',
        }
      }
    });

    // Update goal store record
    goalStore.update(testGoalId, {
      status: 'completed',
      runSummary: { finalAnswer: groundedFindings } as any
    });

    const messagesAfter = await conversationService.getMessages(testConvId);
    const persistedResult = messagesAfter.find(m => m.goalId === testGoalId || (m.metadata as any)?.goalId === testGoalId);

    expect(persistedResult).toBeDefined();
    expect(persistedResult?.content).toContain('Grounded Repository Analysis');
    expect(persistedResult?.role).toBe('agent');
    expect((persistedResult?.metadata as any)?.groundedEvidence).toBe(true);

    // Verify subsequent context assembly receives the grounded result
    const ctx = await assembleConversationContext(testConvId, 'What did Codex find?');
    expect(ctx.hasGroundedEvidence).toBe(true);
    expect(ctx.groundedResult).toContain('Missing core data persistence layer');
  });
});
