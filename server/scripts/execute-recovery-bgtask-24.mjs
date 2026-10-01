import Database from 'better-sqlite3';
import { backgroundTaskManager } from '../dist/services/backgroundTasks/manager.js';
import { backgroundTaskRepo } from '../dist/services/backgroundTasks/store.js';
import { resolveCompletionContract, gatherTaskExecutionEvidence, validateWorkerClaims, evaluateCompletionContract } from '../dist/services/backgroundTasks/completionContract.js';

const dbPath = 'C:/Users/cd-pr/AppData/Roaming/agenticos/data/agentic-os.db';
const db = new Database(dbPath);

console.log('================================================================');
console.log('CHECKING EXISTING TASK bgtask-24a2c4fa7 AND GOAL goal-912a85b9-');
console.log('================================================================');

const taskId = 'bgtask-24a2c4fa7';
const goalId = 'goal-912a85b9-';

const task = backgroundTaskRepo.getTask(taskId);
if (!task) {
  console.error('Task not found!');
  process.exit(1);
}

console.log('Current Task Status:', task.status);
console.log('Current Stage:', task.currentStage);
console.log('Linked Run ID:', task.linkedRunId);
console.log('Blocker:', task.blocker);

const contract = resolveCompletionContract(task);
const evidence = gatherTaskExecutionEvidence(task, goalId, db);
const claimValidation = validateWorkerClaims(task.resultText || '', evidence);
const contractEval = evaluateCompletionContract(contract, evidence, claimValidation);

console.log('\n--- CONTRACT EVALUATION PRIOR TO AUTO-CONTINUATION ---');
console.log('Contract Passed:', contractEval.passed);
console.log('Missing Evidence:', contractEval.missingEvidence);
console.log('Violations:', claimValidation.violations);

console.log('\n================================================================');
console.log('TRIGGERING AUTO-CONTINUE AFTER VALIDATION REJECTION');
console.log('================================================================');

async function runRecovery() {
  await backgroundTaskManager.autoContinueAfterValidationRejection(
    taskId,
    contract,
    contractEval,
    claimValidation,
    task.resultText || undefined
  );

  console.log('\n================================================================');
  console.log('RECOVERY RUN COMPLETE. VERIFYING FINAL TASK & EVIDENCE STATE:');
  console.log('================================================================');

  const finalTask = backgroundTaskRepo.getTask(taskId);
  console.log('Final Task Status:', finalTask.status);
  console.log('Final Task Stage:', finalTask.currentStage);
  console.log('Final Verification State:', finalTask.verificationState);
  console.log('Final Test State:', finalTask.testState);
  console.log('Final Blocker:', finalTask.blocker);
  console.log('Completed At:', finalTask.completedAt);

  console.log('\n--- ALL RECENT EVENTS FOR bgtask-24a2c4fa7 ---');
  const events = backgroundTaskRepo.getEvents(taskId);
  for (const e of events.slice(-15)) {
    console.log(`[${e.ts}] [${e.kind}] ${e.summary}`);
  }

  console.log('\n--- ARGUS VERIFICATIONS IN DB FOR THIS GOAL/TASK ---');
  const argusRows = db.prepare("SELECT * FROM argus_verifications WHERE goal_id = ? OR contract_id = ? ORDER BY created_at DESC LIMIT 3").all(goalId, taskId);
  console.log(JSON.stringify(argusRows, null, 2));
}

runRecovery().catch(err => {
  console.error('Fatal recovery execution error:', err);
  process.exit(1);
});
