import Database from 'better-sqlite3';
import fs from 'fs';

const dbs = [
  'C:\\Users\\cd-pr\\AppData\\Roaming\\AgenticOS\\data\\agentic-os.db',
  'D:\\AgenticOS\\server\\data\\agentic-os.db'
];

for (const dbPath of dbs) {
  if (!fs.existsSync(dbPath)) continue;
  console.log(`\n=== INSPECTING: ${dbPath} ===`);
  try {
    const db = new Database(dbPath, { readonly: true });
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    console.log('Tables:', tables.map((t: any) => t.name).join(', '));

    // Check background_tasks table if exists
    if (tables.some((t: any) => t.name === 'background_tasks')) {
      const tasks = db.prepare("SELECT * FROM background_tasks WHERE id LIKE '%352e2bf60%' OR projectId LIKE '%free-cash%'").all();
      console.log('Matching background_tasks:', JSON.stringify(tasks, null, 2));

      const allRecent = db.prepare("SELECT id, title, status, currentStage, createdAt, updatedAt FROM background_tasks ORDER BY updatedAt DESC LIMIT 5").all();
      console.log('Recent background_tasks:', JSON.stringify(allRecent, null, 2));
    }

    // Check revenue_operator or projects table if exists
    if (tables.some((t: any) => t.name === 'projects')) {
      const proj = db.prepare("SELECT * FROM projects WHERE id LIKE '%free-cash%' OR name LIKE '%Free Cash%'").all();
      console.log('Matching projects:', JSON.stringify(proj, null, 2));
    }

    db.close();
  } catch (err: any) {
    console.error(`Error querying ${dbPath}:`, err.message);
  }
}
