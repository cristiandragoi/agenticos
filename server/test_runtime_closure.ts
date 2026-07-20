import path from 'path';
process.env.USER_DATA_PATH = path.resolve('.agentos/runtime-tests/db');
import { db } from './src/db/index.js';
import { teams, teamRuns, goals, goalEvents } from './src/db/schema.js';
import { eq, desc } from 'drizzle-orm';
import { TeamRunner } from './src/services/agentTeams/teamRunner.js';
import { goalStore } from './src/services/goalStore.js';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';

async function waitForRun(runId: string, timeoutMs: number = 600000) {
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

async function runSuccessfulTeamPath() {
  console.log('\n=======================================');
  console.log('1. Real Local Agent Team (Successful Path)');
  console.log('=======================================');

  const teamId = randomUUID();
  const testDir = '.agentos/runtime-tests';
  
  const mockTeamSheet = {
    objective: 'Create a text file under an explicitly allowed test directory containing the current Agent Teams MVP status, then verify that the file exists and is non-empty.',
    workspaceRoot: path.resolve('.'),
    executionSequence: ['planner', 'builder', 'verifier'],
    agents: [
      { 
        id: 'planner', 
        name: 'Planner',
        role: 'Planner', 
        instructions: 'Output exactly this: <tool_call>{"tool": "finish", "message": "Handoff to builder.", "handoff": {"agentId": "planner", "status": "completed", "summary": "Done", "decisions": [], "artifacts": [], "openIssues": [], "recommendedNextActions": []}}</tool_call>',
        responsibilities: ['Create plan'],
        allowedTools: ['finish'],
        readScopes: [path.resolve(testDir)],
        writeScopes: [path.resolve(testDir)]
      },
      { 
        id: 'builder', 
        name: 'Builder',
        role: 'Builder', 
        instructions: `Output exactly this: <tool_call>{"tool": "finish", "message": "Handoff", "handoff": {"agentId": "builder", "status": "completed", "summary": "Done", "decisions": [], "artifacts": [{"path": ".agentos/runtime-tests/status.txt", "checksum": "de1aeb36275d93ff072ae8e5db6ba310134d1c73599d3e3bb255f50001abfdb7", "checksumAlgorithm": "sha256", "size": 29, "producedBy": "builder"}], "openIssues": [], "recommendedNextActions": []}}</tool_call>`,
        responsibilities: ['Write file'],
        allowedTools: ['finish'],
        readScopes: [path.resolve(testDir)],
        writeScopes: [path.resolve(testDir)]
      },
      { 
        id: 'verifier', 
        name: 'Verifier',
        role: 'Verifier', 
        instructions: `Output exactly this: <tool_call>{"tool": "finish", "message": "Verification complete.", "handoff": {"agentId": "verifier", "status": "completed", "summary": "Done", "decisions": [], "artifacts": [], "openIssues": [], "recommendedNextActions": []}, "verificationReport": { "passed": true, "summary": "All good", "checks": [], "blockingIssues": [], "recommendedFixes": [] }}</tool_call>`,
        responsibilities: ['Verify file'],
        allowedTools: ['readFile', 'finish'],
        readScopes: [path.resolve(testDir)],
        writeScopes: [path.resolve(testDir)]
      }
    ]
  };

  db.insert(teams).values({
    id: teamId,
    name: 'Test Team',
    teamSheet: mockTeamSheet,
    originalPrompt: 'test prompt',
    createdAt: Date.now().toString(),
    updatedAt: Date.now().toString()
  }).run();

  fs.writeFileSync(path.join(testDir, 'status.txt'), 'Phase 2 MVP Status: Completed');
  const runId = await TeamRunner.startTeam(teamId);
  await waitForRun(runId, 600000); // Wait up to 10 mins

  const run = db.select().from(teamRuns).where(eq(teamRuns.id, runId)).get();
  console.log(`Run Status: ${run?.status}, Repair Count: ${run?.repairCount}`);
  if (run?.goalId) {
    printEventSequence(run.goalId);
  }
}

async function runFailedTeamPath() {
  console.log('\n=======================================');
  console.log('2. Real Local Agent Team (Failed Path)');
  console.log('=======================================');

  const teamId = randomUUID();
  const testDir = '.agentos/runtime-tests';
  
  const mockTeamSheet = {
    objective: 'Create a test file, but verification will strictly fail it repeatedly to test repair limit.',
    workspaceRoot: path.resolve('.'),
    executionSequence: ['planner', 'builder', 'verifier'],
    agents: [
      { 
        id: 'planner', 
        role: 'Planner', 
        instructions: 'Output exactly this: <tool_call>{"tool": "finish", "message": "Handoff to builder.", "handoff": {"agentId": "planner", "status": "completed", "summary": "Done", "decisions": [], "artifacts": [], "openIssues": [], "recommendedNextActions": []}}</tool_call>',
        responsibilities: ['Create plan'],
        allowedTools: ['finish'],
        readScopes: [path.resolve(testDir)],
        writeScopes: [path.resolve(testDir)]
      },
      { 
        id: 'builder', 
        role: 'Builder', 
        instructions: `Output exactly this: <tool_call>{"tool": "finish", "message": "Handoff", "handoff": {"agentId": "builder", "status": "completed", "summary": "Done", "decisions": [], "artifacts": [{"path": ".agentos/runtime-tests/fail_test.txt", "checksum": "445a04a0d41422adc7744dff2d79124d94d04c697da467aaceef511265cf1bce", "checksumAlgorithm": "sha256", "size": 11, "producedBy": "builder"}], "openIssues": [], "recommendedNextActions": []}}</tool_call>`,
        responsibilities: ['Write file'],
        allowedTools: ['finish'],
        readScopes: [path.resolve(testDir)],
        writeScopes: [path.resolve(testDir)]
      },
      { 
        id: 'verifier', 
        role: 'Verifier', 
        instructions: `Output exactly this: <tool_call>{"tool": "finish", "message": "Verification complete.", "handoff": {"agentId": "verifier", "status": "completed", "summary": "Done", "decisions": [], "artifacts": [], "openIssues": [], "recommendedNextActions": []}, "verificationReport": { "passed": false, "summary": "Simulated strict failure", "checks": [], "blockingIssues": ["Simulated strict failure"], "recommendedFixes": [] }}</tool_call>`,
        responsibilities: ['Fail verification'],
        allowedTools: ['readFile', 'finish'],
        readScopes: [path.resolve(testDir)],
        writeScopes: [path.resolve(testDir)]
      }
    ]
  };

  db.insert(teams).values({
    id: teamId,
    name: 'Test Team Fail',
    teamSheet: mockTeamSheet,
    originalPrompt: 'test prompt',
    createdAt: Date.now().toString(),
    updatedAt: Date.now().toString()
  }).run();

  fs.writeFileSync(path.join(testDir, 'fail_test.txt'), 'Failed text');
  const runId = await TeamRunner.startTeam(teamId);
  await waitForRun(runId, 600000);

  const run = db.select().from(teamRuns).where(eq(teamRuns.id, runId)).get();
  console.log(`Run Status: ${run?.status}, Repair Count: ${run?.repairCount}`);
  if (run?.goalId) {
    printEventSequence(run.goalId);
  }
}

async function main() {
  fs.mkdirSync('.agentos/runtime-tests', { recursive: true });
  await runSuccessfulTeamPath();
  await runFailedTeamPath();
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
