import { logger } from '../../utils/logger.js';
import { db } from '../../db/index.js';
import { skills } from '../../db/schema.js';
import { eq } from 'drizzle-orm';

export interface AgentSkill {
  id: string;
  name: string;
  description?: string;
  agentId?: string;
  toolId?: string;
  modelHint?: string;
  paramsTemplate?: Record<string, unknown>;
  active: boolean;
  isPublic?: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function listSkills(): Promise<AgentSkill[]> {
  const allSkills = await db.select().from(skills);
  return allSkills as unknown as AgentSkill[];
}

export async function getSkill(id: string): Promise<AgentSkill | null> {
  const row = await db.query.skills.findFirst({
    where: eq(skills.id, id)
  });
  return (row as unknown as AgentSkill) || null;
}

export async function createSkill(input: Partial<AgentSkill>): Promise<AgentSkill> {
  const id = input.id || crypto.randomUUID();
  const now = new Date().toISOString();
  
  await db.insert(skills).values({
    id,
    name: input.name || 'Unnamed Skill',
    description: input.description || '',
    agentId: input.agentId || 'Jarvis',
    toolId: input.toolId || '',
    modelHint: input.modelHint || '',
    paramsTemplate: input.paramsTemplate || {},
    active: input.active !== false,
    isPublic: input.isPublic !== false,
    createdAt: now,
    updatedAt: now
  });

  return getSkill(id) as unknown as Promise<AgentSkill>;
}

export async function updateSkill(id: string, input: Partial<AgentSkill>): Promise<AgentSkill> {
  const now = new Date().toISOString();
  
  await db.update(skills).set({
    ...input,
    updatedAt: now
  }).where(eq(skills.id, id));

  return getSkill(id) as unknown as Promise<AgentSkill>;
}

export async function deleteSkill(id: string): Promise<void> {
  await db.delete(skills).where(eq(skills.id, id));
}

export async function seedDefaultSkills() {
  const existing = await getSkill('daily-briefing');
  if (!existing) {
    await createSkill({
      id: 'daily-briefing',
      name: 'Daily Briefing',
      description: 'Summarize today’s schedule and key messages.',
      agentId: 'Jarvis',
      toolId: 'dailyBriefingTool',
      modelHint: 'llama3.1:8b-64k',
      paramsTemplate: { timeWindowHours: 24 },
      active: true,
      isPublic: true
    });
    logger.info('[SkillRegistry] Seeded default Daily Briefing skill.');
  }

  const existingHealth = await getSkill('agent-health-check');
  if (!existingHealth) {
    await createSkill({
      id: 'agent-health-check',
      name: 'Agent Health Check',
      description: 'Ping agents every 5 minutes to check their status.',
      agentId: 'Sentinel',
      toolId: 'healthCheckTool',
      modelHint: 'omniRoute',
      paramsTemplate: {},
      active: true,
      isPublic: false
    });
    logger.info('[SkillRegistry] Seeded default Agent Health Check skill.');
  }
}
