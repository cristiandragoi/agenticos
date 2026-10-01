/**
 * state.ts — Authoritative Jarvis V2 Single State Object & Persistence.
 *
 * Persisted in SQLite `jarvis_v2_state`. The state object is completely structural;
 * values are never parsed or inferred from assistant prose.
 */

import { rawDb } from '../../db/index.js';

export interface ExpectedInput {
  type: 'instruction_set' | 'confirmation' | 'clarification' | 'selection' | 'credentials' | 'approval';
  target?: string;
  targetId?: string;
  promptQuestion?: string;
}

export interface StoredInstructionSet {
  targetId: string;
  targetName: string;
  instructions: string[];
  rawText: string;
  createdAt: string;
  updatedAt: string;
}

export interface JarvisV2Entity {
  id: string;
  name: string;
  type: string;
  domain: string;
}

export interface JarvisV2Project {
  id: string;
  name: string;
  priority: number;
  status: string;
}

export interface JarvisV2TaskRef {
  taskId: string;
  title: string;
  worker: string;
  status: string;
}

export type ActionStatus =
  | 'proposed'
  | 'awaiting_confirmation'
  | 'approved'
  | 'queued'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'cancelled';

export interface JarvisV2Action {
  id: string;
  conversationId: string;
  type: string; // e.g. 'hermes.delegate', 'codex.delegate'
  target: JarvisV2Entity;
  objective: string;
  executor: string;
  constraints?: string[];
  status: ActionStatus;
  requiresConfirmation: boolean;
  createdAt: string;
  delegatedTaskId?: string;
}

export interface JarvisV2State {
  conversationId: string;
  activeEntity: JarvisV2Entity | null;
  activeProject: JarvisV2Project | null;
  activeGoal: string | null;
  pendingAction: JarvisV2Action | null;
  currentTask: JarvisV2TaskRef | null;
  lastRecommendation: string | null;
  expectedInput: ExpectedInput | null;
  instructionSets: Record<string, StoredInstructionSet>; // targetId -> instructions
  constraints: string[];
  lastUserTurn: string | null;
  lastAssistantTurn: string | null;
  turnId: number;
}

const DDL = `
CREATE TABLE IF NOT EXISTS jarvis_v2_state (
  conversation_id TEXT PRIMARY KEY,
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

let tablesInitialized = false;
export function ensureJarvisV2Tables(): void {
  if (tablesInitialized) return;
  rawDb.exec(DDL);
  tablesInitialized = true;
}
ensureJarvisV2Tables();

export function createDefaultState(conversationId: string): JarvisV2State {
  return {
    conversationId,
    activeEntity: null,
    activeProject: null,
    activeGoal: null,
    pendingAction: null,
    currentTask: null,
    lastRecommendation: null,
    expectedInput: null,
    instructionSets: {},
    constraints: [],
    lastUserTurn: null,
    lastAssistantTurn: null,
    turnId: 0,
  };
}

export function loadState(conversationId: string): JarvisV2State {
  ensureJarvisV2Tables();
  try {
    const row = rawDb.prepare('SELECT state_json FROM jarvis_v2_state WHERE conversation_id = ?').get(conversationId) as { state_json: string } | undefined;
    if (row && row.state_json) {
      return JSON.parse(row.state_json);
    }
  } catch (err) {
    // best-effort fallback
  }
  return createDefaultState(conversationId);
}

export function saveState(state: JarvisV2State): void {
  ensureJarvisV2Tables();
  const now = new Date().toISOString();
  state.turnId += 1;
  const json = JSON.stringify(state);
  rawDb.prepare(`
    INSERT INTO jarvis_v2_state (conversation_id, state_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(conversation_id) DO UPDATE SET
      state_json = excluded.state_json,
      updated_at = excluded.updated_at
  `).run(state.conversationId, json, now);
}
