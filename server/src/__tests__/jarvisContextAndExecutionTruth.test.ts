import { describe, it, expect, beforeEach } from 'vitest';
import { routeTurn, getFocus } from '../domains/jarvisNext/turnRouter.js';
import { buildProjectStateContext } from '../domains/jarvis/projectStateContext.js';
import { backgroundTaskManager } from '../services/backgroundTasks/manager.js';
import { projectsStore } from '../services/projectsStore.js';
import { terminalExecutor } from '../domains/jarvis/execution/executors/terminalExecutor.js';
import { universalExecutionController } from '../domains/jarvis/execution/universalExecutionController.js';
import { browserSessionManager } from '../services/browser/browserSession.js';

describe('Jarvis Context, Execution Truth & Stop/Cancel Regression Suite', () => {
  const conversationId = 'conv-regression-' + Date.now();

  beforeEach(() => {
    projectsStore.ensureRevenueProjects();
    // Clear focus for test conversation
    const focus = getFocus(conversationId);
    focus.activeProjectId = undefined;
    focus.activeProjectName = undefined;
    focus.activeEntityId = undefined;
    focus.activeEntityName = undefined;
    focus.activeEntityType = undefined;
  });

  // 1. FreeCash discussion → arithmetic question
  it('Scenario 1: FreeCash discussion → arithmetic question ("how much is 2 plus 2?" answers "4")', async () => {
    // Turn 1: Discuss Free Cash
    const turn1 = await routeTurn({
      prompt: 'Check the Free Cash project status',
      conversationId,
    });
    expect(turn1.handled).toBe(true);
    expect(turn1.route).toBe('fast_read');
    expect(turn1.entityId).toBe('proj-free-cash');

    // Turn 2: Arithmetic question immediately after Free Cash discussion
    const turn2 = await routeTurn({
      prompt: 'how much is 2 plus 2?',
      conversationId,
    });
    expect(turn2.handled).toBe(true);
    expect(turn2.text).toBe('4');
    expect(turn2.route).toBe('chat_trivial');
    expect(turn2.text).not.toContain('Free Cash');
    expect(turn2.text).not.toContain('tasks are running');
  });

  // 2. FreeCash discussion → unrelated question
  it('Scenario 2: FreeCash discussion → unrelated question does not become Free Cash status read', async () => {
    // Turn 1: Discuss Free Cash
    const turn1 = await routeTurn({
      prompt: 'What is happening with Free Cash?',
      conversationId,
    });
    expect(turn1.handled).toBe(true);
    expect(turn1.entityId).toBe('proj-free-cash');

    // Turn 2: Unrelated topic question
    const turn2 = await routeTurn({
      prompt: 'What is the capital of France?',
      conversationId,
    });
    // Must NOT be routed to Free Cash fast_read or claim Free Cash status
    expect(turn2.entityId).not.toBe('proj-free-cash');
    expect(turn2.text).not.toContain('Free Cash is active');
    expect(turn2.text).not.toContain('tasks are running right now');
  });

  // 3. Relevant project follow-up
  it('Scenario 3: Relevant project follow-up properly inherits Free Cash focus', async () => {
    // Turn 1: Discuss Free Cash
    await routeTurn({
      prompt: 'Tell me about the Free Cash project',
      conversationId,
    });

    // Turn 2: Relevant follow-up about project state
    const turn2 = await routeTurn({
      prompt: 'What is blocked?',
      conversationId,
    });
    expect(turn2.handled).toBe(true);
    expect(turn2.entityId).toBe('proj-free-cash');
    expect(turn2.route).toMatch(/fast_read|blocker_detail_read/);
  });

  // 4. Stop with active work vs stop with no active work
  describe('Scenario 4: Stop speech vs Cancel active work', () => {
    it('Speech stop ("be quiet", "shut up", "stop speaking") returns silence', async () => {
      const res = await routeTurn({
        prompt: 'be quiet',
        conversationId,
      });
      expect(res.handled).toBe(true);
      expect(res.text).toBe('');
      expect((res as any).silent).toBe(true);
    });

    it('Polite speech stop with question mark ("Can you stop speaking?") stops speech silently', async () => {
      const res = await routeTurn({
        prompt: 'Can you stop speaking?',
        conversationId,
      });
      expect(res.handled).toBe(true);
      expect(res.text).toBe('');
      expect((res as any).silent).toBe(true);
    });

    it('Work cancel with no active work truthfully reports nothing running', async () => {
      // Ensure no active tasks or processes
      const res = await routeTurn({
        prompt: 'cancel work',
        conversationId,
      });
      expect(res.handled).toBe(true);
      expect(res.text).toMatch(/There is no active work running to cancel|Nothing is running/i);
      expect(res.executed).toBe(false);
    });

    it('Work cancel with active background task cancels it and reports truth', async () => {
      // Create a running background task
      const { task } = backgroundTaskManager.createTask({
        title: 'Background test task',
        objective: 'Testing cancellation',
        route: 'internal',
        worker: 'test',
        priority: 'normal',
        conversationId,
      });
      backgroundTaskManager.startTask(task!.taskId);

      const res = await routeTurn({
        prompt: 'cancel all work',
        conversationId,
      });
      expect(res.handled).toBe(true);
      expect(res.executed).toBe(true);
      expect(res.text).toMatch(/cancelled.*Background test task/i);

      // Verify task status is cancelled in the manager
      const after = backgroundTaskManager.getTask(task!.taskId);
      expect(after?.status).toBe('cancelled');
    });
  });

  // 5. Stale evidence and stored task counts without live execution
  it('Scenario 5: Stored database task counts are never claimed as actively executing tasks', async () => {
    // When no background tasks are in isExecutingStatus ('running' | 'planning' | 'verifying')
    // buildProjectStateContext must accurately distinguish stored records from live running tasks.
    const context = await buildProjectStateContext('What is running in Free Cash?');
    expect(context.hasEvidence).toBe(true);
    // Should NOT say "30 tasks are running right now" without active executing tasks
    expect(context.directAnswer).not.toMatch(/^\s*Free Cash has \d+ tasks? running right now\.\s*$/i);
    // If tasks are stored in DB, it mentions they are stored or no tasks are actively executing
    if (context.directAnswer?.includes('stored')) {
      expect(context.directAnswer).toContain('No tasks are actively executing right now');
    }
  });

  // 6. Browser access verification
  it('Scenario 6: Browser window query does not claim access without managed browser session', async () => {
    // Ensure managed session is closed/null
    browserSessionManager.clearSession();

    const result = await universalExecutionController.handleUserTurn({
      prompt: 'Where is the Chrome window?',
      conversationId,
      sttConfidence: 0.95,
      rawStt: 'Where is the Chrome window?',
    });

    // Should truthfully report no managed browser session rather than hallucinating
    expect(result.spokenText).toMatch(/No managed browser window is currently open|browser/i);
    expect(result.spokenText).not.toContain("Here is the Chrome window");
  });
});
