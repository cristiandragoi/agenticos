// Priority 3: Background Worker Lifecycle & Active Project Scope Test
import { backgroundTaskManager } from '../dist/services/backgroundTasks/manager.js';
import { TASK_LIMITS, isExecutingStatus } from '../dist/services/backgroundTasks/types.js';
import { buildProjectStateContext } from '../dist/domains/jarvis/projectStateContext.js';
import { projectsStore } from '../dist/services/projectsStore.js';
import { routeTurn } from '../dist/domains/jarvisNext/turnRouter.js';

async function run() {
  console.log('════════════════════════════════════════════════════════════');
  console.log('   PRIORITY 3: WORKER LIFECYCLE & PROJECT SCOPE TEST');
  console.log('════════════════════════════════════════════════════════════\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, msg) {
    if (condition) {
      console.log(`  ✅ PASS: ${msg}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${msg}`);
      failed++;
    }
  }

  // ── TEST 1: Concurrency accounting & waiting_approval non-blocking ───────
  console.log('TEST 1: Concurrency Accounting & waiting_approval Non-Blocking');
  
  // Clean up any stale active tasks from past tests if any
  const existingActive = backgroundTaskManager.listTasks({ activeOnly: true });
  for (const t of existingActive) {
    if (t.taskId.startsWith('test-')) {
      backgroundTaskManager.transition(t.taskId, 'completed');
    }
  }

  // Create Task 1 for codex
  const t1 = backgroundTaskManager.createTask({
    title: 'CodeX Test Task 1',
    objective: 'Simulate work requiring approval',
    originalRequest: 'test',
    route: 'codex',
    selectedAgent: 'codex',
    worker: 'codex',
  });
  assert(!!t1.task, 'Created Task 1 for CodeX');

  // Transition Task 1 to running, then waiting_approval
  backgroundTaskManager.transition(t1.task.taskId, 'running');
  assert(isExecutingStatus(backgroundTaskManager.getTask(t1.task.taskId).status), 'Task 1 is executing (running)');

  backgroundTaskManager.transition(t1.task.taskId, 'waiting_approval');
  assert(!isExecutingStatus(backgroundTaskManager.getTask(t1.task.taskId).status), 'Task 1 in waiting_approval is NOT executing status');

  // Attempt to create Task 2 for codex while Task 1 is waiting_approval
  // Since Task 1 is waiting_approval, CodeX should NOT be blocked from creating another task
  const t2 = backgroundTaskManager.createTask({
    title: 'CodeX Test Task 2',
    objective: 'Second task while task 1 is waiting approval',
    originalRequest: 'test 2',
    route: 'codex',
    selectedAgent: 'codex',
    worker: 'codex',
  });
  assert(!!t2.task && !t2.error, 'Task 2 successfully created/queued while Task 1 is waiting_approval');

  // Clean up test tasks
  backgroundTaskManager.transition(t1.task.taskId, 'cancelled');
  backgroundTaskManager.transition(t2.task.taskId, 'cancelled');

  // ── TEST 2: Authoritative worker status answers ───────────────────────────
  console.log('\nTEST 2: Authoritative Worker Status Answers');
  
  const codexStatus = await buildProjectStateContext('What is CodeX doing?');
  console.log('  Codex status answer:', codexStatus.directAnswer);
  assert(!!codexStatus.directAnswer && codexStatus.directAnswer.toLowerCase().includes('codex'), 'Answers "What is CodeX doing?" authoritatively');

  const hermesStatus = await buildProjectStateContext('What is Hermes doing?');
  console.log('  Hermes status answer:', hermesStatus.directAnswer);
  assert(!!hermesStatus.directAnswer && hermesStatus.directAnswer.toLowerCase().includes('hermes'), 'Answers "What is Hermes doing?" authoritatively');

  const delegateStatus = await buildProjectStateContext("Why can't you delegate this?");
  console.log('  Delegation status answer:', delegateStatus.directAnswer);
  assert(!!delegateStatus.directAnswer, 'Answers "Why can\'t you delegate this?" authoritatively');

  // ── TEST 3: 4-Tier Active Project Context Policy ──────────────────────────
  console.log('\nTEST 3: 4-Tier Active Project Context Policy');
  const logs = [];
  const origLog = console.log;
  console.log = (...args) => {
    logs.push(args.join(' '));
    origLog(...args);
  };

  try {
    // 1. Explicit project in utterance
    logs.length = 0;
    const explicitPack = await buildProjectStateContext('What is blocked in Free Cash?');
    assert(logs.some(l => l.includes('PROJECT_SCOPE source=explicit')), 'Explicit project sets PROJECT_SCOPE source=explicit');

    // 2. Conversation focus project
    logs.length = 0;
    const convPack = await buildProjectStateContext('What is blocked?', {
      entityId: 'proj-free-cash',
      entityType: 'project',
      entityName: 'Free Cash',
    });
    assert(logs.some(l => l.includes('PROJECT_SCOPE source=conversation')), 'Conversation focus sets PROJECT_SCOPE source=conversation');
    assert(convPack.directAnswer.includes('Free Cash'), 'Direct answer reflects Free Cash from conversation focus');

    // 3. Global active project (when no conversation focus)
    logs.length = 0;
    projectsStore.setActiveProjectId('proj-free-cash');
    const globalActivePack = await buildProjectStateContext('What is blocked?');
    assert(logs.some(l => l.includes('PROJECT_SCOPE source=global_active')), 'Global active project sets PROJECT_SCOPE source=global_active');

    // 4. No scope (explicitly clear global active project)
    logs.length = 0;
    projectsStore.setActiveProjectId(null);
    const globalPack = await buildProjectStateContext('What is blocked?');
    assert(logs.some(l => l.includes('PROJECT_SCOPE source=global')), 'No project scope sets PROJECT_SCOPE source=global');
    assert(globalPack.directAnswer.toLowerCase().includes('globally'), 'Global answer explicitly states "Globally across all projects"');
  } finally {
    console.log = origLog;
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
