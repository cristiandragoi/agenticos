import { db } from '../db/index.js';
import { agentExecutions, agentPromptVersions } from '../db/schema.js';
import { logExecution } from '../services/evolution/executionLogger.js';
import { createChallengerPrompt, promotePromptVersion, rollbackPromptVersion } from '../services/evolution/promptManager.js';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';
describe('Evolution Lab', () => {
    const testAgentId = `agent-${crypto.randomUUID()}`;
    beforeAll(async () => {
        // Setup initial prompt
        await db.insert(agentPromptVersions).values({
            id: crypto.randomUUID(),
            agentId: testAgentId,
            versionNumber: 1,
            prompt: 'Original Prompt',
            status: 'active',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });
    });
    test('executionLogger should persist runs to agent_executions', async () => {
        const execId = await logExecution({
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
    });
    test('createChallengerPrompt should clone active prompt as draft', async () => {
        const challenger = await createChallengerPrompt(testAgentId, 'Tester');
        expect(challenger.versionNumber).toBe(2);
        expect(challenger.status).toBe('draft');
        expect(challenger.prompt).toBe('Original Prompt');
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
        const rollback = await rollbackPromptVersion(v1.id, 'Tester', 'Emergency rollback');
        expect(rollback.versionNumber).toBeGreaterThan(v1.versionNumber);
        expect(rollback.status).toBe('active');
        expect(rollback.prompt).toBe(v1.prompt);
    });
});
