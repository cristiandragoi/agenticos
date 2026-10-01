import Database from 'better-sqlite3';

const dbPath = 'C:/Users/cd-pr/AppData/Roaming/agenticos/data/agentic-os.db';
const db = new Database(dbPath);

console.log('--- SEARCHING GOALS FOR CAMERA ---');
const cameraGoals = db.prepare("SELECT id, original_goal, status, created_at FROM goals WHERE original_goal LIKE '%camera%' OR original_goal LIKE '%Camera%' ORDER BY created_at DESC LIMIT 10").all();
console.log('Camera goals:', cameraGoals);

console.log('--- SEARCHING BACKGROUND TASKS FOR CAMERA ---');
const cameraTasks = db.prepare("SELECT task_id, title, objective, status, linked_run_id, metadata FROM background_tasks WHERE title LIKE '%camera%' OR objective LIKE '%camera%' OR metadata LIKE '%camera%' ORDER BY created_at DESC LIMIT 10").all();
console.log('Camera tasks:', cameraTasks);

console.log('--- SEARCHING INCIDENTS ---');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
console.log('Tables:', tables.filter(t => t.includes('incident') || t.includes('heal') || t.includes('perception') || t.includes('argus')));

if (tables.includes('self_heal_incidents')) {
  console.log('self_heal_incidents:', db.prepare("SELECT * FROM self_heal_incidents ORDER BY created_at DESC LIMIT 5").all());
}
if (tables.includes('incidents')) {
  console.log('incidents:', db.prepare("SELECT * FROM incidents ORDER BY created_at DESC LIMIT 5").all());
}
