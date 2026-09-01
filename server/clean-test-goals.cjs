const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve(__dirname, 'data', 'agentic-os.db');
const db = new Database(dbPath);

const testGoalIds = db.prepare("SELECT id FROM goals WHERE id LIKE 'test-%' OR id LIKE 'sweep-%' OR id LIKE 'restart-%' OR id LIKE 'goal-wire-%'").all().map(r => r.id);
console.log(`[Cleanup] Found ${testGoalIds.length} remaining test goal IDs.`);

if (testGoalIds.length > 0) {
  const placeholders = testGoalIds.map(() => '?').join(',');
  db.prepare(`DELETE FROM goal_events WHERE goal_id IN (${placeholders})`).run(...testGoalIds);
  db.prepare(`DELETE FROM goal_steps WHERE goal_id IN (${placeholders})`).run(...testGoalIds);
  const del = db.prepare(`DELETE FROM goals WHERE id IN (${placeholders})`).run(...testGoalIds);
  console.log(`[Cleanup] Deleted ${del.changes} test goal records.`);
}

const remainingGoals = db.prepare("SELECT id, original_goal, status FROM goals").all();
console.log('[Cleanup] Remaining Goals:', remainingGoals);
