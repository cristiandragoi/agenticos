// Verify recovery events are in background_task_events for the E2E task.
import { rawDb } from '../dist/db/index.js';
const taskId = process.argv[2];
if (!taskId) { console.log('usage: node verify-recovery-events.mjs <taskId>'); process.exit(1); }
const rows = rawDb.prepare('SELECT kind, summary, detail FROM background_task_events WHERE task_id = ? ORDER BY sequence').all(taskId);
console.log('total events:', rows.length);
for (const r of rows) {
  console.log(`  ${r.kind} | ${r.summary}`);
}
