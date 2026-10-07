import { rawDb } from '../../db/index.js';
import crypto from 'node:crypto';

// Additive, idempotent domain migration. Goal state remains in goal_runs.
let ready = false;
function migrate() {
  if (ready) return;
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS repository_research_requests (
      id TEXT PRIMARY KEY, goal_id TEXT NOT NULL UNIQUE, specification TEXT NOT NULL,
      rubric_version TEXT NOT NULL, created_at TEXT NOT NULL, report TEXT, error TEXT);
    CREATE TABLE IF NOT EXISTS repository_research_queries (
      id INTEGER PRIMARY KEY, request_id TEXT NOT NULL REFERENCES repository_research_requests(id),
      query TEXT NOT NULL, evidence TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS repository_research_snapshots (
      id TEXT PRIMARY KEY, repository_id INTEGER NOT NULL, commit_sha TEXT,
      collected_at TEXT NOT NULL, content TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS repository_research_candidates (
      request_id TEXT NOT NULL REFERENCES repository_research_requests(id),
      snapshot_id TEXT NOT NULL REFERENCES repository_research_snapshots(id), assessment TEXT NOT NULL,
      PRIMARY KEY(request_id, snapshot_id));
    CREATE TABLE IF NOT EXISTS repository_research_api_cache (
      cache_key TEXT PRIMARY KEY, etag TEXT, fetched_at INTEGER NOT NULL, body TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS repository_research_created ON repository_research_requests(created_at);
    CREATE TABLE IF NOT EXISTS repository_source_reviews (
      cache_key TEXT PRIMARY KEY, body TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS repository_research_decisions (
      id INTEGER PRIMARY KEY, request_id TEXT NOT NULL REFERENCES repository_research_requests(id),
      repository TEXT NOT NULL, stage TEXT NOT NULL, created_at TEXT NOT NULL, detail TEXT NOT NULL);
  `);
  ready = true;
}
export const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
export const researchStore = {
  latestForConversation(conversationId: string) {
    migrate();
    const row = rawDb.prepare(`SELECT r.id,r.goal_id,r.created_at,r.report,r.error,g.status,r.specification,g.original_user_input,g.turn_id,g.conversation_id,g.created_at AS goal_created_at,
      (SELECT COUNT(*) FROM repository_research_candidates c WHERE c.request_id=r.id) AS assessed,
      (SELECT c.assessment FROM repository_research_candidates c WHERE c.request_id=r.id
        AND json_extract(c.assessment,'$.eligible')=1
        ORDER BY json_extract(c.assessment,'$.score') DESC LIMIT 1) AS leading
      FROM repository_research_requests r JOIN goal_runs g ON g.goal_id=r.goal_id
      WHERE g.conversation_id=? ORDER BY r.created_at DESC,r.rowid DESC LIMIT 1`).get(conversationId) as any;
    let originalRequest=row?.original_user_input;
    if(row?.turn_id && rawDb.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='turn_lifecycle'").get()) {
      const turn=rawDb.prepare('SELECT text FROM turn_lifecycle WHERE conversation_id=? AND external_turn_id=? AND received_at<=? ORDER BY received_at DESC LIMIT 1').get(row.conversation_id,row.turn_id,row.goal_created_at) as any;
      if(turn?.text)originalRequest=turn.text;
    }
    return row ? { ...row, originalRequest, goal: JSON.parse(row.specification).goal, leading: row.leading ? JSON.parse(row.leading) : null, report: row.report ? JSON.parse(row.report) : null } : null;
  },
  begin(goalId: string, specification: unknown) {
    migrate();
    const existing = rawDb.prepare('SELECT id,specification FROM repository_research_requests WHERE goal_id=?').get(goalId) as any;
    if (existing) {
      if (existing.specification !== JSON.stringify(specification)) throw new Error('A research goal cannot be reused with a different specification');
      return existing.id as string;
    }
    const id = crypto.randomUUID();
    rawDb.prepare('INSERT INTO repository_research_requests(id,goal_id,specification,rubric_version,created_at) VALUES(?,?,?,?,?)')
      .run(id, goalId, JSON.stringify(specification), 'phase1-v1', new Date().toISOString());
    return id;
  },
  query(id: string, query: string, evidence: unknown) { migrate(); rawDb.prepare('INSERT INTO repository_research_queries(request_id,query,evidence) VALUES(?,?,?)').run(id, query, JSON.stringify(evidence)); },
  candidate(requestId: string, snapshot: any, assessment: unknown) {
    migrate(); const body = JSON.stringify(snapshot); const id = hash(body);
    rawDb.transaction(() => {
      rawDb.prepare('INSERT OR IGNORE INTO repository_research_snapshots VALUES(?,?,?,?,?)').run(id, snapshot.metadata.id, snapshot.commitSha || null, snapshot.collectedAt, body);
      rawDb.prepare('INSERT OR REPLACE INTO repository_research_candidates VALUES(?,?,?)').run(requestId, id, JSON.stringify(assessment));
    })(); return id;
  },
  finish(id: string, report: unknown) { migrate(); rawDb.prepare('UPDATE repository_research_requests SET report=?, error=NULL WHERE id=?').run(JSON.stringify(report), id); },
  decision(id: string, repository: string, stage: string, detail: unknown) { migrate(); rawDb.prepare('INSERT INTO repository_research_decisions(request_id,repository,stage,created_at,detail) VALUES(?,?,?,?,?)').run(id, repository, stage, new Date().toISOString(), JSON.stringify(detail)); },
  sourceReview(key: string) { migrate(); const row = rawDb.prepare('SELECT body FROM repository_source_reviews WHERE cache_key=?').get(key) as { body: string } | undefined; return row ? JSON.parse(row.body) : null; },
  saveSourceReview(key: string, body: unknown) { migrate(); rawDb.prepare('INSERT OR IGNORE INTO repository_source_reviews VALUES(?,?,?)').run(key, JSON.stringify(body), new Date().toISOString()); },
  fail(id: string, error: string) { migrate(); rawDb.prepare('UPDATE repository_research_requests SET error=? WHERE id=?').run(error, id); },
  get(id: string) {
    migrate(); const row = rawDb.prepare('SELECT * FROM repository_research_requests WHERE id=?').get(id) as any;
    if (!row) return null;
    return { ...row, specification: JSON.parse(row.specification), report: row.report ? JSON.parse(row.report) : null,
      decisions: (rawDb.prepare('SELECT repository,stage,created_at,detail FROM repository_research_decisions WHERE request_id=? ORDER BY id').all(id) as any[]).map(r=>({...r, detail:JSON.parse(r.detail)})),
      candidates: (rawDb.prepare('SELECT s.content,c.assessment FROM repository_research_candidates c JOIN repository_research_snapshots s ON s.id=c.snapshot_id WHERE c.request_id=?').all(id) as any[])
        .map(r => ({ snapshot: JSON.parse(r.content), assessment: JSON.parse(r.assessment) })),
      queries: (rawDb.prepare('SELECT query,evidence FROM repository_research_queries WHERE request_id=?').all(id) as any[]).map(r => ({ query: r.query, ...JSON.parse(r.evidence) })) };
  },
  list() { migrate(); return rawDb.prepare('SELECT id,goal_id,created_at,rubric_version,error,report IS NOT NULL AS has_report FROM repository_research_requests ORDER BY created_at DESC LIMIT 100').all(); },
  cached(key: string) { migrate(); return rawDb.prepare('SELECT * FROM repository_research_api_cache WHERE cache_key=?').get(key) as { etag?: string; fetched_at: number; body: string } | undefined; },
  cache(key: string, body: unknown, etag?: string | null) { migrate(); rawDb.prepare('INSERT OR REPLACE INTO repository_research_api_cache VALUES(?,?,?,?)').run(key, etag || null, Date.now(), JSON.stringify(body)); },
};
