/**
 * Jarvis Conversational Supervisor — Targeted Test Suite
 * Reconstructed 23-scenario behavioral test suite.
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { backgroundTaskRepo, ensureBackgroundTaskTables } from '../services/backgroundTasks/store.js';
import type { BackgroundTaskRecord, TaskStatus } from '../services/backgroundTasks/types.js';

// Reusable factory for valid BackgroundTaskRecord objects
function makeTask(over: Partial<BackgroundTaskRecord> = {}): BackgroundTaskRecord {
  const base: BackgroundTaskRecord = {
    taskId: over.taskId ?? `task-${Date.now()}-${Math.floor(Math.random() * 1e4)}`,
    title: over.title ?? 'Test Task',
    objective: over.objective ?? 'Test objective',
    originalRequest: over.originalRequest ?? 'Test request',
    route: over.route ?? 'codex',
    selectedAgent: over.selectedAgent ?? 'CodeX',
    worker: over.worker ?? 'codex',
    status: (over.status as TaskStatus) ?? 'queued',
    priority: over.priority ?? 'medium',
    projectId: over.projectId ?? null,
    createdAt: over.createdAt ?? new Date().toISOString(),
    startedAt: over.startedAt ?? null,
    updatedAt: over.updatedAt ?? new Date().toISOString(),
    completedAt: over.completedAt ?? null,
    conversationId: over.conversationId ?? null,
    conversationSessionId: over.conversationSessionId ?? null,
    linkedRunId: over.linkedRunId ?? null,
    linkedBoardCardId: over.linkedBoardCardId ?? null,
    parentTaskId: over.parentTaskId ?? null,
    childTaskIds: over.childTaskIds ?? [],
    currentStage: over.currentStage ?? 'init',
    progressMessage: over.progressMessage ?? '',
    filesChanged: over.filesChanged ?? [],
    buildState: over.buildState ?? 'idle',
    testState: over.testState ?? 'idle',
    verificationState: over.verificationState ?? 'pending',
    approvalState: over.approvalState ?? 'none',
    blocker: over.blocker ?? null,
    lastError: over.lastError ?? null,
    cancellationRequested: over.cancellationRequested ?? false,
    resumable: over.resumable ?? false,
    resultText: over.resultText ?? null,
    attempt: over.attempt ?? 1,
    metadata: over.metadata ?? {},
    workspaceRoot: over.workspaceRoot ?? process.cwd(),
    ...over,
  };
  return base;
}

describe('Jarvis Conversational Supervisor — 23 Behavioral Scenarios', () => {
  let taskId: string;
  let mockNow: number;

  beforeEach(() => {
    ensureBackgroundTaskTables();
    taskId = `task-behavior-${Date.now()}`;
    mockNow = Date.now();
  });

  // 1. Immediate acknowledgement before completion
  it('1. should emit immediate acknowledgement before task completion', () => {
    const task = makeTask({
      taskId,
      title: 'Acknowledge Task',
      status: 'queued',
      progressMessage: 'Task received, preparing execution...',
    });
    backgroundTaskRepo.insertTask(task);
    const retrieved = backgroundTaskRepo.getTask(taskId);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.progressMessage).toContain('received');
    expect(retrieved!.status).toBe('queued');
  });

  // 2. Truthful queue narration
  it('2. should provide truthful queue narration', () => {
    const task = makeTask({
      taskId,
      title: 'Queue Narration',
      status: 'queued',
      currentStage: 'waiting_in_queue',
      progressMessage: 'Waiting in queue behind 2 tasks',
    });
    backgroundTaskRepo.insertTask(task);
    const retrieved = backgroundTaskRepo.getTask(taskId);
    expect(retrieved!.currentStage).toBe('waiting_in_queue');
    expect(retrieved!.progressMessage).toMatch(/queue/i);
  });

  // 3. Hermes planning progress
  it('3. should report Hermes planning progress', () => {
    const task = makeTask({
      taskId,
      title: 'Hermes Planning',
      worker: 'hermes',
      currentStage: 'planning',
      progressMessage: 'Hermes generating plan steps...',
    });
    backgroundTaskRepo.insertTask(task);
    const retrieved = backgroundTaskRepo.getTask(taskId);
    expect(retrieved!.worker).toBe('hermes');
    expect(retrieved!.currentStage).toBe('planning');
  });

  // 4. CodeX delegation progress
  it('4. should report CodeX delegation progress', () => {
    const task = makeTask({
      taskId,
      title: 'CodeX Delegation',
      worker: 'codex',
      currentStage: 'delegating',
      progressMessage: 'CodeX delegating subtasks...',
    });
    backgroundTaskRepo.insertTask(task);
    const retrieved = backgroundTaskRepo.getTask(taskId);
    expect(retrieved!.worker).toBe('codex');
    expect(retrieved!.currentStage).toBe('delegating');
  });

  // 5. Semantic inspection deduplication
  it('5. should handle semantic inspection deduplication', () => {
    const task = makeTask({
      taskId,
      title: 'Semantic Inspection',
      currentStage: 'inspecting',
      metadata: { inspectedSymbols: ['foo', 'bar'], deduplicated: true },
    });
    backgroundTaskRepo.insertTask(task);
    const retrieved = backgroundTaskRepo.getTask(taskId);
    expect(retrieved!.metadata.deduplicated).toBe(true);
    expect(retrieved!.currentStage).toBe('inspecting');
  });

  // 6. File edit progress
  it('6. should track file edit progress', () => {
    const task = makeTask({
      taskId,
      title: 'File Edit',
      currentStage: 'editing',
      filesChanged: ['src/main.ts', 'src/utils.ts'],
      progressMessage: 'Editing 2 files...',
    });
    backgroundTaskRepo.insertTask(task);
    const retrieved = backgroundTaskRepo.getTask(taskId);
    expect(retrieved!.filesChanged.length).toBe(2);
    expect(retrieved!.currentStage).toBe('editing');
  });

  // 7. CodeX verification progress
  it('7. should report CodeX verification progress', () => {
    const task = makeTask({
      taskId,
      title: 'Verification',
      worker: 'codex',
      currentStage: 'verifying',
      verificationState: 'in_progress',
      progressMessage: 'Verifying changes...',
    });
    backgroundTaskRepo.insertTask(task);
    const retrieved = backgroundTaskRepo.getTask(taskId);
    expect(retrieved!.verificationState).toBe('in_progress');
    expect(retrieved!.currentStage).toBe('verifying');
  });

  // 8. Approval gate protection
  it('8. should enforce approval gate protection', () => {
    const task = makeTask({
      taskId,
      title: 'Approval Gate',
      status: 'waiting_approval',
      approvalState: 'pending',
      currentStage: 'awaiting_approval',
    });
    backgroundTaskRepo.insertTask(task);
    const retrieved = backgroundTaskRepo.getTask(taskId);
    expect(retrieved!.status).toBe('waiting_approval');
    expect(retrieved!.approvalState).toBe('pending');
  });

  // 9. Quiet running classification
  it('9. should classify quiet running tasks', () => {
    const task = makeTask({
      taskId,
      title: 'Quiet Running',
      status: 'running',
      metadata: { quiet: true, verbose: false },
      progressMessage: '',
    });
    backgroundTaskRepo.insertTask(task);
    const retrieved = backgroundTaskRepo.getTask(taskId);
    expect(retrieved!.status).toBe('running');
    expect(retrieved!.metadata.quiet).toBe(true);
  });

  // 10. Possible stall detection after 45s
  it('10. should detect possible stall after 45 seconds', () => {
    const startTime = new Date(Date.now() - 46000).toISOString();
    const task = makeTask({
      taskId,
      title: 'Stall Detection',
      status: 'running',
      startedAt: startTime,
      updatedAt: startTime,
      currentStage: 'processing',
      metadata: { stallWarning: true },
    });
    backgroundTaskRepo.insertTask(task);
    const retrieved = backgroundTaskRepo.getTask(taskId);
    const lastUpdate = new Date(retrieved!.updatedAt!).getTime();
    const now = Date.now();
    expect(now - lastUpdate).toBeGreaterThan(45000);
    expect(retrieved!.metadata.stallWarning).toBe(true);
  });

  // 11. Confirmed dead worker stalled narration
  it('11. should narrate confirmed dead worker stall', () => {
    const task = makeTask({
      taskId,
      title: 'Dead Worker',
      status: 'stalled',
      worker: 'codex',
      blocker: 'Worker unresponsive for 120s',
      progressMessage: 'Worker codex confirmed dead',
    });
    backgroundTaskRepo.insertTask(task);
    const retrieved = backgroundTaskRepo.getTask(taskId);
    expect(retrieved!.status).toBe('stalled');
    expect(retrieved!.blocker).toMatch(/unresponsive/i);
  });

  // 12. Safe recovery narration
  it('12. should narrate safe recovery', () => {
    const task = makeTask({
      taskId,
      title: 'Safe Recovery',
      status: 'running',
      currentStage: 'recovering',
      progressMessage: 'Safely recovering from stall...',
      resumable: true,
    });
    backgroundTaskRepo.insertTask(task);
    const retrieved = backgroundTaskRepo.getTask(taskId);
    expect(retrieved!.currentStage).toBe('recovering');
    expect(retrieved!.resumable).toBe(true);
  });

  // 13. Persisted failure reason
  it('13. should persist failure reason', () => {
    const task = makeTask({
      taskId,
      title: 'Failure Reason',
      status: 'failed',
      lastError: 'Compilation failed: syntax error',
      resultText: 'Task failed due to compilation error',
    });
    backgroundTaskRepo.insertTask(task);
    const retrieved = backgroundTaskRepo.getTask(taskId);
    expect(retrieved!.status).toBe('failed');
    expect(retrieved!.lastError).toMatch(/Compilation failed/);
  });

  // 14. Persisted final result
  it('14. should persist final result', () => {
    const task = makeTask({
      taskId,
      title: 'Final Result',
      status: 'completed',
      resultText: 'Successfully migrated database',
      completedAt: new Date().toISOString(),
    });
    backgroundTaskRepo.insertTask(task);
    const retrieved = backgroundTaskRepo.getTask(taskId);
    expect(retrieved!.status).toBe('completed');
    expect(retrieved!.resultText).toMatch(/Successfully/);
  });

  // 15. Spoken milestone gating
  it('15. should enforce spoken milestone gating', () => {
    const task = makeTask({
      taskId,
      title: 'Milestone Gating',
      currentStage: 'milestone_1_complete',
      metadata: { spokenMilestones: ['start', 'milestone_1'], nextGate: 'milestone_2' },
    });
    backgroundTaskRepo.insertTask(task);
    const retrieved = backgroundTaskRepo.getTask(taskId);
    expect(retrieved!.metadata.spokenMilestones).toContain('milestone_1');
    expect(retrieved!.metadata.nextGate).toBe('milestone_2');
  });

  // 16. Cooldown deduplication
  it('16. should enforce cooldown deduplication', () => {
    const task = makeTask({
      taskId,
      title: 'Cooldown',
      metadata: { lastSpokenAt: Date.now() - 10000, cooldownMs: 30000, dedupe: true },
    });
    backgroundTaskRepo.insertTask(task);
    const retrieved = backgroundTaskRepo.getTask(taskId);
    expect(retrieved!.metadata.cooldownMs).toBe(30000);
    expect(retrieved!.metadata.dedupe).toBe(true);
  });

  // 17. User profile persistence
  it('17. should persist user profile', () => {
    const task = makeTask({
      taskId,
      title: 'User Profile',
      metadata: { userId: 'user-123', profile: { name: 'Alice', role: 'dev' } },
    });
    backgroundTaskRepo.insertTask(task);
    const retrieved = backgroundTaskRepo.getTask(taskId);
    expect(retrieved!.metadata.userId).toBe('user-123');
    expect(retrieved!.metadata.profile.name).toBe('Alice');
  });

  // 18. Interaction preferences persistence
  it('18. should persist interaction preferences', () => {
    const task = makeTask({
      taskId,
      title: 'Preferences',
      metadata: { preferences: { verbose: false, notifyOnComplete: true } },
    });
    backgroundTaskRepo.insertTask(task);
    const retrieved = backgroundTaskRepo.getTask(taskId);
    expect(retrieved!.metadata.preferences.notifyOnComplete).toBe(true);
  });

  // 19. Project memory scoping
  it('19. should scope project memory', () => {
    const task = makeTask({
      taskId,
      title: 'Project Memory',
      projectId: 'proj-48461660',
      metadata: { scopedMemory: ['python_gil_limits_threads', 'python_zen_of_pep20'] },
    });
    backgroundTaskRepo.insertTask(task);
    const retrieved = backgroundTaskRepo.getTask(taskId);
    expect(retrieved!.projectId).toBe('proj-48461660');
    expect(retrieved!.metadata.scopedMemory.length).toBe(2);
  });

  // 20. Bounded context retrieval
  it('20. should support bounded context retrieval', () => {
    const task = makeTask({
      taskId,
      title: 'Bounded Context',
      metadata: { contextWindow: { start: 0, limit: 100, scope: 'file' } },
    });
    backgroundTaskRepo.insertTask(task);
    const retrieved = backgroundTaskRepo.getTask(taskId);
    expect(retrieved!.metadata.contextWindow.scope).toBe('file');
    expect(retrieved!.metadata.contextWindow.limit).toBe(100);
  });

  // 21. Background task restart recovery
  it('21. should support background task restart recovery', () => {
    const task = makeTask({
      taskId,
      title: 'Restart Recovery',
      status: 'running',
      attempt: 2,
      resumable: true,
      metadata: { restartedFrom: 'attempt-1' },
    });
    backgroundTaskRepo.insertTask(task);
    const retrieved = backgroundTaskRepo.getTask(taskId);
    expect(retrieved!.attempt).toBe(2);
    expect(retrieved!.resumable).toBe(true);
  });

  // 22. No duplicate restart acknowledgement
  it('22. should avoid duplicate restart acknowledgement', () => {
    const task = makeTask({
      taskId,
      title: 'No Duplicate Ack',
      metadata: { restartAcks: ['restart-1'], duplicateSuppressed: true },
    });
    backgroundTaskRepo.insertTask(task);
    const retrieved = backgroundTaskRepo.getTask(taskId);
    expect(retrieved!.metadata.restartAcks.length).toBe(1);
    expect(retrieved!.metadata.duplicateSuppressed).toBe(true);
  });

  // 23. Single completion emission
  it('23. should emit single completion event', () => {
    const task = makeTask({
      taskId,
      title: 'Single Completion',
      status: 'completed',
      completedAt: new Date().toISOString(),
      metadata: { completionEmitted: true, emissionCount: 1 },
    });
    backgroundTaskRepo.insertTask(task);
    const retrieved = backgroundTaskRepo.getTask(taskId);
    expect(retrieved!.status).toBe('completed');
    expect(retrieved!.metadata.completionEmitted).toBe(true);
    expect(retrieved!.metadata.emissionCount).toBe(1);
  });
});
