/**
 * perceptionFocus.ts — ONE authoritative perception state for a conversation.
 *
 * WHY THIS EXISTS (P0 audit DEFECT-2 / DEFECT-7 / DEFECT-8)
 * `TurnFocus` (turnRouter.ts) tracks entities, projects, blockers and navigation —
 * it has no perception fields at all. Camera and foreground-screen results were
 * written only to conversation history, so a follow-up turn ("Can you read the
 * text?") had no way to know that a smartphone had just been observed through the
 * camera. `activeInteractionContext` / `referentResolver` are browser-only and
 * cannot carry a camera frame or a foreground window.
 *
 * This module is the single writer/reader of perception state. It deliberately
 * lives beside (not inside) TurnFocus so the existing entity/project continuation
 * semantics are untouched, while both camera and screen perception write to ONE
 * generic record keyed by conversation.
 *
 * Nothing here invents content: `summary` is only ever what an executor actually
 * observed.
 */

export type PerceptionCapability =
  | 'camera_perception'
  | 'read_foreground_screen'
  | 'screen_vision'
  | string;

export type PerceptionTargetType =
  | 'camera_frame'
  | 'foreground_window'
  | 'visible_object'
  | 'visible_text'
  | 'screen_region'
  | string;

export interface PerceptionTarget {
  type: PerceptionTargetType;
  description?: string;
  hwnd?: string | number;
  process?: string;
  windowTitle?: string;
  /** e.g. a visible_text target on top of a visible_object (smartphone). */
  parentTarget?: { type: string; description?: string };
}

export interface PerceptionEntity {
  id?: string;
  type: string;
  description: string;
}

export interface PerceptionFocus {
  capability: PerceptionCapability;
  /** The turn that FIRST established this perception goal. */
  originTurnId: number | string;
  /** The turn that last refreshed it. */
  lastUpdatedTurnId: number | string;
  target: PerceptionTarget;
  evidence?: {
    evidenceId?: string;
    frameId?: string;
    screenshotId?: string;
    capturedAt?: number;
  };
  entities?: PerceptionEntity[];
  expiresAt?: number;
  /** Grounded summary of what was actually observed (never fabricated). */
  summary?: string;
  /** Outcome of the most recent read attempt for this goal. */
  lastOutcome?: 'success' | 'unreadable' | 'cancelled';
  lastOutcomeReason?: string;
}

/** Perception context goes stale quickly; 2 minutes matches conversational tempo. */
export const DEFAULT_PERCEPTION_TTL_MS = 120_000;

const focusByConversation = new Map<string, PerceptionFocus>();

/** Last clear, for observability/tests — why perception state disappeared. */
let lastClear: { conversationId: string; reason: string; at: number } | undefined;

export function getLastPerceptionClear(): typeof lastClear {
  return lastClear;
}

function nowMs(now?: number): number {
  return typeof now === 'number' ? now : Date.now();
}

/** Numeric turn ids compare numerically; non-numeric ids never order. */
function turnOrder(v: number | string | undefined): number {
  if (v === undefined || v === null) return NaN;
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  const n = Number(v);
  return Number.isFinite(n) && String(v).trim() !== '' ? n : NaN;
}

export function isTurnOlder(a: number | string | undefined, b: number | string | undefined): boolean {
  const na = turnOrder(a);
  const nb = turnOrder(b);
  return Number.isFinite(na) && Number.isFinite(nb) && na < nb;
}

export interface RecordPerceptionInput {
  conversationId: string;
  turnId: number | string;
  capability: PerceptionCapability;
  target: PerceptionTarget;
  evidence?: PerceptionFocus['evidence'];
  entities?: PerceptionEntity[];
  summary?: string;
  /** true when this turn CONTINUES an existing perception goal of the same capability. */
  continuation?: boolean;
  now?: number;
  ttlMs?: number;
}

/**
 * Write/replace the active perception focus for a conversation.
 *
 * `originTurnId` is preserved across continuations so "the turn that asked for
 * this" survives a multi-turn refinement ("read it again"), while
 * `lastUpdatedTurnId` always names the turn that supplied the newest evidence.
 */
