/**
 * Recursive SELFHEAL redispatch — the AutonomousRecoveryEngine path.
 *
 * The engine is the second place that used to mint a new incident and a new engineering handoff for
 * every failure it saw (`SELFHEAL-<last 4 digits of the clock>`, then `delegateTask`), including
 * failures that happened INSIDE the retry of an earlier repair. These tests run the REAL engine, the
 * REAL goal lifecycle, the REAL FailureDetector / recovery-chain registry and a REAL SQLite database.
 * Only the engineering handoff itself (`delegateTask`, "start a worker window") and the spoken
 * announcements are replaced, so a test can count exactly how many handoffs one failure produced.
 *
 * Identity is (root operation = goal run, failure class, target). Nothing here matches on user phrases.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { rawDb } from '../../../db/index.js';
import { autonomousRecoveryEngine } from '../../controlPlane/AutonomousRecoveryEngine.js';
import { goalLifecycleManager } from '../../controlPlane/GoalLifecycle.js';
import { engineeringDelegationService } from '../../controlPlane/EngineeringDelegationService.js';
import { speechArbiter } from '../../jarvisNext/speechArbiter.js';
import { runWithRecoveryContext } from '../recoveryContext.js';
import { runWithTurnOwnership } from '../../jarvis/perception/turnOwnership.js';
import { failureDetector } from '../FailureDetector.js';
import * as chains from '../recoveryChain.js';
import type { GoalAttempt } from '../../controlPlane/types.js';

const REPAIR_ENV = 'AGENTICOS_AUTONOMOUS_ENGINEERING_REPAIR';

let savedRepairEnv: string | undefined;
let seq = 0;

function incidentRows(): any[] {
  return rawDb.prepare('SELECT * FROM repair_incidents ORDER BY detected_at, id').all() as any[];
}

function startGoal(text: string, target: string) {
  seq += 1;
  return goalLifecycleManager.startGoal({
    conversationId: `engine-conv-${seq}`,
    turnId: String(seq),
    userInput: text,
    normalizedGoal: text,
    target,
  });
}

function failedAttempt(target: string, error: string): GoalAttempt {
  const t = new Date().toISOString();
  return { attemptNumber: 1, strategy: 'test.strategy', surface: 'desktop', target, startedAt: t, completedAt: t, executed: false, verified: false, evidence: [], error };
}

function failure(goalId: string, target: string, error = 'postcondition not observed') {
  return {
    goalId,
    failedAttempt: failedAttempt(target, error),
    target,
    goalType: 'open',
    verb: 'open',
    entityId: target,
    executeStrategy: async () => ({ executed: true }),
  };
}

/** What a refused engineering handoff looks like (the funnel refuses; no worker task exists). */
const refusedHandoff = (message = 'refused by the test') => ({
  success: false, taskId: '', worker: 'antigravity', status: 'blocked', accepted: false, hasWorkerAccepted: false,
  objective: '', workspace: 'D:\\AgenticOS', message,
}) as any;

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

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
});

beforeEach(() => {
  savedRepairEnv = process.env[REPAIR_ENV];
  process.env[REPAIR_ENV] = '1';
  chains.__resetRecoveryChainsForTests();
  chains.configureRecoveryChains({ retryBackoffBaseMs: 0 });
  rawDb.exec('DELETE FROM repair_incidents; DELETE FROM repair_evidence;');
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  speechArbiter.register({
    speakFn: async () => undefined,
    getCurrentTurnId: () => 1,
    isUserTurnActive: () => true,
  });
});

afterEach(() => {
  if (savedRepairEnv === undefined) delete process.env[REPAIR_ENV];
  else process.env[REPAIR_ENV] = savedRepairEnv;
  vi.restoreAllMocks();
});

describe('AutonomousRecoveryEngine: recovery work never starts another recovery', () => {
  it.each([
    ['repair enabled', '1'],
    ['repair disabled (the Phase 1 default)', undefined],
  ])('%s: the retry of an earlier failure fails again -> it is recorded on its chain and opens nothing', async (_name, envValue) => {
    // The ORIGINAL failure: a user operation fails and the registry opens the one chain + incident for it.
    const original = startGoal('open the quarterly dashboard', 'dashboard');
    const raised = failureDetector.raiseIncident({
      component: 'jarvis.capability.open.dashboard',
      symptom: 'the action failed',
      failureDomain: 'backend',
      priority: 'high',
      metadata: { goalId: original.goalId, rootOperationId: original.goalId, target: 'dashboard', error: 'postcondition not observed', originalText: original.originalUserInput },
    });
    expect(raised.admitted).toBe(true);
    if (!raised.admitted) throw new Error('unreachable');
    expect(incidentRows()).toHaveLength(1);

    if (envValue === undefined) delete process.env[REPAIR_ENV]; else process.env[REPAIR_ENV] = envValue;
    const delegate = vi.spyOn(engineeringDelegationService, 'delegateTask').mockResolvedValue(refusedHandoff());

    // The self-heal RETRY of that request is a new goal run. It fails the same way and reaches the engine.
    const retry = startGoal('open the quarterly dashboard', 'dashboard');
    const outcome = await runWithRecoveryContext(
      { chainId: raised.chainId, rootOperationId: original.goalId, incidentId: raised.incidentId, attempt: 1, origin: 'self_heal_retry' },
      () => autonomousRecoveryEngine.handleFailure(failure(retry.goalId, 'dashboard')),
    );

    expect(outcome.success).toBe(false);
    expect(outcome.status).toBe('FAILED_EXHAUSTED');
    expect(outcome.finalResponseText).toMatch(/did not start another repair/);
    expect(delegate).not.toHaveBeenCalled();
    expect(incidentRows()).toHaveLength(1);
    expect(chains.listHandoffs(raised.chainId)).toHaveLength(0);

    // ...but it IS accounted for on the chain, so the chain can end instead of looping.
    const chain = chains.getChain(raised.chainId)!;
    expect(chain.state).toBe('ACTIVE');
    expect(chain.suppressedCount).toBe(1);
    expect(chains.listChainEvents(raised.chainId).map((e) => e.kind)).toContain('recovery_signal_suppressed');
  });
});

