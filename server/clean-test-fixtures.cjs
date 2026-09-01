const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve(__dirname, 'data', 'agentic-os.db');
const db = new Database(dbPath);

console.log('[Cleanup] Starting approved test fixture removal with child event cleanup...');

// 1. Delete test goal events & goals
db.prepare("DELETE FROM goal_events WHERE goal_id IN ('goal-1788103630229', 'goal-real-1788103663363')").run();
db.prepare("DELETE FROM goal_steps WHERE goal_id IN ('goal-1788103630229', 'goal-real-1788103663363')").run();
const delGoals = db.prepare("DELETE FROM goals WHERE id IN ('goal-1788103630229', 'goal-real-1788103663363')").run();
console.log(`[Cleanup] Deleted ${delGoals.changes} test goal records.`);

// 2. Delete test background task events & background tasks
const testTaskIds = db.prepare("SELECT task_id FROM background_tasks WHERE task_id LIKE 'task-wire-%' OR task_id LIKE 'task-rec-%' OR task_id LIKE 'task-behavior-%'").all().map(r => r.task_id);
console.log(`[Cleanup] Found ${testTaskIds.length} test background task IDs to remove.`);

if (testTaskIds.length > 0) {
  const placeholders = testTaskIds.map(() => '?').join(',');
  const delEvents = db.prepare(`DELETE FROM background_task_events WHERE task_id IN (${placeholders})`).run(...testTaskIds);
  console.log(`[Cleanup] Deleted ${delEvents.changes} background_task_events.`);
  
  const delBg = db.prepare(`DELETE FROM background_tasks WHERE task_id IN (${placeholders})`).run(...testTaskIds);
  console.log(`[Cleanup] Deleted ${delBg.changes} background_tasks records.`);
}

// 3. Verify remaining tasks
const remainingGoals = db.prepare("SELECT id, original_goal, status FROM goals").all();
const remainingBg = db.prepare("SELECT task_id, title, status, worker FROM background_tasks").all();
console.log('[Cleanup] Remaining Goals:', remainingGoals);
console.log('[Cleanup] Remaining Background Tasks:', remainingBg);
