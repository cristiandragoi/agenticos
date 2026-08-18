import { describe, it, expect, beforeEach } from 'vitest';
import * as exec from '../services/executionState.js';

describe('canonical execution state machine', () => {
  beforeEach(() => exec.clearExecutions());

  it('begin creates ONE current record; a newer operation supersedes the old', () => {
    exec.begin({ operationId: 'op-a', worker: 'jarvis', status: 'ROUTING', currentAction: 'routing' });
    expect(exec.getCurrent()?.operationId).toBe('op-a');
    exec.begin({ operationId: 'op-b', worker: 'codex', status: 'PLANNING' });
    expect(exec.getCurrent()?.operationId).toBe('op-b');
    const superseded = exec.get('op-a');
    expect(superseded?.endedAt).not.toBeNull();
    expect(superseded?.note).toContain('Superseded');
  });

  it('update refreshes the current record + lastActivityAt', async () => {
    exec.begin({ operationId: 'op-a', worker: 'jarvis', status: 'ROUTING' });
    const before = exec.getCurrent()!.lastActivityAt;
    await new Promise((r) => setTimeout(r, 5));
    exec.update('op-a', { status: 'WAITING_FOR_MODEL', currentAction: 'Waiting for openrouter' });
    const rec = exec.getCurrent()!;
    expect(rec.status).toBe('WAITING_FOR_MODEL');
    expect(rec.currentAction).toBe('Waiting for openrouter');
    expect(rec.lastActivityAt).toBeGreaterThanOrEqual(before);
  });

  it('end moves the record to history + clears current', () => {
    exec.begin({ operationId: 'op-a', worker: 'hermes', status: 'DISPATCHING', cancel: { kind: 'task', id: 'bgtask-x' } });
    exec.end('op-a', 'COMPLETED', '5 leads found');
    expect(exec.getCurrent()).toBeNull();
    expect(exec.get('op-a')?.status).toBe('COMPLETED');
    expect(exec.get('op-a')?.result).toBe('5 leads found');
    expect(exec.snapshot().history[0].operationId).toBe('op-a');
  });

  it('cancel sets STOPPING and dispatches the cancel action', async () => {
    exec.begin({ operationId: 'op-a', worker: 'codex', status: 'WAITING_FOR_MODEL', cancel: { kind: 'goal', id: 'goal-1' } });
    let dispatched: string | null = null;
    await exec.cancel('op-a', async (c) => { dispatched = `${c.kind}:${c.id}`; });
    expect(dispatched).toBe('goal:goal-1');
    expect(exec.getCurrent()?.status).toBe('STOPPING');
  });

  it('no active operation → current null + empty history', () => {
    expect(exec.getCurrent()).toBeNull();
    expect(exec.snapshot().history).toEqual([]);
  });
});

describe('continuation routing (P7 — uses recent context, not phrase lists)', () => {
  it('routes "So right now, Jarvis is still…" to investigate when context is a malfunction', async () => {
    const router = await import('../domains/jarvis/intentRouter.js');
    const result = await router.intentRouter.routeIntent('So right now, Jarvis is still showing the wrong model in the header.', 'Jarvis, the model display is wrong. It shows agentic-os / registry but the actual model is different. It is still not working.');
    expect(result.route).toBe('investigate');
  });

  it('does not misroute the same cue without a malfunction context', async () => {
    const router = await import('../domains/jarvis/intentRouter.js');
    const result = await router.intentRouter.routeIntent("It's just sitting there.", 'What time does the train leave?');
    expect(result.route).not.toBe('investigate');
  });
});

describe('WAITING_FOR_USER (conversation-state milestone)', () => {
  beforeEach(() => exec.clearExecutions());

  it('a clarification keeps the record current in WAITING_FOR_USER until the user replies', () => {
    exec.begin({ operationId: 'op-clarify', worker: 'jarvis', status: 'ROUTING', currentAction: 'Routing request' });
    exec.update('op-clarify', { status: 'WAITING_FOR_USER', currentAction: 'Clarification required — waiting for your reply', resolvedProvider: null, resolvedModel: null });
    const rec = exec.getCurrent();
    expect(rec?.status).toBe('WAITING_FOR_USER');
    expect(rec?.endedAt).toBeNull();
    expect(rec?.resolvedProvider).toBeNull();
  });

  it('the user reply begins a NEW stream: WAITING_FOR_USER is superseded (never last-writer-wins)', () => {
    exec.begin({ operationId: 'op-clarify', worker: 'jarvis', status: 'WAITING_FOR_USER' });
    exec.begin({ operationId: 'op-reply', worker: 'jarvis', status: 'ROUTING', currentAction: 'Routing request' });
    expect(exec.getCurrent()?.operationId).toBe('op-reply');
    expect(exec.getCurrent()?.status).toBe('ROUTING');
    const waiting = exec.get('op-clarify');
    expect(waiting?.endedAt).not.toBeNull();
    expect(waiting?.note).toContain('Superseded');
  });
});

describe('updateRecord (memory milestone — counts reach history records)', () => {
  beforeEach(() => exec.clearExecutions());

  it('patches a record that has been superseded into history (task progress still lands)', () => {
    exec.begin({ operationId: 'op-rev', worker: 'revenue', status: 'RUNNING', currentAction: 'Discovering prospects' });
    // Another stream supersedes the revenue op in the current slot.
    exec.begin({ operationId: 'op-chat', worker: 'jarvis', status: 'ROUTING' });
    expect(exec.getCurrent()?.operationId).toBe('op-chat');
    // The count mirror now reaches the revenue record even though it is history.
    const updated = exec.updateRecord('op-rev', { qualifiedCount: 8, discoveredCount: 13, targetCount: 10 });
    expect(updated?.qualifiedCount).toBe(8);
    expect(exec.get('op-rev')?.qualifiedCount).toBe(8);
    expect(exec.getCurrent()?.operationId).toBe('op-chat'); // current untouched
  });

  it('still updates the current record when it is the current one', () => {
    exec.begin({ operationId: 'op-rev', worker: 'revenue', status: 'RUNNING' });
    const updated = exec.updateRecord('op-rev', { qualifiedCount: 5 });
    expect(updated?.qualifiedCount).toBe(5);
    expect(exec.getCurrent()?.qualifiedCount).toBe(5);
  });

  it('returns null for an unknown operationId', () => {
    expect(exec.updateRecord('op-missing', { qualifiedCount: 1 })).toBeNull();
  });
});
