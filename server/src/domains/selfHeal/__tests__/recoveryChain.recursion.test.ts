/**
 * Recursive SELFHEAL redispatch — regression tests.
 *
 * The reported failure chain:
 *   user/background command fails (ownership rejection)
 *     -> raiseSelfHealIncident -> NEW incident -> closed-loop repair -> engineering handoff
 *     -> retry of the original request through the lifecycle -> the SAME rejection
 *     -> raiseSelfHealIncident again -> NEW incident -> ...   (hundreds of handoffs)
 *
 * These tests drive the REAL TurnLifecycleController, the REAL self-heal supervisor retry, the REAL
 * FailureDetector / recovery-chain registry and a REAL SQLite database. Only the pieces that touch
 * the outside world are replaced: the legacy routing handler (it plays "the capability that fails
 * the same way every time"), the LLM planner, and the closed-loop repair body (it plays "a repair
 * finished, now retry the original request" — exactly what the real loop does next).
 *
 * Identity is (root operation, failure class, target). Nothing here matches on user phrases.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

const scenario = vi.hoisted(() => ({
  onTurn: null as null | ((record: any) => Promise<any>),
  runs: [] as Array<{ requestId: string; source: string }>,
}));

vi.mock('../../../utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../../services/llmGateway.js', () => ({ llmChat: vi.fn() }));
vi.mock('../../turnLifecycle/legacyHandler.js', () => ({
  runLegacyHandler: vi.fn(async (record: any) => scenario.onTurn!(record)),
}));

import { rawDb } from '../../../db/index.js';
import { llmChat } from '../../../services/llmGateway.js';
import { turnLifecycle } from '../../turnLifecycle/index.js';
import { ensureTurnLifecycleTables } from '../../turnLifecycle/store.js';
import { runWithTurnOwnership, runWithBackgroundOwnership } from '../../jarvis/perception/turnOwnership.js';
import { selfHealSupervisor } from '../SelfHealSupervisor.js';
import { failureDetector } from '../FailureDetector.js';
import { raiseSelfHealIncident } from '../raiseSelfHealIncident.js';
import * as chains from '../recoveryChain.js';

/* ───────────────────────────── harness ───────────────────────────── */

const USER_TEXT = 'open the quarterly dashboard';

function incidentRows(): any[] {
  return rawDb.prepare('SELECT * FROM repair_incidents ORDER BY detected_at, id').all() as any[];
}
function chainRows(): any[] {
  return rawDb.prepare('SELECT * FROM recovery_chains ORDER BY created_ms, rowid').all() as any[];
}

function failingReceipt(error: string) {
  const t = new Date().toISOString();
  return { executor: 'legacy.turnRouter:action', attempted: true, completedWithoutError: false, startedAt: t, finishedAt: t, error, handlerText: 'The action failed.', details: {} };
}

/**
 * What the real legacy handler does around routeTurn — run under the lifecycle's ownership frame — then
 * fail the same way every time and tell Self-Heal about it.
 */
function failingHandler(opts: { error: string; report: (record: any) => Promise<void> }) {
  return (record: any) =>
    runWithTurnOwnership(
      { conversationId: record.contextKey, turnId: Date.parse(record.request.receivedAt), operationId: record.request.requestId },
      async () => {
        scenario.runs.push({ requestId: record.request.requestId, source: record.request.source });
        await opts.report(record);
        return failingReceipt(opts.error);
      },
    );
}

/** The capability-missing signal, exactly as turnRouter raises it. */
const reportViaRaise = async (record: any) => {
  await raiseSelfHealIncident({
    component: 'jarvis.capability.open.dashboard',
    symptom: 'User asked JARVIS to "open" the dashboard but no executable open capability is wired to that entity.',
    conversationId: record.contextKey,
    originalAction: { prompt: record.request.text, conversationId: record.contextKey, entityId: 'dashboard', entityType: 'project', entityName: 'Quarterly Dashboard', verb: 'open' },
  });
};

/**
 * An ownership rejection, exactly as the recovery engine / bridge report it (`rejected:<gate reason>`):
 * admission first, and only the ONE admitted signal goes on to start a repair.
 */
