import { logger } from '../../utils/logger.js';
import { db } from '../../db/index.js';
import { skills } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
export async function listSkills() {
    const allSkills = await db.select().from(skills);
    return allSkills;
}
export async function getSkill(id) {
    const row = await db.query.skills.findFirst({
        where: eq(skills.id, id)
    });
    return row || null;
}
export async function createSkill(input) {
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
    return getSkill(id);
}
export async function updateSkill(id, input) {
    const now = new Date().toISOString();
    await db.update(skills).set({
        ...input,
        updatedAt: now
    }).where(eq(skills.id, id));
    return getSkill(id);
}
export async function deleteSkill(id) {
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
