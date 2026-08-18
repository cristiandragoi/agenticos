// Poll goal-18aa25ce- and print the retrieved memory IDs + titles.
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Database = require('B:/AgenticOS/server/node_modules/better-sqlite3');
const dbPath = 'C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db';
const goalId = 'goal-18aa25ce-';

async function poll() {
  for (let i = 0; i < 40; i++) {
    const db = new Database(dbPath, { readonly: true });
    const goal = db.prepare('SELECT id, status, run_summary FROM goals WHERE id = ?').get(goalId);
    if (goal) {
      let rs = null; try { rs = typeof goal.run_summary === 'string' ? JSON.parse(goal.run_summary) : goal.run_summary; } catch {}
      const mr = rs?.memoryRetrieved;
      if (mr?.memoryIds?.length) {
        console.log('RETRIEVED IDs:', JSON.stringify(mr.memoryIds));
        for (const mid of mr.memoryIds) {
          const m = db.prepare('SELECT title, content, tags FROM memory_records WHERE id = ?').get(mid);
          console.log(`  ${mid} -> ${m?.title} | tags=${JSON.stringify(m?.tags)} | ${(m?.content||'').slice(0,50)}`);
        }
        console.log('MARKETING-LEAK:', mr.memoryIds.includes('mem-1786900453837-zatqtv') ? 'YES (FAIL)' : 'NO (PASS)');
        console.log('status', goal.status, 'truncated', mr.truncated, 'count', mr.count);
        db.close();
        return;
      }
    }
    db.close();
    await new Promise((r) => setTimeout(r, 3000));
  }
  console.log('TIMEOUT');
}
poll().catch((e) => { console.error('ERR', e); process.exit(1); });