const reportOwnershipRejection = async (record: any) => {
  const raised = failureDetector.raiseIncident({
    component: 'jarvis.capability.open.dashboard',
    symptom: 'Open action rejected by the ownership gate.',
    failureDomain: 'backend',
    priority: 'high',
    metadata: { reasonCode: 'rejected:no_ownership_identity', error: 'rejected:no_ownership_identity', target: 'Quarterly Dashboard', originalText: record.request.text },
  });
  if (!raised.admitted) return;
  void selfHealSupervisor.executeClosedLoopRepair({
    incidentId: raised.incidentId,
    conversationId: record.contextKey,
    originalUserInput: record.request.text,
    capabilityId: 'jarvis.capability.open.dashboard',
    target: 'Quarterly Dashboard',
  } as any);
};

/** A plain (non-ownership) failure, so retry exhaustion rather than a policy rejection ends the chain. */
const reportPlainFailure = async (record: any) => {
  failureDetector.raiseIncident({
    component: 'jarvis.capability.open.dashboard',
    symptom: 'Open action did not produce the expected window.',
    failureDomain: 'backend',
    priority: 'high',
    metadata: { failureClass: 'verification_failed', error: 'postcondition not observed', target: 'Quarterly Dashboard', originalText: record.request.text },
  });
};

/** A repair that "finished": what the closed loop does next is retry the ORIGINAL request through the lifecycle. */
function installRepairThatRetries() {
  const retries: Array<Promise<any>> = [];
  const spy = vi.spyOn(selfHealSupervisor, 'executeClosedLoopRepair').mockImplementation(async (opts: any) => {
    const p = selfHealSupervisor.retryOriginalRequestViaLifecycle({
      conversationId: opts.conversationId,
      text: opts.originalUserInput,
      incidentId: opts.incidentId,
    });
    retries.push(p);
    await p;
    return { success: false, error: 'repair stub' };
  });
  return { spy, retries };
}

async function submitUserTurn(conversationId = 'conv-user', text = USER_TEXT) {
  const res = await turnLifecycle.submit({ source: 'typed_chat', conversationId, text });
  expect(res.duplicate).toBe(false);
  return res;
}

const inUserFrame = <T>(operationId: string, fn: () => Promise<T>) =>
  runWithTurnOwnership({ conversationId: 'conv-frame', turnId: Date.now(), operationId }, fn);

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
  ensureTurnLifecycleTables();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

/**
 * The planner classifies "open the quarterly dashboard" as an ACTION that no native executor owns
 * (`other`) — the production shape of the reported failures. The legacy handler then runs it and a
 * failing receipt must end the turn FAILED (never VERIFIED).
 */
function planAsLegacyAction() {
  vi.mocked(llmChat).mockResolvedValue({
    reply: JSON.stringify({ kind: 'action', summary: 'Open the quarterly dashboard', continuesPrevious: false, action: { type: 'other' } }),
    provider: 'test',
  } as any);
}

