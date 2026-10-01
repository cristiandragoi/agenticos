// Verification of Item 7: Worker Queue Hardening & Deduplication
import { backgroundTaskManager } from './dist/services/backgroundTasks/manager.js';

async function run() {
  console.log('=== VERIFYING WORKER QUEUE DEDUPLICATION ===\n');

  const requestText = 'Where in the code is Revenue Operator implemented?';
  
  // Dispatch request 1
  console.log('1. Dispatching engineering task 1...');
  const res1 = backgroundTaskManager.createTask({
    title: 'CodeX: locate Revenue Operator',
    objective: requestText,
    originalRequest: requestText,
    worker: 'codex',
    route: 'codex',
    selectedAgent: 'CodeX',
    conversationId: 'test-conv-dedup',
  });
  if (res1.error || !res1.task) {
    throw new Error(`Failed to create task 1: ${res1.error}`);
  }
  const task1Id = res1.task.taskId;
  console.log(`   Task 1 created: ${task1Id}, status: ${res1.task.status}`);

  // Dispatch identical request 2 rapidly
  console.log('2. Dispatching identical engineering task 2 rapidly...');
  const res2 = backgroundTaskManager.createTask({
    title: 'CodeX: locate Revenue Operator',
    objective: requestText,
    originalRequest: requestText,
    worker: 'codex',
    route: 'codex',
    selectedAgent: 'CodeX',
    conversationId: 'test-conv-dedup',
  });
  if (res2.error || !res2.task) {
    throw new Error(`Failed to create task 2: ${res2.error}`);
  }
  const task2Id = res2.task.taskId;
  console.log(`   Task 2 response: ${task2Id}, status: ${res2.task.status}`);

  if (task1Id !== task2Id) {
    throw new Error(`Expected task 2 to reuse task 1 (${task1Id}), but got new task (${task2Id})`);
  }
  console.log(`\n  SUCCESS: Identical task was deduplicated and reused! (${task1Id} === ${task2Id})`);

  // Cleanup test task
  backgroundTaskManager.transition(task1Id, 'cancelled', { blocker: 'Test cleanup' });
  console.log('  Cleaned up test task.');
  console.log('\n================ WORKER DEDUPLICATION TEST PASSED ================');
}

run().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
