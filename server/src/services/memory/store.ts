/**
 * AgenticOS memory store (SQLite, indexed, FTS5-backed search).
 *
 * Scale design: memories + links + entities live in SQLite with indexes;
 * search uses FTS5; the graph loads NEIGHBORHOODS (never the whole graph);
 * list endpoints are paginated. No giant JSON files, no full-store loads.
 */
import { rawDb } from '../../db/index.js';
import type {
  MemoryRecord, MemoryType, MemoryStatus, MemorySource, MemoryRelation,
  MemoryLink, MemoryEntity, MemoryGraphNeighborhood, MemoryGraphNode, MemoryGraphEdge,
  MemorySearchHit, MemoryCandidate,
} from './types.js';

const DDL = `
CREATE TABLE IF NOT EXISTS memory_records (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  content TEXT,
  scope TEXT NOT NULL DEFAULT 'general',
  entities TEXT NOT NULL DEFAULT '[]',
  tags TEXT NOT NULL DEFAULT '[]',
  source_type TEXT,
  source_conversation_id TEXT,
  source_operation_id TEXT,
  source_task_id TEXT,
  source_worker TEXT,
  source_artifact_path TEXT,
  confidence REAL NOT NULL DEFAULT 0.6,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_confirmed_at INTEGER,
  last_used_at INTEGER,
  use_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  supersedes_memory_id TEXT,
  derived_from_memory_ids TEXT NOT NULL DEFAULT '[]',
  pinned INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_mem_type_status ON memory_records(type, status);
CREATE INDEX IF NOT EXISTS idx_mem_status_created ON memory_records(status, created_at);
CREATE INDEX IF NOT EXISTS idx_mem_scope_status ON memory_records(scope, status);

-- Candidate memory (closure): workers propose, verification gates, promotion
-- links the full provenance chain runId → resultId → verificationId →
-- candidateId → memoryId. Candidates are NEVER silently discarded.
CREATE TABLE IF NOT EXISTS memory_candidates (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  source_worker TEXT NOT NULL,
  source_run_id TEXT,
  source_result_id TEXT,
  verification_id TEXT,
  verification_verdict TEXT,
  cand_key TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  cand_value TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  memory_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  promoted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_mem_cand_status ON memory_candidates(status);
CREATE INDEX IF NOT EXISTS idx_mem_cand_project ON memory_candidates(project_id);
CREATE INDEX IF NOT EXISTS idx_mem_cand_run ON memory_candidates(source_run_id);

CREATE TABLE IF NOT EXISTS memory_links (
  id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1,
  count INTEGER NOT NULL DEFAULT 1,
  last_seen_at INTEGER NOT NULL,
  UNIQUE(from_id, to_id, relation)
);
CREATE INDEX IF NOT EXISTS idx_mem_links_from ON memory_links(from_id);
CREATE INDEX IF NOT EXISTS idx_mem_links_to ON memory_links(to_id);

CREATE TABLE IF NOT EXISTS memory_entities (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'generic',
  name TEXT NOT NULL,
  ref_count INTEGER NOT NULL DEFAULT 1,
  strength REAL NOT NULL DEFAULT 1,
  last_seen_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mem_entities_name ON memory_entities(name);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(memory_id UNINDEXED, title, summary, content, entities, tags);
`;

function rowToMemory(row: any): MemoryRecord {
  return {
    id: row.id,
    type: row.type as MemoryType,
    title: row.title,
    summary: row.summary || '',
    content: row.content || '',
    scope: row.scope,
    entities: JSON.parse(row.entities || '[]'),
    tags: JSON.parse(row.tags || '[]'),
    source: {
      conversationId: row.source_conversation_id ?? null,
      operationId: row.source_operation_id ?? null,
      taskId: row.source_task_id ?? null,
      worker: row.source_worker ?? null,
      artifactPath: row.source_artifact_path ?? null,
      sourceType: row.source_type || 'manual',
    } as MemorySource,
    confidence: row.confidence ?? 0.6,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastConfirmedAt: row.last_confirmed_at ?? null,
    lastUsedAt: row.last_used_at ?? null,
    useCount: row.use_count ?? 0,
    status: row.status as MemoryStatus,
    supersedesMemoryId: row.supersedes_memory_id ?? null,
    derivedFromMemoryIds: JSON.parse(row.derived_from_memory_ids || '[]'),
    pinned: !!row.pinned,
    verificationStatus: row.verification_status ?? undefined,
  };
}

