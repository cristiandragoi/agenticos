const { resolvedDbPath } = require('./dist/db/index.js');
const Database = require('better-sqlite3');
const db = new Database(resolvedDbPath);

try {
  const bgCols = db.prepare("PRAGMA table_info(background_tasks)").all();
  console.log('background_tasks columns:', bgCols.map(c => c.name));

  const bgTasks = db.prepare("SELECT * FROM background_tasks WHERE status IN ('running', 'executing')").all();
  console.log('Currently executing background tasks:', bgTasks);

  const pendingGoals = db.prepare("SELECT * FROM active_goals WHERE status = 'resume_pending' OR status = 'active'").all();
  console.log('Active/pending goals in registry:', pendingGoals);
} catch (e) {
  console.error(e.message);
}
