/**
 * perceptionOperation.ts — turn ownership + terminal-state guarantee.
 *
 * WHY THIS EXISTS (P0 audit DEFECT-5 / DEFECT-6, "Turn supersession")
 * An async capability operation used to keep running with no record of which turn
 * asked for it. After "Stop" (or after a newer turn superseded it) a late
 * completion could still speak, still write conversation/focus state, or still
 * launch an application. Nothing owned the work, so nothing could refuse it.
 *
 * Every dispatched capability operation now registers here with:
 *   conversationId, turnId, operationId, originTurnId, capability
 * and must END in exactly one of SUCCESS / FAILED / CANCELLED. Before any
 * external side effect or any publish, the operation is re-checked against the
 * conversation's active turn; a stale or cancelled operation is refused.
 *
 * This is deliberately a gate, not a scheduler: it uses no timers and no sleeps.
 * Supersession is decided from the registered turn ids and the explicit status.
 */

export type OperationStatus = 'ACCEPTED' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';

export const TERMINAL_STATUSES: readonly OperationStatus[] = ['SUCCESS', 'FAILED', 'CANCELLED'];

export interface PerceptionOperation {
  operationId: string;
  conversationId: string;
  turnId: number | string;
  originTurnId: number | string;
  capability: string;
  status: OperationStatus;
  createdAt: number;
  updatedAt: number;
  reason?: string;
  /** Who asked for this work. Background origins get no desktop rights. */
  origin: OperationOrigin;
  /** Explicit permission set for external side effects of this operation. */
  policy: SideEffectPolicy;
  /** Human-readable provenance (module or subsystem) for audit logs. */
  source?: string;
}

const byId = new Map<string, PerceptionOperation>();
/** conversationId -> operationId of the most recently started operation. */
const latestByConversation = new Map<string, string>();
let seq = 0;

function turnOrder(v: number | string | undefined): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  const n = Number(v);
  return Number.isFinite(n) && String(v ?? '').trim() !== '' ? n : NaN;
}

export function isTerminal(op: PerceptionOperation | undefined | null): boolean {
  return !!op && TERMINAL_STATUSES.includes(op.status);
}

export interface BeginOperationInput {
  conversationId: string;
  turnId: number | string;
  capability: string;
  originTurnId?: number | string;
  now?: number;
  origin?: OperationOrigin;
  policy?: SideEffectPolicy;
  source?: string;
}

/**
 * Register an accepted operation. This is the ONLY point at which the turn may
 * emit an acknowledgement (D-6): the ack means "a real capability operation was
 * accepted and dispatched", never "a timer fired while routing was unresolved".
 *
 * A user turn defaults to USER_TURN_POLICY; a background caller must supply its
 * own origin and policy explicitly (see beginBackgroundOperation).
 */
export function beginOperation(input: BeginOperationInput): PerceptionOperation {
  const at = input.now ?? Date.now();
  seq += 1;
  const origin: OperationOrigin = input.origin ?? 'user_turn';
  const op: PerceptionOperation = {
    operationId: `op-${at}-${seq}`,
    conversationId: input.conversationId,
    turnId: input.turnId,
    originTurnId: input.originTurnId ?? input.turnId,
    capability: input.capability,
    status: 'ACCEPTED',
    createdAt: at,
    updatedAt: at,
    origin,
    policy: input.policy ?? (origin === 'user_turn' ? USER_TURN_POLICY : BACKGROUND_DENY_ALL_POLICY),
    source: input.source,
  };
  byId.set(op.operationId, op);
  latestByConversation.set(input.conversationId, op.operationId);
  return op;
}

/** Synthetic conversation id for operations not tied to a user turn. */
export const BACKGROUND_CONVERSATION_ID = '__background__';

export interface BackgroundOperationInput {
  /** Background origins only — a user turn must go through beginOperation. */
  origin: Exclude<OperationOrigin, 'user_turn'>;
  capability: string;
  /** Required. There is no implicit grant for background work. */
  policy: SideEffectPolicy;
  conversationId?: string;
  source?: string;
  now?: number;
}

