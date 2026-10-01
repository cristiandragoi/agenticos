/**
 * activeGoalRegistry.ts — Durable operational goals that survive blockers and
 * backend restarts (PHASE D / §9).
 *
 * When the user says "Start working on FreeCash" and the work is blocked on
 * authentication, the ORIGINAL GOAL must persist: Jarvis must never lose the
 * intent and must never ask "What would you like me to do with FreeCash?"
 * again. When the blocker clears (session verified), the goal is picked up
 * automatically by the resume handler.
 *
 * Persistence: SQLite via the canonical rawDb (survives restart by design —
 * the in-memory TurnFocus does not).
 */
import { rawDb } from '../../db/index.js';
import { logger } from '../../utils/logger.js';

export type GoalStatus =
  | 'active'                 // executing normally
  | 'blocked_waiting_for_auth'
  | 'resume_pending'         // blocker cleared, automatic resume queued
  | 'completed'
  | 'abandoned';

export interface ActiveGoalRecord {
  id: string;
  originalGoal: string;
  projectId: string | null;
  service: string | null;
  blocker: string | null;
  nextStep: string | null;
  status: GoalStatus;
  conversationId: string | null;
  createdAt: string;
  updatedAt: string;
  clearedAt: string | null;
}

const DDL = `
CREATE TABLE IF NOT EXISTS active_operational_goals (
  id TEXT PRIMARY KEY,
  original_goal TEXT NOT NULL,
  project_id TEXT,
  service TEXT,
  blocker TEXT,
  next_step TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  conversation_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  cleared_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_aog_status ON active_operational_goals(status);
CREATE INDEX IF NOT EXISTS idx_aog_service ON active_operational_goals(service, status);
`;

let ready = false;
function ensure(): void {
  if (ready) return;
  rawDb.exec(DDL);
  ready = true;
}

function rowToRecord(r: any): ActiveGoalRecord {
  return {
    id: r.id,
    originalGoal: r.original_goal,
    projectId: r.project_id ?? null,
    service: r.service ?? null,
    blocker: r.blocker ?? null,
    nextStep: r.next_step ?? null,
    status: r.status as GoalStatus,
    conversationId: r.conversation_id ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    clearedAt: r.cleared_at ?? null,
  };
}

function nowIso(): string { return new Date().toISOString(); }

/**
 * Register (or refresh) the goal for a service. Idempotent per service:
 * a second "start working on FreeCash" while a goal is open reuses the row
 * and refreshes the timestamp rather than duplicating the intent.
 */
