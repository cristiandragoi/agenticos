/**
 * SQLite persistence for the Revenue Pipeline (prospects + runs).
 *
 * Same proven pattern as the background task manager: idempotent DDL at
 * module load via rawDb (safe beside drizzle tables), no migration tooling.
 *
 * `revenue_prospects` keeps a UNIQUE index on website_url so the same
 * prospect is never created twice across runs (no duplicate prospects).
 */
import { rawDb } from '../../db/index.js';
import type { PipelineRunRecord, ProspectRecord } from './types.js';

const DDL = `
CREATE TABLE IF NOT EXISTS revenue_pipeline_runs (
  run_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'queued',
  current_stage TEXT NOT NULL DEFAULT 'DISCOVERING PROSPECTS',
  prospects TEXT NOT NULL DEFAULT '[]',
  selected_prospect_id TEXT,
  audit_report_path TEXT,
  blueprint_path TEXT,
  concept_path TEXT,
  proposal_dir_path TEXT,
  run_summary_path TEXT,
  build_state TEXT NOT NULL DEFAULT 'idle',
  test_state TEXT NOT NULL DEFAULT 'idle',
  verification_state TEXT NOT NULL DEFAULT 'pending',
  approval_state TEXT NOT NULL DEFAULT 'none',
  cost_ledger TEXT NOT NULL DEFAULT '[]',
  total_elapsed_ms INTEGER NOT NULL DEFAULT 0,
  blocker TEXT,
  last_error TEXT,
  outreach_approved INTEGER NOT NULL DEFAULT 0,
  discovery_stop_reason TEXT,
  discovery_source_log TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS revenue_prospects (
  prospect_id TEXT PRIMARY KEY,
  business_name TEXT NOT NULL,
  niche TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  website_url TEXT NOT NULL,
  public_contact_url TEXT,
  discovery_source TEXT NOT NULL DEFAULT 'fixture',
  discovery_source_record TEXT,
  fixture INTEGER NOT NULL DEFAULT 0,
  verified_facts TEXT NOT NULL DEFAULT '[]',
  unverified_observations TEXT NOT NULL DEFAULT '[]',
  audit_findings TEXT NOT NULL DEFAULT '[]',
  audit_score REAL,
  opportunity_score REAL,
  scoring_criteria TEXT,
  confidence TEXT NOT NULL DEFAULT 'low',
  status TEXT NOT NULL DEFAULT 'discovered',
  linked_task_id TEXT,
  linked_board_card_id TEXT,
  workspace_path TEXT,
  selected_for_build INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rev_prospect_website ON revenue_prospects(website_url);
CREATE INDEX IF NOT EXISTS idx_rev_run_task ON revenue_pipeline_runs(task_id);
`;

let initialized = false;

export function ensureRevenueTables(): void {
  if (initialized) return;
  rawDb.exec(DDL);
  // Existing databases created before the discovery-source contract: add the
  // column idempotently (SQLite ADD COLUMN has no IF NOT EXISTS).
  const cols = (rawDb.prepare('PRAGMA table_info(revenue_prospects)').all() as any[]).map((c) => c.name);
  if (!cols.includes('discovery_source_record')) {
    rawDb.exec('ALTER TABLE revenue_prospects ADD COLUMN discovery_source_record TEXT');
  }
  // Source-resilience milestone: the discovery stop reason + attempt log on
  // the runs table (safe, idempotent migration for existing databases).
  const runCols = (rawDb.prepare('PRAGMA table_info(revenue_pipeline_runs)').all() as any[]).map((c) => c.name);
  if (!runCols.includes('discovery_stop_reason')) {
    rawDb.exec('ALTER TABLE revenue_pipeline_runs ADD COLUMN discovery_stop_reason TEXT');
  }
  if (!runCols.includes('discovery_source_log')) {
    rawDb.exec("ALTER TABLE revenue_pipeline_runs ADD COLUMN discovery_source_log TEXT NOT NULL DEFAULT '[]'");
  }
  initialized = true;
}

