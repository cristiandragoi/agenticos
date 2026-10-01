/**
 * dialogueState.ts — Persistent DialogueState & PendingAction storage (§1, §2 of plan).
 *
 * SQLite is authoritative. In-memory LRU map (100 conversations) is a read-through
 * cache — every write goes to SQLite first, then updates the cache.
 *
 * This module is a pure persistence layer with no business logic.
 * The semantic turn resolver (semanticTurnResolver.ts) calls these functions.
 */

import { db, rawDb } from '../../db/index.js';
import { jarvisDialogueState, jarvisPendingActions } from '../../db/schema.js';
import { eq, and, lt, desc } from 'drizzle-orm';
import { logger } from '../../utils/logger.js';

// Idempotent DDL at module load (same pattern as backgroundTasks/store.ts).
// Guarantees the dialogue-state tables exist even when drizzle migrations are
// not applied — safe against running inside a packaged app with an older DB.
const DDL = `
CREATE TABLE IF NOT EXISTS jarvis_dialogue_state (
  conversation_id TEXT PRIMARY KEY,
  active_entity_id TEXT,
  active_entity_type TEXT,
  active_entity_domain TEXT,
  active_entity_name TEXT,
  active_goal TEXT,
  active_task_id TEXT,
  pending_action_id TEXT,
  delegated_task_id TEXT,
  last_completed_action_id TEXT,
  last_resolved_intent TEXT,
  last_recommendation TEXT,
  user_timezone TEXT NOT NULL DEFAULT 'Europe/Berlin',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jarvis_pending_actions (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  intent TEXT NOT NULL,
  target_entity_id TEXT,
  target_entity_type TEXT,
  target_entity_domain TEXT,
  target_entity_name TEXT,
  executor TEXT,
  objective TEXT,
  args TEXT,
  status TEXT NOT NULL DEFAULT 'proposed',
  delegated_task_id TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pa_conv ON jarvis_pending_actions(conversation_id);
CREATE INDEX IF NOT EXISTS idx_pa_status ON jarvis_pending_actions(status);
`;

let dialogueTablesInitialized = false;

/** Ensure the dialogue-state tables exist. Idempotent. */
export function ensureJarvisDialogueTables(): void {
  if (dialogueTablesInitialized) return;
  rawDb.exec(DDL);
  try {
    rawDb.exec('ALTER TABLE jarvis_dialogue_state ADD COLUMN last_recommendation TEXT;');
  } catch {}
  dialogueTablesInitialized = true;
}
ensureJarvisDialogueTables();

// ── Types ────────────────────────────────────────────────────────────────────

export interface EntityRef {
  id: string;
  type: string;           // 'revenue_opportunity' | 'capability' | 'project' | 'task' | 'agent'
  domain: string;         // 'revenue_operator' | 'capabilities' | 'projects' | 'tasks' | 'agents'
  displayName: string;
}

export type PendingActionStatus =
  | 'proposed'
  | 'awaiting_confirmation'
  | 'approved'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'rejected'
  | 'expired';

export interface RecommendationRef {
  action: string;
  reason: string;
  target: EntityRef | null;
  worker?: string;
}

export interface DialogueState {
  conversationId: string;
  activeEntity: EntityRef | null;
  activeGoal: { description: string; targetEntityId?: string } | null;
  activeTaskId: string | null;
  pendingActionId: string | null;
  delegatedTaskId: string | null;
  lastCompletedActionId: string | null;
  lastResolvedIntent: string | null;
  lastRecommendation?: RecommendationRef | null;
  userTimezone: string;
  createdAt: string;
  updatedAt: string;
}

