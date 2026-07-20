import path from 'path';
process.env.USER_DATA_PATH = path.resolve('.agentos/runtime-tests/db');
import { db } from './src/db/index.js';
import { teams, teamRuns, goals, goalEvents } from './src/db/schema.js';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import fs from 'fs';
import { goalStore } from './src/services/goalStore.js';
import path from 'path';
import { TeamRunner } from './src/services/agentTeams/teamRunner.js';

async function waitForRun(runId: string, timeoutMs: number = 300000) {
  return new Promise<void>((resolve, reject) => {
    const start = Date.now();
    const interval = setInterval(() => {
      const run = db.select().from(teamRuns).where(eq(teamRuns.id, runId)).get();
      if (run && (run.status === 'completed' || run.status === 'failed' || run.status === 'paused')) {
        clearInterval(interval);
        resolve();
      }
      if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        reject(new Error('Timeout waiting for run to finish'));
      }
    }, 1000);
  });
}

function printEventSequence(goalId: string) {
  const events = db.select().from(goalEvents).where(eq(goalEvents.goalId, goalId)).orderBy(goalEvents.sequence).all();
  console.log('\n--- Event Timeline ---');
  for (const e of events) {
    console.log(`[Seq ${e.sequence}] [Team ${e.teamId}] [Agent ${e.agentId}] [${e.eventType || e.state}] ${e.message}`);
  }
}

async function main() {
  console.log('\n=======================================');
  console.log('4. Real Sandbox Tool Denial Test');
  console.log('=======================================');

  fs.mkdirSync('.agentos/runtime-tests', { recursive: true });

  const teamId = randomUUID();
  const testDir = '.agentos/runtime-tests';
  
  const mockTeamSheet = {
    objective: 'Test sandbox enforcement.',
    workspaceRoot: path.resolve('.'),
    executionSequence: ['builder'],
    agents: [
      { 
        id: 'builder', 
        role: 'Builder', 
        instructions: `Output exactly this and nothing else: <tool_call>{"tool": "writeFile", "path": "../../../forbidden.txt", "content": "Failed text"}</tool_call>`,
        responsibilities: ['Write file'],
        allowedTools: ['writeFile', 'finish'],
        readScopes: [path.resolve(testDir)],
        writeScopes: [path.resolve(testDir)]
      }
    ]
  };

  db.insert(teams).values({
    id: teamId,
    name: 'Sandbox Team',
    teamSheet: mockTeamSheet,
    originalPrompt: 'test prompt',
    createdAt: Date.now().toString(),
    updatedAt: Date.now().toString()
  }).run();

  const runId = await TeamRunner.startTeam(teamId);
  try {
    await waitForRun(runId, 30000);
  } catch (e) {
    // Timeout is expected since the LLM loops after sandbox denial
  }

  const run = db.select().from(teamRuns).where(eq(teamRuns.id, runId)).get();
  console.log(`Run Status: ${run?.status}`);
  
  if (run?.goalId) {
    printEventSequence(run.goalId);
  }

  // Check if forbidden.txt was created
  if (fs.existsSync('../../../forbidden.txt')) {
    console.error('FAILED: Sandbox allowed writing outside workspace!');
    fs.unlinkSync('../../../forbidden.txt');
  } else {
    console.log('SUCCESS: Sandbox successfully denied writing outside workspace.');
  }

  process.exit(0);
}

main().catch(console.error);