/**
 * Register a background/system operation with an EXPLICIT side-effect policy.
 * This is the only way non-user work obtains the right to act, and the policy is
 * what decides which classes of side effect it may perform.
 */
export function beginBackgroundOperation(input: BackgroundOperationInput): PerceptionOperation {
  const at = input.now ?? Date.now();
  return beginOperation({
    conversationId: input.conversationId ?? BACKGROUND_CONVERSATION_ID,
    turnId: `bg-${input.origin}-${input.capability}-${at}`,
    capability: input.capability,
    origin: input.origin,
    policy: input.policy,
    source: input.source,
    now: at,
  });
}

export function markRunning(op: PerceptionOperation, now?: number): PerceptionOperation {
  if (isTerminal(op)) return op;
  op.status = 'RUNNING';
  op.updatedAt = now ?? Date.now();
  return op;
}

/** Terminal-state guarantee: every operation ends in exactly one terminal state. */
export function completeOperation(
  op: PerceptionOperation,
  outcome: 'SUCCESS' | 'FAILED',
  reason?: string,
  now?: number,
): PerceptionOperation {
  if (isTerminal(op)) return op;
  op.status = outcome;
  op.reason = reason;
  op.updatedAt = now ?? Date.now();
  return op;
}

export function cancelOperation(
  op: PerceptionOperation,
  reason: string,
  now?: number,
): PerceptionOperation {
  if (isTerminal(op)) return op;
  op.status = 'CANCELLED';
  op.reason = reason;
  op.updatedAt = now ?? Date.now();
  return op;
}

/** Cancel every non-terminal operation of a conversation (Stop / Never mind). */
export function cancelConversationOperations(
  conversationId: string,
  reason: string,
  now?: number,
): PerceptionOperation[] {
  const cancelled: PerceptionOperation[] = [];
  for (const op of byId.values()) {
    if (op.conversationId !== conversationId) continue;
    if (isTerminal(op)) continue;
    cancelled.push(cancelOperation(op, reason, now));
  }
  return cancelled;
}

export function getOperation(operationId: string): PerceptionOperation | undefined {
  return byId.get(operationId);
}

export function getLatestOperation(conversationId: string): PerceptionOperation | undefined {
  const id = latestByConversation.get(conversationId);
  return id ? byId.get(id) : undefined;
}

export interface OwnershipCheck {
  ok: boolean;
  reason: string;
}

/**
 * The supersession gate. Returns ok=false when this operation no longer owns the
 * conversation: it was cancelled, or a strictly newer turn has taken over.
 */
export function checkOperationOwnership(
  op: PerceptionOperation,
  opts: { currentTurnId: number | string },
): OwnershipCheck {
  if (op.status === 'CANCELLED') return { ok: false, reason: 'operation_cancelled' };
  // A newer turn for the same conversation supersedes this one. Compared only
  // when both ids are numeric (string ids are not orderable).
  const mine = turnOrder(op.turnId);
  const current = turnOrder(opts.currentTurnId);
  if (Number.isFinite(mine) && Number.isFinite(current) && current > mine) {
    return { ok: false, reason: 'superseded_by_newer_turn' };
  }
  return { ok: true, reason: 'owner' };
}

/**
 * Gate for external side effects (launching an app, changing window focus) and
 * for publishing a result. Executors call this immediately before acting.
 */
export function mayPerformSideEffect(
  op: PerceptionOperation,
  opts: { currentTurnId: number | string },
): OwnershipCheck {
  const check = checkOperationOwnership(op, opts);
  if (!check.ok) {
    // The operation is stale: make terminal so it can never act later.
    cancelOperation(op, check.reason);
  }
  return check;
}

export function resetOperationRegistry(): void {
  byId.clear();
  latestByConversation.clear();
  activeTurnByConversation.clear();
  seq = 0;
}

/* ── authoritative active-turn tracking (supersession source of truth) ───── */

/**
 * The highest turn id seen per conversation. This is what makes supersession
 * decidable for work that never registered an operation: when turn 11 arrives,
 * turn 10 is stale by definition, whatever it was about to do.
 */
