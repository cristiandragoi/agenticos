import { db } from '../../db/index.js';
import { agentPromptVersions } from '../../db/schema.js';
import { eq, and, desc } from 'drizzle-orm';
import crypto from 'crypto';

/**
 * Creates a Challenger (draft) version of an agent's currently active prompt.
 */
export async function createChallengerPrompt(agentId: string, author: string): Promise<any> {
  // Find current active
  const activeVersions = await db.select()
    .from(agentPromptVersions)
    .where(and(eq(agentPromptVersions.agentId, agentId), eq(agentPromptVersions.status, 'active')))
    .limit(1);

  // Find max version number
  const allVersions = await db.select({ versionNumber: agentPromptVersions.versionNumber })
    .from(agentPromptVersions)
    .where(eq(agentPromptVersions.agentId, agentId))
    .orderBy(desc(agentPromptVersions.versionNumber))
    .limit(1);

  const nextVersion = (allVersions.length > 0 ? allVersions[0].versionNumber : 0) + 1;
  const source = activeVersions.length > 0 ? activeVersions[0] : null;

  const newVersion = {
    id: crypto.randomUUID(),
    agentId,
    versionNumber: nextVersion,
    systemPrompt: source ? source.systemPrompt : 'You are a helpful assistant.',
    tools: source && source.tools ? source.tools : JSON.stringify([]),
    skills: source && source.skills ? source.skills : JSON.stringify([]),
    memoryConfiguration: source && source.memoryConfiguration ? source.memoryConfiguration : JSON.stringify({}),
    permissions: source && source.permissions ? source.permissions : JSON.stringify([]),
    model: source ? source.model : 'auto',
    temperature: source ? source.temperature : 0.7,
    status: 'draft',
    author,
    reasonForChange: 'Challenger copy created for testing',
    parentVersionId: source ? source.id : null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  await db.insert(agentPromptVersions).values(newVersion);
  return newVersion;
}

/**
 * Promotes a specific prompt version to 'active', retiring the currently active one.
 * Must be executed in a transaction ideally, but Drizzle SQLite handles it adequately sequentially for now.
 */
export async function promotePromptVersion(versionId: string, author: string, reason: string): Promise<any> {
  const targetArray = await db.select().from(agentPromptVersions).where(eq(agentPromptVersions.id, versionId)).limit(1);
  if (!targetArray.length) throw new Error('Version not found');
  const target = targetArray[0];

  db.transaction((tx) => {
    // Retire current active
    tx.update(agentPromptVersions)
      .set({ status: 'retired', updatedAt: new Date().toISOString() })
      .where(and(eq(agentPromptVersions.agentId, target.agentId), eq(agentPromptVersions.status, 'active')))
      .run();

    // Promote target
    tx.update(agentPromptVersions)
      .set({ 
        status: 'active', 
        author, 
        reasonForChange: reason,
        updatedAt: new Date().toISOString() 
      })
      .where(eq(agentPromptVersions.id, versionId))
      .run();
  });

  const updatedArray = await db.select().from(agentPromptVersions).where(eq(agentPromptVersions.id, versionId)).limit(1);
  return updatedArray[0];
}

/**
 * Rollback to a specific version by creating a NEW version that copies the old one.
 * Preserves immutable history.
 */
export async function rollbackPromptVersion(versionId: string, author: string, reason: string): Promise<any> {
  const targetArray = await db.select().from(agentPromptVersions).where(eq(agentPromptVersions.id, versionId)).limit(1);
  if (!targetArray.length) throw new Error('Version not found');
  const target = targetArray[0];

  const allVersions = await db.select({ versionNumber: agentPromptVersions.versionNumber })
    .from(agentPromptVersions)
    .where(eq(agentPromptVersions.agentId, target.agentId))
    .orderBy(desc(agentPromptVersions.versionNumber))
    .limit(1);

  const nextVersion = (allVersions.length > 0 ? allVersions[0].versionNumber : 0) + 1;

  const rollbackCopy = {
    id: crypto.randomUUID(),
    agentId: target.agentId,
    versionNumber: nextVersion,
    systemPrompt: target.systemPrompt,
    tools: target.tools,
    skills: target.skills,
    memoryConfiguration: target.memoryConfiguration,
    permissions: target.permissions,
    model: target.model,
    temperature: target.temperature,
    status: 'active',
    author,
    reasonForChange: `Rollback to version ${target.versionNumber}: ${reason}`,
    parentVersionId: target.id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  db.transaction((tx) => {
    // Retire current active
    tx.update(agentPromptVersions)
      .set({ status: 'retired', updatedAt: new Date().toISOString() })
      .where(and(eq(agentPromptVersions.agentId, target.agentId), eq(agentPromptVersions.status, 'active')))
      .run();

    tx.insert(agentPromptVersions).values(rollbackCopy).run();
  });

  return rollbackCopy;
}
