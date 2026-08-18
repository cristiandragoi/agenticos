/**
 * routineBridge.test.ts — canonical Routine foundation + schedule dispatcher
 * unit tests (no live worker execution; worker paths proven in packaged
 * acceptance tests).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { rawDb } from '../db/index.js';
import { routineRepo, type RoutineRecord } from '../services/routines/store.js';
import { dispatchScheduledExecution, type ScheduleFireRecord } from '../services/scheduler/scheduleDispatcher.js';

const PROJ = `proj-test-${randomUUID().slice(0, 6)}`;

function mkRoutine(overrides: Partial<RoutineRecord> = {}): RoutineRecord {
  const now = new Date().toISOString();
  return {
    routineId: `routine-${randomUUID()}`,
    projectId: PROJ,
    name: 'Test Routine',
    description: null,
    objective: 'Test objective',
    worker: 'hermes',
    taskTemplate: { objective: 'Test objective', worker: 'hermes', input: {} },
    scheduleId: null,
    enabled: true,
    memoryPolicy: { retrieveProjectMemory: true, allowCandidatePromotion: true },
    approvalPolicy: 'inherit_project_policy',
    verificationPolicy: 'required',
    retryPolicy: null,
    timeoutSeconds: 120,
    outputPolicy: null,
    createdAt: now,
    updatedAt: now,
    createdBy: null,
    ...overrides,
  };
}

describe('Routine bridge — store', () => {
  beforeAll(() => {
    routineRepo.ensureTables();
    // Ensure a project row exists for ownership checks.
    rawDb.prepare(`INSERT OR IGNORE INTO projects (id, name, status, created_at, updated_at) VALUES (?, 'Test', 'active', ?, ?)`)
      .run(PROJ, new Date().toISOString(), new Date().toISOString());
  });

  it('creates and reads a routine', () => {
    const r = mkRoutine();
    routineRepo.create(r);
    const got = routineRepo.get(r.routineId);
    expect(got).not.toBeNull();
    expect(got!.worker).toBe('hermes');
    expect(got!.taskTemplate.objective).toBe('Test objective');
    expect(got!.memoryPolicy.allowCandidatePromotion).toBe(true);
  });

  it('updates enabled flag and preserves identity', () => {
    const r = mkRoutine();
    routineRepo.create(r);
    const updated = routineRepo.update(r.routineId, { enabled: false });
    expect(updated!.enabled).toBe(false);
    expect(updated!.routineId).toBe(r.routineId);
  });

  it('lists routines and deletes', () => {
    const r = mkRoutine({ name: 'Listed Routine' });
    routineRepo.create(r);
    const before = routineRepo.list().some((x) => x.routineId === r.routineId);
    expect(before).toBe(true);
    routineRepo.delete(r.routineId);
    expect(routineRepo.get(r.routineId)).toBeNull();
  });

  it('records and reads schedule executions with full provenance', () => {
    const r = mkRoutine();
    routineRepo.create(r);
    const exec = {
      id: `sched-exec-${randomUUID()}`,
      scheduleId: `sched-${randomUUID()}`,
      routineId: r.routineId,
      projectId: PROJ,
      backgroundTaskId: 'bgtask-x',
      projectTaskId: 'pt-x',
      runId: 'er-x',
      resultId: 'exr-x',
      verificationId: 'ver-x',
      triggeredAt: new Date().toISOString(),
      triggerType: 'manual' as const,
      outcome: 'completed' as const,
      error: null,
    };
    routineRepo.recordExecution(exec);
    const listed = routineRepo.listExecutionsForRoutine(r.routineId);
    expect(listed.some((e) => e.id === exec.id)).toBe(true);
  });
});

describe('Routine bridge — dispatcher guard rails', () => {
  beforeAll(() => routineRepo.ensureTables());

  it('rejects a worker_task schedule with no projectId (no orphan runs)', async () => {
    const sched: ScheduleFireRecord = {
      id: `sched-${randomUUID()}`,
      taskId: 't-x',
      executionType: 'worker_task',
      routineId: null,
      worker: 'hermes',
      projectId: null,
      taskTemplate: { objective: 'x' },
      cronExpression: null,
      timezone: 'UTC',
      misfirePolicy: 'run_once',
      enabled: true,
    };
    const result = await dispatchScheduledExecution(sched, 'manual');
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe('dispatch_failed');
    expect(result.error).toMatch(/projectId/);
  });

  it('rejects an unsupported worker', async () => {
    const sched: ScheduleFireRecord = {
      id: `sched-${randomUUID()}`,
      taskId: 't-x',
      executionType: 'worker_task',
      routineId: null,
      worker: 'unknown_worker',
      projectId: PROJ,
      taskTemplate: { objective: 'x' },
      cronExpression: null,
      timezone: 'UTC',
      misfirePolicy: 'run_once',
      enabled: true,
    };
    const result = await dispatchScheduledExecution(sched, 'manual');
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe('dispatch_failed');
  });

  it('migrates legacy schedules: execution_type defaults to legacy_skill', () => {
    routineRepo.ensureTables();
    const cols = (rawDb.prepare('PRAGMA table_info(schedules)').all() as any[]).map((c) => c.name);
    expect(cols).toContain('execution_type');
    expect(cols).toContain('routine_id');
    expect(cols).toContain('worker');
    expect(cols).toContain('project_id');
  });
});
