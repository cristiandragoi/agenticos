import Database from 'better-sqlite3';
import path from 'node:path';

const roamingDataDir = path.join(process.env.APPDATA, 'agenticos', 'data');
const dbPath = path.join(roamingDataDir, 'agentic-os.db');
const db = new Database(dbPath);

console.log('--- GOALS waiting_for_approval (Full details) ---');
const waitingGoals = db.prepare("SELECT id, original_goal, status, created_at, updated_at FROM goals WHERE status='waiting_for_approval'").all();
console.table(waitingGoals);
