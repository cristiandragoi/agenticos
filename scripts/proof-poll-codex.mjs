// Poll the CodeX goal for memory retrieval proof (runSummary.memoryRetrieved) + final status.
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Database = require('B:/AgenticOS/server/node_modules/better-sqlite3');

const goalId = 'goal-b6213f20-';
const dbPath = 'C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db';

async function poll() {
  for (let i = 0; i < 30; i++) {
    const db = new Database(dbPath, { readonly: true });
    const goal = db.prepare('SELECT id, status, run_summary FROM goals WHERE id = ?').get(goalId);
    db.close();
    if (goal) {
      let rs = null;
      try { rs = typeof goal.run_summary === 'string' ? JSON.parse(goal.run_summary) : goal.run_summary; } catch {}
      const mr = rs?.memoryRetrieved;
      console.log(`poll ${i}: status=${goal.status} memoryRetrieved=${JSON.stringify(mr)}`);
      if (mr && mr.memoryIds?.length) {
        console.log('FINAL-RETRIEVED', JSON.stringify(mr, null, 1));
        console.log('FULL-RUNSUMMARY-KEYS', rs ? Object.keys(rs).join(',') : 'none');
        return;
      }
      if (['completed', 'failed', 'stopped', 'paused'].includes(goal.status)) {
        console.log('TERMINAL without retrieval:', goal.status);
        return;
      }
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  console.log('TIMEOUT waiting for retrieval');
}
poll().catch((e) => { console.error('ERR', e); process.exit(1); });
