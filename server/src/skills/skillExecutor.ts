import { dailyBriefingSkill } from './built-in/daily-briefing.skill.js';
import { db } from '../db/index.js';
import { runSteps } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { getSkill } from '../services/agent/skillRegistry.js';

export async function executeSkill(run: any) {
  const skillId = run.input?.skillId || 'daily-briefing';
  const skillDef = await getSkill(skillId);
  
  if (!skillDef) {
    throw new Error(`Skill ${skillId} not found in registry.`);
  }

  const stepId = crypto.randomUUID();
  await db.insert(runSteps).values({
    id: stepId,
    runId: run.id,
    skillId: skillDef.id,
    toolId: skillDef.toolId || '',
    status: 'running',
    startedAt: new Date().toISOString()
  });

  try {
    let output: any;
    
    // In the future, this will dynamically load the tool via toolLoader based on skillDef.toolId
    if (skillDef.toolId === 'dailyBriefingTool' || skillId === 'daily-briefing') {
      output = await dailyBriefingSkill.execute({ ...skillDef.paramsTemplate, ...run.input }, {
        taskId: run.taskId,
        runId: run.id,
        tools: {} as any,
        logger: console as any,
        requestApproval: async () => ({ status: 'approved' } as any)
      });
    } else {
      // Mock execution for other skills for now
      output = { message: `Executed mock skill ${skillDef.name}` };
    }

    await db.update(runSteps).set({
      status: 'completed',
      output,
      completedAt: new Date().toISOString()
    }).where(eq(runSteps.id, stepId));

  } catch (err: any) {
    await db.update(runSteps).set({
      status: 'failed',
      error: err.message,
      completedAt: new Date().toISOString()
    }).where(eq(runSteps.id, stepId));
    throw err;
  }
}
