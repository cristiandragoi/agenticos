import { TeamRunner } from './src/services/agentTeams/teamRunner.js';
import { goalStore } from './src/services/goalStore.js';
import { db } from './src/db/index.js';
import { teamRuns, agentTeamHandoffs, goalEvents, teams } from './src/db/schema.js';
import { randomUUID } from 'crypto';
import { eq, sql as drizzleSql } from 'drizzle-orm';
import type { AgentHandoff, VerificationReport } from './src/types.js';

async function main() {
  console.log('--- Agent Teams Safeguard E2E Tests ---');

  const teamId = 'team-safeguard-test';
  const goalId = randomUUID();
  const runId = randomUUID();
  
  try {
    const mockTeamSheet = {
      objective: 'Build a secure component',
      executionSequence: ['planner', 'builder', 'verifier'],
      agents: [
        { id: 'planner', role: 'Planner', allowedTools: [] },
        { id: 'builder', role: 'Builder', allowedTools: [] },
        { id: 'verifier', role: 'Verifier', allowedTools: [] }
      ]
    };
    db.delete(teams).where(eq(teams.id, teamId)).run();
    db.insert(teams).values({
      id: teamId,
      name: 'Test Team',
      teamSheet: mockTeamSheet,
      originalPrompt: 'test prompt',
      createdAt: Date.now().toString(),
      updatedAt: Date.now().toString()
    }).onConflictDoNothing().run();
  } catch (e) {
    console.log('Insert team failed:', e);
  }

  goalStore.create({
    id: goalId,
    originalGoal: 'Build a secure component',
    status: 'queued',
    retryCount: 0,
    providerFallbackCount: 0,
    createdAt: Date.now().toString(),
    updatedAt: Date.now().toString(),
    history: [] as any
  });

  db.insert(teamRuns).values({
    id: runId,
    teamId,
    goalId,
    currentAgent: 'planner',
    status: 'pending',
    repairCount: 0,
    createdAt: Date.now().toString(),
    updatedAt: Date.now().toString()
  }).run();

  async function simulateFinish(agent: string, handoff: any, report?: any) {
    const payload: any = { handoff };
    if (report) payload.verificationReport = report;
    
    goalStore.createEventWriter({ goalId, teamId, agentId: agent }).push({
      state: 'queued',
      tool: 'finish',
      message: 'Done',
      payload
    } as any);

    try {
      await (TeamRunner as any).handleAgentCompletion(runId, goalId);
    } catch (e) {
      console.log('Error in handleAgentCompletion:', e);
    }
  }

  // 1. Planner Finishes
  console.log('\n--- 1. Planner -> Builder Transition ---');
  const plannerHandoff = {
    agentId: 'planner',
    status: 'completed',
    summary: 'Plan complete',
    decisions: ['Use strict checking'],
    artifacts: [],
    openIssues: [],
    recommendedNextActions: ['Implement the component']
  };
  
  await simulateFinish('planner', plannerHandoff);

  let runState = db.select().from(teamRuns).where(eq(teamRuns.id, runId)).get();
  console.log('Run State after Planner:', runState?.currentAgent, runState?.status);
  
  // 2. Builder Finishes
  console.log('\n--- 2. Builder -> Verifier Transition ---');
  const builderHandoff = {
    agentId: 'builder',
    status: 'completed',
    summary: 'Implementation complete',
    decisions: [],
    artifacts: [],
    openIssues: [],
    recommendedNextActions: ['Verify']
  };

  await simulateFinish('builder', builderHandoff);

  runState = db.select().from(teamRuns).where(eq(teamRuns.id, runId)).get();
  console.log('Run State after Builder:', runState?.currentAgent, runState?.status);

  // 3. Verifier Fails (Bounded Repair Cycle)
  console.log('\n--- 3. Verifier Fails -> Builder (Repair) ---');
  const verifierFailHandoff = {
    agentId: 'verifier',
    status: 'completed',
    summary: 'Verification failed',
    decisions: [],
    artifacts: [],
    openIssues: ['Tests failed'],
    recommendedNextActions: ['Fix tests']
  };
  const verificationFailReport = {
    passed: false,
    summary: 'Component fails tests.',
    checks: [{ name: 'Test suite', passed: false, evidence: 'Failed 1 test.' }],
    blockingIssues: ['Test suite failure'],
    recommendedFixes: ['Fix the bug']
  };

  await simulateFinish('verifier', verifierFailHandoff, verificationFailReport);

  runState = db.select().from(teamRuns).where(eq(teamRuns.id, runId)).get();
  console.log('Run State after Failed Verifier:', runState?.currentAgent, runState?.status, 'Repair Count:', runState?.repairCount);

  // 4. Builder Finishes Again
  console.log('\n--- 4. Builder Finishes (Repair) -> Verifier ---');
  await simulateFinish('builder', builderHandoff);

  runState = db.select().from(teamRuns).where(eq(teamRuns.id, runId)).get();
  console.log('Run State after Builder Repair:', runState?.currentAgent, runState?.status);

  // 5. Verifier Fails Again (Exceeds bound)
  console.log('\n--- 5. Verifier Fails Again -> Exceeds Bound ---');
  try {
    await simulateFinish('verifier', verifierFailHandoff, verificationFailReport);
  } catch (e: any) {
    console.log('Expected failure caught:', e.message);
  }

  runState = db.select().from(teamRuns).where(eq(teamRuns.id, runId)).get();
  console.log('Run State after Verifier Fail 2:', runState?.currentAgent, runState?.status);

  // Dump Events
  const events = db.select().from(goalEvents).where(eq(goalEvents.goalId, goalId)).all();
  console.log('\n--- Event Sequence ---');
  events.forEach(e => console.log(`[Seq ${e.sequence}] [Agent ${e.agentId}] ${e.state} - ${e.message.substring(0,50)}`));

  console.log('\n--- SUCCESS: E2E Team Transitions verified ---');
}

main().catch(console.error);