function rowToRun(row: any): PipelineRunRecord {
  return {
    runId: row.run_id,
    taskId: row.task_id,
    config: JSON.parse(row.config || '{}'),
    status: row.status,
    currentStage: row.current_stage,
    prospects: JSON.parse(row.prospects || '[]'),
    selectedProspectId: row.selected_prospect_id,
    auditReportPath: row.audit_report_path,
    blueprintPath: row.blueprint_path,
    conceptPath: row.concept_path,
    proposalDirPath: row.proposal_dir_path,
    runSummaryPath: row.run_summary_path,
    buildState: row.build_state,
    testState: row.test_state,
    verificationState: row.verification_state,
    approvalState: row.approval_state,
    costLedger: JSON.parse(row.cost_ledger || '[]'),
    totalElapsedMs: row.total_elapsed_ms,
    blocker: row.blocker,
    lastError: row.last_error,
    outreachApproved: !!row.outreach_approved,
    discoveryStopReason: row.discovery_stop_reason ?? null,
    discoverySourceLog: JSON.parse(row.discovery_source_log || '[]'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function rowToProspect(row: any): ProspectRecord {
  return {
    prospectId: row.prospect_id,
    businessName: row.business_name,
    niche: row.niche,
    city: row.city,
    websiteUrl: row.website_url,
    publicContactUrl: row.public_contact_url,
    discoverySource: row.discovery_source,
    discoverySourceRecord: row.discovery_source_record ? JSON.parse(row.discovery_source_record) : null,
    fixture: !!row.fixture,
    verifiedFacts: JSON.parse(row.verified_facts || '[]'),
    unverifiedObservations: JSON.parse(row.unverified_observations || '[]'),
    auditFindings: JSON.parse(row.audit_findings || '[]'),
    auditScore: row.audit_score,
    opportunityScore: row.opportunity_score,
    scoringCriteria: row.scoring_criteria ? JSON.parse(row.scoring_criteria) : null,
    confidence: row.confidence,
    status: row.status,
    linkedTaskId: row.linked_task_id,
    linkedBoardCardId: row.linked_board_card_id,
    workspacePath: row.workspace_path,
    selectedForBuild: !!row.selected_for_build,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const revenuePipelineRepo = {
  ensureTables: ensureRevenueTables,

  insertRun(run: PipelineRunRecord): void {
    ensureRevenueTables();
    rawDb.prepare(`
      INSERT INTO revenue_pipeline_runs (
        run_id, task_id, config, status, current_stage, prospects,
        selected_prospect_id, audit_report_path, blueprint_path, concept_path,
        proposal_dir_path, run_summary_path, build_state, test_state,
        verification_state, approval_state, cost_ledger, total_elapsed_ms,
        blocker, last_error, outreach_approved, discovery_stop_reason, discovery_source_log,
        created_at, updated_at, completed_at
      ) VALUES (
        @runId, @taskId, @config, @status, @currentStage, @prospects,
        @selectedProspectId, @auditReportPath, @blueprintPath, @conceptPath,
        @proposalDirPath, @runSummaryPath, @buildState, @testState,
        @verificationState, @approvalState, @costLedger, @totalElapsedMs,
        @blocker, @lastError, @outreachApproved, @discoveryStopReason, @discoverySourceLog,
        @createdAt, @updatedAt, @completedAt
      )
    `).run({
      ...run,
      config: JSON.stringify(run.config),
      prospects: JSON.stringify(run.prospects),
      costLedger: JSON.stringify(run.costLedger),
      outreachApproved: run.outreachApproved ? 1 : 0,
      discoveryStopReason: run.discoveryStopReason ?? null,
      discoverySourceLog: JSON.stringify(run.discoverySourceLog || []),
    });
  },

  updateRun(runId: string, patch: Partial<PipelineRunRecord>): PipelineRunRecord | null {
    ensureRevenueTables();
    const existing = this.getRun(runId);
    if (!existing) return null;
    const merged: PipelineRunRecord = { ...existing, ...patch, runId: existing.runId, updatedAt: new Date().toISOString() };
    rawDb.prepare(`
      UPDATE revenue_pipeline_runs SET
        task_id=@taskId, config=@config, status=@status, current_stage=@currentStage,
        prospects=@prospects, selected_prospect_id=@selectedProspectId,
        audit_report_path=@auditReportPath, blueprint_path=@blueprintPath,
        concept_path=@conceptPath, proposal_dir_path=@proposalDirPath,
        run_summary_path=@runSummaryPath, build_state=@buildState,
        test_state=@testState, verification_state=@verificationState,
        approval_state=@approvalState, cost_ledger=@costLedger,
        total_elapsed_ms=@totalElapsedMs, blocker=@blocker, last_error=@lastError,
        outreach_approved=@outreachApproved,
        discovery_stop_reason=@discoveryStopReason, discovery_source_log=@discoverySourceLog,
        updated_at=@updatedAt, completed_at=@completedAt
      WHERE run_id=@runId
    `).run({
      ...merged,
      config: JSON.stringify(merged.config),
      prospects: JSON.stringify(merged.prospects),
      costLedger: JSON.stringify(merged.costLedger),
      outreachApproved: merged.outreachApproved ? 1 : 0,
      discoveryStopReason: merged.discoveryStopReason ?? null,
      discoverySourceLog: JSON.stringify(merged.discoverySourceLog || []),
    });
    return merged;
  },

  getRun(runId: string): PipelineRunRecord | null {
    ensureRevenueTables();
    const row = rawDb.prepare('SELECT * FROM revenue_pipeline_runs WHERE run_id = ?').get(runId);
    return row ? rowToRun(row) : null;
  },

  getRunByTask(taskId: string): PipelineRunRecord | null {
    ensureRevenueTables();
    const row = rawDb.prepare('SELECT * FROM revenue_pipeline_runs WHERE task_id = ? LIMIT 1').get(taskId);
    return row ? rowToRun(row) : null;
  },

  listRuns(limit = 50): PipelineRunRecord[] {
    ensureRevenueTables();
    const rows = rawDb.prepare('SELECT * FROM revenue_pipeline_runs ORDER BY created_at DESC LIMIT ?').all(Math.max(1, Math.min(200, limit)));
    return rows.map(rowToRun);
  },

  /** Dedupe: same website URL can only exist once (cross-run). */
  findProspectByWebsite(websiteUrl: string): ProspectRecord | null {
    ensureRevenueTables();
    const row = rawDb.prepare('SELECT * FROM revenue_prospects WHERE website_url = ? LIMIT 1').get(websiteUrl);
    return row ? rowToProspect(row) : null;
  },

  upsertProspect(prospect: ProspectRecord): { created: boolean; prospect: ProspectRecord } {
    ensureRevenueTables();
    const existing = this.findProspectByWebsite(prospect.websiteUrl);
    if (existing) {
      // Same record id → update in place. Different id, same URL → merge into
      // the canonical record (no duplicates), preserving provenance.
      const merged: ProspectRecord = {
        ...existing,
        ...prospect,
        prospectId: existing.prospectId,
        linkedTaskId: prospect.linkedTaskId || existing.linkedTaskId,
        linkedBoardCardId: prospect.linkedBoardCardId || existing.linkedBoardCardId,
        updatedAt: new Date().toISOString(),
      };
      rawDb.prepare(`
        UPDATE revenue_prospects SET
          business_name=@businessName, niche=@niche, city=@city, website_url=@websiteUrl,
          public_contact_url=@publicContactUrl, discovery_source=@discoverySource,
          discovery_source_record=@discoverySourceRecord,
          fixture=@fixture, verified_facts=@verifiedFacts,
          unverified_observations=@unverifiedObservations, audit_findings=@auditFindings,
          audit_score=@auditScore, opportunity_score=@opportunityScore,
          scoring_criteria=@scoringCriteria, confidence=@confidence, status=@status,
          linked_task_id=@linkedTaskId, linked_board_card_id=@linkedBoardCardId,
          workspace_path=@workspacePath, selected_for_build=@selectedForBuild,
          updated_at=@updatedAt
        WHERE prospect_id=@prospectId
      `).run({
        ...merged,
        discoverySourceRecord: merged.discoverySourceRecord ? JSON.stringify(merged.discoverySourceRecord) : null,
        fixture: merged.fixture ? 1 : 0,
        verifiedFacts: JSON.stringify(merged.verifiedFacts),
        unverifiedObservations: JSON.stringify(merged.unverifiedObservations),
        auditFindings: JSON.stringify(merged.auditFindings),
        scoringCriteria: merged.scoringCriteria ? JSON.stringify(merged.scoringCriteria) : null,
        selectedForBuild: merged.selectedForBuild ? 1 : 0,
      });
      return { created: false, prospect: merged };
    }
    rawDb.prepare(`
      INSERT INTO revenue_prospects (
        prospect_id, business_name, niche, city, website_url, public_contact_url,
        discovery_source, discovery_source_record, fixture, verified_facts, unverified_observations,
        audit_findings, audit_score, opportunity_score, scoring_criteria,
        confidence, status, linked_task_id, linked_board_card_id, workspace_path,
        selected_for_build, created_at, updated_at
      ) VALUES (
        @prospectId, @businessName, @niche, @city, @websiteUrl, @publicContactUrl,
        @discoverySource, @discoverySourceRecord, @fixture, @verifiedFacts, @unverifiedObservations,
        @auditFindings, @auditScore, @opportunityScore, @scoringCriteria,
        @confidence, @status, @linkedTaskId, @linkedBoardCardId, @workspacePath,
        @selectedForBuild, @createdAt, @updatedAt
      )
    `).run({
      ...prospect,
      discoverySourceRecord: prospect.discoverySourceRecord ? JSON.stringify(prospect.discoverySourceRecord) : null,
      fixture: prospect.fixture ? 1 : 0,
      verifiedFacts: JSON.stringify(prospect.verifiedFacts),
      unverifiedObservations: JSON.stringify(prospect.unverifiedObservations),
      auditFindings: JSON.stringify(prospect.auditFindings),
      scoringCriteria: prospect.scoringCriteria ? JSON.stringify(prospect.scoringCriteria) : null,
      selectedForBuild: prospect.selectedForBuild ? 1 : 0,
    });
    return { created: true, prospect };
  },

  getProspect(prospectId: string): ProspectRecord | null {
    ensureRevenueTables();
    const row = rawDb.prepare('SELECT * FROM revenue_prospects WHERE prospect_id = ?').get(prospectId);
    return row ? rowToProspect(row) : null;
  },

  listProspects(limit = 200): ProspectRecord[] {
    ensureRevenueTables();
    const rows = rawDb.prepare('SELECT * FROM revenue_prospects ORDER BY created_at DESC LIMIT ?').all(Math.max(1, Math.min(500, limit)));
    return rows.map(rowToProspect);
  },
};