beforeEach(() => {
  planAsLegacyAction();
  chains.__resetRecoveryChainsForTests();
  chains.configureRecoveryChains({ retryBackoffBaseMs: 0 });
  rawDb.exec('DELETE FROM repair_incidents; DELETE FROM repair_evidence; DELETE FROM turn_lifecycle; DELETE FROM turn_lifecycle_events;');
  scenario.runs.length = 0;
  scenario.onTurn = null;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

/* ───────────────────────────── A ───────────────────────────── */

describe('A. original user action fails -> exactly ONE self-heal incident', () => {
  it('opens one incident, one chain and starts one closed-loop repair', async () => {
    const repair = vi.spyOn(selfHealSupervisor, 'executeClosedLoopRepair').mockResolvedValue({ success: false, error: 'repair stub' });
    scenario.onTurn = failingHandler({ error: 'rejected:no_ownership_identity', report: reportViaRaise });

    const res = await submitUserTurn();

    expect(res.duplicate === false && res.record.outcome).not.toBe('VERIFIED');
    const incidents = incidentRows();
    expect(incidents).toHaveLength(1);
    expect(repair).toHaveBeenCalledTimes(1);

    const rows = chainRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe('ACTIVE');
    expect(rows[0].incident_id).toBe(incidents[0].id);
    // The chain is rooted at the lifecycle request that failed — not at any phrase.
    expect(rows[0].root_operation_id).toBe(res.duplicate === false ? res.record.request.requestId : '');
    expect(rows[0].original_text).toBe(USER_TEXT);
  });

  it('the same turn signalling the same failure from several call sites still opens one incident', async () => {
    const repair = vi.spyOn(selfHealSupervisor, 'executeClosedLoopRepair').mockResolvedValue({ success: false, error: 'repair stub' });
    scenario.onTurn = failingHandler({
      error: 'rejected:no_ownership_identity',
      report: async (record) => { await reportViaRaise(record); await reportViaRaise(record); await reportViaRaise(record); },
    });
    await submitUserTurn();
    expect(incidentRows()).toHaveLength(1);
    expect(repair).toHaveBeenCalledTimes(1);
  });
});

/* ───────────────────────────── B ───────────────────────────── */

describe('B. self-heal retries the original action and gets the SAME ownership rejection -> NO second incident', () => {
  it.each([
    ['capability-missing signal (raiseSelfHealIncident)', reportViaRaise],
    ['ownership-rejection signal (recovery engine / bridge style)', reportOwnershipRejection],
  ])('%s: the retry opens nothing and the chain ends BLOCKED, not recursive', async (_name, report) => {
    const { spy: repair, retries } = installRepairThatRetries();
    scenario.onTurn = failingHandler({ error: 'rejected:no_ownership_identity', report });

    await submitUserTurn();
    const settled = await Promise.all(retries);

    // Exactly one incident for the whole chain, exactly one repair, exactly one retry.
    expect(incidentRows()).toHaveLength(1);
    expect(repair).toHaveBeenCalledTimes(1);
    expect(retries).toHaveLength(1);
    expect(scenario.runs.map((r) => r.source)).toEqual(['typed_chat', 'self_heal_retry']);

    // The retry failed; it is reported as failed and terminal — never VERIFIED, never re-escalated.
    expect(settled[0].outcome).not.toBe('VERIFIED');
    expect(settled[0].chainState).toBe('BLOCKED');

    const chain = chains.findChain({ incidentId: incidentRows()[0].id })!;
    expect(chain.state).toBe('BLOCKED');
    expect(chain.terminalReason).toBe('ownership_rejected_on_retry');
    expect(chain.retryCount).toBe(1);
    expect(chain.handoffCount).toBe(0);

    // The incident is closed for a human instead of left to re-trigger.
    const incident = incidentRows()[0];
    expect(incident.status).toBe('unresolved');
    expect(JSON.parse(incident.metadata).recoveryChain.state).toBe('BLOCKED');

    // The retry ran as RECOVERY WORK: its lifecycle record carries the chain identity.
    const retryRow: any = rawDb.prepare("SELECT attached_json FROM turn_lifecycle WHERE source = 'self_heal_retry'").get();
    expect(JSON.parse(retryRow.attached_json).recoveryChainId).toBe(chain.chainId);
  });

  it('the failure raised inside the retry is recorded on the chain, not opened as an incident', async () => {
    const { retries } = installRepairThatRetries();
    scenario.onTurn = failingHandler({ error: 'rejected:no_ownership_identity', report: reportViaRaise });
    await submitUserTurn();
    await Promise.all(retries);

    const chain = chainRows()[0];
    expect(chain.signal_count).toBeGreaterThanOrEqual(1);
    expect(chain.suppressed_count).toBeGreaterThanOrEqual(1);
    const events = chains.listChainEvents(chain.chain_id).map((e) => e.kind);
    expect(events).toContain('recovery_signal_suppressed');
    expect(events).toContain('retry_admitted');
    expect(events).toContain('chain_blocked');
  });

  it('a retry turn can never open an incident even if it is the first thing to fail', async () => {
    // A self_heal_retry that arrives with no chain at all still runs as recovery work (fail closed).
    scenario.onTurn = failingHandler({ error: 'rejected:no_ownership_identity', report: reportViaRaise });
    const repair = vi.spyOn(selfHealSupervisor, 'executeClosedLoopRepair').mockResolvedValue({ success: false, error: 'repair stub' });
    await turnLifecycle.submit({ source: 'self_heal_retry', conversationId: 'conv-orphan', text: USER_TEXT, attached: { incidentId: 'SELFHEAL-ORPHAN' } });
    expect(incidentRows()).toHaveLength(0);
    expect(repair).not.toHaveBeenCalled();
  });

  it('the loop as reported — every admitted incident repairs then retries, and every retry fails the same way — terminates after one pass', async () => {
    const { spy: repair, retries } = installRepairThatRetries();
    scenario.onTurn = failingHandler({ error: 'rejected:no_ownership_identity', report: reportOwnershipRejection });
    await submitUserTurn();
    await Promise.all(retries);
    // Quiescence: nothing else is pending that could re-trigger.
    await new Promise((r) => setTimeout(r, 50));
    expect(incidentRows()).toHaveLength(1);
    expect(repair).toHaveBeenCalledTimes(1);
    expect(scenario.runs).toHaveLength(2);
    expect(chains.listHandoffs()).toHaveLength(0);
  });
});

/* ───────────────────────────── C ───────────────────────────── */

describe('C. a genuinely separate later user operation with the same text may open a new incident', () => {
  it('while the first chain is still active', async () => {
    const repair = vi.spyOn(selfHealSupervisor, 'executeClosedLoopRepair').mockResolvedValue({ success: false, error: 'repair stub' });
    scenario.onTurn = failingHandler({ error: 'rejected:no_ownership_identity', report: reportViaRaise });

    const first = await submitUserTurn('conv-c1');
    const second = await submitUserTurn('conv-c2');

    expect(incidentRows()).toHaveLength(2);
    expect(repair).toHaveBeenCalledTimes(2);
    const rows = chainRows();
    expect(rows).toHaveLength(2);
    expect(rows[0].root_operation_id).not.toBe(rows[1].root_operation_id);
    expect(first.duplicate || second.duplicate).toBe(false);
  });

  it('after the first chain went terminal', async () => {
    const { retries } = installRepairThatRetries();
    scenario.onTurn = failingHandler({ error: 'rejected:no_ownership_identity', report: reportOwnershipRejection });
    await submitUserTurn('conv-c3');
    await Promise.all(retries);
    expect(chainRows()[0].state).toBe('BLOCKED');

    await submitUserTurn('conv-c4');
    await Promise.all(retries);
    // The new operation got its OWN incident (it is not swallowed by the terminal one) ...
    expect(chainRows().filter((c) => c.root_operation_id).length).toBeGreaterThanOrEqual(2);
    expect(new Set(incidentRows().map((i) => i.id)).size).toBe(incidentRows().length);
    expect(incidentRows().length).toBeGreaterThanOrEqual(2);
  });

  it('the same operation failing the same way after its chain ended does NOT reopen it', async () => {
    scenario.onTurn = null;
    const root = 'op-already-terminal';
    const first = await inUserFrame(root, async () => failureDetector.raiseIncident({
      component: 'cap.x', symptom: 's', failureDomain: 'backend', priority: 'high', metadata: { failureClass: 'executor_error', target: 't' },
    }));
    expect(first.admitted).toBe(true);
    chains.closeChain((first as any).chainId, 'FAILED', 'test_terminal');
    const again = await inUserFrame(root, async () => failureDetector.raiseIncident({
      component: 'cap.x', symptom: 's', failureDomain: 'backend', priority: 'high', metadata: { failureClass: 'executor_error', target: 't' },
    }));
    expect(again.admitted).toBe(false);
    expect((again as any).reason).toBe('terminal_chain');
    expect(incidentRows()).toHaveLength(1);
  });
});

/* ───────────────────────────── D ───────────────────────────── */

describe('D. bounded retry exhaustion terminates cleanly', () => {
  it('after maxRetries the chain is FAILED, the incident is closed and further retries are refused without running anything', async () => {
    chains.configureRecoveryChains({ maxRetriesPerChain: 2, retryBackoffBaseMs: 0 });
    scenario.onTurn = failingHandler({ error: 'postcondition not observed', report: reportPlainFailure });
    vi.spyOn(selfHealSupervisor, 'executeClosedLoopRepair').mockResolvedValue({ success: false, error: 'repair stub' });

    await submitUserTurn('conv-d');
    const incident = incidentRows()[0];
    expect(incidentRows()).toHaveLength(1);

    const ask = () => selfHealSupervisor.retryOriginalRequestViaLifecycle({ conversationId: 'conv-d-retry', text: USER_TEXT, incidentId: incident.id });
    const r1 = await ask();
    expect(r1.outcome).not.toBe('VERIFIED');
    expect(r1.chainState).toBe('ACTIVE');

    const r2 = await ask();
    expect(r2.outcome).not.toBe('VERIFIED');
    expect(r2.chainState).toBe('FAILED'); // budget exhausted by the second retry

    const runsBefore = scenario.runs.length;
    const r3 = await ask();
    expect(r3.requestId).toBeNull();
    expect(r3.reason).toBe('recovery_retry_refused:chain_terminal');
    expect(scenario.runs.length).toBe(runsBefore); // nothing was executed

    // Original + exactly two retries ever ran. No new incident, no handoff.
    expect(scenario.runs.map((r) => r.source)).toEqual(['typed_chat', 'self_heal_retry', 'self_heal_retry']);
    expect(incidentRows()).toHaveLength(1);
    expect(chains.listHandoffs()).toHaveLength(0);

    const chain = chains.findChain({ incidentId: incident.id })!;
    expect(chain.state).toBe('FAILED');
    expect(chain.terminalReason).toBe('retry_budget_exhausted');
    expect(chain.retryCount).toBe(2);
    expect(incidentRows()[0].status).toBe('unresolved');
    const events = chains.listChainEvents(chain.chainId).map((e) => e.kind);
    expect(events.filter((k) => k === 'retry_admitted')).toHaveLength(2);
    expect(events).toContain('chain_failed');
    expect(events).toContain('retry_refused');
  });

  it('retries back off: an immediate second retry is refused (not terminal) and is admitted after the backoff elapses', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    chains.configureRecoveryChains({ maxRetriesPerChain: 3, retryBackoffBaseMs: 60_000, retryBackoffCapMs: 600_000 });
    scenario.onTurn = failingHandler({ error: 'postcondition not observed', report: reportPlainFailure });
    vi.spyOn(selfHealSupervisor, 'executeClosedLoopRepair').mockResolvedValue({ success: false, error: 'repair stub' });

    await submitUserTurn('conv-d2');
    const incident = incidentRows()[0];
    const ask = () => selfHealSupervisor.retryOriginalRequestViaLifecycle({ conversationId: 'conv-d2-retry', text: USER_TEXT, incidentId: incident.id });

    const r1 = await ask();
    expect(r1.requestId).not.toBeNull();

    const early = await ask();
    expect(early.requestId).toBeNull();
    expect(early.reason).toBe('recovery_retry_refused:backoff');
    expect(early.chainState).toBe('ACTIVE');

    vi.setSystemTime(Date.now() + 61_000);
    const later = await ask();
    expect(later.requestId).not.toBeNull();
    expect(scenario.runs.filter((r) => r.source === 'self_heal_retry')).toHaveLength(2);
  });

  it('a retry may only re-run the root operation\'s own request (never a repair objective)', async () => {
    scenario.onTurn = failingHandler({ error: 'postcondition not observed', report: reportPlainFailure });
    vi.spyOn(selfHealSupervisor, 'executeClosedLoopRepair').mockResolvedValue({ success: false, error: 'repair stub' });
    await submitUserTurn('conv-d3');
    const incident = incidentRows()[0];

    const runsBefore = scenario.runs.length;
    const wrong = await selfHealSupervisor.retryOriginalRequestViaLifecycle({
      conversationId: 'conv-d3-retry',
      text: `[AUTONOMOUS SELF-HEAL REPAIR INCIDENT ${incident.id}] Diagnose and fix the capability. Use AntiGravity.`,
      incidentId: incident.id,
    });
    expect(wrong.requestId).toBeNull();
    expect(wrong.reason).toBe('recovery_retry_refused:retry_text_mismatch');
    expect(scenario.runs.length).toBe(runsBefore);
    expect(chains.findChain({ incidentId: incident.id })!.retryCount).toBe(0);

    const right = await selfHealSupervisor.retryOriginalRequestViaLifecycle({ conversationId: 'conv-d3-retry', text: USER_TEXT, incidentId: incident.id });
    expect(right.requestId).not.toBeNull();
  });

  it('two concurrent retries of one chain collapse to one', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    scenario.onTurn = async (record: any) => {
      if (record.request.source === 'self_heal_retry') await gate;
      return failingHandler({ error: 'postcondition not observed', report: reportPlainFailure })(record);
    };
    vi.spyOn(selfHealSupervisor, 'executeClosedLoopRepair').mockResolvedValue({ success: false, error: 'repair stub' });
    await submitUserTurn('conv-d4');
    const incident = incidentRows()[0];

    const ask = () => selfHealSupervisor.retryOriginalRequestViaLifecycle({ conversationId: 'conv-d4-retry', text: USER_TEXT, incidentId: incident.id });
    const first = ask();
    await new Promise((r) => setTimeout(r, 20));
    const second = await ask();
    expect(second.requestId).toBeNull();
    expect(second.reason).toBe('recovery_retry_refused:retry_in_flight');
    release();
    const done = await first;
    expect(done.requestId).not.toBeNull();
    expect(scenario.runs.filter((r) => r.source === 'self_heal_retry')).toHaveLength(1);
  });
});

