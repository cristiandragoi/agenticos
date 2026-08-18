import path from 'path';
process.env.USER_DATA_PATH = path.resolve('.agentos/runtime-tests/db');
import { db } from './src/db/index.js';
import { teams, teamRuns, goals, goalEvents } from './src/db/schema.js';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { checkTeamRecovery } from './src/services/agentTeams/recovery.js';

async function main() {
  console.log('\n=======================================');
  console.log('3. Real Interruption & Resume Test');
  console.log('=======================================');

  fs.mkdirSync('.agentos/runtime-tests', { recursive: true });

  const teamId = randomUUID();
  const goalId = randomUUID();
  const testDir = '.agentos/runtime-tests';
  
  const mockTeamSheet = {
    objective: 'Test interruption.',
    workspaceRoot: path.resolve('.'),
    executionSequence: ['builder', 'verifier'],
    agents: [
      { 
        id: 'builder', 
        role: 'Builder', 
        instructions: `Write some text to ${testDir}/interrupt.txt. Then sleep or wait for interruption.`,
        responsibilities: ['Write file'],
        allowedTools: ['writeFile', 'finish'],
        readScopes: [path.resolve(testDir)],
        writeScopes: [path.resolve(testDir)]
      },
      { 
        id: 'verifier', 
        role: 'Verifier', 
        instructions: `Pass.`,
        responsibilities: ['Verify'],
        allowedTools: ['finish'],
        readScopes: [path.resolve(testDir)],
        writeScopes: [path.resolve(testDir)]
      }
    ]
  };

  db.insert(teams).values({
    id: teamId,
    name: 'Interrupt Team',
    teamSheet: mockTeamSheet,
    originalPrompt: 'test prompt',
    createdAt: Date.now().toString(),
    updatedAt: Date.now().toString()
  }).run();

  db.insert(goals).values({
    id: goalId,
    originalGoal: mockTeamSheet.objective,
    status: 'pending',
    history: '[]',
    context: JSON.stringify({
      readScopes: [path.resolve(testDir)],
      writeScopes: [path.resolve(testDir)]
    }),
    createdAt: Date.now().toString(),
    updatedAt: Date.now().toString()
  }).run();

  // Create a separate process to run the team
  const childCode = `
import { db } from './src/db/index.js';
import { TeamRunner } from './src/services/agentTeams/teamRunner.js';
async function run() {
  await TeamRunner.startTeam('${teamId}', '${goalId}');
  // Keep alive
  setInterval(() => {}, 1000);
}
run();
  `;
  fs.writeFileSync('temp_child.ts', childCode);

  console.log('Starting child process...');
  const child = spawn(/^win/.test(process.platform) ? 'npx.cmd' : 'npx', ['tsx', 'temp_child.ts'], { stdio: 'inherit', shell: true });

  // Wait 15 seconds to let the builder start and process some LLM output
  await new Promise(r => setTimeout(r, 15000));
  
  console.log('\n--- INTERRUPTING CHILD PROCESS ---');
  child.kill('SIGKILL');

  // Wait for it to die
  await new Promise(r => setTimeout(r, 2000));

  console.log('\n--- RECOVERY RECONCILIATION ---');
  checkTeamRecovery();

  const run = db.select().from(teamRuns).where(eq(teamRuns.goalId, goalId)).get();
  console.log(`Run Status after recovery check: ${run?.status}`);
  
  const events = db.select().from(goalEvents).where(eq(goalEvents.goalId, goalId)).orderBy(goalEvents.sequence).all();
  const recoveryEvent = events.find(e => e.eventType === 'recovery_available');
  if (recoveryEvent) {
    console.log('SUCCESS: recovery_available event was emitted properly!');
  } else {
    console.error('FAILED: No recovery_available event found.');
  }

  console.log('\n--- RESUMING TEAM EXPLICITLY ---');
  const { TeamRunner } = await import('./src/services/agentTeams/teamRunner.js');
  await TeamRunner.resumeTeam(run!.id);

  // Wait for goal to finish
  let finished = false;
  for (let i = 0; i < 60; i++) {
    const updatedRun = db.select().from(teamRuns).where(eq(teamRuns.goalId, goalId)).get();
    if (updatedRun && (updatedRun.status === 'completed' || updatedRun.status === 'failed')) {
      console.log(`\nFinal Run Status: ${updatedRun.status}`);
      finished = true;
      break;
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  if (!finished) {
    console.log('Timeout waiting for resumed team to finish.');
  }
  
  const finalEvents = db.select().from(goalEvents).where(eq(goalEvents.goalId, goalId)).orderBy(goalEvents.sequence).all();
  console.log('\n--- Final Event Timeline ---');
  for (const e of finalEvents) {
    console.log(`[Seq ${e.sequence}] [Team ${e.teamId}] [Agent ${e.agentId}] [${e.eventType || e.state}] ${e.message}`);
  }

  try { fs.unlinkSync('temp_child.ts'); } catch (e) {}
  process.exit(0);
}

main().catch(console.error);
