/**
 * selfHeal/recoveryChain.ts — the recovery-chain registry: ONE failure, at most ONE
 * active repair chain, with hard budgets.
 *
 * THE DEFECT THIS FIXES (recursive SELFHEAL redispatch)
 *   user/background command fails (ownership rejection)
 *     -> raiseSelfHealIncident / handleFailure -> NEW SELFHEAL incident
 *     -> closed-loop repair -> engineering handoff (a new worker window)
 *     -> retry of the original request through the lifecycle
 *     -> the retry fails the same way -> a NEW incident -> ... (hundreds of handoffs)
 *
 * Nothing carried the identity of the failure across that loop, so every pass
 * looked like a fresh user failure.
 *
 * STRUCTURE
 *  - Identity: a chain is keyed by (root operation, failure class, target). The root
 *    operation is the lifecycle request that FIRST failed (or, for monitors with no
 *    operation, the failing component). It is never derived from the request text.
 *  - Origin: work running inside a recovery context (see recoveryContext.ts), or in an
 *    operation declared self_heal/recovery, may RECORD a failure on its chain but can
 *    never open an incident, start a repair run or hand off to a worker.
 *  - Dedupe: while a chain is ACTIVE, every further signal for the same key collapses
 *    into it (partial UNIQUE index + synchronous admission => race-free).
 *  - Budgets: bounded retries with exponential backoff, one handoff per chain, one per
 *    root operation, one per failure fingerprint per window and a global breaker.
 *  - Terminal: RECOVERED | FAILED | BLOCKED. A terminal chain never escalates again;
 *    its incident is closed as `unresolved` for a human.
 *  - Independence: a different root operation is a different chain, so a genuinely
 *    separate later failure can still open its own legitimate incident.
 *
 * All admission functions are SYNCHRONOUS on purpose: better-sqlite3 is synchronous,
 * so check-and-insert happens inside one tick and two concurrent signals cannot both
 * be admitted.
 */
import { createHash, randomUUID } from 'node:crypto';
import { rawDb } from '../../db/index.js';
import { logger } from '../../utils/logger.js';
import { currentTurnOwnership } from '../jarvis/perception/turnOwnership.js';
import { currentRecoveryContext, type RecoveryContext } from './recoveryContext.js';

/* ───────────────────────────── types ───────────────────────────── */

export type ChainState = 'ACTIVE' | 'RECOVERED' | 'FAILED' | 'BLOCKED';
export const TERMINAL_CHAIN_STATES: readonly ChainState[] = ['RECOVERED', 'FAILED', 'BLOCKED'];

/**
 * Machine failure classes. Derived from structured codes (`rejected:<gate reason>`,
 * explicit flags) — never from user phrases.
 */
export type FailureClass =
  | 'ownership_rejected'   // a side-effect gate refused: no/foreign/superseded turn identity or policy denial
  | 'capability_missing'
  | 'executor_error'
  | 'verification_failed'
  | 'unknown';

export type SignalOrigin = 'user_turn' | 'recovery' | 'background' | 'system';

export type IncidentSuppression =
  | 'recovery_origin'                     // raised from inside a recovery chain
  | 'ownership_rejection_without_user_turn' // a background actor without ownership: nothing to repair
  | 'duplicate_active'                    // same (root, class, target) is already active
  | 'terminal_chain'                      // this operation already had its chain for this failure and it ended; it is never reopened
  | 'root_incident_cap'                   // one operation may not open unbounded incidents
  | 'fingerprint_active_cap'              // too many active chains for the same failure fingerprint
  | 'terminal_cooldown';                  // a monitor-style failure just ended terminally

export interface IncidentSignal {
  component: string;
  /** Explicit machine class; otherwise derived by classifyFailure(). */
  failureClass?: string;
  /** What failed (app, entity, capability). Defaults to the component. */
  target?: string;
  /** Fallback root when no turn-ownership frame exists. A frame always wins. */
  rootOperationId?: string;
  /** Machine reason code, e.g. `rejected:no_ownership_identity`. */
  reasonCode?: string | null;
  error?: string | null;
  capabilityMissing?: boolean;
  conversationId?: string;
  goalId?: string;
  /** The root operation's original request text (used to bound what a retry may re-run). */
  originalText?: string;
}

export type IncidentAdmission =
  | { admit: true; chainId: string; rootOperationId: string; failureClass: string; target: string; origin: SignalOrigin }
  | { admit: false; reason: IncidentSuppression; origin: SignalOrigin; chainId?: string; incidentId?: string; state?: ChainState };

export interface RecoveryChain {
  chainId: string;
  chainKey: string;
  rootOperationId: string;
  failureClass: string;
  target: string;
  state: ChainState;
  incidentId: string | null;
  conversationId: string | null;
  goalId: string | null;
  originalText: string | null;
  originalTextHash: string | null;
  retryCount: number;
  maxRetries: number;
  handoffCount: number;
  maxHandoffs: number;
  repairRuns: number;
  suppressedCount: number;
  signalCount: number;
  lastSignalClass: string | null;
  lastSignalDetail: string | null;
  retryInFlight: boolean;
  retryStartedMs: number | null;
  nextRetryMs: number | null;
  lastRetryOutcome: string | null;
  terminalReason: string | null;
  createdMs: number;
  updatedMs: number;
  closedMs: number | null;
}

export type RetryRefusal =
  | 'chain_terminal'
  | 'retry_text_mismatch'
  | 'retry_budget_exhausted'
  | 'retry_in_flight'
  | 'backoff';

