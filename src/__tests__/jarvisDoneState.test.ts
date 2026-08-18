// Regression: stream `done` events for synchronous terminal conversation
// routes (memory_store / memory_recall / decision_statement / continuation /
// project_state_answer) must classify as COMPLETED so the composer is
// released. Before the fix, routes without a delegation status fell through
// to 'executing' and the composer stayed disabled forever — the user-facing
// "Jarvis does not respond at all" symptom.
import { describe, expect, it } from 'vitest';
import { classifyDoneState } from '../components/jarvis/JarvisChat';

describe('classifyDoneState', () => {
  it('classifies direct replies as completed', () => {
    expect(classifyDoneState({ route: 'direct' })).toBe('completed');
  });

  it('classifies memory_store as completed (the empty-response/composer-lock regression)', () => {
    expect(classifyDoneState({ route: 'memory_store' })).toBe('completed');
  });

  it('classifies memory_recall, decision_statement, continuation and project_state_answer as completed', () => {
    expect(classifyDoneState({ route: 'memory_recall' })).toBe('completed');
    expect(classifyDoneState({ route: 'decision_statement' })).toBe('completed');
    expect(classifyDoneState({ route: 'continuation' })).toBe('completed');
    expect(classifyDoneState({ route: 'project_state_answer' })).toBe('completed');
  });

  it('classifies clarification_required as completed', () => {
    expect(classifyDoneState({ route: 'clarification_required' })).toBe('completed');
  });

  it('classifies a synchronous investigate reply (no status) as completed', () => {
    expect(classifyDoneState({ route: 'investigate' })).toBe('completed');
  });

  it('keeps real delegations executing until they report completion', () => {
    expect(classifyDoneState({ route: 'codex', status: 'running' })).toBe('executing');
    expect(classifyDoneState({ route: 'hermes', status: 'queued' })).toBe('executing');
    expect(classifyDoneState({ route: 'investigate', status: 'running' })).toBe('executing');
  });

  it('maps delegation terminal statuses to their runtime states', () => {
    expect(classifyDoneState({ route: 'codex', status: 'completed' })).toBe('completed');
    expect(classifyDoneState({ route: 'codex', status: 'failed' })).toBe('error');
    expect(classifyDoneState({ route: 'codex', status: 'paused' })).toBe('paused');
    expect(classifyDoneState({ route: 'codex', status: 'waiting_for_approval' })).toBe('approval_required');
  });
});
