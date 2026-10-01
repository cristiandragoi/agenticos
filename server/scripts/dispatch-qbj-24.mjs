import { backgroundTaskManager } from '../dist/services/backgroundTasks/manager.js';
import { backgroundTaskRepo } from '../dist/services/backgroundTasks/store.js';
import { dispatchTask, clearDispatchGuard } from '../dist/services/backgroundTasks/adapters.js';
import { isAppServerPortOpen } from '../dist/services/gateway/codexBridge.js';
import { goalStore } from '../dist/services/goalStore.js';
import Database from 'better-sqlite3';

const dbPath = process.env.APPDATA + '/agenticos/data/agentic-os.db';
const db = new Database(dbPath);

async function main() {
  console.log('================================================================');
  console.log('DISPATCHING QBJ TASK 24 (bgtask-24a2c4fa7)');
  console.log('================================================================');

  const taskId = 'bgtask-24a2c4fa7';
  const task = backgroundTaskRepo.getTask(taskId);
  if (!task) {
    console.error(`Task ${taskId} not found!`);
    process.exit(1);
  }

  console.log(`Task found: ID=${task.taskId}, status=${task.status}, worker=${task.worker}`);
  console.log(`Title: ${task.title}`);

  // 1. Verify health of Codex
  const codexPortOpen = await isAppServerPortOpen();
  console.log(`Codex app-server port 20129 open: ${codexPortOpen}`);

  // 2. Ensure task is queued and front of queue
  clearDispatchGuard(taskId);

  console.log('\nDispatching task to worker...');
  const dispatchRes = await dispatchTask(task, task.workspaceRoot || 'D:\\AgenticOS');
  console.log('Dispatch result:', dispatchRes);

  if (!dispatchRes.ok) {
    console.error('Dispatch failed:', dispatchRes.error);
    process.exit(1);
  }

  // 3. Monitor execution for real activity
  console.log('\nMonitoring real worker execution...');
  const startTime = Date.now();
  let firstFileInspected = null;
  let firstCommandExecuted = null;
  let goalLinked = null;

  while (Date.now() - startTime < 60000) {
    const updated = backgroundTaskRepo.getTask(taskId);
    const events = backgroundTaskRepo.getEvents(taskId);
    
    if (updated.linkedRunId && !goalLinked) {
      goalLinked = updated.linkedRunId;
      console.log(`[REAL EXECUTION] Worker accepted task! Linked GoalRun: ${goalLinked} (Status: ${updated.status})`);
    }

    if (goalLinked) {
      try {
        const goal = goalStore.get(goalLinked);
        if (goal) {
          if (goal.history && goal.history.length > 0) {
            for (const item of goal.history) {
              const str = JSON.stringify(item);
              if (!firstFileInspected && (str.includes('readFile') || str.includes('inspect') || str.includes('read') || item.type === 'file_read')) {
                firstFileInspected = item;
                console.log(`[REAL EXECUTION] First file inspected at ${new Date().toISOString()}:`, JSON.stringify(item).slice(0, 160));
              }
              if (!firstCommandExecuted && (str.includes('runCommand') || str.includes('command') || str.includes('cmd') || item.type === 'command_execution')) {
                firstCommandExecuted = item;
                console.log(`[REAL EXECUTION] First command executed at ${new Date().toISOString()}:`, JSON.stringify(item).slice(0, 160));
              }
            }
          }
        }
      } catch (err) {
        console.log('[DEBUG] Goal read error:', err.message);
      }
    }

    for (const ev of events) {
      if (!firstFileInspected && ev.kind === 'task.file_read') {
        firstFileInspected = ev;
        console.log(`[REAL EXECUTION] Event file read: ${ev.summary}`);
      }
      if (!firstCommandExecuted && (ev.kind === 'task.command' || ev.kind === 'task.progress')) {
        if (ev.summary?.toLowerCase().includes('execut') || ev.summary?.toLowerCase().includes('read') || ev.summary?.toLowerCase().includes('inspect')) {
          console.log(`[REAL EXECUTION] Worker progress at ${ev.ts}: ${ev.summary}`);
        }
      }
    }

    if (firstFileInspected && firstCommandExecuted) {
      console.log('\nSUCCESS: Both file inspection and command execution confirmed active!');
      break;
    }

    await new Promise(r => setTimeout(r, 1500));
  }

  // Print final summary
  const finalTask = backgroundTaskRepo.getTask(taskId);
  console.log('\n=== CURRENT TASK STATUS ===');
  console.log(`Status: ${finalTask.status}`);
  console.log(`Stage: ${finalTask.currentStage}`);
  console.log(`Linked Run ID: ${finalTask.linkedRunId}`);
  console.log(`Started At: ${finalTask.startedAt}`);
  console.log(`Progress Message: ${finalTask.progressMessage}`);
  console.log(`Files Changed: ${JSON.stringify(finalTask.filesChanged)}`);

  console.log('\n=== RECENT EVENTS ===');
  const evts = backgroundTaskRepo.getEvents(taskId);
  for (const e of evts.slice(-10)) {
    console.log(`[${e.ts}] [${e.kind}] ${e.summary}`);
  }

  if (finalTask.linkedRunId) {
    const goal = goalStore.get(finalTask.linkedRunId);
    if (goal) {
      console.log('\n=== LINKED GOAL HISTORY (sample) ===');
      console.log(`Goal status: ${goal.status}`);
      console.log(`Goal history length: ${goal.history?.length || 0}`);
      for (const h of (goal.history || []).slice(-5)) {
        console.log(`- ${JSON.stringify(h).slice(0, 140)}`);
      }
    }
  }
}

main().catch(err => {
  console.error('Fatal dispatch error:', err);
  process.exit(1);
});
