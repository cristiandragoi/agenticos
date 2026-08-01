import { logger } from '../../utils/logger.js';
import { db } from '../../db/index.js';
import { teamRuns, goalEvents } from '../../db/schema.js';
import { eq, inArray, desc } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';

export function checkTeamRecovery() {
  const activeRuns = db.select().from(teamRuns).where(inArray(teamRuns.status, ['running', 'pending'])).all();
  
  for (const run of activeRuns) {
    let requiresRecovery = false;
    let conflict = false;
    let pauseReason = '';
    
    if (run.goalId) {
      const checkpointDir = path.join('.agentos', 'checkpoints', run.id);
      const checkpointPath = path.join(checkpointDir, 'checkpoint.json');
      const checkpointTmpPath = path.join(checkpointDir, 'checkpoint.json.tmp');

      // Cleanup stale tmp file
      if (fs.existsSync(checkpointTmpPath)) {
        fs.unlinkSync(checkpointTmpPath);
      }
      
      let lastEventSequence = 0;
      const latestEvent = db.select({ seq: goalEvents.sequence })
        .from(goalEvents)
        .where(eq(goalEvents.goalId, run.goalId))
        .orderBy(desc(goalEvents.sequence))
        .limit(1)
        .get();
        
      if (latestEvent) {
        lastEventSequence = latestEvent.seq;
      }

      if (fs.existsSync(checkpointPath)) {
        try {
          const checkpointStr = fs.readFileSync(checkpointPath, 'utf8');
          const checkpoint = JSON.parse(checkpointStr);
          
          if (checkpoint.lastEventSequence === lastEventSequence && checkpoint.databaseRevision === run.databaseRevision) {
             // Mutually valid, allow resume
          } else if (checkpoint.lastEventSequence > lastEventSequence) {
             logger.error(`[Recovery] TeamRun ${run.id}: Checkpoint is ahead of DB. Reconciling to last mutually valid state.`);
             requiresRecovery = true;
          } else if (checkpoint.lastEventSequence < lastEventSequence) {
             logger.error(`[Recovery] TeamRun ${run.id}: Database is ahead of Checkpoint. Regenerating checkpoint required.`);
             requiresRecovery = true;
          } else if (checkpoint.checkpointVersion !== run.checkpointVersion) {
             logger.error(`[Recovery] TeamRun ${run.id} ambiguous reconciliation (Version mismatch).`);
             conflict = true;
             requiresRecovery = true;
             pauseReason = 'recovery_conflict';
          }
        } catch (e) {
          logger.error(`[Recovery] TeamRun ${run.id} has malformed checkpoint.`);
          requiresRecovery = true;
        }
      } else {
        if (lastEventSequence > 0 || run.databaseRevision > 1) {
          logger.error(`[Recovery] TeamRun ${run.id} missing checkpoint file but has DB events.`);
          requiresRecovery = true;
        }
      }
    }

    if (requiresRecovery) {
      db.update(teamRuns).set({ status: 'recovery_required' as any, updatedAt: Date.now().toString() }).where(eq(teamRuns.id, run.id)).run();
      logger.info(`[Recovery] Paused team run ${run.id} and set to recovery_required.`);
      const safeGoalId = run.goalId;
      if (safeGoalId) {
        import('../goalStore.js').then(({ goalStore }) => {
          const writer = goalStore.createEventWriter({ goalId: safeGoalId, teamId: run.id, agentId: run.activeAgentId || run.currentAgent || undefined });
          writer.push({
            state: conflict ? 'recovery_conflict' : 'recovery_available',
            message: conflict ? 'Process interrupted. Recovery conflict requires user review.' : 'Process interrupted. Recovery available.',
            eventType: conflict ? 'recovery_conflict' : 'recovery_available',
            normalizedStatus: 'attention',
            lifecycleState: 'paused'
          });
        });
      }
    }
  }
}
