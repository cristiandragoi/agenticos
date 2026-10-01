import Database from 'better-sqlite3';
import { resolveCompletionContract, validateWorkerClaims, evaluateCompletionContract, gatherTaskExecutionEvidence } from '../dist/services/backgroundTasks/completionContract.js';

const dbPath = 'C:/Users/cd-pr/AppData/Roaming/agenticos/data/agentic-os.db';
const db = new Database(dbPath);

console.log('================================================================');
console.log('REOPENING FALSELY COMPLETED TASK bgtask-24a2c4fa7');
console.log('================================================================');

const taskId = 'bgtask-24a2c4fa7';
const goalId = 'goal-912a85b9-';

// 1. Fetch current task and goal
const taskRow = db.prepare("SELECT * FROM background_tasks WHERE task_id = ?").get(taskId);
if (!taskRow) {
  console.error("Task not found!");
  process.exit(1);
}

console.log(`Current task status: ${taskRow.status}, completed_at: ${taskRow.completed_at}`);

// 2. Parse task
const task = {
  ...taskRow,
  childTaskIds: JSON.parse(taskRow.child_task_ids || '[]'),
  filesChanged: JSON.parse(taskRow.files_changed || '[]'),
  metadata: JSON.parse(taskRow.metadata || '{}'),
  cancellationRequested: Boolean(taskRow.cancellation_requested),
  resumable: Boolean(taskRow.resumable),
};

// 3. Resolve contract and gather machine evidence
const contract = resolveCompletionContract(task);
const evidence = gatherTaskExecutionEvidence(task, goalId, db);
const claimValidation = validateWorkerClaims(task.resultText || '', evidence);
const contractEval = evaluateCompletionContract(contract, evidence, claimValidation);

console.log('\n--- COMPLETION CONTRACT ---');
console.log(JSON.stringify(contract, null, 2));

console.log('\n--- GATHERED MACHINE EVIDENCE ---');
console.log(JSON.stringify(evidence, null, 2));

console.log('\n--- WORKER CLAIM VALIDATION ---');
console.log(JSON.stringify(claimValidation, null, 2));

console.log('\n--- CONTRACT EVALUATION ---');
console.log(JSON.stringify(contractEval, null, 2));

const reason = 'FALSE_COMPLETION_REOPENED: worker finish accepted without CompletionContract evidence.';
const rejectionMsg = `Reopened task completion invalidated: ${[...claimValidation.violations, ...contractEval.missingEvidence].join(' | ')}`;

const now = new Date().toISOString();

// 4. Update background_tasks
db.prepare(`
  UPDATE background_tasks
  SET status = 'validating_worker_output',
      current_stage = 'validating_worker_output',
      completed_at = NULL,
      resumable = 1,
      verification_state = 'failed',
      blocker = ?,
      progress_message = ?,
      updated_at = ?
  WHERE task_id = ?
`).run(rejectionMsg, `Task reopened: ${reason}`, now, taskId);

// 5. Insert reopen and rejection events in background_task_events
const nextSeq = (db.prepare("SELECT MAX(sequence) as s FROM background_task_events WHERE task_id = ?").get(taskId)?.s || 0) + 1;
db.prepare(`
  INSERT INTO background_task_events (id, task_id, ts, kind, summary, detail, sequence)
  VALUES (?, ?, ?, 'task.reopened', ?, ?, ?)
`).run(`bge-${Date.now()}-1`, taskId, now, reason, JSON.stringify({ previousStatus: taskRow.status, reopenReason: reason }), nextSeq);

db.prepare(`
  INSERT INTO background_task_events (id, task_id, ts, kind, summary, detail, sequence)
  VALUES (?, ?, ?, 'task.validation_rejected', ?, ?, ?)
`).run(`bge-${Date.now()}-2`, taskId, now, rejectionMsg, JSON.stringify({ violations: claimValidation.violations, missingEvidence: contractEval.missingEvidence }), nextSeq + 1);

// 6. Update goal
db.prepare(`
  UPDATE goals
  SET status = 'validating_worker_output',
      updated_at = ?
  WHERE id = ?
`).run(Date.now().toString(), goalId);

const goalSeq = (db.prepare("SELECT MAX(sequence) as s FROM goal_events WHERE goal_id = ?").get(goalId)?.s || 0) + 1;
db.prepare(`
  INSERT INTO goal_events (id, goal_id, sequence, timestamp, state, step, message, event_type, normalized_status, lifecycle_state, user_message, technical_message, payload)
  VALUES (?, ?, ?, ?, 'validating_worker_output', ?, ?, 'validation_rejected', 'attention', 'recovering', ?, ?, ?)
`).run(
  `gev-${Date.now()}`,
  goalId,
  goalSeq,
  now,
  goalSeq,
  rejectionMsg,
  'Completion rejected: Worker self-certification invalidated. Machine evidence missing.',
  rejectionMsg,
  JSON.stringify({ violations: claimValidation.violations, missingEvidence: contractEval.missingEvidence })
);

console.log('\n================================================================');
console.log('REOPEN SUCCESSFUL. VERIFYING UPDATED DATABASE ROWS:');
console.log('================================================================');

const updatedTask = db.prepare("SELECT task_id, status, current_stage, completed_at, verification_state, blocker, progress_message FROM background_tasks WHERE task_id = ?").get(taskId);
console.log('UPDATED TASK ROW:', JSON.stringify(updatedTask, null, 2));

const updatedGoal = db.prepare("SELECT id, status, updated_at FROM goals WHERE id = ?").get(goalId);
console.log('UPDATED GOAL ROW:', JSON.stringify(updatedGoal, null, 2));

const latestTaskEvents = db.prepare("SELECT sequence, ts, kind, summary FROM background_task_events WHERE task_id = ? ORDER BY sequence DESC LIMIT 3").all(taskId);
console.log('LATEST TASK EVENTS:', JSON.stringify(latestTaskEvents, null, 2));

const latestGoalEvents = db.prepare("SELECT sequence, timestamp, state, event_type, message FROM goal_events WHERE goal_id = ? ORDER BY sequence DESC LIMIT 2").all(goalId);
console.log('LATEST GOAL EVENTS:', JSON.stringify(latestGoalEvents, null, 2));