describe('AutonomousRecoveryEngine: one failure produces at most one incident and one handoff', () => {
  it('a duplicate failure signal for the same goal while the first is active opens nothing and hands off nothing', async () => {
    const goal = startGoal('open the quarterly dashboard', 'dashboard');
    const gate = deferred();
    const delegate = vi.spyOn(engineeringDelegationService, 'delegateTask').mockImplementation(async () => {
      await gate.promise;
      return refusedHandoff('worker unavailable');
    });

    // Safety net only: if a regression let the duplicates through they would park in the handoff too, so
    // the gate is released by a timer and the assertions below fail fast instead of hanging until the
    // test timeout. Correct code never waits for it: the duplicates return before any timer can fire.
    const safetyNet = setTimeout(() => gate.resolve(), 250);

    const first = autonomousRecoveryEngine.handleFailure(failure(goal.goalId, 'dashboard'));
    // The first call has admitted its incident synchronously and is now parked inside the handoff.
    const second = await autonomousRecoveryEngine.handleFailure(failure(goal.goalId, 'dashboard'));
    const third = await autonomousRecoveryEngine.handleFailure(failure(goal.goalId, 'dashboard', 'a different error text'));
    clearTimeout(safetyNet);

    for (const dup of [second, third]) {
      expect(dup.success).toBe(false);
      expect(dup.status).toBe('BLOCKED_EXTERNAL');
      expect(dup.finalResponseText).toMatch(/already tracked by SELFHEAL-\d+/);
      expect(dup.finalResponseText).toMatch(/did not start another repair/);
      expect(dup.incidentId).toMatch(/^SELFHEAL-\d+$/);
    }
    expect(second.incidentId).toBe(third.incidentId);

    gate.resolve();
    const firstOutcome = await first;
    expect(firstOutcome.status).toBe('BLOCKED_EXTERNAL');
    expect(firstOutcome.incidentId).toBe(second.incidentId);

    expect(delegate).toHaveBeenCalledTimes(1);
    expect(incidentRows()).toHaveLength(1);
  });

  it('once its chain is terminal the same failing operation can never reopen a repair', async () => {
    const goal = startGoal('open the quarterly dashboard', 'dashboard');
    const delegate = vi.spyOn(engineeringDelegationService, 'delegateTask').mockResolvedValue(refusedHandoff());

    const first = await autonomousRecoveryEngine.handleFailure(failure(goal.goalId, 'dashboard'));
    expect(first.status).toBe('BLOCKED_EXTERNAL');
    expect(delegate).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 5; i++) {
      const again = await autonomousRecoveryEngine.handleFailure(failure(goal.goalId, 'dashboard'));
      expect(again.status).toBe('BLOCKED_EXTERNAL');
      expect(again.success).toBe(false);
    }
    expect(delegate).toHaveBeenCalledTimes(1);
    expect(incidentRows()).toHaveLength(1);
  });

  it('a refused handoff ends the chain BLOCKED and parks the incident as unresolved for a human (it is not retried)', async () => {
    const goal = startGoal('open the quarterly dashboard', 'dashboard');
    vi.spyOn(engineeringDelegationService, 'delegateTask').mockResolvedValue(refusedHandoff('Engineering handoff refused by the recovery guard (chain_handoff_cap); no worker task was created.'));

    const outcome = await autonomousRecoveryEngine.handleFailure(failure(goal.goalId, 'dashboard'));

    expect(outcome.success).toBe(false);
    expect(outcome.status).toBe('BLOCKED_EXTERNAL');
    expect(outcome.finalResponseText).toMatch(/did not hand the repair to an engineering worker/);
    expect(outcome.finalResponseText).toMatch(/unresolved for review/);

    const incidents = incidentRows();
    expect(incidents).toHaveLength(1);
    expect(incidents[0].id).toBe(outcome.incidentId);
    expect(incidents[0].status).toBe('unresolved');

    const chain = chains.findChain({ incidentId: incidents[0].id })!;
    expect(chain.state).toBe('BLOCKED');
    expect(chain.terminalReason).toBe('handoff_refused');

    // The goal run is not left parked in ENGINEERING_REPAIR as if a worker were still on it.
    expect(goalLifecycleManager.getGoalRun(goal.goalId)?.status).toBe('BLOCKED_EXTERNAL');
  });

  it('the handoff the engine makes is bound to its chain and carries the USER request, so a retry re-runs that text', async () => {
    const goal = startGoal('open the quarterly dashboard', 'dashboard');
    const delegate = vi.spyOn(engineeringDelegationService, 'delegateTask').mockResolvedValue(refusedHandoff());

    const outcome = await autonomousRecoveryEngine.handleFailure(failure(goal.goalId, 'dashboard'));

    expect(delegate).toHaveBeenCalledTimes(1);
    const args = delegate.mock.calls[0][0] as any;
    const chain = chains.findChain({ incidentId: outcome.incidentId })!;
    expect(args.recoveryChainId).toBe(chain.chainId);
    expect(args.incidentId).toBe(outcome.incidentId);
    expect(args.originalUserInput).toBe('open the quarterly dashboard');
    expect(chain.rootOperationId).toBe(goal.goalId);
  });
});

