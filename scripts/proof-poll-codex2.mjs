// Poll CodeX goal goal-f42acb8e- for retrieval + completion with runSummary persistence.
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Database = require('B:/AgenticOS/server/node_modules/better-sqlite3');
const dbPath = 'C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db';
const goalId = 'goal-f42acb8e-';

async function poll() {
  for (let i = 0; i < 40; i++) {
    const db = new Database(dbPath, { readonly: true });
    const goal = db.prepare('SELECT id, status, run_summary FROM goals WHERE id = ?').get(goalId);
    db.close();
    if (goal) {
      let rs = null; try { rs = typeof goal.run_summary === 'string' ? JSON.parse(goal.run_summary) : goal.run_summary; } catch {}
      const mr = rs?.memoryRetrieved;
      console.log(`poll ${i}: status=${goal.status} memoryRetrieved=${JSON.stringify(mr)}`);
      if (goal.status === 'completed') {
        console.log('FINAL runSummary.memoryRetrieved:', JSON.stringify(mr));
        console.log('runSummary keys:', rs ? Object.keys(rs).join(',') : 'none');
        return;
      }
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  console.log('TIMEOUT');
}
poll().catch((e) => { console.error('ERR', e); process.exit(1); });