export function recordPerception(input: RecordPerceptionInput): PerceptionFocus {
  const at = nowMs(input.now);
  const existing = focusByConversation.get(input.conversationId);
  const continues =
    input.continuation === true &&
    !!existing &&
    existing.capability === input.capability;

  const focus: PerceptionFocus = {
    capability: input.capability,
    originTurnId: continues && existing ? existing.originTurnId : input.turnId,
    lastUpdatedTurnId: input.turnId,
    target: input.target,
    evidence: input.evidence ?? (continues ? existing?.evidence : undefined),
    entities: input.entities && input.entities.length ? input.entities : continues ? existing?.entities : undefined,
    summary: input.summary ?? undefined,
    expiresAt: at + (input.ttlMs ?? DEFAULT_PERCEPTION_TTL_MS),
    lastOutcome: 'success',
  };

  focusByConversation.set(input.conversationId, focus);
  return focus;
}

/**
 * Refresh an existing focus without replacing its target — used when a follow-up
 * reveals more about what is already being observed ("What am I holding?" adds
 * the smartphone entity to the active camera goal).
 */
export function updatePerceptionEntities(
  conversationId: string,
  turnId: number | string,
  entities: PerceptionEntity[],
  opts: { summary?: string; now?: number; ttlMs?: number } = {},
): PerceptionFocus | undefined {
  const existing = focusByConversation.get(conversationId);
  if (!existing) return undefined;
  const at = nowMs(opts.now);
  const merged = [...(existing.entities ?? [])];
  for (const e of entities) {
    if (!merged.some((m) => m.description === e.description && m.type === e.type)) merged.push(e);
  }
  const next: PerceptionFocus = {
    ...existing,
    lastUpdatedTurnId: turnId,
    entities: merged,
    summary: opts.summary ?? existing.summary,
    expiresAt: at + (opts.ttlMs ?? DEFAULT_PERCEPTION_TTL_MS),
    lastOutcome: 'success',
  };
  focusByConversation.set(conversationId, next);
  return next;
}

/** Mark the outcome of a read attempt against the active focus. */
export function recordPerceptionOutcome(
  conversationId: string,
  turnId: number | string,
  outcome: 'success' | 'unreadable' | 'cancelled',
  reason?: string,
): void {
  const existing = focusByConversation.get(conversationId);
  if (!existing) return;
  existing.lastUpdatedTurnId = turnId;
  existing.lastOutcome = outcome;
  existing.lastOutcomeReason = reason;
}

/**
 * Read the ACTIVE perception focus, or undefined when there is none, it expired,
 * or it was explicitly cleared. Expired records are dropped on read so a stale
 * referent cannot silently resolve.
 */
export function getActivePerception(
  conversationId: string,
  now?: number,
): PerceptionFocus | undefined {
  const f = focusByConversation.get(conversationId);
  if (!f) return undefined;
  if (f.expiresAt !== undefined && nowMs(now) > f.expiresAt) {
    focusByConversation.delete(conversationId);
    return undefined;
  }
  return f;
}

/** Raw read that ignores expiry — for diagnostics and tests. */
export function peekPerception(conversationId: string): PerceptionFocus | undefined {
  return focusByConversation.get(conversationId);
}

/**
 * Clear perception state. Called by Stop (D-5) and when a goal is replaced.
 * A cleared goal can no longer resolve a referent or be mutated by an in-flight
 * operation that started before the clear.
 */
export function clearPerception(conversationId: string, reason: string): boolean {
  const had = focusByConversation.has(conversationId);
  focusByConversation.delete(conversationId);
  lastClear = { conversationId, reason, at: Date.now() };
  return had;
}

export function clearAllPerception(): void {
  focusByConversation.clear();
  lastClear = undefined;
}

/**
 * Decide whether an in-flight perception operation still owns the right to write
 * into the focus. A stopped/superseded operation must never mutate context.
 */
export function mayMutatePerception(
  conversationId: string,
  operation: { status: string; turnId: number | string; originTurnId: number | string },
): boolean {
  if (operation.status === 'CANCELLED') return false;
  const active = getActivePerception(conversationId);
  if (!active) {
    // No focus yet: only the operation's own turn may create one.
    return operation.status !== 'CANCELLED';
  }
  if (isTurnOlder(active.lastUpdatedTurnId, operation.turnId)) return true;
  return !isTurnOlder(operation.turnId, active.lastUpdatedTurnId);
}
