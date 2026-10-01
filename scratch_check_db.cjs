const { resolvedDbPath } = require('./server/dist/db/index.js');
const Database = require('better-sqlite3');
const db = new Database(resolvedDbPath);

console.log('DB path:', resolvedDbPath);

try {
  const bgTasks = db.prepare("SELECT id, project_id, title, status FROM background_tasks WHERE status IN ('running', 'executing')").all();
  console.log('Currently executing background tasks:', bgTasks);

  const pendingGoals = db.prepare("SELECT * FROM active_goals WHERE status = 'resume_pending' OR status = 'active'").all();
  console.log('Active/pending goals in registry:', pendingGoals);
} catch (e) {
  console.error(e.message);
}
