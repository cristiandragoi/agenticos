/**
 * Explicit worker delegation inside the turn lifecycle — regression tests.
 *
 * The repair under test (already in HEAD): when the user explicitly asks for a worker ("Use CodeX
 * to ..."), the lifecycle's legacy handler routes the turn straight to the orchestrator —
 * EXACTLY ONE `handleMessage` call, one delegated goal — and never lets turnRouter answer first
 * with a generic fallback.
 *
 * These tests run the REAL TurnLifecycleController, the REAL legacy handler (with the REAL
 * `detectDelegationSignals`) and a REAL SQLite lifecycle store. Only the outside world is replaced:
 * the orchestrator (it plays "the worker dispatcher": it reports the goal it created), turnRouter
 * (it must never run for an explicit delegation), the planner LLM and the conversation store.
 *
 * Nothing here matches on a particular user phrase in the code under test; the phrases are only
 * the inputs.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

const world = vi.hoisted(() => ({
  orchestrator: null as null | ((args: any[]) => Promise<any>),
  handleMessage: vi.fn(),
  routeTurn: vi.fn(),
}));

vi.mock('../../../utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../../services/llmGateway.js', () => ({ llmChat: vi.fn() }));
vi.mock('../../conversations/service.js', () => ({
  conversationService: {
    getConversation: vi.fn(async () => ({ id: 'ctx' })),
    createConversation: vi.fn(async () => 'ctx'),
    getMessages: vi.fn(async () => []),
    appendMessage: vi.fn(async (m: any) => ({ id: 'm', ...m })),
  },
}));
vi.mock('../../../services/workspaceStore.js', () => ({ getWorkspaceRoot: () => 'B:\\AgenticOS' }));
vi.mock('../../jarvis/orchestrator.js', () => ({ jarvisOrchestrator: { handleMessage: world.handleMessage } }));
vi.mock('../../jarvisNext/turnRouter.js', () => ({ routeTurn: world.routeTurn }));

import { rawDb } from '../../../db/index.js';
import { llmChat } from '../../../services/llmGateway.js';
import { turnLifecycle } from '../index.js';
import { ensureTurnLifecycleTables } from '../store.js';

/** The planner classifies the request as an action no native executor owns (`other`). */
function planAsLegacyAction() {
  vi.mocked(llmChat).mockResolvedValue({
    reply: JSON.stringify({ kind: 'action', summary: 'Delegate the request', continuesPrevious: false, action: { type: 'other' } }),
    provider: 'test',
  } as any);
}

beforeAll(() => {
  ensureTurnLifecycleTables();
});

beforeEach(() => {
  planAsLegacyAction();
  rawDb.exec('DELETE FROM turn_lifecycle; DELETE FROM turn_lifecycle_events;');
  world.orchestrator = async () => ({ route: 'codex', status: 'queued', goalId: 'goal-one' });
  world.handleMessage.mockReset();
  world.handleMessage.mockImplementation(async (...args: any[]) => world.orchestrator!(args));
  world.routeTurn.mockReset();
  world.routeTurn.mockImplementation(async () => ({ handled: false }));
});

afterEach(() => {
  vi.mocked(llmChat).mockReset();
});