const activeTurnByConversation = new Map<string, number | string>();

export function getActiveTurn(conversationId: string): number | string | undefined {
  return activeTurnByConversation.get(conversationId);
}

/**
 * Record that a new turn of this conversation has started. Called on entry to
 * routing for EVERY turn (not only perception turns) so supersession is
 * authoritative. Any non-terminal operation belonging to a strictly older turn
 * is cancelled here — "mark/cancel stale operation appropriately".
 */
export function noteConversationTurn(
  conversationId: string,
  turnId: number | string,
  now?: number,
): PerceptionOperation[] {
  const previous = activeTurnByConversation.get(conversationId);
  const isNewer =
    previous === undefined ||
    (Number.isFinite(turnOrder(turnId)) &&
      Number.isFinite(turnOrder(previous)) &&
      turnOrder(turnId) > turnOrder(previous)) ||
    String(previous) !== String(turnId);
  if (!isNewer) return [];
  activeTurnByConversation.set(conversationId, turnId);

  const cancelled: PerceptionOperation[] = [];
  for (const op of byId.values()) {
    if (op.conversationId !== conversationId) continue;
    if (isTerminal(op)) continue;
    // Only user-turn work is superseded by a newer user turn. Background work
    // is governed by its own policy and operation lifecycle, not by the user's
    // conversation tempo.
    if (op.origin !== 'user_turn') continue;
    const mine = turnOrder(op.turnId);
    const current = turnOrder(turnId);
    if (Number.isFinite(mine) && Number.isFinite(current) && current > mine) {
      cancelled.push(cancelOperation(op, 'superseded_by_newer_turn', now));
    }
  }
  return cancelled;
}

/** Newest operation registered for a specific conversation + turn. */
export function findOperationForTurn(
  conversationId: string,
  turnId: number | string,
): PerceptionOperation | undefined {
  let found: PerceptionOperation | undefined;
  for (const op of byId.values()) {
    if (op.conversationId !== conversationId) continue;
    if (String(op.turnId) !== String(turnId)) continue;
    if (!found || op.createdAt >= found.createdAt) found = op;
  }
  return found;
}

/** Result of an ownership gate, shaped for structured rejection logging. */
export interface SideEffectGate {
  ok: boolean;
  reason: string;
  operationId?: string;
  conversationId?: string;
  turnId?: number | string;
  registered: boolean;
}

/* ── explicit operation origins and side-effect policy (fail-closed) ─────── */

/**
 * Who asked for this work. Only `user_turn` means a human is present at the
 * desktop. Background origins never inherit the right to control it.
 */
export type OperationOrigin = 'user_turn' | 'self_heal' | 'recovery' | 'background_worker';

/**
 * Explicit per-operation permission for external side effects. A background
 * operation WITHOUT a policy is denied — there is no implicit grant, and no
 * permission is ever inferred from process, timing or caller name.
 */
export interface SideEffectPolicy {
  allowTerminal: boolean;
  allowGuiLaunch: boolean;
  allowForegroundChange: boolean;
  allowBrowserNavigation: boolean;
  /**
   * Drives a HEADLESS browser only — no visible window is opened or focused.
   * Kept separate from `allowBrowserNavigation` because the interactive mode
   * launches a maximized visible Chrome and forces it to the foreground, which
   * background work must never do implicitly.
   */
  allowHeadlessBrowserNavigation: boolean;
  allowProcessControl: boolean;
  allowPerception: boolean;
}

/** A user turn may do whatever the user explicitly asked for. */
export const USER_TURN_POLICY: SideEffectPolicy = {
  allowTerminal: true,
  allowGuiLaunch: true,
  allowForegroundChange: true,
  allowBrowserNavigation: true,
  allowHeadlessBrowserNavigation: true,
  allowProcessControl: true,
  allowPerception: true,
};

/**
 * BACKGROUND MAINTENANCE: may run commands, may NOT touch the user's desktop.
 * "Background is not automatic permission to control the user's desktop."
 */
