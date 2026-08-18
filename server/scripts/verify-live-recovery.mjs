// Verify the completed live E2E: goal history events (real provider/model),
// task metadata truth (assigned vs effective), recovery events in DB.
import { backgroundTaskRepo } from '../dist/services/backgroundTasks/store.js';
import { goalStore } from '../dist/services/goalStore.js';
const taskId = 'task-reclive-1786630186618';

const t = backgroundTaskRepo.getTask(taskId);
const m = t.metadata || {};
console.log('task:', taskId, 'status:', t.status, 'verificationState:', t.verificationState);
console.log('assigned:', m.assignedProvider + '/' + m.assignedModel);
console.log('effective:', m.effectiveProvider + '/' + m.effectiveModel);
console.log('escalationOccurred:', m.escalationOccurred, '| reason:', m.escalationReason);
console.log('attempt:', t.attempt);

const g = goalStore.get(t.linkedRunId);
console.log('\ngoal:', t.linkedRunId, 'status:', g?.status);
const steps = (g?.history || []).filter((h) => h.state && h.state !== 'planning').slice(0, 6);
for (const h of steps) {
  console.log(`  step ${h.step} [${h.state}] tool=${h.tool || '?'} provider=${h.provider || '?'} model=${h.model || '?'} msg=${String(h.message || '').slice(0, 60)}`);
}

const events = backgroundTaskRepo.getEvents(taskId);
console.log('\nrecovery/gate events:');
for (const e of events) {
  if (String(e.kind).startsWith('run.recovery') || e.kind === 'task.verified' || e.kind === 'task.completed') {
    console.log(`  ${e.kind} | ${String(e.summary).slice(0, 80)}`);
  }
}