/* ───────────────────────────── E ───────────────────────────── */

describe('E. duplicate concurrent failure signals for the same root operation collapse to one active incident', () => {
  it('eight concurrent raiseSelfHealIncident calls -> one incident, one repair run, one admitted', async () => {
    const repair = vi.spyOn(selfHealSupervisor, 'executeClosedLoopRepair').mockResolvedValue({ success: false, error: 'repair stub' });
    const raise = () => raiseSelfHealIncident({
      component: 'jarvis.capability.open.dashboard',
      symptom: 'no executable capability',
      conversationId: 'conv-e',
      originalAction: { prompt: USER_TEXT, conversationId: 'conv-e', entityId: 'dashboard', entityType: 'project', entityName: 'Quarterly Dashboard', verb: 'open' },
    });

    const results = await inUserFrame('op-e-1', () => Promise.all(Array.from({ length: 8 }, raise)));

    expect(results.filter((r) => r.raised)).toHaveLength(1);
    expect(results.filter((r) => !r.raised && r.suppressed === 'duplicate_active')).toHaveLength(7);
    expect(new Set(results.map((r) => r.incidentId).filter(Boolean)).size).toBe(1);
    expect(incidentRows()).toHaveLength(1);
    expect(chainRows().filter((c) => c.state === 'ACTIVE')).toHaveLength(1);
    expect(repair).toHaveBeenCalledTimes(1);
    // The collapsed signals are not lost: they are counted as occurrences of the one incident.
    expect(JSON.parse(incidentRows()[0].metadata).occurrenceCount).toBe(8);
  });

  it('concurrent signals through the synchronous admission path cannot both be admitted', async () => {
    const results = await inUserFrame('op-e-2', async () =>
      Promise.all(Array.from({ length: 25 }, async () => {
        await Promise.resolve();
        return failureDetector.raiseIncident({
          component: 'cap.y', symptom: 'boom', failureDomain: 'backend', priority: 'high', metadata: { failureClass: 'executor_error', target: 'thing' },
        });
      })));
    expect(results.filter((r) => r.admitted)).toHaveLength(1);
    expect(incidentRows()).toHaveLength(1);
  });

  it('the database itself refuses a second ACTIVE chain for the same identity (cross-process safety)', () => {
    chains.ensureRecoveryChainTables();
    const insert = () => rawDb.prepare(
      `INSERT INTO recovery_chains (chain_id, chain_key, root_operation_id, failure_class, target, state, max_retries, max_handoffs, created_at, created_ms, updated_ms)
       VALUES (?, 'same-key', 'r', 'c', 't', 'ACTIVE', 2, 1, 'x', 1, 1)`,
    ).run(`rc-${Math.random()}`);
    insert();
    expect(insert).toThrow(/UNIQUE/i);
  });

  it('independent failures of the same operation (different target) are NOT collapsed', async () => {
    const out = await inUserFrame('op-e-3', async () => [
      failureDetector.raiseIncident({ component: 'cap.z', symptom: 'a', failureDomain: 'backend', priority: 'high', metadata: { failureClass: 'executor_error', target: 'app-one' } }),
      failureDetector.raiseIncident({ component: 'cap.z', symptom: 'b', failureDomain: 'backend', priority: 'high', metadata: { failureClass: 'executor_error', target: 'app-two' } }),
    ]);
    expect(out.map((r) => r.admitted)).toEqual([true, true]);
    expect(incidentRows()).toHaveLength(2);
  });
});

