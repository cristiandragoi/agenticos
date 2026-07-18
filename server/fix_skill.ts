import { db } from './src/db/index.js';
import { skills } from './src/db/schema.js';
import { eq } from 'drizzle-orm';

async function fix() {
  await db.update(skills).set({ isPublic: false }).where(eq(skills.id, 'agent-health-check'));
  console.log('Fixed agent-health-check');
  process.exit(0);
}
fix();
