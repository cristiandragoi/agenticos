import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const repairIncidents = sqliteTable('repair_incidents', {
  id: text('id').primaryKey(),
  goalId: text('goal_id'),
  status: text('status').notNull(),
  component: text('component').notNull(),
  failureDomain: text('failure_domain').notNull(),
  symptom: text('symptom').notNull(),
  detectedAt: text('detected_at').notNull(),
  resolvedAt: text('resolved_at'),
  triggeredBy: text('triggered_by').notNull(),
  priority: text('priority').notNull(),
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
});

export const repairEvidence = sqliteTable('repair_evidence', {
  id: text('id').primaryKey(),
  incidentId: text('incident_id').notNull(),
  type: text('type').notNull(),
  label: text('label').notNull(),
  content: text('content').notNull(),
  source: text('source').notNull(),
  timestamp: text('timestamp').notNull(),
});

export const repairDiagnoses = sqliteTable('repair_diagnoses', {
  id: text('id').primaryKey(),
  incidentId: text('incident_id').notNull(),
  failureDomain: text('failure_domain').notNull(),
  rootCause: text('root_cause').notNull(),
  confidence: real('confidence').notNull(),
  evidence: text('evidence', { mode: 'json' }).$type<any[]>().notNull(),
  affectedFiles: text('affected_files', { mode: 'json' }).$type<string[]>().notNull(),
  repairStrategy: text('repair_strategy').notNull(),
  repairSteps: text('repair_steps', { mode: 'json' }).$type<any[]>().notNull(),
  testsRequired: text('tests_required', { mode: 'json' }).$type<string[]>().notNull(),
  riskLevel: text('risk_level').notNull(),
  rollbackPlan: text('rollback_plan').notNull(),
  requiresHumanApproval: integer('requires_human_approval', { mode: 'boolean' }).notNull(),
  status: text('status').notNull(),
  model: text('model').notNull(),
  modelIdentity: text('model_identity', { mode: 'json' }).$type<any>(),
  candidateCauses: text('candidate_causes', { mode: 'json' }).$type<any[]>(),
  selectedRootCause: text('selected_root_cause'),
  createdAt: text('created_at').notNull(),
});

export const repairAttempts = sqliteTable('repair_attempts', {
  id: text('id').primaryKey(),
  incidentId: text('incident_id').notNull(),
  diagnosisId: text('diagnosis_id').notNull(),
  worktreePath: text('worktree_path').notNull(),
  diffSummary: text('diff_summary').notNull(),
  fullDiff: text('full_diff').notNull(),
  filesChanged: text('files_changed', { mode: 'json' }).$type<string[]>().notNull(),
  testReport: text('test_report', { mode: 'json' }).$type<any>(),
  argusVerdict: text('argus_verdict').notNull(),
  argusEvidence: text('argus_evidence').notNull(),
  argusModelIdentity: text('argus_model_identity', { mode: 'json' }).$type<any>(),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
  completedAt: text('completed_at'),
});

export const repairTests = sqliteTable('repair_tests', {
  id: text('id').primaryKey(),
  attemptId: text('attempt_id').notNull(),
  name: text('name').notNull(),
  command: text('command').notNull(),
  exitCode: integer('exit_code').notNull(),
  stdout: text('stdout').notNull(),
  stderr: text('stderr').notNull(),
  durationMs: integer('duration_ms').notNull(),
  passed: integer('passed', { mode: 'boolean' }).notNull(),
  runAt: text('run_at').notNull(),
});

export const repairVerifications = sqliteTable('repair_verifications', {
  id: text('id').primaryKey(),
  attemptId: text('attempt_id').notNull(),
  incidentId: text('incident_id').notNull(),
  verdict: text('verdict').notNull(),
  evidence: text('evidence').notNull(),
  model: text('model').notNull(),
  modelIdentity: text('model_identity', { mode: 'json' }).$type<any>(),
  createdAt: text('created_at').notNull(),
});

export const repairDeployments = sqliteTable('repair_deployments', {
  id: text('id').primaryKey(),
  incidentId: text('incident_id').notNull(),
  attemptId: text('attempt_id').notNull(),
  buildId: text('build_id').notNull(),
  previousBuildId: text('previous_build_id').notNull(),
  deployedAt: text('deployed_at').notNull(),
  rolledBackAt: text('rolled_back_at'),
  status: text('status').notNull(),
});

export const repairBudgetLog = sqliteTable('repair_budget_log', {
  id: text('id').primaryKey(),
  incidentId: text('incident_id').notNull(),
  eventType: text('event_type').notNull(),
  model: text('model').notNull(),
  tokensUsed: integer('tokens_used').notNull(),
  estimatedCost: real('estimated_cost').notNull(),
  timestamp: text('timestamp').notNull(),
});

// ── Governance Tables (v2) ──────────────────────────────────────────────────

export const repairAuditLog = sqliteTable('repair_audit_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  incidentId: text('incident_id').notNull(),
  fromState: text('from_state'),
  toState: text('to_state').notNull(),
  timestamp: text('timestamp').notNull(),
  actor: text('actor').notNull(),
  model: text('model'),
  provider: text('provider'),
  artifactId: text('artifact_id'),
  reason: text('reason').notNull(),
});

export const repairApprovals = sqliteTable('repair_approvals', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  incidentId: text('incident_id').notNull(),
  repairAttemptId: text('repair_attempt_id').notNull(),
  approvedAt: text('approved_at').notNull(),
  approvalSource: text('approval_source').notNull(),
  patchHash: text('patch_hash').notNull(),
  approver: text('approver').notNull(),
});

export const repairSnapshots = sqliteTable('repair_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  incidentId: text('incident_id').notNull(),
  sourceHead: text('source_head').notNull(),
  worktreePath: text('worktree_path').notNull(),
  manifestJson: text('manifest_json', { mode: 'json' }).$type<any>().notNull(),
  verified: integer('verified', { mode: 'boolean' }).notNull(),
  createdAt: text('created_at').notNull(),
});
