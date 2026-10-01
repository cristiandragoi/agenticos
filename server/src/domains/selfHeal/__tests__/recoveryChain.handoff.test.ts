/**
 * Recursive SELFHEAL redispatch — engineering HANDOFF bounds.
 *
 * "One user failure cannot generate hundreds of Antigravity handoffs."
 *
 * Two layers are proven here:
 *  1. the registry's handoff admission (per chain, per root operation, per failure fingerprint per
 *     window, global circuit breaker, terminal chains);
 *  2. the single funnel every handoff goes through (EngineeringDelegationService.delegateTask): a
 *     handoff that belongs to a recovery chain — explicitly or because it is made from inside recovery
 *     work — is admitted BEFORE any worker task exists, so a refused handoff creates no task and
 *     dispatches nothing.
 *
 * Independent / explicit user delegation (no recovery chain) is not throttled by this guard.
 * Nothing here matches on user phrases.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

vi.mock('../../../utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../../services/backgroundTasks/adapters.js', () => ({
  dispatchTask: vi.fn(async () => undefined),
  clearDispatchGuard: vi.fn(),
}));

import { rawDb } from '../../../db/index.js';
import { runWithTurnOwnership } from '../../jarvis/perception/turnOwnership.js';
import { runWithRecoveryContext } from '../recoveryContext.js';
import { engineeringDelegationService } from '../../controlPlane/EngineeringDelegationService.js';
import { backgroundTaskManager } from '../../../services/backgroundTasks/manager.js';
import { dispatchTask } from '../../../services/backgroundTasks/adapters.js';
import { failureDetector } from '../FailureDetector.js';
import * as chains from '../recoveryChain.js';

/** Open ONE active chain for `root` through the real incident admission (an ownership frame is needed only for the sync admission). */
function openChainSync(opts: { root: string; target?: string; failureClass?: string }): string {
  let chainId = '';
  // runWithTurnOwnership returns the callback's promise; the admission itself runs synchronously inside it.
  void runWithTurnOwnership({ conversationId: `conv-${opts.root}`, turnId: Date.now(), operationId: opts.root }, async () => {
    const res = failureDetector.raiseIncident({
      component: 'cap.engineering',
      symptom: 'needs engineering',
      failureDomain: 'backend',
      priority: 'high',
      metadata: { failureClass: opts.failureClass ?? 'executor_error', target: opts.target ?? 'thing' },
    });
    if (!res.admitted) throw new Error(`test setup: chain not admitted (${res.reason})`);
    chainId = res.chainId!;
  });
  if (!chainId) throw new Error('test setup: admission did not run synchronously');
  return chainId;
}

const taskRows = () => rawDb.prepare("SELECT task_id AS id FROM background_tasks WHERE title LIKE 'handoff-test%'").all() as Array<{ id: string }>;

