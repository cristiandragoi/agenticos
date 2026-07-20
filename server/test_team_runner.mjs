import { coordinatorService } from './src/domains/teams/coordinatorService.js';
import { TeamRunner } from './src/services/agentTeams/teamRunner.js';
import { db } from './src/db/index.js';
import { teamRuns, goalEvents, goals } from './src/db/schema.js';
import { eq } from 'drizzle-orm';

async function run() {
  console.log('1. Creating a Team...');
  const { teamId } = await coordinatorService.createTeam(
    'Create a simple hello.txt file that says "Hello, World!" and verify it.',
    'B:/AgenticOS/scratch'
  );
  console.log('Team created:', teamId);

  console.log('2. Starting TeamRun...');
  const runId = await TeamRunner.startTeam(teamId);
  console.log('Run started:', runId);

  // Poll for completion
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      const run = db.select().from(teamRuns).where(eq(teamRuns.id, runId)).get();
      if (run) {
        console.log(`Run status: ${run.status}, Current Agent: ${run.currentAgent}, Step: ${run.currentStep}`);
        
        if (run.status === 'completed' || run.status === 'failed') {
          clearInterval(timer);
          console.log('Final Verification Report:', run.verificationReport);
          
          const events = db.select().from(goalEvents).where(eq(goalEvents.goalId, run.goalId)).all();
          console.log(`Total events in unified timeline: ${events.length}`);
          
          const g = db.select().from(goals).where(eq(goals.id, run.goalId)).get();
          console.log(`Goal status: ${g.status}`);

          resolve();
        }
      }
    }, 2000);
  });
}

run().catch(console.error);