describe('AutonomousRecoveryEngine: ownership rejections', () => {
  it('a background repair that lacks ownership does not create a repair of itself', async () => {
    // The reported hop: a background command is rejected by the ownership gate and reaches the engine.
    // There is no user turn behind it, so there is nobody to repair it FOR.
    const goal = startGoal('open the quarterly dashboard', 'dashboard');
    const delegate = vi.spyOn(engineeringDelegationService, 'delegateTask').mockResolvedValue(refusedHandoff());

    const outcome = await autonomousRecoveryEngine.handleFailure(failure(goal.goalId, 'dashboard', 'rejected:no_ownership_identity'));

    expect(outcome.success).toBe(false);
    expect(outcome.status).toBe('BLOCKED_EXTERNAL');
    expect(outcome.finalResponseText).toMatch(/did not start another repair/);
    expect(delegate).not.toHaveBeenCalled();
    expect(incidentRows()).toHaveLength(0);
    expect(chains.listHandoffs()).toHaveLength(0);
  });

  it('the same rejection of a real user turn still opens its one incident and its one handoff', async () => {
    const goal = startGoal('open the quarterly dashboard', 'dashboard');
    const delegate = vi.spyOn(engineeringDelegationService, 'delegateTask').mockResolvedValue(refusedHandoff());

    const outcome = await runWithTurnOwnership(
      { conversationId: 'engine-user-turn', turnId: Date.now(), operationId: goal.goalId },
      () => autonomousRecoveryEngine.handleFailure(failure(goal.goalId, 'dashboard', 'rejected:no_ownership_identity')),
    );

    expect(delegate).toHaveBeenCalledTimes(1);
    expect(incidentRows()).toHaveLength(1);
    expect(outcome.incidentId).toBe(incidentRows()[0].id);
  });
});

describe('AutonomousRecoveryEngine: independent failures are still repaired', () => {
  it('two different operations fail -> two incidents, two handoffs', async () => {
    const delegate = vi.spyOn(engineeringDelegationService, 'delegateTask').mockResolvedValue(refusedHandoff());
    const a = startGoal('open the quarterly dashboard', 'dashboard');
    const b = startGoal('take a screenshot', 'screenshot');

    const [oa, ob] = await Promise.all([
      autonomousRecoveryEngine.handleFailure(failure(a.goalId, 'dashboard')),
      autonomousRecoveryEngine.handleFailure(failure(b.goalId, 'screenshot')),
    ]);

    expect(delegate).toHaveBeenCalledTimes(2);
    expect(incidentRows()).toHaveLength(2);
    expect(oa.incidentId).not.toBe(ob.incidentId);
  });

  it('a genuinely separate later operation with the same text opens its own incident', async () => {
    const delegate = vi.spyOn(engineeringDelegationService, 'delegateTask').mockResolvedValue(refusedHandoff());
    const first = startGoal('open the quarterly dashboard', 'dashboard');
    const o1 = await autonomousRecoveryEngine.handleFailure(failure(first.goalId, 'dashboard'));
    expect(o1.status).toBe('BLOCKED_EXTERNAL');

    // Same words, but a NEW user operation (a new goal run): it is not the retry of anything.
    const later = startGoal('open the quarterly dashboard', 'dashboard');
    const o2 = await autonomousRecoveryEngine.handleFailure(failure(later.goalId, 'dashboard'));

    expect(o2.incidentId).toBeTruthy();
    expect(o2.incidentId).not.toBe(o1.incidentId);
    expect(delegate).toHaveBeenCalledTimes(2);
    expect(incidentRows()).toHaveLength(2);
  });
});
