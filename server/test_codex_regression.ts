import path from 'path';
process.env.USER_DATA_PATH = path.resolve('.agentos/runtime-tests/db');

import { db } from './src/db/index.js';
import { goals, goalEvents } from './src/db/schema.js';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import fs from 'fs';
import { startCodexGoalLoop } from './src/loops/codexLoop.js';
import { goalStore } from './src/services/goalStore.js';

async function waitForGoal(goalId: string, timeoutMs: number = 300000) {
  return new Promise<void>((resolve, reject) => {
    const start = Date.now();
    const interval = setInterval(() => {
      const g = goalStore.get(goalId);
      if (g && (g.status === 'completed' || g.status === 'paused' || g.status === 'stopped' || g.status === 'failed')) {
        clearInterval(interval);
        resolve();
      }
      if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        reject(new Error('Timeout waiting for goal to finish'));
      }
    }, 1000);
  });
}

function printEventSequence(goalId: string) {
  const events = db.select().from(goalEvents).where(eq(goalEvents.goalId, goalId)).orderBy(goalEvents.sequence).all();
  console.log('\n--- Event Timeline ---');
  let hasArtifact = false;
  for (const e of events) {
    console.log(`[Seq ${e.sequence}] [Team ${e.teamId || 'null'}] [Agent ${e.agentId || 'null'}] [${e.eventType || e.state}] ${e.message}`);
    if (e.eventType === 'artifact_created') {
      hasArtifact = true;
    }
  }
  return hasArtifact;
}

async function main() {
  console.log('\n=======================================');
  console.log('5. Non-Team CodeX Regression Test');
  console.log('=======================================');

  fs.mkdirSync('.agentos/runtime-tests', { recursive: true });

  const goalId = randomUUID();
  const testDir = '.agentos/runtime-tests';
  
  db.insert(goals).values({
    id: goalId,
    originalGoal: `Write a simple text file called regression.txt with 'CodeX standalone ok' inside ${testDir}.`,
    status: 'queued',
    history: '[]',
    context: JSON.stringify({
      readScopes: [path.resolve(testDir)],
      writeScopes: [path.resolve(testDir)],
      allowedTools: ['writeFile', 'finish'],
      instructions: `Output exactly this and nothing else: <tool_call>{"tool": "writeFile", "path": "${testDir}/regression.txt", "content": "CodeX standalone ok"}</tool_call> then output <tool_call>{"tool": "finish", "message": "Done"}</tool_call>`
    }),
    createdAt: Date.now().toString(),
    updatedAt: Date.now().toString()
  }).run();

  // Start standalone CodeX loop
  startCodexGoalLoop(goalId);
  await waitForGoal(goalId, 120000);

  const goal = goalStore.get(goalId);
  console.log(`Goal Status: ${goal?.status}`);
  
  const hasArtifact = printEventSequence(goalId);

  // Verification
  if (!fs.existsSync(`${testDir}/regression.txt`)) {
    console.error('FAILED: CodeX failed to create regression.txt');
    process.exit(1);
  } else {
    console.log('SUCCESS: CodeX created regression.txt correctly.');
  }

  if (!hasArtifact) {
    console.error('FAILED: No artifact_created event found for standalone CodeX.');
    process.exit(1);
  }

  process.exit(0);
}

main().catch(console.error);
