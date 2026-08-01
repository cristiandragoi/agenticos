import { logger } from '../utils/logger.js';
import { runStore } from './runStore.js';
import { executeWithFailover } from './llm.js';

/**
 * Supervisor Loop
 * Periodically scans active runs, detects stalls, and injects corrective nudges
 * that Hermes/Jarvis can use as steering prompts.
 */
export async function supervisorLoop(intervalMs: number = 60000) {
  logger.info(`[Supervisor] Starting background loop (Interval: ${intervalMs}ms)`);

  while (true) {
    try {
      // 1. Fetch active runs
      const activeRuns = runStore.list().filter(r => r.status === 'running' || r.status === 'queued');

      for (const run of activeRuns) {
        // 2. Simple stall detection logic
        // Check if explicitly stalled or if no activity for > 3 minutes (180000 ms)
        const lastActivityTime = new Date(run.updatedAt || run.createdAt).getTime();
        const timeSinceActivity = Date.now() - lastActivityTime;
        
        const isTimeStalled = timeSinceActivity > 180000;
        const isExplicitlyStalled = !!run.stalled;

        if (!isExplicitlyStalled && !isTimeStalled) {
          continue; // Run is making progress
        }

        logger.info(`[Supervisor] Detected stalled run: ${run.id} (Agent: ${run.agentId})`);

        const summary = run.summary || `Run is stalled. Last input: "${run.input.substring(0, 50)}..."`;

        // 3. Build a prompt for the supervisor LLM
        const systemPrompt = `You are the overarching Agentic OS Supervisor monitoring a stalled task. 
Your job is to generate a concise steering instruction (1-3 sentences) that moves the task closer to completion with concrete next steps.`;

        const userPrompt = `Stalled task summary:
${summary}

Write a short steering instruction:`;

        try {
          // 4. Generate nudge
          const { text: nudge } = await executeWithFailover(systemPrompt, userPrompt, 'Supervisor');

          // 5. Attach the nudge to the run
          const eventPayload = JSON.stringify({
            type: "supervisor_nudge",
            payload: nudge
          });

          runStore.appendEvent(run.id, eventPayload);
          runStore.appendLog(run.id, `[Supervisor Nudge]: ${nudge}`);
          
          // Un-flag stall
          runStore.update(run.id, { stalled: false });
          
          logger.info(`[Supervisor] Injected nudge for run ${run.id}: ${nudge}`);
        } catch (err: any) {
          logger.error(`[Supervisor] Failed to generate nudge for run ${run.id}: ${err.message}`);
        }
      }
    } catch (err: any) {
      logger.error(`[Supervisor] Error in supervisor loop: ${err.message}`);
    }

    // 6. Sleep until the next supervision cycle
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
}
