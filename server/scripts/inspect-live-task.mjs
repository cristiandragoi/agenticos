// Inspect the live E2E task's final state + recovery continuation.
import { backgroundTaskRepo } from '../dist/services/backgroundTasks/store.js';
const taskId = process.argv[2] || 'task-reclive-1786630040272';
const t = backgroundTaskRepo.getTask(taskId);
if (!t) { console.log('task not found'); process.exit(0); }
console.log('status:', t.status);
console.log('blocker:', t.blocker);
console.log('attempt:', t.attempt);
const m = t.metadata || {};
console.log('assigned:', m.assignedProvider + '/' + m.assignedModel);
console.log('effective:', m.effectiveProvider + '/' + m.effectiveModel);
console.log('escalationOccurred:', m.escalationOccurred, '| reason:', m.escalationReason);
console.log('recovery:', JSON.stringify(m.recovery || null));
const events = backgroundTaskRepo.getEvents(taskId);
console.log('events:');
for (const e of events.slice(-12)) {
  console.log(`  ${e.kind} | ${String(e.summary).slice(0, 90)}`);
}