describe('explicit worker delegation takes the lifecycle fast-path', () => {
  it('creates exactly ONE delegated goal: one orchestrator call, turnRouter never consulted', async () => {
    const res = await turnLifecycle.submit({ source: 'typed_chat', conversationId: 'conv-codex', text: 'Use CodeX to inspect the Jarvis router.' });

    expect(res.duplicate).toBe(false);
    expect(world.handleMessage).toHaveBeenCalledTimes(1);
    expect(world.routeTurn).not.toHaveBeenCalled();

    const [, text, workspace, mode, operationId] = world.handleMessage.mock.calls[0];
    expect(text).toBe('Use CodeX to inspect the Jarvis router.');
    expect(workspace).toBe('B:\\AgenticOS');
    expect(mode).toBe('manual');
    // the lifecycle's request id is the operation id: the goal can be traced back to this turn
    expect(operationId).toBe(res.duplicate === false ? res.record.request.requestId : undefined);

    if (res.duplicate) throw new Error('unexpected duplicate');
    const receipt = res.record.receipt!;
    expect(receipt.executor).toBe('legacy.jarvisOrchestrator:codex');
    expect(receipt.attempted).toBe(true);
    expect(receipt.details.goalId).toBe('goal-one');
    expect(receipt.details.status).toBe('queued');
  });

  it('never reports a delegated goal as VERIFIED (the legacy dispatcher cannot prove the work happened)', async () => {
    const res = await turnLifecycle.submit({ source: 'typed_chat', conversationId: 'conv-codex-outcome', text: 'Use CodeX to inspect the Jarvis router.' });
    if (res.duplicate) throw new Error('unexpected duplicate');
    expect(res.record.outcome).toBe('EXECUTED_UNVERIFIED');
    expect(res.record.responseText || '').not.toMatch(/^Done/);
  });

  it('a duplicate delivery of the same request adds NO second goal', async () => {
    const first = await turnLifecycle.submit({ source: 'typed_chat', conversationId: 'conv-codex-dup', text: 'Use CodeX to inspect the Jarvis router.', externalTurnId: 'op-dup-1' });
    const second = await turnLifecycle.submit({ source: 'typed_chat', conversationId: 'conv-codex-dup', text: 'Use CodeX to inspect the Jarvis router.', externalTurnId: 'op-dup-1' });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(world.handleMessage).toHaveBeenCalledTimes(1);
  });

  it('an orchestrator failure is a FAILED turn after ONE call — the lifecycle never loops on it', async () => {
    world.orchestrator = async () => ({ route: 'codex', status: 'failed', error: 'CodeX received an invalid response from the model after one retry.' });

    const res = await turnLifecycle.submit({ source: 'typed_chat', conversationId: 'conv-codex-fail', text: 'Use CodeX to inspect the Jarvis router.' });
    if (res.duplicate) throw new Error('unexpected duplicate');

    expect(res.record.outcome).toBe('FAILED');
    expect(res.record.receipt!.completedWithoutError).toBe(false);
    expect(world.handleMessage).toHaveBeenCalledTimes(1);
    expect(world.routeTurn).not.toHaveBeenCalled();
  });

  it('a thrown orchestrator error is reported as a failed receipt, not swallowed as success', async () => {
    world.orchestrator = async () => { throw new Error('worker registry unavailable'); };

    const res = await turnLifecycle.submit({ source: 'typed_chat', conversationId: 'conv-codex-throw', text: 'Use CodeX to inspect the Jarvis router.' });
    if (res.duplicate) throw new Error('unexpected duplicate');

    expect(res.record.outcome).toBe('FAILED');
    expect(res.record.receipt!.error).toMatch(/orchestrator_delegation_error/);
    expect(world.handleMessage).toHaveBeenCalledTimes(1);
  });
});

describe('the fast-path is only for explicit delegation', () => {
  it('a plain request still goes to turnRouter first', async () => {
    world.routeTurn.mockImplementation(async () => ({ handled: true, text: 'Here is the answer.', route: 'direct', executed: false }));

    const res = await turnLifecycle.submit({ source: 'typed_chat', conversationId: 'conv-plain', text: 'what is on my calendar today' });
    if (res.duplicate) throw new Error('unexpected duplicate');

    expect(world.routeTurn).toHaveBeenCalledTimes(1);
    expect(world.handleMessage).not.toHaveBeenCalled();
    expect(res.record.receipt!.executor).toBe('legacy.turnRouter:direct');
  });

  it('an explicit prohibition ("do not use CodeX") does not delegate', async () => {
    world.orchestrator = async () => ({ route: 'direct', status: 'completed', message: 'The router decides which handler owns a turn.' });

    const res = await turnLifecycle.submit({ source: 'typed_chat', conversationId: 'conv-prohibit', text: 'Do not use CodeX. Answer directly: what does the router do?' });
    if (res.duplicate) throw new Error('unexpected duplicate');

    // turnRouter is consulted first (it declines in this fixture); the orchestrator then runs once as the
    // generic fallback and answers directly - no delegated goal.
    expect(world.routeTurn).toHaveBeenCalledTimes(1);
    expect(world.handleMessage).toHaveBeenCalledTimes(1);
    expect(res.record.receipt!.executor).toBe('legacy.jarvisOrchestrator:direct');
    expect(res.record.receipt!.details.goalId).toBeNull();
  });
});