export const BACKGROUND_MAINTENANCE_POLICY: SideEffectPolicy = {
  allowTerminal: true,
  allowGuiLaunch: false,
  allowForegroundChange: false,
  allowBrowserNavigation: false,
  allowHeadlessBrowserNavigation: false,
  allowProcessControl: false,
  allowPerception: true,
};

/** Read-only background probe — no side effects of any kind. */
export const BACKGROUND_DENY_ALL_POLICY: SideEffectPolicy = {
  allowTerminal: false,
  allowGuiLaunch: false,
  allowForegroundChange: false,
  allowBrowserNavigation: false,
  allowHeadlessBrowserNavigation: false,
  allowProcessControl: false,
  allowPerception: false,
};

/**
 * SELF-HEAL / RECOVERY: may run commands and may drive a HEADLESS browser
 * session to re-run a failed browser goal. It may NOT launch GUI applications,
 * change the user's foreground window, kill processes, or drive the user's
 * VISIBLE interactive browser — `browser_navigation` stays false on purpose.
 * A repair loop that silently takes over the user's browser is worse than the
 * failure it is repairing.
 */
export const BACKGROUND_REPAIR_POLICY: SideEffectPolicy = {
  allowTerminal: true,
  allowGuiLaunch: false,
  allowForegroundChange: false,
  allowBrowserNavigation: false,
  allowHeadlessBrowserNavigation: true,
  allowProcessControl: false,
  allowPerception: true,
};

/** Maps a capability string to the policy flag that governs it. */
export function policyFlagForCapability(capability: string): keyof SideEffectPolicy {
  switch (capability) {
    case 'terminal':
      return 'allowTerminal';
    case 'desktop_launch':
      return 'allowGuiLaunch';
    case 'desktop_kill':
      return 'allowProcessControl';
    case 'desktop_foreground':
    case 'desktop_automation':
      return 'allowForegroundChange';
    case 'browser_navigation':
    case 'browser_action':
      return 'allowBrowserNavigation';
    case 'headless_browser_navigation':
      return 'allowHeadlessBrowserNavigation';
    case 'camera_perception':
    case 'read_foreground_screen':
    case 'perception':
      return 'allowPerception';
    default:
      // Unknown capability = most restrictive interactive permission.
      return 'allowForegroundChange';
  }
}

export function policyAllows(policy: SideEffectPolicy | undefined, capability: string): boolean {
  if (!policy) return false;
  return policy[policyFlagForCapability(capability)] === true;
}

function deny(
  reason: string,
  ctx: { conversationId?: string; turnId?: number | string; operationId?: string; registered: boolean },
): SideEffectGate {
  return { ok: false, reason, ...ctx };
}

export interface SideEffectGuardInput {
  capability: string;
  conversationId?: string;
  turnId?: number | string;
  operationId?: string;
  origin?: OperationOrigin;
  policy?: SideEffectPolicy;
  now?: number;
}

/**
 * THE authoritative gate for an external side effect.
 *
 * Call this immediately before the OS/browser call that actually does the thing
 * (spawn, Start-Process, navigate, type/click, PowerShell, taskkill). There must
 * be no meaningful work between this check and the side effect.
 *
 * FAIL-CLOSED. A side effect must carry either valid current user-turn ownership
 * or a registered background operation with an explicit policy that permits this
 * capability. No identity = REJECT — absence of ownership identity is never
 * permission, and ownership is never inferred from process, timing or caller name.
 */