export type RetryAdmission =
  | { admit: true; chainId: string; rootOperationId: string; incidentId: string | null; attempt: number; adopted: boolean }
  | { admit: false; reason: RetryRefusal; chainId: string; state: ChainState; terminal: boolean; retryAfterMs?: number };

export type HandoffRefusal =
  | 'unknown_chain'
  | 'chain_terminal'
  | 'chain_handoff_cap'
  | 'root_handoff_cap'
  | 'fingerprint_recent'
  | 'breaker_open';

export type HandoffAdmission =
  | { admit: true; handoffId: number; chainId: string }
  | { admit: false; reason: HandoffRefusal; chainId?: string; state?: ChainState };

export interface RecoveryChainConfig {
  /** Retries a chain may run through the lifecycle. */
  maxRetriesPerChain: number;
  retryBackoffBaseMs: number;
  retryBackoffCapMs: number;
  /** An in-flight retry older than this is considered dead and no longer blocks the next one. */
  retryLeaseMs: number;
  maxHandoffsPerChain: number;
  maxHandoffsPerRoot: number;
  /** One handoff per (failure class, target) per window. */
  fingerprintWindowMs: number;
  fingerprintMaxHandoffs: number;
  /** Global circuit breaker across every chain. */
  globalWindowMs: number;
  globalMaxHandoffs: number;
  /** One operation may open at most this many chains (incidents). */
  maxChainsPerRoot: number;
  /** At most this many ACTIVE chains per (failure class, target). */
  maxActiveChainsPerFingerprint: number;
  /** An ACTIVE chain with no progress for this long expires to FAILED. */
  chainTtlMs: number;
  /** After a terminal FAILED/BLOCKED chain, a monitor-style (no user operation) signal is suppressed for this long. */
  terminalCooldownMs: number;
  /** Closed-loop repair runs per chain. */
  maxRepairRunsPerChain: number;
}

/* ───────────────────────────── config ───────────────────────────── */

function envNum(name: string, dflt: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return dflt;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : dflt;
}

function defaultConfig(): RecoveryChainConfig {
  return {
    maxRetriesPerChain: envNum('AGENTICOS_RECOVERY_MAX_RETRIES', 2),
    retryBackoffBaseMs: envNum('AGENTICOS_RECOVERY_BACKOFF_BASE_MS', 15_000),
    retryBackoffCapMs: envNum('AGENTICOS_RECOVERY_BACKOFF_CAP_MS', 300_000),
    retryLeaseMs: envNum('AGENTICOS_RECOVERY_RETRY_LEASE_MS', 180_000),
    maxHandoffsPerChain: envNum('AGENTICOS_RECOVERY_MAX_HANDOFFS_PER_CHAIN', 1),
    maxHandoffsPerRoot: envNum('AGENTICOS_RECOVERY_MAX_HANDOFFS_PER_ROOT', 1),
    fingerprintWindowMs: envNum('AGENTICOS_RECOVERY_FINGERPRINT_WINDOW_MS', 3_600_000),
    fingerprintMaxHandoffs: envNum('AGENTICOS_RECOVERY_FINGERPRINT_MAX_HANDOFFS', 1),
    globalWindowMs: envNum('AGENTICOS_RECOVERY_GLOBAL_WINDOW_MS', 600_000),
    globalMaxHandoffs: envNum('AGENTICOS_RECOVERY_GLOBAL_MAX_HANDOFFS', 3),
    maxChainsPerRoot: envNum('AGENTICOS_RECOVERY_MAX_CHAINS_PER_ROOT', 3),
    maxActiveChainsPerFingerprint: envNum('AGENTICOS_RECOVERY_MAX_ACTIVE_PER_FINGERPRINT', 3),
    chainTtlMs: envNum('AGENTICOS_RECOVERY_CHAIN_TTL_MS', 1_800_000),
    terminalCooldownMs: envNum('AGENTICOS_RECOVERY_TERMINAL_COOLDOWN_MS', 1_800_000),
    maxRepairRunsPerChain: envNum('AGENTICOS_RECOVERY_MAX_REPAIR_RUNS', 1),
  };
}

let config: RecoveryChainConfig = defaultConfig();

export function recoveryChainConfig(): Readonly<RecoveryChainConfig> {
  return config;
}

export function configureRecoveryChains(partial: Partial<RecoveryChainConfig>): void {
  config = { ...config, ...partial };
}

/* ───────────────────────────── storage ───────────────────────────── */

let ensured = false;