export interface PendingAction {
  id: string;
  conversationId: string;
  intent: string;
  target: EntityRef | null;
  executor: string | null;
  objective: string | null;
  args: Record<string, unknown>;
  status: PendingActionStatus;
  delegatedTaskId: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── LRU Cache ────────────────────────────────────────────────────────────────

const CACHE_MAX = 100;
const dialogueCache = new Map<string, DialogueState>();
const pendingActionCache = new Map<string, PendingAction>(); // key: id

function cacheGet<K, V>(map: Map<K, V>, key: K): V | undefined {
  if (!map.has(key)) return undefined;
  // Move to end (most recently used)
  const val = map.get(key)!;
  map.delete(key);
  map.set(key, val);
  return val;
}

function cacheSet<K, V>(map: Map<K, V>, key: K, val: V, max: number = CACHE_MAX): void {
  if (map.has(key)) map.delete(key);
  if (map.size >= max) {
    // Evict oldest (first entry)
    const first = map.keys().next().value;
    if (first !== undefined) map.delete(first);
  }
  map.set(key, val);
}

// ── SQLite ↔ TypeScript mapping ──────────────────────────────────────────────

function rowToDialogueState(row: any): DialogueState {
  return {
    conversationId: row.conversationId,
    activeEntity: row.activeEntityId
      ? { id: row.activeEntityId, type: row.activeEntityType || '', domain: row.activeEntityDomain || '', displayName: row.activeEntityName || '' }
      : null,
    activeGoal: row.activeGoal || null,
    activeTaskId: row.activeTaskId || null,
    pendingActionId: row.pendingActionId || null,
    delegatedTaskId: row.delegatedTaskId || null,
    lastCompletedActionId: row.lastCompletedActionId || null,
    lastResolvedIntent: row.lastResolvedIntent || null,
    lastRecommendation: row.lastRecommendation
      ? (typeof row.lastRecommendation === 'string' ? JSON.parse(row.lastRecommendation) : row.lastRecommendation)
      : (row.last_recommendation
        ? (typeof row.last_recommendation === 'string' ? JSON.parse(row.last_recommendation) : row.last_recommendation)
        : null),
    userTimezone: row.userTimezone || 'Europe/Berlin',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function dialogueStateToRow(state: DialogueState) {
  return {
    conversationId: state.conversationId,
    createdAt: state.createdAt,
    activeEntityId: state.activeEntity?.id || null,
    activeEntityType: state.activeEntity?.type || null,
    activeEntityDomain: state.activeEntity?.domain || null,
    activeEntityName: state.activeEntity?.displayName || null,
    activeGoal: state.activeGoal || null,
    activeTaskId: state.activeTaskId || null,
    pendingActionId: state.pendingActionId || null,
    delegatedTaskId: state.delegatedTaskId || null,
    lastCompletedActionId: state.lastCompletedActionId || null,
    lastResolvedIntent: state.lastResolvedIntent || null,
    lastRecommendation: state.lastRecommendation || null,
    userTimezone: state.userTimezone,
    updatedAt: state.updatedAt,
  };
}

function rowToPendingAction(row: any): PendingAction {
  return {
    id: row.id,
    conversationId: row.conversationId,
    intent: row.intent,
    target: row.targetEntityId
      ? { id: row.targetEntityId, type: row.targetEntityType || '', domain: row.targetEntityDomain || '', displayName: row.targetEntityName || '' }
      : null,
    executor: row.executor || null,
    objective: row.objective || null,
    args: row.args || {},
    status: row.status as PendingActionStatus,
    delegatedTaskId: row.delegatedTaskId || null,
    expiresAt: row.expiresAt || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ── DialogueState CRUD ───────────────────────────────────────────────────────

/** Read dialogue state from cache or SQLite. Returns null if no state exists. */
export function getDialogueState(conversationId: string): DialogueState | null {
  const cached = cacheGet(dialogueCache, conversationId);
  if (cached) return cached;

  try {
    const row = db.select().from(jarvisDialogueState)
      .where(eq(jarvisDialogueState.conversationId, conversationId))
      .get();
    if (!row) return null;
    const state = rowToDialogueState(row);
    cacheSet(dialogueCache, conversationId, state);
    return state;
  } catch (err) {
    logger.warn('[DialogueState] get failed', { conversationId, error: String(err) });
    return null;
  }
}

/** Create or update dialogue state (upsert). Always writes to SQLite first. */
export function upsertDialogueState(conversationId: string, patch: Partial<Omit<DialogueState, 'conversationId' | 'createdAt'>>): DialogueState {
  const now = new Date().toISOString();
  const existing = getDialogueState(conversationId);

  const merged: DialogueState = {
    conversationId,
    activeEntity: patch.activeEntity !== undefined ? patch.activeEntity : (existing?.activeEntity ?? null),
    activeGoal: patch.activeGoal !== undefined ? patch.activeGoal : (existing?.activeGoal ?? null),
    activeTaskId: patch.activeTaskId !== undefined ? patch.activeTaskId : (existing?.activeTaskId ?? null),
    pendingActionId: patch.pendingActionId !== undefined ? patch.pendingActionId : (existing?.pendingActionId ?? null),
    delegatedTaskId: patch.delegatedTaskId !== undefined ? patch.delegatedTaskId : (existing?.delegatedTaskId ?? null),
    lastCompletedActionId: patch.lastCompletedActionId !== undefined ? patch.lastCompletedActionId : (existing?.lastCompletedActionId ?? null),
    lastResolvedIntent: patch.lastResolvedIntent !== undefined ? patch.lastResolvedIntent : (existing?.lastResolvedIntent ?? null),
    lastRecommendation: patch.lastRecommendation !== undefined ? patch.lastRecommendation : (existing?.lastRecommendation ?? null),
    userTimezone: patch.userTimezone || existing?.userTimezone || 'Europe/Berlin',
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  try {
    if (existing) {
      db.update(jarvisDialogueState)
        .set(dialogueStateToRow(merged))
        .where(eq(jarvisDialogueState.conversationId, conversationId))
        .run();
    } else {
      db.insert(jarvisDialogueState)
        .values(dialogueStateToRow(merged))
        .run();
    }
    cacheSet(dialogueCache, conversationId, merged);
  } catch (err) {
    logger.error('[DialogueState] upsert failed', { conversationId, error: String(err) });
  }

  return merged;
}

// ── PendingAction CRUD ───────────────────────────────────────────────────────

/** Read a pending action by ID. */
export function getPendingAction(id: string): PendingAction | null {
  const cached = cacheGet(pendingActionCache, id);
  if (cached) return cached;

  try {
    const row = db.select().from(jarvisPendingActions)
      .where(eq(jarvisPendingActions.id, id))
      .get();
    if (!row) return null;
    const pa = rowToPendingAction(row);
    cacheSet(pendingActionCache, id, pa);
    return pa;
  } catch (err) {
    logger.warn('[PendingAction] get failed', { id, error: String(err) });
    return null;
  }
}

/** Get the active (awaiting_confirmation) pending action for a conversation. */
export function getActivePendingAction(conversationId: string): PendingAction | null {
  try {
    const row = db.select().from(jarvisPendingActions)
      .where(and(
        eq(jarvisPendingActions.conversationId, conversationId),
        eq(jarvisPendingActions.status, 'awaiting_confirmation'),
      ))
      .orderBy(desc(jarvisPendingActions.createdAt))
      .get();
    if (!row) return null;
    const pa = rowToPendingAction(row);
    cacheSet(pendingActionCache, pa.id, pa);
    return pa;
  } catch (err) {
    logger.warn('[PendingAction] getActive failed', { conversationId, error: String(err) });
    return null;
  }
}

/** Create a new pending action. Returns the created action. */
export function createPendingAction(input: {
  id: string;
  conversationId: string;
  intent: string;
  target?: EntityRef | null;
  executor?: string;
  objective?: string;
  args?: Record<string, unknown>;
  status?: PendingActionStatus;
  expiresAt?: string;
}): PendingAction {
  const now = new Date().toISOString();
  const pa: PendingAction = {
    id: input.id,
    conversationId: input.conversationId,
    intent: input.intent,
    target: input.target || null,
    executor: input.executor || null,
    objective: input.objective || null,
    args: input.args || {},
    status: input.status || 'proposed',
    delegatedTaskId: null,
    expiresAt: input.expiresAt || new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    createdAt: now,
    updatedAt: now,
  };

  try {
    db.insert(jarvisPendingActions).values({
      id: pa.id,
      conversationId: pa.conversationId,
      intent: pa.intent,
      targetEntityId: pa.target?.id || null,
      targetEntityType: pa.target?.type || null,
      targetEntityDomain: pa.target?.domain || null,
      targetEntityName: pa.target?.displayName || null,
      executor: pa.executor,
      objective: pa.objective,
      args: pa.args,
      status: pa.status,
      delegatedTaskId: null,
      expiresAt: pa.expiresAt,
      createdAt: pa.createdAt,
      updatedAt: pa.updatedAt,
    }).run();
    cacheSet(pendingActionCache, pa.id, pa);
  } catch (err) {
    logger.error('[PendingAction] create failed', { id: pa.id, error: String(err) });
  }

  return pa;
}

/** Update a pending action's status and/or fields. */
export function updatePendingAction(id: string, patch: Partial<Pick<PendingAction, 'status' | 'delegatedTaskId' | 'objective' | 'executor' | 'args'>>): PendingAction | null {
  const existing = getPendingAction(id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const merged: PendingAction = {
    ...existing,
    ...patch,
    updatedAt: now,
  };

  try {
    db.update(jarvisPendingActions)
      .set({
        status: merged.status,
        delegatedTaskId: merged.delegatedTaskId,
        objective: merged.objective,
        executor: merged.executor,
        args: merged.args,
        updatedAt: merged.updatedAt,
      })
      .where(eq(jarvisPendingActions.id, id))
      .run();
    cacheSet(pendingActionCache, id, merged);
  } catch (err) {
    logger.error('[PendingAction] update failed', { id, error: String(err) });
  }

  return merged;
}

/** Expire all pending actions older than 30 minutes with status 'proposed' or 'awaiting_confirmation'. */
export function expireStalePendingActions(): number {
  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  try {
    const result = db.update(jarvisPendingActions)
      .set({ status: 'expired', updatedAt: new Date().toISOString() })
      .where(and(
        lt(jarvisPendingActions.expiresAt, cutoff),
        eq(jarvisPendingActions.status, 'awaiting_confirmation'),
      ))
      .run();
    return result.changes;
  } catch {
    return 0;
  }
}
