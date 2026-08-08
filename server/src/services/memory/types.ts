/**
 * AgenticOS memory domain types (Jarvis memory + proactive context milestone).
 *
 * Memory lives at the AgenticOS level: WORKING (short-lived, never auto-
 * permanent), EPISODIC (events that happened), SEMANTIC (durable knowledge),
 * DECISION (explicit rules consulted before acting), PREFERENCE (stable
 * user/workflow preferences). Every permanent memory carries provenance —
 * the system must always answer "where did this come from?".
 */

export type MemoryType = 'episodic' | 'semantic' | 'decision' | 'preference' | 'working';
export type MemoryStatus = 'active' | 'superseded' | 'stale' | 'archived';
export type EntityKind = 'company' | 'person' | 'project' | 'task' | 'artifact' | 'decision' | 'provider' | 'model' | 'agent' | 'outcome' | 'generic';

export interface MemorySource {
  conversationId?: string | null;
  operationId?: string | null;
  taskId?: string | null;
  worker?: string | null;
  artifactPath?: string | null;
  sourceType: 'task' | 'conversation' | 'manual' | 'system' | 'ledger';
}

export interface MemoryRecord {
  id: string;
  type: MemoryType;
  title: string;
  summary: string;
  content: string;
  scope: string;
  entities: string[];
  tags: string[];
  source: MemorySource;
  confidence: number;
  createdAt: number;
  updatedAt: number;
  lastConfirmedAt: number | null;
  lastUsedAt: number | null;
  useCount: number;
  status: MemoryStatus;
  supersedesMemoryId: string | null;
  derivedFromMemoryIds: string[];
  pinned: boolean;
}

export type MemoryRelation =
  | 'RELATED_TO'
  | 'RESULT_OF'
  | 'CREATED_BY'
  | 'DECIDED_IN'
  | 'USES_PROVIDER'
  | 'USES_MODEL'
  | 'SUPERSEDES'
  | 'DERIVED_FROM'
  | 'BELONGS_TO_PROJECT'
  | 'MENTIONS_ENTITY'
  | 'PRODUCED_ARTIFACT'
  | 'TOP_PROSPECT_OF';

export interface MemoryLink {
  id: string;
  fromId: string;   // memory id OR 'entity:<name>'
  toId: string;     // memory id OR 'entity:<name>'
  relation: MemoryRelation | string;
  weight: number;
  count: number;
  lastSeenAt: number;
}

export interface MemoryEntity {
  id: string;       // 'entity:<name>'
  kind: EntityKind;
  name: string;
  refCount: number;
  strength: number;
  lastSeenAt: number;
}

export interface MemoryGraphNode {
  id: string;
  kind: 'memory' | 'entity';
  type?: MemoryType;
  title: string;
  summary?: string;
  status?: MemoryStatus;
  entityKind?: EntityKind;
  strength?: number;
}

export interface MemoryGraphEdge {
  from: string;
  to: string;
  relation: string;
  weight: number;
}

export interface MemoryGraphNeighborhood {
  nodes: MemoryGraphNode[];
  edges: MemoryGraphEdge[];
  focus: string | null;
  truncated: boolean;
  totalNodes: number;
}

export interface MemorySearchHit {
  memory: MemoryRecord;
  score: number;
  matchedOn: string[];
}