/* ───────────────────────────── background / ownership origin ───────────────────────────── */

describe('a background repair lacking ownership must not create another repair of itself', () => {
  const ownershipSignal = () => failureDetector.raiseIncident({
    component: 'jarvis.capability.open.dashboard', symptom: 'rejected', failureDomain: 'backend', priority: 'high',
    metadata: { reasonCode: 'rejected:no_ownership_identity', error: 'rejected:no_ownership_identity', target: 'Quarterly Dashboard' },
  });
  const policy = { allowTerminal: false, allowGuiLaunch: false, allowForegroundChange: false, allowBrowserNavigation: false, allowHeadlessBrowserNavigation: false, allowProcessControl: false, allowPerception: false };

  it('no ownership frame at all: an ownership rejection opens nothing', () => {
    const r = ownershipSignal();
    expect(r.admitted).toBe(false);
    expect((r as any).reason).toBe('ownership_rejection_without_user_turn');
    expect(incidentRows()).toHaveLength(0);
  });

  it('a background_worker frame: an ownership rejection opens nothing', async () => {
    const r = await runWithBackgroundOwnership({ origin: 'background_worker', capability: 'terminal', policy }, async () => ownershipSignal());
    expect(r.admitted).toBe(false);
    expect((r as any).reason).toBe('ownership_rejection_without_user_turn');
    expect(incidentRows()).toHaveLength(0);
  });

  it('work that declared itself self_heal/recovery can open nothing at all', async () => {
    for (const origin of ['self_heal', 'recovery'] as const) {
      const r = await runWithBackgroundOwnership({ origin, capability: 'terminal', policy }, async () =>
        failureDetector.raiseIncident({ component: 'cap.q', symptom: 'x', failureDomain: 'backend', priority: 'high', metadata: { failureClass: 'executor_error', target: 'q' } }));
      expect(r.admitted).toBe(false);
      expect((r as any).reason).toBe('recovery_origin');
    }
    expect(incidentRows()).toHaveLength(0);
  });

  it('a real USER turn that is rejected by the ownership gate still opens its one incident', async () => {
    const r = await inUserFrame('op-user-ownership', async () => ownershipSignal());
    expect(r.admitted).toBe(true);
    expect(incidentRows()).toHaveLength(1);
  });

  it('monitor-style failures (no operation) still open an incident and are deduplicated while active', () => {
    const raise = () => failureDetector.raiseIncident({ component: 'hermes_gateway', symptom: 'unreachable', failureDomain: 'backend', priority: 'high' });
    const a = raise();
    const b = raise();
    expect(a.admitted).toBe(true);
    expect(b.admitted).toBe(false);
    expect((b as any).reason).toBe('duplicate_active');
    expect((b as any).incidentId).toBe((a as any).incidentId);
    expect(incidentRows()).toHaveLength(1);
  });

  it('createManualIncident still returns the id of the incident a duplicate collapsed into', () => {
    const a = failureDetector.createManualIncident('svc.alpha', 'down', 'backend', 'high');
    const b = failureDetector.createManualIncident('svc.alpha', 'down', 'backend', 'high');
    expect(a).toMatch(/^SELFHEAL-/);
    expect(b).toBe(a);
  });
});