function rowToCandidate(row: any): MemoryCandidate {
  return {
    id: row.id,
    projectId: row.project_id ?? null,
    sourceWorker: row.source_worker,
    sourceRunId: row.source_run_id ?? null,
    sourceResultId: row.source_result_id ?? null,
    verificationId: row.verification_id ?? null,
    verificationVerdict: row.verification_verdict ?? null,
    key: row.cand_key,
    category: row.category || 'general',
    value: row.cand_value,
    status: row.status as MemoryCandidate['status'],
    memoryId: row.memory_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    promotedAt: row.promoted_at ?? null,
  };
}

export function ensureMemoryTables(): void {
  rawDb.exec(DDL);
  // Idempotent column migration for existing databases (closure): the
  // verification_status column was added after the initial DDL shipped.
  const cols = rawDb.prepare(`PRAGMA table_info(memory_records)`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'verification_status')) {
    rawDb.exec(`ALTER TABLE memory_records ADD COLUMN verification_status TEXT`);
  }
}

ensureMemoryTables();

export const memoryStore = {
  create(m: MemoryRecord): MemoryRecord {
    rawDb.prepare(`
      INSERT INTO memory_records (id, type, title, summary, content, scope, entities, tags,
        source_type, source_conversation_id, source_operation_id, source_task_id, source_worker, source_artifact_path,
        confidence, created_at, updated_at, last_confirmed_at, last_used_at, use_count, status,
        supersedes_memory_id, derived_from_memory_ids, pinned, verification_status)
      VALUES (@id, @type, @title, @summary, @content, @scope, @entities, @tags,
        @sourceType, @sourceConversationId, @sourceOperationId, @sourceTaskId, @sourceWorker, @sourceArtifactPath,
        @confidence, @createdAt, @updatedAt, @lastConfirmedAt, @lastUsedAt, @useCount, @status,
        @supersedesMemoryId, @derivedFromMemoryIds, @pinned, @verificationStatus)
    `).run({
      ...m,
      entities: JSON.stringify(m.entities || []),
      tags: JSON.stringify(m.tags || []),
      sourceType: m.source.sourceType,
      sourceConversationId: m.source.conversationId ?? null,
      sourceOperationId: m.source.operationId ?? null,
      sourceTaskId: m.source.taskId ?? null,
      sourceWorker: m.source.worker ?? null,
      sourceArtifactPath: m.source.artifactPath ?? null,
      derivedFromMemoryIds: JSON.stringify(m.derivedFromMemoryIds || []),
      pinned: m.pinned ? 1 : 0,
      verificationStatus: m.verificationStatus ?? null,
    });
    rawDb.prepare('INSERT INTO memory_fts (memory_id, title, summary, content, entities, tags) VALUES (?, ?, ?, ?, ?, ?)')
      .run(m.id, m.title, m.summary || '', m.content || '', (m.entities || []).join(' '), (m.tags || []).join(' '));
    for (const entity of m.entities || []) upsertEntity(entity, m.createdAt);
    return m;
  },

  get(id: string): MemoryRecord | null {
    const row = rawDb.prepare('SELECT * FROM memory_records WHERE id = ?').get(id);
    return row ? rowToMemory(row) : null;
  },

  update(id: string, patch: Partial<MemoryRecord>): MemoryRecord | null {
    const existing = this.get(id);
    if (!existing) return null;
    const merged: MemoryRecord = { ...existing, ...patch, id, updatedAt: Date.now() };
    rawDb.prepare(`
      UPDATE memory_records SET type=@type, title=@title, summary=@summary, content=@content, scope=@scope,
        entities=@entities, tags=@tags, confidence=@confidence, updated_at=@updatedAt,
        last_confirmed_at=@lastConfirmedAt, last_used_at=@lastUsedAt, use_count=@useCount, status=@status,
        supersedes_memory_id=@supersedesMemoryId, derived_from_memory_ids=@derivedFromMemoryIds, pinned=@pinned,
        verification_status=@verificationStatus
      WHERE id=@id
    `).run({
      ...merged,
      entities: JSON.stringify(merged.entities || []),
      tags: JSON.stringify(merged.tags || []),
      derivedFromMemoryIds: JSON.stringify(merged.derivedFromMemoryIds || []),
      pinned: merged.pinned ? 1 : 0,
      verificationStatus: merged.verificationStatus ?? null,
    });
    rawDb.prepare('DELETE FROM memory_fts WHERE memory_id = ?').run(id);
    rawDb.prepare('INSERT INTO memory_fts (memory_id, title, summary, content, entities, tags) VALUES (?, ?, ?, ?, ?, ?)')
      .run(merged.id, merged.title, merged.summary || '', merged.content || '', (merged.entities || []).join(' '), (merged.tags || []).join(' '));
    return merged;
  },

  remove(id: string): void {
    rawDb.prepare('DELETE FROM memory_records WHERE id = ?').run(id);
    rawDb.prepare('DELETE FROM memory_fts WHERE memory_id = ?').run(id);
    rawDb.prepare('DELETE FROM memory_links WHERE from_id = ? OR to_id = ?').run(id, id);
  },

  touch(id: string): void {
    rawDb.prepare('UPDATE memory_records SET last_used_at = ?, use_count = use_count + 1 WHERE id = ?').run(Date.now(), id);
  },

  /** List with pagination + filters (Library view). */
  list(opts: {
    type?: MemoryType | null; scope?: string | null; status?: MemoryStatus | null;
    agent?: string | null; entity?: string | null; tag?: string | null;
    minConfidence?: number | null; limit?: number; offset?: number;
  } = {}): { items: MemoryRecord[]; total: number } {
    const where: string[] = [];
    const params: any[] = [];
    if (opts.type) { where.push('type = ?'); params.push(opts.type); }
    if (opts.scope) { where.push('scope = ?'); params.push(opts.scope); }
    if (opts.status) { where.push('status = ?'); params.push(opts.status); }
    else where.push("status != 'archived'");
    if (opts.agent) { where.push('source_worker = ?'); params.push(opts.agent); }
    if (opts.tag) { where.push('tags LIKE ?'); params.push(`%"${opts.tag}"%`); }
    if (opts.minConfidence != null) { where.push('confidence >= ?'); params.push(opts.minConfidence); }
    if (opts.entity) {
      where.push('entities LIKE ?');
      params.push(`%"${opts.entity}"%`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const limit = opts.limit ?? 50;
    const offset = opts.offset ?? 0;
    const rows = rawDb.prepare(`SELECT * FROM memory_records ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset) as any[];
    const total = (rawDb.prepare(`SELECT COUNT(*) AS c FROM memory_records ${whereSql}`).get(...params) as any).c;
    return { items: rows.map(rowToMemory), total };
  },

  /** Chronological timeline (Today / Yesterday / This week / Earlier grouping). */
  timeline(opts: { limit?: number; offset?: number } = {}): MemoryRecord[] {
    const limit = opts.limit ?? 100;
    const offset = opts.offset ?? 0;
    const rows = rawDb.prepare(
      "SELECT * FROM memory_records WHERE status != 'archived' ORDER BY created_at DESC LIMIT ? OFFSET ?"
    ).all(limit, offset) as any[];
    return rows.map(rowToMemory);
  },

  /** Decisions view: all decision memories, active first. */
  decisions(): MemoryRecord[] {
    const rows = rawDb.prepare(
      "SELECT * FROM memory_records WHERE type = 'decision' AND status != 'archived' ORDER BY (status = 'active') DESC, created_at DESC LIMIT 500"
    ).all() as any[];
    return rows.map(rowToMemory);
  },

  /** FTS + ranked search (relevance, recency, confidence, scope, decisions). */
  search(q: string, opts: {
    type?: MemoryType | null; scope?: string | null; status?: MemoryStatus | null;
    limit?: number;
  } = {}): MemorySearchHit[] {
    const limit = opts.limit ?? 20;
    if (!q || !q.trim()) return [];
    const terms = q.trim().split(/\s+/).filter(Boolean).map((t) => `"${t.replace(/"/g, '')}"`).join(' OR ');
    if (!terms) return [];
    const rows = rawDb.prepare(
      'SELECT memory_id, title, summary, content, entities, tags, bm25(memory_fts) AS rank FROM memory_fts WHERE memory_fts MATCH ? ORDER BY rank LIMIT 200'
    ).all(terms) as any[];
    if (!rows.length) return [];
    const ids = rows.map((r) => r.memory_id);
    const recs = ids.map((id) => this.get(id)).filter(Boolean) as MemoryRecord[];
    const filtered = opts.status ? recs.filter((m) => m.status === opts.status) : recs;
    const now = Date.now();
    const hits = filtered.map((m) => {
      let score = 1 / (1 + Math.abs((m.createdAt - now) / 1000 / 3600 / 24 / 14)); // recency (14d half-life-ish)
      score += m.confidence * 0.3;
      if (opts.scope && m.scope === opts.scope) score += 0.5;
      if (opts.type && m.type === opts.type) score += 0.5;
      if (m.type === 'decision') score += 0.4; // decision priority
      if (m.pinned) score += 0.3;
      if (m.status === 'active') score += 0.2;
      const matchedOn: string[] = [];
      for (const [field, val] of [['title', m.title], ['summary', m.summary], ['content', m.content], ['entities', (m.entities || []).join(' ')], ['tags', (m.tags || []).join(' ')]]) {
        const lv = val.toLowerCase();
        if (q.trim().toLowerCase().split(/\s+/).some((t) => lv.includes(t))) matchedOn.push(field);
      }
      return { memory: m, score, matchedOn };
    });
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  },

  /** Graph neighborhood — progressive local expansion, never the whole graph. */
  graph(opts: { focus?: string | null; depth?: number; limit?: number } = {}): MemoryGraphNeighborhood {
    const limit = opts.limit ?? 60;
    const depth = Math.max(1, opts.depth ?? 1);
    const focus = opts.focus || null;
    const nodes = new Map<string, MemoryGraphNode>();
    const edges = new Map<string, MemoryGraphEdge>();
    const queue: { id: string; kind: 'memory' | 'entity'; d: number }[] = [];

    if (focus) {
      const seedNode = (id: string) => {
        if (nodes.has(id) || nodes.size >= limit) return;
        if (id.startsWith('entity:')) {
          const ent = rawDb.prepare('SELECT * FROM memory_entities WHERE id = ?').get(id) as any;
          if (ent) nodes.set(id, { id, kind: 'entity', title: ent.name, entityKind: ent.kind, strength: ent.strength });
        } else {
          const m = this.get(id);
          if (m) nodes.set(id, { id, kind: 'memory', type: m.type, title: m.title, summary: m.summary, status: m.status });
        }
        queue.push({ id, kind: id.startsWith('entity:') ? 'entity' : 'memory', d: 0 });
      };
      if (focus.startsWith('entity:')) {
        seedNode(focus);
      } else {
        const m = this.get(focus);
        if (m) {
          seedNode(focus);
        } else {
          // Fuzzy term resolution: the user types a plain term ("Kadabau",
          // "Berlin roofing"). Resolve to every memory whose title contains it
          // and every entity whose name contains it, then seed each match so
          // the neighborhood is populated instead of an empty canvas.
          const memRows = rawDb
            .prepare("SELECT id FROM memory_records WHERE title LIKE ? ORDER BY created_at DESC LIMIT 8")
            .all(`%${focus}%`) as any[];
          const entRows = rawDb
            .prepare("SELECT id FROM memory_entities WHERE name LIKE ? ORDER BY strength DESC LIMIT 8")
            .all(`%${focus}%`) as any[];
          for (const r of memRows) seedNode(r.id);
          for (const r of entRows) seedNode(r.id);
        }
      }
    } else {
      // No focus: seed with the most recent active memories so the graph is
      // never an empty canvas — a small, bounded subgraph (not the universe).
      const recent = rawDb.prepare(
        "SELECT * FROM memory_records WHERE status = 'active' ORDER BY created_at DESC LIMIT 10"
      ).all() as any[];
      for (const r of recent) {
        if (nodes.has(r.id) || nodes.size >= limit) continue;
        nodes.set(r.id, { id: r.id, kind: 'memory', type: r.type, title: r.title, summary: r.summary, status: r.status });
        queue.push({ id: r.id, kind: 'memory', d: 0 });
      }
    }

    while (queue.length && nodes.size < limit) {
      const { id, d } = queue.shift()!;
      if (d >= depth) continue;
      const links = rawDb.prepare('SELECT * FROM memory_links WHERE from_id = ? OR to_id = ?').all(id, id) as any[];
      for (const l of links) {
        const other = l.from_id === id ? l.to_id : l.from_id;
        const ekey = [l.from_id, l.to_id, l.relation].join('|');
        if (!edges.has(ekey)) {
          edges.set(ekey, { from: l.from_id, to: l.to_id, relation: l.relation, weight: l.weight });
        }
        if (nodes.has(other) || nodes.size >= limit) continue;
        if (other.startsWith('entity:')) {
          const ent = rawDb.prepare('SELECT * FROM memory_entities WHERE id = ?').get(other) as any;
          if (ent) nodes.set(other, { id: other, kind: 'entity', title: ent.name, entityKind: ent.kind, strength: ent.strength });
        } else {
          const m = this.get(other);
          if (m) nodes.set(other, { id: other, kind: 'memory', type: m.type, title: m.title, summary: m.summary, status: m.status });
        }
        queue.push({ id: other, kind: other.startsWith('entity:') ? 'entity' : 'memory', d: d + 1 });
      }
    }
    return {
      nodes: [...nodes.values()],
      edges: [...edges.values()],
      focus,
      truncated: nodes.size >= limit,
      totalNodes: nodes.size,
    };
  },

  /** Entity index with strength (repeated references strengthen). */
  entities(limit = 100): MemoryEntity[] {
    const rows = rawDb.prepare('SELECT * FROM memory_entities ORDER BY strength DESC, ref_count DESC LIMIT ?').all(limit) as any[];
    return rows.map((r) => ({
      id: r.id, kind: r.kind, name: r.name, refCount: r.ref_count, strength: r.strength, lastSeenAt: r.last_seen_at,
    }));
  },

  // ── Candidate memory (closure) ────────────────────────────────────────
  createCandidate(c: MemoryCandidate): MemoryCandidate {
    rawDb.prepare(`
      INSERT INTO memory_candidates (id, project_id, source_worker, source_run_id, source_result_id,
        verification_id, verification_verdict, cand_key, category, cand_value, status, memory_id,
        created_at, updated_at, promoted_at)
      VALUES (@id, @projectId, @sourceWorker, @sourceRunId, @sourceResultId,
        @verificationId, @verificationVerdict, @key, @category, @value, @status, @memoryId,
        @createdAt, @updatedAt, @promotedAt)
    `).run({
      ...c,
      key: c.key,
      category: c.category,
      value: c.value,
      status: c.status,
      memoryId: c.memoryId ?? null,
      verificationId: c.verificationId ?? null,
      verificationVerdict: c.verificationVerdict ?? null,
      projectId: c.projectId ?? null,
      sourceRunId: c.sourceRunId ?? null,
      sourceResultId: c.sourceResultId ?? null,
      promotedAt: c.promotedAt ?? null,
    });
    return c;
  },

  getCandidate(id: string): MemoryCandidate | null {
    const row = rawDb.prepare('SELECT * FROM memory_candidates WHERE id = ?').get(id);
    return row ? rowToCandidate(row) : null;
  },

  updateCandidate(id: string, patch: Partial<MemoryCandidate>): MemoryCandidate | null {
    const existing = this.getCandidate(id);
    if (!existing) return null;
    const merged: MemoryCandidate = { ...existing, ...patch, id, updatedAt: Date.now() };
    rawDb.prepare(`
      UPDATE memory_candidates SET project_id=@projectId, source_worker=@sourceWorker,
        source_run_id=@sourceRunId, source_result_id=@sourceResultId,
        verification_id=@verificationId, verification_verdict=@verificationVerdict,
        cand_key=@key, category=@category, cand_value=@value, status=@status, memory_id=@memoryId,
        updated_at=@updatedAt, promoted_at=@promotedAt
      WHERE id=@id
    `).run({
      ...merged,
      key: merged.key,
      category: merged.category,
      value: merged.value,
      status: merged.status,
      memoryId: merged.memoryId ?? null,
      verificationId: merged.verificationId ?? null,
      verificationVerdict: merged.verificationVerdict ?? null,
      projectId: merged.projectId ?? null,
      sourceRunId: merged.sourceRunId ?? null,
      sourceResultId: merged.sourceResultId ?? null,
      promotedAt: merged.promotedAt ?? null,
    });
    return merged;
  },

  listCandidates(opts: { status?: string | null; projectId?: string | null; limit?: number } = {}): MemoryCandidate[] {
    const where: string[] = [];
    const params: any[] = [];
    if (opts.status) { where.push('status = ?'); params.push(opts.status); }
    if (opts.projectId) { where.push('project_id = ?'); params.push(opts.projectId); }
    const sql = `SELECT * FROM memory_candidates ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT ?`;
    params.push(opts.limit ?? 100);
    const rows = rawDb.prepare(sql).all(...params) as any[];
    return rows.map(rowToCandidate);
  },
};

/** Entity upsert — repeated references increase refCount + strength. */
export function upsertEntity(name: string, now = Date.now(), kind: MemoryEntity['kind'] = 'generic'): void {
  const id = `entity:${name}`;
  const existing = rawDb.prepare('SELECT * FROM memory_entities WHERE id = ?').get(id) as any;
  if (existing) {
    rawDb.prepare('UPDATE memory_entities SET ref_count = ref_count + 1, strength = MIN(10, strength + 0.5), last_seen_at = ? WHERE id = ?').run(now, id);
  } else {
    rawDb.prepare('INSERT INTO memory_entities (id, kind, name, ref_count, strength, last_seen_at) VALUES (?, ?, ?, 1, 1, ?)').run(id, kind, name, now);
  }
}

export function entityId(name: string): string {
  return `entity:${name}`;
}

/** Link two nodes (memory|entity) — repeated links strengthen (weight/count). */
export function link(
  fromId: string, toId: string, relation: MemoryRelation | string, now = Date.now(), weight = 1,
): void {
  const existing = rawDb.prepare('SELECT * FROM memory_links WHERE from_id = ? AND to_id = ? AND relation = ?').get(fromId, toId, relation) as any;
  if (existing) {
    rawDb.prepare('UPDATE memory_links SET weight = MIN(10, weight + ?), count = count + 1, last_seen_at = ? WHERE id = ?').run(weight, now, existing.id);
  } else {
    rawDb.prepare('INSERT INTO memory_links (id, from_id, to_id, relation, weight, count, last_seen_at) VALUES (?, ?, ?, ?, ?, 1, ?)')
      .run(`link-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, fromId, toId, relation, weight, now);
  }
}

/** Title similarity for consolidation (normalized prefix token overlap). */
export function titleSimilar(a: string, b: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((t) => t.length > 2);
  const ta = new Set(norm(a));
  const tb = new Set(norm(b));
  if (!ta.size || !tb.size) return 0;
  let overlap = 0;
  for (const t of ta) if (tb.has(t)) overlap++;
  return overlap / Math.min(ta.size, tb.size);
}