export function setGoal(input: {
  originalGoal: string;
  projectId?: string | null;
  service?: string | null;
  conversationId?: string | null;
}): ActiveGoalRecord {
  ensure();
  const now = nowIso();
  if (input.service) {
    const open = rawDb
      .prepare(
        "SELECT * FROM active_operational_goals WHERE service = ? AND status IN ('active','blocked_waiting_for_auth','resume_pending') ORDER BY updated_at DESC LIMIT 1",
      )
      .get(input.service) as any;
    if (open) {
      rawDb
        .prepare('UPDATE active_operational_goals SET original_goal=?, updated_at=?, conversation_id=COALESCE(?, conversation_id), project_id=COALESCE(?, project_id) WHERE id=?')
        .run(input.originalGoal, now, input.conversationId ?? null, input.projectId ?? null, open.id);
      return rowToRecord(rawDb.prepare('SELECT * FROM active_operational_goals WHERE id=?').get(open.id));
    }
  }
  const id = `goal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  rawDb
    .prepare(
      `INSERT INTO active_operational_goals
       (id, original_goal, project_id, service, blocker, next_step, status, conversation_id, created_at, updated_at, cleared_at)
       VALUES (?, ?, ?, ?, NULL, NULL, 'active', ?, ?, ?, NULL)`,
    )
    .run(id, input.originalGoal, input.projectId ?? null, input.service ?? null, input.conversationId ?? null, now, now);
  return rowToRecord(rawDb.prepare('SELECT * FROM active_operational_goals WHERE id=?').get(id));
}

export function markBlockedWaitingForAuth(input: {
  originalGoal: string;
  projectId?: string | null;
  service: string;
  conversationId?: string | null;
  blocker: string;
  nextStep: string;
}): ActiveGoalRecord {
  ensure();
  const goal = setGoal({
    originalGoal: input.originalGoal,
    projectId: input.projectId ?? null,
    service: input.service,
    conversationId: input.conversationId ?? null,
  });
  const now = nowIso();
  rawDb
    .prepare("UPDATE active_operational_goals SET status='blocked_waiting_for_auth', blocker=?, next_step=?, updated_at=? WHERE id=?")
    .run(input.blocker, input.nextStep, now, goal.id);
  return rowToRecord(rawDb.prepare('SELECT * FROM active_operational_goals WHERE id=?').get(goal.id));
}

/** Called when live session evidence proves authentication. Flags the goal
 *  for automatic resume — the ORIGINAL goal, never a fresh "what next?". */
export function markResumePending(service: string): ActiveGoalRecord | null {
  ensure();
  const open = rawDb
    .prepare(
      "SELECT * FROM active_operational_goals WHERE service=? AND status='blocked_waiting_for_auth' ORDER BY updated_at DESC LIMIT 1",
    )
    .get(service) as any;
  if (!open) return null;
  rawDb
    .prepare("UPDATE active_operational_goals SET status='resume_pending', updated_at=? WHERE id=?")
    .run(nowIso(), open.id);
  logger.info(`[activeGoal] resume armed for "${open.original_goal}" (service=${service})`);
  return rowToRecord(rawDb.prepare('SELECT * FROM active_operational_goals WHERE id=?').get(open.id));
}

/** Called when a resume was actually dispatched: the goal is executing again
 *  under the ORIGINAL intent, so it must stop being pumped as resume_pending
 *  (otherwise every backend start would try to resume it again). */
export function markActive(id: string): ActiveGoalRecord | null {
  ensure();
  const row = rawDb.prepare('SELECT * FROM active_operational_goals WHERE id=?').get(id) as any;
  if (!row) return null;
  rawDb
    .prepare("UPDATE active_operational_goals SET status='active', blocker=NULL, updated_at=? WHERE id=?")
    .run(nowIso(), id);
  logger.info(`[activeGoal] resumed goal ${id} is active again (original intent preserved)`);
  return rowToRecord(rawDb.prepare('SELECT * FROM active_operational_goals WHERE id=?').get(id));
}

export function getOpenGoalForService(service: string): ActiveGoalRecord | null {
  ensure();
  const r = rawDb
    .prepare(
      "SELECT * FROM active_operational_goals WHERE service=? AND status IN ('active','blocked_waiting_for_auth','resume_pending') ORDER BY updated_at DESC LIMIT 1",
    )
    .get(service) as any;
  return r ? rowToRecord(r) : null;
}

/** Goals whose blocker cleared (auth verified) and that await the resume pump. */
export function listResumePending(): ActiveGoalRecord[] {
  ensure();
  return (rawDb.prepare("SELECT * FROM active_operational_goals WHERE status='resume_pending' ORDER BY updated_at").all() as any[]).map(rowToRecord);
}

export function completeGoal(id: string): void {
  ensure();
  rawDb
    .prepare("UPDATE active_operational_goals SET status='completed', cleared_at=?, updated_at=?, blocker=NULL WHERE id=?")
    .run(nowIso(), nowIso(), id);
}

export function abandonGoal(id: string, reason: string): void {
  ensure();
  rawDb
    .prepare("UPDATE active_operational_goals SET status='abandoned', cleared_at=?, updated_at=?, blocker=? WHERE id=?")
    .run(nowIso(), nowIso(), reason, id);
}

export function listGoals(opts?: { status?: GoalStatus[]; limit?: number }): ActiveGoalRecord[] {
  ensure();
  const limit = opts?.limit ?? 50;
  if (opts?.status?.length) {
    const ph = opts.status.map(() => '?').join(',');
    return (rawDb.prepare(`SELECT * FROM active_operational_goals WHERE status IN (${ph}) ORDER BY updated_at DESC LIMIT ?`).all(...opts.status, limit) as any[]).map(rowToRecord);
  }
  return (rawDb.prepare('SELECT * FROM active_operational_goals ORDER BY updated_at DESC LIMIT ?').all(limit) as any[]).map(rowToRecord);
}
