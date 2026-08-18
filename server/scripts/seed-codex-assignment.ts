import { db } from '../src/db/index.js';
import { agentProviderAssignments } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

async function seed() {
  const existing = db.select().from(agentProviderAssignments).where(eq(agentProviderAssignments.agentId, 'agent-codex')).get();
  const now = new Date().toISOString();
  
  if (existing) {
    db.update(agentProviderAssignments)
      .set({
        providerId: 'prov-deepseek',
        modelId: 'deepseek-v4-flash',
        routingMode: 'forced',
        enabled: true,
        updatedAt: now
      })
      .where(eq(agentProviderAssignments.agentId, 'agent-codex'))
      .run();
    console.log('Updated agent-codex assignment in DB.');
  } else {
    db.insert(agentProviderAssignments)
      .values({
        agentId: 'agent-codex',
        providerId: 'prov-deepseek',
        modelId: 'deepseek-v4-flash',
        routingMode: 'forced',
        enabled: true,
        updatedAt: now
      })
      .run();
    console.log('Inserted agent-codex assignment into DB.');
  }

  const verified = db.select().from(agentProviderAssignments).where(eq(agentProviderAssignments.agentId, 'agent-codex')).get();
  console.log('Verified DB record:', verified);
}

seed();
