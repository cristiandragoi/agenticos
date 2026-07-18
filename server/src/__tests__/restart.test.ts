import { goalStore } from '../services/goalStore.js';
import { db } from '../db/index.js';
import { goals, goalSteps, goalEvents } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { resumeCodexGoalLoop } from '../loops/codexLoop.js';

describe('Durability and Restart Verification', () => {

  beforeAll(() => {
    // Clear out testing states
    db.delete(goalSteps).run();
    db.delete(goalEvents).run();
    db.delete(goals).run();
  });

  it('Restarts execution with full DB persistence integrity', async () => {
    const goalId = 'restart-goal-' + Date.now();
    
    // 1. Insert initial state directly into the "live" DB
    goalStore.create({ id: goalId, originalGoal: 't', status: 'executing', retryCount: 0, providerFallbackCount: 0, history: [], createdAt: '', updatedAt: '' });
    
    // Add two events so goal.history.length = 2
    goalStore.pushEvent({ runId: goalId, sequenceId: 1, timestamp: '1', state: 'executing', step: 1, message: 'm', provider: 'custom', model: 'c' });
    goalStore.pushEvent({ runId: goalId, sequenceId: 2, timestamp: '2', state: 'executing', step: 2, message: 'm', provider: 'custom', model: 'c' });
    
    goalStore.upsertStep(goalId, 1, 'completed', JSON.stringify({tool: 'writeFile'}), 'Success');
    goalStore.upsertStep(goalId, 2, 'started', JSON.stringify({tool: 'runCommand', cmd: 'npm install'}));

    // Verify state is in DB
    const step1Before = goalStore.getStep(goalId, 1);
    expect(step1Before?.status).toBe('completed');
    const step2Before = goalStore.getStep(goalId, 2);
    expect(step2Before?.status).toBe('started');

    // Simulate crash/restart by calling the resume loop, which contains the recovery logic
    // The resume logic converts 'started' tool calls to 'interrupted_requires_review' for runCommand.
    const loopPromise = resumeCodexGoalLoop(goalId).catch(err => console.error("LOOP CRASH:", err));
    
    // We expect the loop to process the crash state immediately.
    // Let's give it a short moment, then abort it or check state.
    await new Promise(r => setTimeout(r, 1000));

    const step1After = goalStore.getStep(goalId, 1);
    console.log('step1After:', step1After);
    expect(step1After?.status).toBe('completed'); // Idempotency: not repeated

    const step2After = goalStore.getStep(goalId, 2);
    console.log('step2After:', step2After);
    expect(step2After?.status).toBe('interrupted_requires_review'); // Recovered safely
  });
});
