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
/** Verification semantics for a memory record (closure): distinguishes
 *  unverified machine candidates, verified machine facts, and
 *  human-confirmed facts. NEVER treat arbitrary POST /memories as a
 *  verified machine fact. */
export type VerificationStatus = 'unverified' | 'verified' | 'human_confirmed' | 'needs_review' | 'rejected';
export type EntityKind = 'company' | 'person' | 'project' | 'task' | 'artifact' | 'decision' | 'provider' | 'model' | 'agent' | 'outcome' | 'generic';

export interface MemorySource {
  conversationId?: string | null;
  operationId?: string | null;
  taskId?: string | null;
  worker?: string | null;
  artifactPath?: string | null;
  sourceType: 'task' | 'conversation' | 'manual' | 'system' | 'ledger' | 'human';
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
  /** Verification semantics (closure): 'human_confirmed' for direct human
   *  memory, 'verified' for machine facts that passed a verifier,
   *  'unverified'/'needs_review' for raw machine candidates. */
  verificationStatus?: VerificationStatus;
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

/** Candidate memory produced by a worker (e.g. Hermes memoryCandidates)
 *  awaiting verification/promotion. Persisted so candidates are NEVER
 *  silently discarded; promotion links runId → resultId → verificationId
 *  → candidateId → canonical memoryId. */
export interface MemoryCandidate {
  id: string;
  projectId: string | null;
  sourceWorker: string;
  sourceRunId: string | null;
  sourceResultId: string | null;
  verificationId: string | null;
  verificationVerdict: string | null;
  key: string;
  category: string;
  value: string;
  status: 'pending' | 'needs_review' | 'promoted' | 'rejected';
  memoryId: string | null;
  createdAt: number;
  updatedAt: number;
  promotedAt: number | null;
}
