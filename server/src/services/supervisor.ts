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
      // 0. HERMES GATEWAY WATCHDOG (unattended recovery).
      // A gateway PROCESS being alive is not API health. Live defect this fixes
      // (Hermes logs/errors.log 2026-09-21 09:36:13): the api_server's asyncio
      // accept loop died on 127.0.0.1:8642 ("Accept failed on a socket",
      // WinError 64) and was never re-created, while the gateway process stayed
      // alive serving Telegram. Nothing detected it: `hermes gateway status`
      // reported "Gateway process running" and AgenticOS could make no API call.
      // This tick verifies the API BEHAVIOURALLY and recovers through the
      // product's own lifecycle. Bounded, and never looped on auth failures.
      try {
        const { getHermesGatewayHealth, recoverHermesGateway } = await import('../domains/jarvis/hermesGatewayHealth.js');
        const health = await getHermesGatewayHealth();
        if (health.state === 'HERMES_PROCESS_ALIVE_API_DOWN' || health.state === 'HERMES_PROCESS_DOWN') {
          logger.warn('[Supervisor] Hermes gateway behavioural health failed — starting unattended recovery', {
            state: health.state, apiUrl: health.apiUrl, processIds: health.processIds,
          });
          console.log(`[JRT] HERMES_WATCHDOG_TRIGGER state=${health.state} api=${health.apiUrl}`);
          const recovery = await recoverHermesGateway({ maxAttempts: 2 });
          if (recovery.recovered) {
            logger.info('[Supervisor] Hermes gateway auto-recovered — API verified', { recovery });
          } else {
            logger.error('[Supervisor] Hermes gateway recovery FAILED', { recovery });
            try {
              const { failureDetector } = await import('../domains/selfHeal/FailureDetector.js');
              const incidentId = failureDetector.createManualIncident(
                'hermes_gateway',
                `Hermes gateway unreachable (${health.state}); unattended recovery failed after ${recovery.attempts} attempt(s): ${recovery.detail}`,
                'hermes',
                'high',
                { source: 'supervisor_watchdog', state: health.state, apiUrl: health.apiUrl, recovery },
              );
              logger.warn('[Supervisor] Hermes gateway incident raised', { incidentId });
            } catch (incErr) {
              logger.error('[Supervisor] Could not raise the Hermes gateway incident', {
                error: incErr instanceof Error ? incErr.message : String(incErr),
              });
            }
          }
        }
      } catch (watchdogErr) {
        // The watchdog must never take down the supervision loop.
        logger.warn('[Supervisor] Hermes gateway watchdog error', {
          error: watchdogErr instanceof Error ? watchdogErr.message : String(watchdogErr),
        });
      }

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