export function guardExternalSideEffect(input: SideEffectGuardInput): SideEffectGate {
  const { conversationId, turnId, capability } = input;
  const origin: OperationOrigin = input.origin ?? 'user_turn';

  const hasTurn = Boolean(conversationId) && turnId !== undefined && turnId !== null;

  // ── Fail-closed: no identity at all is NOT permission ───────────────────
  if (!hasTurn && !input.operationId) {
    return deny('no_ownership_identity', { registered: false });
  }

  const op = input.operationId
    ? getOperation(input.operationId)
    : hasTurn
      ? findOperationForTurn(conversationId as string, turnId as number | string)
      : undefined;

  // A terminal operation never acts again (cancelled, or already completed).
  if (op && isTerminal(op)) {
    return deny(`operation_${op.status.toLowerCase()}`, {
      registered: true,
      conversationId,
      turnId,
      operationId: op.operationId,
    });
  }

  // ── Background origins: an explicit policy is REQUIRED ──────────────────
  if (origin !== 'user_turn') {
    const policy = input.policy ?? op?.policy;
    if (!policy) {
      return deny('no_side_effect_policy', {
        registered: !!op,
        conversationId,
        turnId,
        operationId: op?.operationId ?? input.operationId,
      });
    }
    if (!policyAllows(policy, capability)) {
      return deny(`policy_denied_${policyFlagForCapability(capability)}`, {
        registered: !!op,
        conversationId,
        turnId,
        operationId: op?.operationId ?? input.operationId,
      });
    }
    return {
      ok: true,
      reason: `background_authorized:${origin}`,
      operationId: op?.operationId ?? input.operationId,
      conversationId,
      turnId,
      registered: !!op,
    };
  }

  // ── User turn: the ACTIVE turn of the conversation owns the desktop ─────
  if (!hasTurn) {
    // An operationId alone cannot prove ownership of a user turn.
    return deny('no_turn_identity', { registered: !!op, conversationId, turnId, operationId: input.operationId });
  }

  const active = activeTurnByConversation.get(conversationId as string);
  if (active !== undefined) {
    const mine = turnOrder(turnId as number | string);
    const current = turnOrder(active);
    if (Number.isFinite(mine) && Number.isFinite(current) && current > mine) {
      if (op) cancelOperation(op, 'superseded_by_newer_turn', input.now);
      return deny('superseded_by_newer_turn', {
        registered: !!op,
        conversationId,
        turnId,
        operationId: op?.operationId ?? input.operationId,
      });
    }
  }

  return {
    ok: true,
    reason: op ? 'owner' : 'owner_unregistered',
    operationId: op?.operationId ?? input.operationId,
    conversationId,
    turnId,
    registered: !!op,
  };
}

/**
 * Gate for PUBLISHING a result (speech, perception-focus mutation, terminal
 * output). Async work happened between dispatch and completion, so ownership is
 * validated again here.
 */
export function guardResultPublication(input: {
  conversationId?: string;
  turnId?: number | string;
  capability: string;
  operationId?: string;
  origin?: OperationOrigin;
  policy?: SideEffectPolicy;
}): SideEffectGate {
  const gate = guardExternalSideEffect(input);
  if (!gate.ok) return { ...gate, reason: `publication_${gate.reason}` };
  return gate;
}

/**
 * D-6: an acknowledgement may only be spoken once a REAL capability operation has
 * been accepted and dispatched for this turn. "A timer fired while routing was
 * still unresolved" is not a reason to speak.
 *
 * Acknowledging an operation that was accepted and then failed is acceptable —
 * the ack was truthful at the time it was spoken. Acknowledging a turn for which
 * nothing was ever created is not.
 */
export interface AckDecision {
  allowed: boolean;
  operationId?: string;
  reason: string;
}

export function authorizePreliminaryAck(input: {
  conversationId: string;
  turnId: number | string;
  /**
   * True for capabilities that are known to be long-running and which do not yet
   * register an operation (browser/engineering/delegation). Keeps their existing
   * acknowledgements working without re-introducing the "timer fired" ack.
   */
  longRunningCapability?: boolean;
}): AckDecision {
  const latest = getLatestOperation(input.conversationId);
  if (latest && String(latest.turnId) === String(input.turnId) && !isTerminal(latest)) {
    return { allowed: true, operationId: latest.operationId, reason: 'accepted_operation' };
  }
  if (input.longRunningCapability) {
    return { allowed: true, reason: 'long_running_capability' };
  }
  return { allowed: false, reason: 'no_accepted_operation' };
}

/** True when an accepted, non-terminal operation exists for this turn. */
export function hasAcceptedOperationForTurn(
  conversationId: string,
  turnId: number | string,
): boolean {
  const latest = getLatestOperation(conversationId);
  return !!latest && String(latest.turnId) === String(turnId) && !isTerminal(latest);
}
