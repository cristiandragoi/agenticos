import { describe, it, expect } from 'vitest';
import { classifyTaskControl } from '../services/backgroundTasks/taskControl.js';

/**
 * Phase 6 regression — new-task vs. existing-task lookup separation.
 *
 * A normal imperative engineering prompt must NEVER be hijacked into task
 * control. Only an explicit, ID-bearing (or short, unambiguous) control
 * command may route to lookup/pause/resume/stop/cancel/retry/approve.
 */
describe('classifyTaskControl — new-task vs. lookup separation (Phase 6)', () => {
  // 1. explicit existing task ID → lookup path
  it('explicit task-id reference routes to lookup', () => {
    expect(classifyTaskControl('show task T-ABC123')?.type).toBe('show_task');
    expect(classifyTaskControl('show task bgtask-123456789')?.type).toBe('show_task');
    expect(classifyTaskControl('show task pt-e80a87e3')?.type).toBe('show_task');
    expect(classifyTaskControl('resume task pt-123')?.type).toBe('resume_task');
  });

  // 2. explicit goal ID → lookup/resume path (not a new task)
  it('explicit goal-id reference routes to a lookup path', () => {
    expect(classifyTaskControl('what happened to goal-456')?.type).toBe('show_task');
    expect(classifyTaskControl('resume task goal-456')?.type).toBe('resume_task');
  });

  // 3. long engineering prompt → NEW TASK (must NOT be hijacked)
  it('a long engineering instruction is NOT task control', () => {
    const p = 'Inspect the restart recovery implementation and add a regression test ensuring a completed CodeX goal reconciles its parent task after restart. Do not modify unrelated files.';
    expect(classifyTaskControl(p)).toBeNull();
  });

  // 4. word "task" without an id → NEW TASK
  it('the word "task" without an identifier is NOT task control', () => {
    expect(classifyTaskControl('Fix the task that is stuck in the queue')).toBeNull();
    expect(classifyTaskControl('add a regression test for the parent task reconciliation')).toBeNull();
  });

  // 5. code symbols / file paths → NEW TASK
  it('code symbols and file paths are NOT task control', () => {
    expect(classifyTaskControl('inspect adapters.ts and add a test')).toBeNull();
    expect(classifyTaskControl('refactor server/src/services/goalStore.ts')).toBeNull();
  });

  // 6 + 7. multiline prompt with control words → full content preserved, not hijacked
  it('multiline engineering prompt with incidental control words is NOT hijacked', () => {
    const p = [
      'Implement the feature.',
      '- restart the service safely',
      '- ensure the parent task reconciles after restart',
      '- stop the loop on failure',
    ].join('\n');
    expect(classifyTaskControl(p)).toBeNull();
  });

  // 8. no fabricated task id from prose fragments ("t-", hyphenated words)
  it('does not fabricate a task id from prose fragments', () => {
    expect(classifyTaskControl('restart the t-restart recovery task')).toBeNull();
    // "run-time" / "task-force" style hyphenated words must not become refs
    expect(classifyTaskControl('stop the task-queue consumer')).toBeNull();
  });

  // preserve existing valid control behavior
  it('still classifies explicit control commands', () => {
    expect(classifyTaskControl('pause task T-ABC123')?.type).toBe('pause_task');
    expect(classifyTaskControl('stop task bgtask-1a2b3c')?.type).toBe('stop_task');
    expect(classifyTaskControl('cancel task pt-123')?.type).toBe('cancel_task');
    expect(classifyTaskControl('approve task T-ABC123')?.type).toBe('approve_task');
    expect(classifyTaskControl('show active tasks')?.type).toBe('list_tasks');
    expect(classifyTaskControl('what is Hermes doing')?.type).toBe('agent_status');
    expect(classifyTaskControl('open the task board')?.type).toBe('open_board');
    // short, unambiguous no-id commands still work
    expect(classifyTaskControl('resume task')?.type).toBe('resume_task');
    expect(classifyTaskControl('show tasks')?.type).toBe('list_tasks');
  });

  // normal conversation never classifies
  it('normal conversation never classifies as task control', () => {
    expect(classifyTaskControl('What model are you using?')).toBeNull();
    expect(classifyTaskControl('Ask Hermes to inspect the voice pipeline')).toBeNull();
    expect(classifyTaskControl('Tell me a joke')).toBeNull();
  });
});