beforeAll(() => {
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS repair_incidents (
      id TEXT PRIMARY KEY, goal_id TEXT, status TEXT NOT NULL, component TEXT NOT NULL,
      failure_domain TEXT NOT NULL, symptom TEXT NOT NULL, detected_at TEXT NOT NULL,
      resolved_at TEXT, triggered_by TEXT NOT NULL, priority TEXT NOT NULL, metadata TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS repair_evidence (
      id TEXT PRIMARY KEY, incident_id TEXT NOT NULL, type TEXT NOT NULL, label TEXT NOT NULL,
      content TEXT NOT NULL, source TEXT NOT NULL, timestamp TEXT NOT NULL
    );
  `);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

beforeEach(() => {
  chains.__resetRecoveryChainsForTests();
  rawDb.exec('DELETE FROM repair_incidents; DELETE FROM repair_evidence;');
  vi.mocked(dispatchTask).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

/* ───────────────────────── registry admission ───────────────────────── */

describe('handoff admission (registry)', () => {
  it('per chain: the first handoff is admitted, every further one is refused', () => {
    const chainId = openChainSync({ root: 'op-h1' });
    const first = chains.admitHandoff({ chainId, worker: 'antigravity' });
    expect(first.admit).toBe(true);
    for (let i = 0; i < 25; i++) {
      const again = chains.admitHandoff({ chainId, worker: 'antigravity' });
      expect(again.admit).toBe(false);
      expect((again as any).reason).toBe('chain_handoff_cap');
    }
    expect(chains.listHandoffs(chainId)).toHaveLength(1);
  });

  it('per root operation: a second chain of the same operation cannot hand off again, and is closed BLOCKED', () => {
    const a = openChainSync({ root: 'op-h2', target: 'alpha' });
    const b = openChainSync({ root: 'op-h2', target: 'beta' });
    expect(chains.admitHandoff({ chainId: a, worker: 'antigravity' }).admit).toBe(true);
    const second = chains.admitHandoff({ chainId: b, worker: 'antigravity' });
    expect(second.admit).toBe(false);
    expect((second as any).reason).toBe('root_handoff_cap');
    expect(chains.getChain(b)!.state).toBe('BLOCKED');
    expect(chains.listHandoffs()).toHaveLength(1);
  });

  it('per failure fingerprint per window: the same (class, target) from different operations hands off once per hour', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
    const a = openChainSync({ root: 'op-h3a', target: 'same-target' });
    const b = openChainSync({ root: 'op-h3b', target: 'same-target' });
    expect(chains.admitHandoff({ chainId: a, worker: 'antigravity' }).admit).toBe(true);

    vi.setSystemTime(new Date('2026-10-01T12:01:00Z'));
    const refused = chains.admitHandoff({ chainId: b, worker: 'antigravity' });
    expect(refused.admit).toBe(false);
    expect((refused as any).reason).toBe('fingerprint_recent');

    // After the window a genuinely new failure of that fingerprint may hand off again.
    vi.setSystemTime(new Date('2026-10-01T13:00:30Z'));
    const c = openChainSync({ root: 'op-h3c', target: 'same-target' });
    expect(chains.admitHandoff({ chainId: c, worker: 'antigravity' }).admit).toBe(true);
    expect(chains.listHandoffs()).toHaveLength(2);
  });

  it('global circuit breaker: at most globalMaxHandoffs across ALL chains per window', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = Date.parse('2026-10-01T12:00:00Z');
    vi.setSystemTime(t0);
    const max = chains.recoveryChainConfig().globalMaxHandoffs;
    const admitted: boolean[] = [];
    for (let i = 0; i < max + 4; i++) {
      vi.setSystemTime(t0 + i * 1000);
      const id = openChainSync({ root: `op-h4-${i}`, target: `target-${i}` });
      admitted.push(chains.admitHandoff({ chainId: id, worker: 'antigravity' }).admit);
    }
    expect(admitted.filter(Boolean)).toHaveLength(max);
    expect(chains.listHandoffs()).toHaveLength(max);

    // Once the window has passed the breaker closes again.
    vi.setSystemTime(t0 + chains.recoveryChainConfig().globalWindowMs + 60_000);
    const later = openChainSync({ root: 'op-h4-later', target: 'target-later' });
    expect(chains.admitHandoff({ chainId: later, worker: 'antigravity' }).admit).toBe(true);
  });

  it('a terminal chain cannot hand off; an unknown chain cannot hand off', () => {
    const chainId = openChainSync({ root: 'op-h5' });
    chains.closeChain(chainId, 'FAILED', 'test_terminal');
    const terminal = chains.admitHandoff({ chainId, worker: 'antigravity' });
    expect(terminal.admit).toBe(false);
    expect((terminal as any).reason).toBe('chain_terminal');
    const unknown = chains.admitHandoff({ chainId: 'rc-does-not-exist', worker: 'antigravity' });
    expect(unknown.admit).toBe(false);
    expect((unknown as any).reason).toBe('unknown_chain');
    expect(chains.listHandoffs()).toHaveLength(0);
  });
});

/* ───────────────────────── the delegation funnel ───────────────────────── */

describe('delegateTask funnel: one failure -> at most one worker task', () => {
  const delegate = (title: string, extra: Record<string, unknown> = {}) =>
    engineeringDelegationService.delegateTask({
      objective: title,
      workspacePath: 'D:\\AgenticOS',
      conversationId: null as any,
      worker: 'antigravity',
      ...extra,
    } as any);

  it('50 handoff attempts from inside recovery work create exactly ONE task and dispatch ONCE', async () => {
    const chainId = openChainSync({ root: 'op-f1' });
    const ctx = { chainId, rootOperationId: 'op-f1', attempt: 1, origin: 'self_heal_retry' as const };

    const results = await runWithRecoveryContext(ctx, async () => {
      const out = [];
      for (let i = 0; i < 50; i++) out.push(await delegate(`handoff-test f1 attempt ${i}`));
      return out;
    });

    const created = results.filter((r) => r.taskId);
    const refused = results.filter((r) => !r.taskId);
    expect(created).toHaveLength(1);
    expect(refused).toHaveLength(49);
    for (const r of refused) {
      expect(r.success).toBe(false);
      expect(r.accepted).toBe(false);
      expect(r.status).toBe('blocked');
      expect(r.message).toMatch(/refused by the recovery guard/);
    }
    expect(dispatchTask).toHaveBeenCalledTimes(1);
    expect(taskRows()).toHaveLength(1);

    const handoffs = chains.listHandoffs(chainId);
    expect(handoffs).toHaveLength(1);
    expect(handoffs[0].taskId).toBe(created[0].taskId);
    expect(chains.getChain(chainId)!.handoffCount).toBe(1);
  });

  it('an explicit recoveryChainId on the input binds the handoff to the chain (no ambient context needed)', async () => {
    const chainId = openChainSync({ root: 'op-f2' });
    const results = await Promise.all(Array.from({ length: 10 }, (_v, i) => delegate(`handoff-test f2 attempt ${i}`, { recoveryChainId: chainId })));
    expect(results.filter((r) => r.taskId)).toHaveLength(1);
    expect(dispatchTask).toHaveBeenCalledTimes(1);
    expect(chains.listHandoffs(chainId)).toHaveLength(1);
  });

  it('a refused handoff leaves the chain intact; the single admitted task carries the chain identity', async () => {
    const chainId = openChainSync({ root: 'op-f3' });
    const first = await delegate('handoff-test f3 a', { recoveryChainId: chainId, incidentId: 'SELFHEAL-F3', originalUserInput: 'the original request' });
    expect(first.taskId).toBeTruthy();
    const task = backgroundTaskManager.getTask(first.taskId)!;
    expect((task.metadata as any).recoveryChainId).toBe(chainId);
    expect((task.metadata as any).incidentId).toBe('SELFHEAL-F3');
    expect((task.metadata as any).originalUserInput).toBe('the original request');
    await delegate('handoff-test f3 b', { recoveryChainId: chainId });
    expect(chains.getChain(chainId)!.state).toBe('ACTIVE');
  });

  it('independent failures still get their own handoff (different operations, different targets)', async () => {
    const a = openChainSync({ root: 'op-f4a', target: 'target-a' });
    const b = openChainSync({ root: 'op-f4b', target: 'target-b' });
    const ra = await delegate('handoff-test f4 a', { recoveryChainId: a });
    const rb = await delegate('handoff-test f4 b', { recoveryChainId: b });
    expect(ra.taskId).toBeTruthy();
    expect(rb.taskId).toBeTruthy();
    expect(ra.taskId).not.toBe(rb.taskId);
    expect(dispatchTask).toHaveBeenCalledTimes(2);
  });

  it('explicit user delegation (no recovery chain, no recovery context) is NOT throttled by the guard', async () => {
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await delegate(`handoff-test f5 explicit ${i}`));
    expect(results.every((r) => r.success && r.taskId)).toBe(true);
    expect(new Set(results.map((r) => r.taskId)).size).toBe(4);
    expect(dispatchTask).toHaveBeenCalledTimes(4);
    expect(chains.listHandoffs()).toHaveLength(0);
  });

  it('a handoff on a chain that already ended is refused without creating a task', async () => {
    const chainId = openChainSync({ root: 'op-f6' });
    chains.closeChain(chainId, 'BLOCKED', 'ownership_rejected_on_retry');
    const before = taskRows().length;
    const res = await delegate('handoff-test f6', { recoveryChainId: chainId });
    expect(res.taskId).toBe('');
    expect(res.status).toBe('blocked');
    expect(taskRows().length).toBe(before);
    expect(dispatchTask).not.toHaveBeenCalled();
  });
});

