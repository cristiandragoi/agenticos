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

    if (tables.some((t: any) => t.name === 'background_tasks')) {
      const cols = db.prepare("PRAGMA table_info(background_tasks)").all();
      console.log('background_tasks columns:', cols.map((c: any) => c.name).join(', '));
      const tasks = db.prepare("SELECT * FROM background_tasks").all();
      console.log(`Found ${tasks.length} background_tasks:`);
      for (const task of tasks) {
        console.log(JSON.stringify(task, null, 2));
      }
    }

    if (tables.some((t: any) => t.name === 'projects')) {
      const cols = db.prepare("PRAGMA table_info(projects)").all();
      console.log('projects columns:', cols.map((c: any) => c.name).join(', '));
      const projs = db.prepare("SELECT * FROM projects").all();
      console.log(`Found ${projs.length} projects:`);
      for (const p of projs) {
        console.log(JSON.stringify(p, null, 2));
      }
    }

    db.close();
  } catch (err: any) {
    console.error(`Error querying ${dbPath}:`, err.message);
  }
}
