import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getUserWorkingProfile, resolvePreferredNameTurn, updateUserWorkingProfile } from '../domains/jarvis/coreMemory.js';
import { classifyExecutiveIntent } from '../domains/jarvis/executiveIntent.js';
import { buildConversationalAcknowledgement } from '../domains/jarvis/conversationalAck.js';
import { detectLocalFastReply } from '../domains/jarvis/fastLocalReplies.js';
import { buildWorkerStatus } from '../domains/jarvis/workerInsights.js';
import { getCapability } from '../domains/jarvis/capabilityRegistry.js';
import { backgroundTaskManager } from '../services/backgroundTasks/manager.js';

vi.mock('../services/backgroundTasks/manager.js', () => ({
  backgroundTaskManager: {
    listTasks: vi.fn(() => []),
    createTask: vi.fn(),
    transition: vi.fn()
  }
}));

vi.mock('../services/goalStore.js', () => ({
  goalStore: {
    list: vi.fn(() => [])
  }
}));

describe('Jarvis Core Project Handoff, Name & Title Persistence Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1. Accepting each requested title & changing preferred title
  it('Accepts each requested title (Master, Commander, Chief, Executive) and updates profile', () => {
    const titles = ['Master', 'Commander', 'Chief', 'Executive'];

    for (const title of titles) {
      const result = resolvePreferredNameTurn(`Call me ${title}`);
      expect(result).toBe(`I'll call you ${title}.`);
      
      const profile = getUserWorkingProfile();
      expect(profile.preferredTitle).toBe(title);
      expect(profile.avoidNameDrops).toBe(false);
    }
  });

  // 2. Stopping repeated use of "Christian"
  it('Handles stop calling me Christian command and sets avoidNameDrops', () => {
    const result = resolvePreferredNameTurn('Stop calling me Christian.');
    expect(result).toBe("I will not use that title from now on. I'll speak normally.");

    const profile = getUserWorkingProfile();
    expect(profile.avoidNameDrops).toBe(true);

    // Prompting for name should reflect preference
    const nameQuery = resolvePreferredNameTurn('What is my name?');
    expect(nameQuery).toBe('You asked me not to use your name or a specific title.');
  });

  // 3. Persistent profile settings save and restore
  it('Maintains profile persistence settings across updates', () => {
    const profile = updateUserWorkingProfile({ preferredTitle: 'Commander', avoidNameDrops: false });
    expect(profile.preferredTitle).toBe('Commander');
    expect(profile.avoidNameDrops).toBe(false);

    const reloaded = getUserWorkingProfile();
    expect(reloaded.preferredTitle).toBe('Commander');
    expect(reloaded.avoidNameDrops).toBe(false);
  });

  // 4. Natural Name Usage & No safety refusal
  it('Does not fabricate safety refusals and uses Christian sparing, not in acknowledgments', () => {
    const profile = updateUserWorkingProfile({ preferredName: 'Christian', preferredTitle: undefined, avoidNameDrops: false });
    
    const ack = buildConversationalAcknowledgement('Fix the bug', 'codex');
    expect(ack).not.toContain('Christian');
    expect(ack).not.toContain('safety protocol');
    expect(ack).not.toContain('Master');
  });

  // 5. Already-approved actions are not reconfirmed & Queue Match
  it('Explicit queue-it commands route directly to delegation with queued mode and do not ask to confirm', () => {
    const prompt = 'Yes, I want you to queue that change request.';
    const exec = classifyExecutiveIntent(prompt);
    
    expect(exec).not.toBeNull();
    expect(exec!.intent).toBe('worker_delegation');
    expect(exec!.workerKind).toBe('codex');
    expect((exec as any).executionMode).toBe('queued');

    const ack = buildConversationalAcknowledgement(prompt, 'codex', false, (exec as any).executionMode, 'task-mock-123');
    expect(ack).toBe("Queued for CodeX (Task ID: task-mock-123). It will modify the existing Revenue Operator implementation and preserve the current Jarvis fixes.");
  });

  // 6. Queue vs Start
  it('Verify that distinct CodeX intents resolve to correct execution modes', () => {
    const testCases = [
      { prompt: 'Queue this for Codex.', expectedMode: 'queued' },
      { prompt: 'Give this to Codex.', expectedMode: 'immediate' },
      { prompt: 'Start this project now.', expectedMode: 'start_now' },
      { prompt: "Prepare this for Codex but don't start.", expectedMode: 'specification_only' }
    ];

    for (const tc of testCases) {
      const exec = classifyExecutiveIntent(tc.prompt);
      expect(exec, `Failed on: ${tc.prompt}`).not.toBeNull();
      expect(exec!.intent).toBe('worker_delegation');
      expect(exec!.workerKind).toBe('codex');
      expect((exec as any).executionMode).toBe(tc.expectedMode);
    }
  });

  // 7. Task ID and state included after genuine dispatch
  it('Genuine task start includes task ID and execution state', () => {
    const prompt = 'Give this to Codex.';
    const exec = classifyExecutiveIntent(prompt);
    expect(exec).not.toBeNull();
    
    const ack = buildConversationalAcknowledgement(prompt, 'codex', false, (exec as any).executionMode, 'bgtask-456');
    expect(ack).toBe('CodeX has started the implementation (Task ID: bgtask-456, State: running).');
  });

  // 8. New Project Handoff Local Replies
  it('Verify that natural project handoffs get deterministic local fast replies', () => {
    const handoffGeneric = detectLocalFastReply("I'll give you a new project.");
    expect(handoffGeneric).not.toBeNull();
    expect(handoffGeneric!.reply).toBe('Send it over.');

    const handoffStart = detectLocalFastReply("I'll give you a new project. This project has to start now.");
    expect(handoffStart).not.toBeNull();
    expect(handoffStart!.reply).toBe("Send it over. I'll turn it into an implementation task and delegate the code work to Codex.");
  });

  // 9. Real State Database Status
  it('Verify that buildWorkerStatus queries real task database to answer what Codex is doing, failed, or finished', async () => {
    const codexCap = getCapability('codex')!;
    
    // Setup mock database tasks
    const mockTasks = [
      { taskId: 'task-1', title: 'Implement login', worker: 'codex', status: 'running', progressMessage: 'writing tests' },
      { taskId: 'task-2', title: 'Setup CI', worker: 'codex', status: 'queued' },
      { taskId: 'task-3', title: 'Fix auth bug', worker: 'codex', status: 'completed' },
      { taskId: 'task-4', title: 'Add dashboard', worker: 'codex', status: 'failed', lastError: 'Vitest run failed' },
      { taskId: 'task-5', title: 'Configure db', worker: 'codex', status: 'blocked', blocker: 'Missing credentials' }
    ];

    vi.mocked(backgroundTaskManager.listTasks).mockReturnValue(mockTasks as any);

    // "What is Codex doing?"
    const doing = await buildWorkerStatus(codexCap, 'What is Codex doing?');
    expect(doing).toBe('CodeX is currently working on: "Implement login" (ID: task-1). Current step: writing tests.');

    // "What projects are waiting for Codex?"
    const waiting = await buildWorkerStatus(codexCap, 'What projects are waiting for Codex?');
    expect(waiting).toBe('The following tasks are waiting in CodeX\'s queue:\n- "Setup CI" (ID: task-2)');

    // "What did Codex finish?"
    const finished = await buildWorkerStatus(codexCap, 'What did Codex finish?');
    expect(finished).toBe('CodeX has completed the following tasks:\n- "Fix auth bug" (ID: task-3)');

    // "What failed?"
    const failed = await buildWorkerStatus(codexCap, 'What failed?');
    expect(failed).toBe('The following CodeX tasks have failed:\n- "Add dashboard" (ID: task-4) - Error: Vitest run failed');

    // "What is blocking the project?"
    const blocked = await buildWorkerStatus(codexCap, 'What is blocking the project?');
    expect(blocked).toBe('The following CodeX tasks are currently blocked:\n- "Configure db" (ID: task-5) - Blocker: Missing credentials');

    // "What did you give Codex?"
    const given = await buildWorkerStatus(codexCap, 'What did you give Codex?');
    expect(given).toBe('I have given CodeX the following tasks:\n- "Implement login" (ID: task-1) - Status: running\n- "Setup CI" (ID: task-2) - Status: queued\n- "Fix auth bug" (ID: task-3) - Status: completed\n- "Add dashboard" (ID: task-4) - Status: failed\n- "Configure db" (ID: task-5) - Status: blocked');
  });
});