export function ensureRecoveryChainTables(): void {
  if (ensured) return;
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS recovery_chains (
      chain_id TEXT PRIMARY KEY,
      chain_key TEXT NOT NULL,
      root_operation_id TEXT NOT NULL,
      failure_class TEXT NOT NULL,
      target TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('ACTIVE','RECOVERED','FAILED','BLOCKED')),
      incident_id TEXT,
      conversation_id TEXT,
      goal_id TEXT,
      original_text TEXT,
      original_text_hash TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL,
      handoff_count INTEGER NOT NULL DEFAULT 0,
      max_handoffs INTEGER NOT NULL,
      repair_runs INTEGER NOT NULL DEFAULT 0,
      suppressed_count INTEGER NOT NULL DEFAULT 0,
      signal_count INTEGER NOT NULL DEFAULT 0,
      last_signal_class TEXT,
      last_signal_detail TEXT,
      retry_in_flight INTEGER NOT NULL DEFAULT 0,
      retry_started_ms INTEGER,
      next_retry_ms INTEGER,
      last_retry_outcome TEXT,
      terminal_reason TEXT,
      created_at TEXT NOT NULL,
      created_ms INTEGER NOT NULL,
      updated_ms INTEGER NOT NULL,
      closed_ms INTEGER
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_recovery_chain_active ON recovery_chains(chain_key) WHERE state = 'ACTIVE';
    CREATE INDEX IF NOT EXISTS idx_recovery_chain_incident ON recovery_chains(incident_id);
    CREATE INDEX IF NOT EXISTS idx_recovery_chain_root ON recovery_chains(root_operation_id);
    CREATE INDEX IF NOT EXISTS idx_recovery_chain_fp ON recovery_chains(failure_class, target, state);
    CREATE TABLE IF NOT EXISTS recovery_chain_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chain_id TEXT NOT NULL,
      at_ms INTEGER NOT NULL,
      kind TEXT NOT NULL,
      detail_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_recovery_chain_events_chain ON recovery_chain_events(chain_id);
    CREATE TABLE IF NOT EXISTS recovery_handoffs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chain_id TEXT NOT NULL,
      root_operation_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      worker TEXT NOT NULL,
      task_id TEXT,
      at_ms INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_recovery_handoffs_at ON recovery_handoffs(at_ms);
    CREATE INDEX IF NOT EXISTS idx_recovery_handoffs_fp ON recovery_handoffs(fingerprint, at_ms);
    CREATE INDEX IF NOT EXISTS idx_recovery_handoffs_chain ON recovery_handoffs(chain_id);
    CREATE INDEX IF NOT EXISTS idx_recovery_handoffs_root ON recovery_handoffs(root_operation_id);
  `);
  ensured = true;
}

/** Tests only: forget every chain and handoff and restore default budgets. */
export function __resetRecoveryChainsForTests(): void {
  ensureRecoveryChainTables();
  rawDb.exec('DELETE FROM recovery_chains; DELETE FROM recovery_chain_events; DELETE FROM recovery_handoffs;');
  config = defaultConfig();
}

function rowToChain(r: any): RecoveryChain {
  return {
    chainId: r.chain_id,
    chainKey: r.chain_key,
    rootOperationId: r.root_operation_id,
    failureClass: r.failure_class,
    target: r.target,
    state: r.state,
    incidentId: r.incident_id ?? null,
    conversationId: r.conversation_id ?? null,
    goalId: r.goal_id ?? null,
    originalText: r.original_text ?? null,
    originalTextHash: r.original_text_hash ?? null,
    retryCount: r.retry_count,
    maxRetries: r.max_retries,
    handoffCount: r.handoff_count,
    maxHandoffs: r.max_handoffs,
    repairRuns: r.repair_runs,
    suppressedCount: r.suppressed_count,
    signalCount: r.signal_count,
    lastSignalClass: r.last_signal_class ?? null,
    lastSignalDetail: r.last_signal_detail ?? null,
    retryInFlight: r.retry_in_flight === 1,
    retryStartedMs: r.retry_started_ms ?? null,
    nextRetryMs: r.next_retry_ms ?? null,
    lastRetryOutcome: r.last_retry_outcome ?? null,
    terminalReason: r.terminal_reason ?? null,
    createdMs: r.created_ms,
    updatedMs: r.updated_ms,
    closedMs: r.closed_ms ?? null,
  };
}

function recordEvent(chainId: string, kind: string, detail?: unknown, now = Date.now()): void {
  try {
    rawDb.prepare('INSERT INTO recovery_chain_events (chain_id, at_ms, kind, detail_json) VALUES (?,?,?,?)')
      .run(chainId, now, kind, detail === undefined ? null : JSON.stringify(detail));
  } catch (err: any) {
    logger.warn('[RecoveryChain] event write failed', { chainId, kind, error: err?.message });
  }
}

export function getChain(chainId: string): RecoveryChain | undefined {
  ensureRecoveryChainTables();
  const r = rawDb.prepare('SELECT * FROM recovery_chains WHERE chain_id = ?').get(chainId);
  return r ? rowToChain(r) : undefined;
}

export function findChain(ref: { chainId?: string; incidentId?: string; taskId?: string }): RecoveryChain | undefined {
  ensureRecoveryChainTables();
  if (ref.chainId) {
    const c = getChain(ref.chainId);
    if (c) return c;
  }
  if (ref.incidentId) {
    const r = rawDb.prepare('SELECT * FROM recovery_chains WHERE incident_id = ? ORDER BY created_ms DESC LIMIT 1').get(ref.incidentId);
    if (r) return rowToChain(r);
  }
  if (ref.taskId) {
    const r = rawDb.prepare(
      `SELECT c.* FROM recovery_chains c JOIN recovery_handoffs h ON h.chain_id = c.chain_id
        WHERE h.task_id = ? ORDER BY h.at_ms DESC LIMIT 1`,
    ).get(ref.taskId);
    if (r) return rowToChain(r);
  }
  return undefined;
}

export function listChainEvents(chainId: string): Array<{ kind: string; atMs: number; detail: unknown }> {
  ensureRecoveryChainTables();
  const rows = rawDb.prepare('SELECT kind, at_ms, detail_json FROM recovery_chain_events WHERE chain_id = ? ORDER BY id').all(chainId) as any[];
  return rows.map((r) => ({ kind: r.kind, atMs: r.at_ms, detail: r.detail_json ? JSON.parse(r.detail_json) : undefined }));
}

export function listHandoffs(chainId?: string): Array<{ id: number; chainId: string; rootOperationId: string; worker: string; taskId: string | null; atMs: number }> {
  ensureRecoveryChainTables();
  const rows = (chainId
    ? rawDb.prepare('SELECT * FROM recovery_handoffs WHERE chain_id = ? ORDER BY id').all(chainId)
    : rawDb.prepare('SELECT * FROM recovery_handoffs ORDER BY id').all()) as any[];
  return rows.map((r) => ({ id: r.id, chainId: r.chain_id, rootOperationId: r.root_operation_id, worker: r.worker, taskId: r.task_id ?? null, atMs: r.at_ms }));
}

/* ───────────────────────────── identity ───────────────────────────── */

export function normalizeIdentityPart(s: unknown): string {
  return String(s ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200);
}

function normalizeText(s: unknown): string {
  return String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function sha(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** The dedupe identity: (root operation, failure class, target). */
export function chainKeyFor(rootOperationId: string, failureClass: string, target: string): string {
  return sha(`${normalizeIdentityPart(rootOperationId)}\u0000${normalizeIdentityPart(failureClass)}\u0000${normalizeIdentityPart(target)}`).slice(0, 40);
}

function fingerprintOf(failureClass: string, target: string): string {
  return `${normalizeIdentityPart(failureClass)}|${normalizeIdentityPart(target)}`;
}

/**
 * Structured gate reasons produced by guardExternalSideEffect / guardResultPublication.
 * Matching these CODES (not user phrases) is how an ownership/policy rejection is recognised.
 */
const OWNERSHIP_REASON_CODES = new Set([
  'no_ownership_identity',
  'no_turn_identity',
  'no_side_effect_policy',
  'superseded_by_newer_turn',
  'operation_cancelled',
  'operation_success',
  'operation_failed',
  'owner_unregistered_denied',
]);

export function isOwnershipRejectionCode(code: string | null | undefined): boolean {
  if (!code) return false;
  let c = String(code).trim().toLowerCase();
  if (c.startsWith('rejected:')) return true; // executors report a refused gate as `rejected:<reason>`
  c = c.replace(/^publication_/, '');
  return OWNERSHIP_REASON_CODES.has(c) || c.startsWith('policy_denied_') || c.startsWith('operation_');
}

export function classifyFailure(input: { reasonCode?: string | null; error?: string | null; capabilityMissing?: boolean }): FailureClass {
  if (isOwnershipRejectionCode(input.reasonCode) || isOwnershipRejectionCode(input.error)) return 'ownership_rejected';
  if (input.capabilityMissing) return 'capability_missing';
  if (input.error || input.reasonCode) return 'executor_error';
  return 'unknown';
}

/* ───────────────────────────── origin ───────────────────────────── */

export interface DetectedOrigin {
  origin: SignalOrigin;
  rootOperationId?: string;
  recovery?: RecoveryContext;
}

/** Who is signalling? Read from ambient frames; never from the caller's name or text. */
export function detectSignalOrigin(): DetectedOrigin {
  const recovery = currentRecoveryContext();
  if (recovery) return { origin: 'recovery', rootOperationId: recovery.rootOperationId, recovery };

  const frame = currentTurnOwnership();
  if (frame) {
    const frameOrigin = frame.origin ?? 'user_turn';
    const root = frame.operationId ?? `${frame.conversationId}:${frame.turnId}`;
    // Work that DECLARED itself self-heal/recovery is recovery work even without a chain frame.
    if (frameOrigin === 'self_heal' || frameOrigin === 'recovery') return { origin: 'recovery', rootOperationId: root };
    if (frameOrigin === 'background_worker') return { origin: 'background', rootOperationId: root };
    return { origin: 'user_turn', rootOperationId: root };
  }
  return { origin: 'system' };
}

/* ───────────────────────────── helpers ───────────────────────────── */

function activeChainByKey(key: string): RecoveryChain | undefined {
  const r = rawDb.prepare("SELECT * FROM recovery_chains WHERE chain_key = ? AND state = 'ACTIVE'").get(key);
  return r ? rowToChain(r) : undefined;
}

function latestChainByKey(key: string): RecoveryChain | undefined {
  const r = rawDb.prepare('SELECT * FROM recovery_chains WHERE chain_key = ? ORDER BY created_ms DESC, rowid DESC LIMIT 1').get(key);
  return r ? rowToChain(r) : undefined;
}

/** Count a suppressed signal. Deliberately NOT progress: it must not postpone chain expiry. */
function bump(chainId: string): void {
  rawDb.prepare('UPDATE recovery_chains SET suppressed_count = suppressed_count + 1 WHERE chain_id = ?').run(chainId);
}

function latestIncidentForRoot(root: string): string | undefined {
  const r = rawDb.prepare('SELECT incident_id FROM recovery_chains WHERE root_operation_id = ? AND incident_id IS NOT NULL ORDER BY created_ms DESC LIMIT 1').get(root) as any;
  return r?.incident_id ?? undefined;
}

function latestIncidentForFingerprint(failureClass: string, target: string): string | undefined {
  const r = rawDb.prepare('SELECT incident_id FROM recovery_chains WHERE failure_class = ? AND target = ? AND incident_id IS NOT NULL ORDER BY created_ms DESC LIMIT 1').get(failureClass, target) as any;
  return r?.incident_id ?? undefined;
}

/** Expire ACTIVE chains that made no progress for chainTtlMs. */
export function expireStaleChains(now = Date.now()): number {
  ensureRecoveryChainTables();
  const stale = rawDb.prepare("SELECT chain_id FROM recovery_chains WHERE state = 'ACTIVE' AND updated_ms < ?").all(now - config.chainTtlMs) as any[];
  for (const s of stale) closeChain(s.chain_id, 'FAILED', 'expired_without_progress', now);
  return stale.length;
}

/* ───────────────────────────── incident admission ───────────────────────────── */

/**
 * Decide whether a failure signal may open a NEW incident. Synchronous: the decision and
 * the chain insert happen in one tick, so concurrent duplicate signals collapse to one.
 */
export function admitIncident(signal: IncidentSignal, opts: { now?: number } = {}): IncidentAdmission {
  ensureRecoveryChainTables();
  const now = opts.now ?? Date.now();
  expireStaleChains(now);

  const det = detectSignalOrigin();
  const failureClass = normalizeIdentityPart(
    signal.failureClass || classifyFailure({ reasonCode: signal.reasonCode, error: signal.error, capabilityMissing: signal.capabilityMissing }),
  );
  const target = normalizeIdentityPart(signal.target || signal.component);

  // 1. Recovery work records its failure on its chain and goes no further.
  if (det.origin === 'recovery') {
    const chain = recordRecoverySignal({ ...signal, failureClass, target }, { now });
    const chainId = det.recovery?.chainId;
    logger.warn('[RecoveryChain] incident suppressed: raised from recovery work', { chainId, failureClass, target, component: signal.component });
    return { admit: false, reason: 'recovery_origin', origin: 'recovery', chainId: chain?.chainId ?? chainId, incidentId: chain?.incidentId ?? det.recovery?.incidentId, state: chain?.state };
  }

  // 2. An ownership/policy rejection of work that has no user turn behind it is the guard doing
  //    its job. There is no capability defect to repair, and "repairing" it can only loop.
  if (failureClass === 'ownership_rejected' && det.origin !== 'user_turn') {
    logger.warn('[RecoveryChain] incident suppressed: ownership rejection without a user turn', { origin: det.origin, target, component: signal.component });
    return { admit: false, reason: 'ownership_rejection_without_user_turn', origin: det.origin };
  }

  // 3. Root operation identity. A turn-ownership frame wins over anything the caller passes.
  const root = normalizeIdentityPart(det.rootOperationId ?? signal.rootOperationId ?? `system:${signal.component}`);
  const key = chainKeyFor(root, failureClass, target);

  // 4. Collapse onto the chain for the same (root, class, target).
  const known = latestChainByKey(key);
  if (known?.state === 'ACTIVE') {
    bump(known.chainId);
    recordEvent(known.chainId, 'duplicate_signal_collapsed', { component: signal.component }, now);
    return { admit: false, reason: 'duplicate_active', origin: det.origin, chainId: known.chainId, incidentId: known.incidentId ?? undefined, state: known.state };
  }
  // A user operation gets ONE chain per failure. Once it is terminal (recovered, failed or blocked)
  // the same operation failing the same way again does not reopen it: terminal stays terminal.
  if (known && det.origin === 'user_turn') {
    recordEvent(known.chainId, 'signal_after_terminal_ignored', { component: signal.component }, now);
    return { admit: false, reason: 'terminal_chain', origin: det.origin, chainId: known.chainId, incidentId: known.incidentId ?? undefined, state: known.state };
  }

  // 5. Bulkheads.
  const rootCount = (rawDb.prepare('SELECT COUNT(*) AS c FROM recovery_chains WHERE root_operation_id = ?').get(root) as any).c as number;
  if (rootCount >= config.maxChainsPerRoot) {
    return { admit: false, reason: 'root_incident_cap', origin: det.origin, incidentId: latestIncidentForRoot(root) };
  }
  const activeFp = (rawDb.prepare("SELECT COUNT(*) AS c FROM recovery_chains WHERE failure_class = ? AND target = ? AND state = 'ACTIVE'").get(failureClass, target) as any).c as number;
  if (activeFp >= config.maxActiveChainsPerFingerprint) {
    return { admit: false, reason: 'fingerprint_active_cap', origin: det.origin, incidentId: latestIncidentForFingerprint(failureClass, target) };
  }
  if (det.origin !== 'user_turn' && config.terminalCooldownMs > 0 && known && (known.state === 'FAILED' || known.state === 'BLOCKED') && (known.closedMs ?? 0) >= now - config.terminalCooldownMs) {
    return { admit: false, reason: 'terminal_cooldown', origin: det.origin, chainId: known.chainId, incidentId: known.incidentId ?? undefined, state: known.state };
  }

  // 6. Admit: this is the ONE active chain for the key.
  const chainId = `rc-${randomUUID().slice(0, 12)}`;
  const text = signal.originalText ? String(signal.originalText) : null;
  try {
    rawDb.prepare(
      `INSERT INTO recovery_chains (chain_id, chain_key, root_operation_id, failure_class, target, state, conversation_id, goal_id,
         original_text, original_text_hash, max_retries, max_handoffs, created_at, created_ms, updated_ms)
       VALUES (?,?,?,?,?,'ACTIVE',?,?,?,?,?,?,?,?,?)`,
    ).run(
      chainId, key, root, failureClass, target, signal.conversationId ?? null, signal.goalId ?? null,
      text, text ? sha(normalizeText(text)) : null, config.maxRetriesPerChain, config.maxHandoffsPerChain,
      new Date(now).toISOString(), now, now,
    );
  } catch (err: any) {
    if (String(err?.code || '').startsWith('SQLITE_CONSTRAINT')) {
      const winner = activeChainByKey(key);
      if (winner) return { admit: false, reason: 'duplicate_active', origin: det.origin, chainId: winner.chainId, incidentId: winner.incidentId ?? undefined, state: winner.state };
    }
    throw err;
  }
  recordEvent(chainId, 'chain_opened', { origin: det.origin, root, failureClass, target, component: signal.component }, now);
  return { admit: true, chainId, rootOperationId: root, failureClass, target, origin: det.origin };
}

/**
 * Record a failure observed by RECOVERY WORK on its own chain (no-op outside recovery work).
 * The observed class is what lets a retry that failed the same deterministic way go terminal.
 */
export function recordRecoverySignal(signal: IncidentSignal, opts: { now?: number } = {}): RecoveryChain | undefined {
  ensureRecoveryChainTables();
  const now = opts.now ?? Date.now();
  const ctx = currentRecoveryContext();
  if (!ctx) return undefined;
  const chain = getChain(ctx.chainId);
  if (!chain) return undefined;
  const failureClass = normalizeIdentityPart(
    signal.failureClass || classifyFailure({ reasonCode: signal.reasonCode, error: signal.error, capabilityMissing: signal.capabilityMissing }),
  );
  const target = normalizeIdentityPart(signal.target || signal.component);
  rawDb.prepare(
    `UPDATE recovery_chains SET signal_count = signal_count + 1, suppressed_count = suppressed_count + 1,
            last_signal_class = ?, last_signal_detail = ? WHERE chain_id = ?`,
  ).run(failureClass, String(signal.error || signal.reasonCode || signal.component).slice(0, 300), chain.chainId);
  recordEvent(chain.chainId, 'recovery_signal_suppressed', { failureClass, target, component: signal.component }, now);
  return getChain(chain.chainId);
}

/** Bind the incident that was created for an admitted chain. */
export function attachIncident(chainId: string, incidentId: string): void {
  ensureRecoveryChainTables();
  rawDb.prepare('UPDATE recovery_chains SET incident_id = ?, updated_ms = ? WHERE chain_id = ? AND incident_id IS NULL').run(incidentId, Date.now(), chainId);
  recordEvent(chainId, 'incident_attached', { incidentId });
}

/* ───────────────────────────── retry admission ───────────────────────────── */

function backoffMs(attempt: number): number {
  if (config.retryBackoffBaseMs <= 0) return 0;
  return Math.min(config.retryBackoffCapMs, config.retryBackoffBaseMs * Math.pow(2, Math.max(0, attempt - 1)));
}

/**
 * Admit ONE retry of a chain's root operation. Bounded by attempt count, backoff, a single
 * in-flight retry, and by the rule that a retry may only re-run the root operation's own
 * recorded request (never a repair objective or any other text).
 */
export function admitRetry(
  input: { chainId?: string; incidentId?: string; taskId?: string; text: string; conversationId?: string; goalId?: string; retryOfRequestId?: string },
  opts: { now?: number } = {},
): RetryAdmission {
  ensureRecoveryChainTables();
  const now = opts.now ?? Date.now();
  expireStaleChains(now);

  const run = rawDb.transaction((): RetryAdmission => {
    let adopted = false;
    let chain = findChain(input);
    if (!chain) {
      // A retry of something the registry has never seen (legacy incident / task). Adopt it so
      // that it is bounded like every other chain instead of being an unbounded side door.
      const root = normalizeIdentityPart(input.retryOfRequestId || input.incidentId || input.taskId || `adopted:${randomUUID().slice(0, 8)}`);
      const target = normalizeIdentityPart(input.incidentId || input.taskId || 'adopted');
      const key = chainKeyFor(root, 'adopted', target);
      chain = activeChainByKey(key);
      if (!chain) {
        const chainId = `rc-${randomUUID().slice(0, 12)}`;
        const text = input.text ? String(input.text) : null;
        rawDb.prepare(
          `INSERT INTO recovery_chains (chain_id, chain_key, root_operation_id, failure_class, target, state, incident_id, conversation_id, goal_id,
             original_text, original_text_hash, max_retries, max_handoffs, created_at, created_ms, updated_ms)
           VALUES (?,?,?,?,?,'ACTIVE',?,?,?,?,?,?,?,?,?,?)`,
        ).run(chainId, key, root, 'adopted', target, input.incidentId ?? null, input.conversationId ?? null, input.goalId ?? null,
          text, text ? sha(normalizeText(text)) : null, config.maxRetriesPerChain, config.maxHandoffsPerChain, new Date(now).toISOString(), now, now);
        recordEvent(chainId, 'chain_adopted', { incidentId: input.incidentId, taskId: input.taskId }, now);
        chain = getChain(chainId)!;
      }
      adopted = true;
    }

    const refuse = (reason: RetryRefusal, extra: { terminal?: boolean; retryAfterMs?: number } = {}): RetryAdmission => {
      bump(chain!.chainId);
      recordEvent(chain!.chainId, 'retry_refused', { reason, ...extra }, now);
      const fresh = getChain(chain!.chainId)!;
      return { admit: false, reason, chainId: fresh.chainId, state: fresh.state, terminal: extra.terminal ?? TERMINAL_CHAIN_STATES.includes(fresh.state), retryAfterMs: extra.retryAfterMs };
    };

    if (chain.state !== 'ACTIVE') return refuse('chain_terminal', { terminal: true });

    if (chain.originalTextHash && sha(normalizeText(input.text)) !== chain.originalTextHash) return refuse('retry_text_mismatch');

    if (chain.retryCount >= chain.maxRetries) {
      closeChain(chain.chainId, 'FAILED', 'retry_budget_exhausted', now);
      return refuse('retry_budget_exhausted', { terminal: true });
    }
    if (chain.retryInFlight && (chain.retryStartedMs ?? 0) > now - config.retryLeaseMs) return refuse('retry_in_flight');
    if (chain.nextRetryMs && now < chain.nextRetryMs) return refuse('backoff', { retryAfterMs: chain.nextRetryMs - now });

    const attempt = chain.retryCount + 1;
    rawDb.prepare(
      `UPDATE recovery_chains SET retry_count = ?, retry_in_flight = 1, retry_started_ms = ?, next_retry_ms = ?,
              last_signal_class = NULL, last_signal_detail = NULL, updated_ms = ? WHERE chain_id = ?`,
    ).run(attempt, now, backoffMs(attempt) > 0 ? now + backoffMs(attempt) : null, now, chain.chainId);
    recordEvent(chain.chainId, 'retry_admitted', { attempt, adopted }, now);
    return { admit: true, chainId: chain.chainId, rootOperationId: chain.rootOperationId, incidentId: chain.incidentId, attempt, adopted };
  });
  return run();
}

/**
 * Record how an admitted retry ended and decide whether the chain is finished.
 * VERIFIED -> RECOVERED. A retry that hit an ownership/policy rejection again is a
 * deterministic failure -> BLOCKED. An exhausted budget -> FAILED. Otherwise the chain
 * stays ACTIVE (and backoff applies to the next attempt).
 */
export function recordRetryResult(
  input: { chainId: string; outcome: string; reason?: string; failureText?: string | null },
  opts: { now?: number } = {},
): { state: ChainState; terminal: boolean; terminalReason?: string } {
  ensureRecoveryChainTables();
  const now = opts.now ?? Date.now();
  const chain = getChain(input.chainId);
  if (!chain) return { state: 'FAILED', terminal: true, terminalReason: 'unknown_chain' };

  rawDb.prepare('UPDATE recovery_chains SET retry_in_flight = 0, last_retry_outcome = ?, updated_ms = ? WHERE chain_id = ?').run(input.outcome, now, chain.chainId);
  recordEvent(chain.chainId, 'retry_result', { outcome: input.outcome, reason: input.reason }, now);

  if (chain.state !== 'ACTIVE') return { state: chain.state, terminal: true, terminalReason: chain.terminalReason ?? undefined };

  if (input.outcome === 'VERIFIED') {
    closeChain(chain.chainId, 'RECOVERED', 'retry_verified', now);
    return { state: 'RECOVERED', terminal: true, terminalReason: 'retry_verified' };
  }

  // Deterministic policy rejection: reported by a failure signal raised during the retry, or by the
  // retry's own failure code (`rejected:<gate reason>`). Repairing or retrying cannot change it.
  const ownershipRejected = chain.lastSignalClass === 'ownership_rejected'
    || classifyFailure({ reasonCode: input.failureText, error: input.failureText }) === 'ownership_rejected';
  if (ownershipRejected) {
    closeChain(chain.chainId, 'BLOCKED', 'ownership_rejected_on_retry', now);
    return { state: 'BLOCKED', terminal: true, terminalReason: 'ownership_rejected_on_retry' };
  }
  if (input.outcome === 'BLOCKED') {
    closeChain(chain.chainId, 'BLOCKED', 'retry_blocked_by_lifecycle', now);
    return { state: 'BLOCKED', terminal: true, terminalReason: 'retry_blocked_by_lifecycle' };
  }
  if (chain.retryCount >= chain.maxRetries) {
    closeChain(chain.chainId, 'FAILED', 'retry_budget_exhausted', now);
    return { state: 'FAILED', terminal: true, terminalReason: 'retry_budget_exhausted' };
  }
  return { state: 'ACTIVE', terminal: false };
}

/* ───────────────────────────── handoff admission ───────────────────────────── */

/**
 * Admit ONE engineering handoff (a new worker task/window). Caps, in order: per chain, per
 * root operation, per failure fingerprint per window, and a global circuit breaker.
 */
export function admitHandoff(input: { chainId: string; worker: string }, opts: { now?: number } = {}): HandoffAdmission {
  ensureRecoveryChainTables();
  const now = opts.now ?? Date.now();
  expireStaleChains(now);

  const run = rawDb.transaction((): HandoffAdmission => {
    const chain = getChain(input.chainId);
    if (!chain) return { admit: false, reason: 'unknown_chain', chainId: input.chainId };
    const refuse = (reason: HandoffRefusal, blockChain: boolean): HandoffAdmission => {
      bump(chain.chainId);
      recordEvent(chain.chainId, 'handoff_refused', { reason, worker: input.worker }, now);
      logger.warn('[RecoveryChain] engineering handoff refused', { chainId: chain.chainId, reason, worker: input.worker });
      if (blockChain && chain.state === 'ACTIVE' && chain.handoffCount === 0) closeChain(chain.chainId, 'BLOCKED', `handoff_refused:${reason}`, now);
      return { admit: false, reason, chainId: chain.chainId, state: getChain(chain.chainId)?.state };
    };

    if (chain.state !== 'ACTIVE') return refuse('chain_terminal', false);
    if (chain.handoffCount >= chain.maxHandoffs) return refuse('chain_handoff_cap', false);

    const perRoot = (rawDb.prepare('SELECT COUNT(*) AS c FROM recovery_handoffs WHERE root_operation_id = ?').get(chain.rootOperationId) as any).c as number;
    if (perRoot >= config.maxHandoffsPerRoot) return refuse('root_handoff_cap', true);

    const fp = fingerprintOf(chain.failureClass, chain.target);
    const perFp = (rawDb.prepare('SELECT COUNT(*) AS c FROM recovery_handoffs WHERE fingerprint = ? AND at_ms >= ?').get(fp, now - config.fingerprintWindowMs) as any).c as number;
    if (perFp >= config.fingerprintMaxHandoffs) return refuse('fingerprint_recent', true);

    const global = (rawDb.prepare('SELECT COUNT(*) AS c FROM recovery_handoffs WHERE at_ms >= ?').get(now - config.globalWindowMs) as any).c as number;
    if (global >= config.globalMaxHandoffs) return refuse('breaker_open', true);

    const info = rawDb.prepare('INSERT INTO recovery_handoffs (chain_id, root_operation_id, fingerprint, worker, at_ms) VALUES (?,?,?,?,?)')
      .run(chain.chainId, chain.rootOperationId, fp, input.worker, now);
    rawDb.prepare('UPDATE recovery_chains SET handoff_count = handoff_count + 1, updated_ms = ? WHERE chain_id = ?').run(now, chain.chainId);
    recordEvent(chain.chainId, 'handoff_admitted', { worker: input.worker, handoffId: Number(info.lastInsertRowid) }, now);
    return { admit: true, handoffId: Number(info.lastInsertRowid), chainId: chain.chainId };
  });
  return run();
}

export function recordHandoffTask(handoffId: number, taskId: string): void {
  ensureRecoveryChainTables();
  rawDb.prepare('UPDATE recovery_handoffs SET task_id = ? WHERE id = ?').run(taskId, handoffId);
}

/* ───────────────────────────── closed-loop repair admission ───────────────────────────── */

/** A closed-loop repair run may start once per chain, and never from recovery work. */
export function admitRepairRun(input: { incidentId?: string; chainId?: string }, opts: { now?: number; resume?: boolean } = {}): { admit: boolean; reason?: string; chainId?: string } {
  ensureRecoveryChainTables();
  const now = opts.now ?? Date.now();
  if (currentRecoveryContext()) return { admit: false, reason: 'recovery_origin', chainId: currentRecoveryContext()!.chainId };
  const chain = findChain(input);
  if (!chain) return { admit: true }; // legacy incident with no chain: nothing to bound against
  if (chain.state !== 'ACTIVE') return { admit: false, reason: 'chain_terminal', chainId: chain.chainId };
  if (!opts.resume && chain.repairRuns >= config.maxRepairRunsPerChain) {
    bump(chain.chainId);
    recordEvent(chain.chainId, 'repair_run_refused', { reason: 'repair_run_cap' }, now);
    return { admit: false, reason: 'repair_run_cap', chainId: chain.chainId };
  }
  if (!opts.resume) rawDb.prepare('UPDATE recovery_chains SET repair_runs = repair_runs + 1, updated_ms = ? WHERE chain_id = ?').run(now, chain.chainId);
  recordEvent(chain.chainId, opts.resume ? 'repair_run_resumed' : 'repair_run_admitted', {}, now);
  return { admit: true, chainId: chain.chainId };
}

/* ───────────────────────────── terminal handling ───────────────────────────── */

const CLOSED_INCIDENT_STATUSES = new Set(['resolved', 'closed', 'unresolved', 'completed', 'monitoring', 'invalid_misclassified', 'failed_escalated', 'superseded']);

/** A failed/blocked chain closes its incident as `unresolved` for a human; it is never retried automatically. */
function markIncidentTerminal(incidentId: string, state: ChainState, chainId: string, reason: string, now: number): void {
  try {
    const row: any = rawDb.prepare('SELECT status, metadata FROM repair_incidents WHERE id = ?').get(incidentId);
    if (!row) return;
    let meta: any = {};
    try { meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {}); } catch { /* keep empty */ }
    meta.recoveryChain = { chainId, state, reason, at: new Date(now).toISOString() };
    const alreadyClosed = CLOSED_INCIDENT_STATUSES.has(String(row.status).toLowerCase());
    if (alreadyClosed) {
      rawDb.prepare('UPDATE repair_incidents SET metadata = ? WHERE id = ?').run(JSON.stringify(meta), incidentId);
      return;
    }
    rawDb.prepare('UPDATE repair_incidents SET status = ?, resolved_at = ?, metadata = ? WHERE id = ?').run('unresolved', new Date(now).toISOString(), JSON.stringify(meta), incidentId);
    try {
      rawDb.prepare(
        `INSERT INTO repair_evidence (id, incident_id, type, label, content, source, timestamp)
         VALUES (?, ?, 'audit', 'recovery_chain_terminal', ?, 'recoveryChain', ?)`,
      ).run(`ev-rc-${incidentId}-${now.toString(36)}`, incidentId, `${row.status} -> unresolved: recovery chain ${chainId} ${state} (${reason})`, new Date(now).toISOString());
    } catch { /* the evidence table may not exist in every environment */ }
  } catch (err: any) {
    logger.warn('[RecoveryChain] could not close incident for terminal chain', { incidentId, chainId, error: err?.message });
  }
}

export function closeChain(chainId: string, state: Exclude<ChainState, 'ACTIVE'>, reason: string, now = Date.now()): void {
  ensureRecoveryChainTables();
  const chain = getChain(chainId);
  if (!chain || chain.state !== 'ACTIVE') return;
  rawDb.prepare('UPDATE recovery_chains SET state = ?, terminal_reason = ?, retry_in_flight = 0, closed_ms = ?, updated_ms = ? WHERE chain_id = ?').run(state, reason, now, now, chainId);
  recordEvent(chainId, `chain_${state.toLowerCase()}`, { reason }, now);
  logger.info('[RecoveryChain] chain closed', { chainId, state, reason, incidentId: chain.incidentId });
  if (state !== 'RECOVERED' && chain.incidentId) markIncidentTerminal(chain.incidentId, state, chainId, reason, now);
}

/** Build the recovery context for work that belongs to an existing chain (e.g. a retry). */
export function recoveryContextFromChain(chain: RecoveryChain, attempt: number, origin: RecoveryContext['origin'] = 'self_heal_retry'): RecoveryContext {
  return { chainId: chain.chainId, rootOperationId: chain.rootOperationId, incidentId: chain.incidentId ?? undefined, attempt, origin };
}
