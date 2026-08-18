import { sqliteTable, text, integer, real, index, uniqueIndex, unique } from 'drizzle-orm/sqlite-core';

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  status: text('status').notNull().default('draft'),
  priority: text('priority').notNull().default('medium'),
  skillIds: text('skill_ids', { mode: 'json' }).notNull(), // string[]
  scheduleId: text('schedule_id'),
  input: text('input', { mode: 'json' }), // Record<string, unknown>
  assignedAgentId: text('assigned_agent_id'),
  requiresApproval: integer('requires_approval', { mode: 'boolean' }).notNull().default(false),
  approvalPolicyId: text('approval_policy_id'),
  retryPolicy: text('retry_policy', { mode: 'json' }), // { maxAttempts, backoffSeconds }
  timeoutSeconds: integer('timeout_seconds'),
  dependencies: text('dependencies', { mode: 'json' }), // string[] of task IDs
  briefId: text('brief_id'), // Link to production brief
  metadata: text('metadata', { mode: 'json' }),
  budgetLimit: real('budget_limit'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  lastRunAt: text('last_run_at'),
  nextRunAt: text('next_run_at'),
});

export const schedules = sqliteTable('schedules', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull(),
  type: text('type').notNull(), // "once" | "interval" | "cron"
  timezone: text('timezone').notNull(),
  runAt: text('run_at'),
  intervalSeconds: integer('interval_seconds'),
  cronExpression: text('cron_expression'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  nextRunAt: text('next_run_at'),
  lastTriggeredAt: text('last_triggered_at'),
  misfirePolicy: text('misfire_policy').notNull().default('run_once'),
  // ── Routine bridge (closure) ─────────────────────────────────────────────
  // Classifies how this schedule executes. 'worker_task' fires a canonical
  // background task through the real worker dispatcher; 'legacy_skill' keeps
  // the old runEngine/executeSkill path. Never inferred from names.
  executionType: text('execution_type').notNull().default('legacy_skill'),
  routineId: text('routine_id'),
  worker: text('worker'),           // hermes | codex | magnitude
  projectId: text('project_id'),
  taskTemplate: text('task_template', { mode: 'json' }), // { objective, worker, input }
  lastOutcome: text('last_outcome'),   // 'completed' | 'execution_failed' | 'dispatch_failed' | null
  lastError: text('last_error'),
});

export const runs = sqliteTable('runs', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull(),
  trigger: text('trigger').notNull(), // "manual" | "schedule" | "api" | "agent" | "retry"
  status: text('status').notNull().default('queued'),
  attempt: integer('attempt').notNull().default(1),
  input: text('input', { mode: 'json' }),
  output: text('output', { mode: 'json' }),
  error: text('error', { mode: 'json' }), // { code, message, stack }
  actualCost: real('actual_cost'),
  metadata: text('metadata', { mode: 'json' }),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
  createdAt: text('created_at').notNull(),
});

export const runSteps = sqliteTable('run_steps', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull(),
  skillId: text('skill_id'),
  toolId: text('tool_id'),
  status: text('status').notNull().default('pending'),
  input: text('input', { mode: 'json' }),
  output: text('output', { mode: 'json' }),
  error: text('error'),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
});

// Goal Mode Schema
export const goals = sqliteTable('goals', {
  id: text('id').primaryKey(),
  workspacePath: text('workspace_path'),
  conversationId: text('conversation_id'),
  workspaceId: text('workspace_id'),
  originalGoal: text('original_goal').notNull(),
  status: text('status').notNull().default('queued'),
  retryCount: integer('retry_count').notNull().default(0),
  providerFallbackCount: integer('provider_fallback_count').notNull().default(0),
  executionOptions: text('execution_options'),
  activeCheckpointId: text('active_checkpoint_id'),
  workerId: text('worker_id'), // For atomic worker leases
  leaseExpiresAt: text('lease_expires_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  runSummary: text('run_summary', { mode: 'json' }),
});

export const goalEvents = sqliteTable('goal_events', {
  id: text('id').primaryKey(),
  goalId: text('goal_id').notNull().references(() => goals.id, { onDelete: 'cascade' }),
  sequence: integer('sequence').notNull(),
  timestamp: text('timestamp').notNull(),
  state: text('state').notNull(),
  step: integer('step').notNull(),
  message: text('message').notNull(),
  provider: text('provider').notNull().default('unknown'),
  model: text('model').notNull().default('unknown'),
  tool: text('tool'),
  checkpointId: text('checkpoint_id'),
  error: text('error'),
  
  eventType: text('event_type'),
  normalizedStatus: text('normalized_status'),
  lifecycleState: text('lifecycle_state'),
  userMessage: text('user_message'),
  technicalMessage: text('technical_message'),
  durationMs: integer('duration_ms'),
  filePath: text('file_path'),
  command: text('command'),
  nextAction: text('next_action'),
  retryCount: integer('retry_count'),
  requiresUserAction: integer('requires_user_action', { mode: 'boolean' }),
  errorCode: text('error_code'),
  errorDetails: text('error_details'),
  teamId: text('team_id'),
  agentId: text('agent_id'),
  payload: text('payload', { mode: 'json' }),
  eventSchemaVersion: integer('event_schema_version').notNull().default(1),
  operationId: text('operation_id')
}, (table) => {
  return {
    runSeqUnique: uniqueIndex('goal_events_goal_seq_idx').on(table.goalId, table.sequence),
    teamSeqIdx: index('goal_events_team_seq_idx').on(table.teamId, table.sequence),
    teamAgentSeqIdx: index('goal_events_team_agent_seq_idx').on(table.teamId, table.agentId, table.sequence)
  };
});

export const goalSteps = sqliteTable('goal_steps', {
  id: text('id').primaryKey(),
  goalId: text('goal_id').notNull().references(() => goals.id, { onDelete: 'cascade' }),
  stepNumber: integer('step_number').notNull(),
  status: text('status').notNull(), // 'pending' | 'started' | 'completed' | 'failed' | 'interrupted' | 'paused'
  toolCall: text('tool_call', { mode: 'json' }), // The raw JSON of the tool call
  toolResult: text('tool_result'),
  error: text('error'),
  startedAt: text('started_at').notNull(),
  completedAt: text('completed_at'),
});

// Canonical Conversation Schema
export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id'),
  title: text('title').notNull(),
  status: text('status').notNull().default('active'),
  primaryAgent: text('primary_agent'),
  activeRunId: text('active_run_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  archivedAt: text('archived_at'),
});

export const conversationMessages = sqliteTable('conversation_messages', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  sequence: integer('sequence'), // For ordering
  role: text('role').notNull(), // 'user', 'agent', 'system'
  messageType: text('message_type').notNull().default('message'), // 'message', 'routing_event', 'tool_event', 'approval_request', 'plan', 'artifact', 'error', 'system_status'
  content: text('content').notNull(),
  status: text('status'), 
  routedAgent: text('routed_agent'), 
  runId: text('run_id'),
  goalId: text('goal_id'),
  parentMessageId: text('parent_message_id'),
  metadata: text('metadata', { mode: 'json' }), // Record<string, any>
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  convIdIdx: index('idx_conv_msg_conv').on(table.conversationId),
}));

export const goalCheckpoints = sqliteTable('goal_checkpoints', {
  id: text('id').primaryKey(),
  goalId: text('goal_id').notNull().references(() => goals.id, { onDelete: 'cascade' }),
  sequenceId: integer('sequence_id').notNull(),
  stepId: text('step_id'),
  stepIndex: integer('step_index'),
  goalStatus: text('goal_status'),
  executionPhase: text('execution_phase'),
  workspaceSnapshot: text('workspace_snapshot', { mode: 'json' }),
  workspaceHash: text('workspace_hash'),
  changedFiles: text('changed_files', { mode: 'json' }),
  executionContext: text('execution_context', { mode: 'json' }),
  providerState: text('provider_state', { mode: 'json' }),
  validationState: text('validation_state', { mode: 'json' }),
  budgetState: text('budget_state', { mode: 'json' }),
  createdAt: text('created_at').notNull(),
});

export const providerCircuitBreakers = sqliteTable('provider_circuit_breakers', {
  id: text('id').primaryKey(), // e.g. "omniRoute-qwen2.5-coder:14b"
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  errorCount: integer('error_count').notNull().default(0),
  cooldownUntil: text('cooldown_until'), // ISO date string
  updatedAt: text('updated_at').notNull(),
  migrationState: text('migration_state').default('none'),
  migrationOwner: text('migration_owner'),
  leaseExpiresAt: text('lease_expires_at'),
  migrationVersion: integer('migration_version').default(1)
});


export const skills = sqliteTable('skills', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  agentId: text('agent_id'),
  toolId: text('tool_id'),
  modelHint: text('model_hint'),
  paramsTemplate: text('params_template', { mode: 'json' }), // Record<string, unknown>
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  isPublic: integer('is_public', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const revenueOpportunities = sqliteTable('revenue_opportunities', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  opportunityType: text('opportunity_type').notNull(),
  sourcePlatform: text('source_platform'),
  sourceUrl: text('source_url'),
  stage: text('stage').notNull().default('discovered'),
  researchPayload: text('research_payload', { mode: 'json' }),
  evidencePayload: text('evidence_payload', { mode: 'json' }),
  demandScore: real('demand_score'),
  competitionScore: real('competition_score'),
  profitabilityScore: real('profitability_score'),
  complianceRiskScore: real('compliance_risk_score'),
  evidenceQualityScore: real('evidence_quality_score'),
  overallScore: real('overall_score'),
  scoringConfidence: text('scoring_confidence'),
  scoringVersion: text('scoring_version'),
  estimatedRevenue: real('estimated_revenue'),
  estimatedCost: real('estimated_cost'),
  currency: text('currency').default('USD'),
  ownerAgentId: text('owner_agent_id'),
  createdByRunId: text('created_by_run_id'),
  approvalStatus: text('approval_status').notNull().default('not_required'),
  approvedBy: text('approved_by'),
  approvedAt: text('approved_at'),
  rejectionReason: text('rejection_reason'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  stageIdx: index('idx_rev_opp_stage').on(table.stage),
  approvalStatusIdx: index('idx_rev_opp_approval_status').on(table.approvalStatus),
  typeIdx: index('idx_rev_opp_type').on(table.opportunityType),
  createdAtIdx: index('idx_rev_opp_created_at').on(table.createdAt),
}));

export const revenueOpportunityEvents = sqliteTable('revenue_opportunity_events', {
  id: text('id').primaryKey(),
  opportunityId: text('opportunity_id').notNull(),
  eventType: text('event_type').notNull(),
  previousStage: text('previous_stage'),
  nextStage: text('next_stage'),
  actorType: text('actor_type'),
  actorId: text('actor_id'),
  metadata: text('metadata', { mode: 'json' }),
  createdAt: text('created_at').notNull(),
});

export const productionBriefs = sqliteTable('production_briefs', {
  id: text('id').primaryKey(),
  opportunityId: text('opportunity_id').notNull(),
  version: integer('version').notNull().default(1),
  status: text('status').notNull().default('draft'),
  objective: text('objective'),
  targetPlatform: text('target_platform'),
  targetAudience: text('target_audience', { mode: 'json' }),
  productSummary: text('product_summary'),
  valueProposition: text('value_proposition'),
  contentType: text('content_type'),
  requestedAssetCount: integer('requested_asset_count').default(1),
  language: text('language').default('en'),
  tone: text('tone'),
  keyBenefits: text('key_benefits', { mode: 'json' }),
  approvedClaims: text('approved_claims', { mode: 'json' }),
  prohibitedClaims: text('prohibited_claims', { mode: 'json' }),
  requiredDisclosures: text('required_disclosures', { mode: 'json' }),
  contentAngles: text('content_angles', { mode: 'json' }),
  sourceEvidence: text('source_evidence', { mode: 'json' }),
  successMetrics: text('success_metrics', { mode: 'json' }),
  estimatedGenerationCost: real('estimated_generation_cost'),
  actualGenerationCost: real('actual_generation_cost'),
  executionPlan: text('execution_plan', { mode: 'json' }),
  createdBy: text('created_by'),
  createdByRunId: text('created_by_run_id'),
  approvedBy: text('approved_by'),
  approvedAt: text('approved_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  opportunityIdIdx: index('idx_prod_brief_opp').on(table.opportunityId),
  statusIdx: index('idx_prod_brief_status').on(table.status),
  platformIdx: index('idx_prod_brief_platform').on(table.targetPlatform),
  createdAtIdx: index('idx_prod_brief_created_at').on(table.createdAt),
}));

export const productionBriefEvents = sqliteTable('production_brief_events', {
  id: text('id').primaryKey(),
  briefId: text('brief_id').notNull(),
  opportunityId: text('opportunity_id').notNull(),
  eventType: text('event_type').notNull(),
  actorId: text('actor_id'),
  metadata: text('metadata', { mode: 'json' }),
  createdAt: text('created_at').notNull(),
});

export const generatedAssets = sqliteTable('generated_assets', {
  id: text('id').primaryKey(),
  briefId: text('brief_id').notNull(),
  opportunityId: text('opportunity_id').notNull(),
  jobId: text('job_id'),
  assetType: text('asset_type').notNull(),
  title: text('title').notNull(),
  content: text('content'),
  fileReference: text('file_reference'),
  version: integer('version').notNull().default(1),
  previousVersionId: text('previous_version_id'),
  status: text('status').notNull().default('draft'),
  validationResult: text('validation_result', { mode: 'json' }),
  complianceResult: text('compliance_result', { mode: 'json' }),
  metadata: text('metadata', { mode: 'json' }),
  createdByAgentId: text('created_by_agent_id'),
  createdByRunId: text('created_by_run_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  briefIdx: index('idx_gen_asset_brief').on(table.briefId),
  statusIdx: index('idx_gen_asset_status').on(table.status),
  jobIdx: index('idx_gen_asset_job').on(table.jobId),
}));

/* ─── EVOLUTION LAB (Agent Run Registry & Prompt Versioning) ─── */

export const agentPromptVersions = sqliteTable('agent_prompt_versions', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull(),
  versionNumber: integer('version_number').notNull(),
  systemPrompt: text('system_prompt').notNull(),
  model: text('model'),
  provider: text('provider'),
  temperature: real('temperature'),
  tools: text('tools', { mode: 'json' }), // string[]
  skills: text('skills', { mode: 'json' }), // string[]
  memoryConfiguration: text('memory_configuration', { mode: 'json' }),
  permissions: text('permissions', { mode: 'json' }),
  status: text('status').notNull().default('draft'), // draft, testing, active, retired, rollback
  author: text('author'),
  reasonForChange: text('reason_for_change'),
  parentVersionId: text('parent_version_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  agentIdIdx: index('idx_prompt_ver_agent').on(table.agentId),
  statusIdx: index('idx_prompt_ver_status').on(table.status),
}));

export const agentExecutions = sqliteTable('agent_executions', {
  id: text('id').primaryKey(),
  sourceType: text('source_type'),
  sourceRunId: text('source_run_id'),
  sourceTaskId: text('source_task_id'),
  idempotencyKey: text('idempotency_key').unique(),
  agentId: text('agent_id').notNull(),
  promptVersionId: text('prompt_version_id'),
  provider: text('provider'),
  model: text('model'),
  input: text('input', { mode: 'json' }),
  output: text('output', { mode: 'json' }),
  toolCalls: text('tool_calls', { mode: 'json' }),
  status: text('status'),
  success: integer('success', { mode: 'boolean' }),
  error: text('error', { mode: 'json' }),
  primaryFailureCategory: text('primary_failure_category'),
  secondaryFailureCategories: text('secondary_failure_categories', { mode: 'json' }),
  complianceResult: text('compliance_result'),
  humanReviewScore: integer('human_review_score'),
  opportunityId: text('opportunity_id'),
  briefId: text('brief_id'),
  assetId: text('asset_id'),
  startedAt: text('started_at').notNull(),
  completedAt: text('completed_at'),
  executionTimeMs: integer('execution_time_ms'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  cachedTokens: integer('cached_tokens'),
  totalTokens: integer('total_tokens'),
  estimatedCost: real('estimated_cost'),
  actualCost: real('actual_cost'),
  costSource: text('cost_source'), // provider_reported, calculated, estimated, unavailable
  createdAt: text('created_at').notNull(),
}, (table) => ({
  agentIdIdx: index('idx_exec_agent').on(table.agentId),
  promptVersionIdx: index('idx_exec_prompt').on(table.promptVersionId),
  successIdx: index('idx_exec_success').on(table.success),
  idempotencyIdx: index('idx_exec_idem').on(table.idempotencyKey),
}));

export const runEvaluations = sqliteTable('run_evaluations', {
  id: text('id').primaryKey(),
  executionId: text('execution_id').notNull(),
  evaluationVersion: text('evaluation_version'),
  status: text('status'),
  deterministicScores: text('deterministic_scores', { mode: 'json' }),
  judgeScores: text('judge_scores', { mode: 'json' }),
  taskCompletionScore: integer('task_completion_score'),
  outputQualityScore: integer('output_quality_score'),
  complianceScore: integer('compliance_score'),
  correctnessScore: integer('correctness_score'),
  costEfficiencyScore: integer('cost_efficiency_score'),
  speedScore: integer('speed_score'),
  overallScore: integer('overall_score'),
  reasons: text('reasons', { mode: 'json' }),
  strengths: text('strengths', { mode: 'json' }),
  weaknesses: text('weaknesses', { mode: 'json' }),
  recommendations: text('recommendations', { mode: 'json' }),
  evaluatorProvider: text('evaluator_provider'),
  evaluatorModel: text('evaluator_model'),
  evaluationPromptVersion: text('evaluation_prompt_version'),
  evaluationMethod: text('evaluation_method'), // deterministic, judge, hybrid
  evaluationCost: real('evaluation_cost'),
  evaluationDurationMs: integer('evaluation_duration_ms'),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  executionIdx: index('idx_eval_exec').on(table.executionId),
}));

export const evaluationDatasets = sqliteTable('evaluation_datasets', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull(),
});

export const evaluationTestCases = sqliteTable('evaluation_test_cases', {
  id: text('id').primaryKey(),
  datasetId: text('dataset_id').notNull(),
  input: text('input', { mode: 'json' }),
  expectedOutput: text('expected_output', { mode: 'json' }), // Expected output or properties
  evaluationRules: text('evaluation_rules', { mode: 'json' }),
  acceptanceThreshold: integer('acceptance_threshold').notNull().default(80),
  tags: text('tags', { mode: 'json' }),
  enabled: integer('enabled', { mode: 'boolean' }).default(true),
});

export const evaluationSuiteRuns = sqliteTable('evaluation_suite_runs', {
  id: text('id').primaryKey(),
  datasetId: text('dataset_id').notNull(),
  promptVersionId: text('prompt_version_id').notNull(),
  status: text('status'), // pending, running, completed, failed
  createdAt: text('created_at').notNull(),
});

export const evaluationCaseResults = sqliteTable('evaluation_case_results', {
  id: text('id').primaryKey(),
  suiteRunId: text('suite_run_id').notNull(),
  testCaseId: text('test_case_id').notNull(),
  executionId: text('execution_id'),
  passed: integer('passed', { mode: 'boolean' }),
  score: integer('score'),
});

/* ─── REVENUE INTELLIGENCE & ATTRIBUTION ─── */

export const campaigns = sqliteTable('campaigns', {
  id: text('id').primaryKey(),
  opportunityId: text('opportunity_id').notNull(),
  briefId: text('brief_id').notNull(),
  name: text('name').notNull(),
  platform: text('platform').notNull(),
  productReference: text('product_reference'),
  status: text('status').notNull().default('draft'), // draft, scheduled, active, paused, completed, cancelled, archived
  startAt: text('start_at'),
  endAt: text('end_at'),
  budget: real('budget'),
  spend: real('spend').default(0),
  revenue: real('revenue').default(0),
  commission: real('commission').default(0),
  roi: real('roi').default(0),
  notes: text('notes'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  opportunityIdx: index('idx_camp_opp').on(table.opportunityId),
  briefIdx: index('idx_camp_brief').on(table.briefId),
  statusIdx: index('idx_camp_status').on(table.status),
  platformIdx: index('idx_camp_platform').on(table.platform),
}));

export const attribution = sqliteTable('attribution', {
  id: text('id').primaryKey(),
  campaignId: text('campaign_id').notNull(),
  runId: text('run_id'), // Link to OmniRoute/Agentic OS run
  assetId: text('asset_id'), // Link to generated asset
  promptVersionId: text('prompt_version_id'),
  agentId: text('agent_id'),
  model: text('model'),
  provider: text('provider'),
  views: integer('views').default(0),
  watchTime: integer('watch_time').default(0),
  ctr: real('ctr').default(0),
  clicks: integer('clicks').default(0),
  conversions: integer('conversions').default(0),
  revenue: real('revenue').default(0),
  commission: real('commission').default(0),
  cost: real('cost').default(0),
  profit: real('profit').default(0),
  roi: real('roi').default(0),
  confidence: text('confidence').default('medium'), // high, medium, low
  source: text('source'), // Analytics provider, e.g., 'tiktok_ads', 'shopify'
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  campaignIdx: index('idx_attr_camp').on(table.campaignId),
  runIdx: index('idx_attr_run').on(table.runId),
  assetIdx: index('idx_attr_asset').on(table.assetId),
  promptIdx: index('idx_attr_prompt').on(table.promptVersionId),
  agentIdx: index('idx_attr_agent').on(table.agentId),
}));

/* ─── MILESTONE 7: CONNECTORS & EVENT INGESTION ─── */

export const systemEvents = sqliteTable('system_events', {
  id: text('id').primaryKey(),
  eventType: text('event_type').notNull(), // video_view, click, purchase, etc.
  source: text('source').notNull(), // tiktok_shop, google_analytics, system
  payload: text('payload', { mode: 'json' }).notNull(),
  processed: integer('processed', { mode: 'boolean' }).default(false).notNull(),
  timestamp: text('timestamp').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  typeIdx: index('idx_sys_events_type').on(table.eventType),
  sourceIdx: index('idx_sys_events_source').on(table.source),
  processedIdx: index('idx_sys_events_processed').on(table.processed),
}));

export const knowledgeEdges = sqliteTable('knowledge_edges', {
  id: text('id').primaryKey(),
  subjectId: text('subject_id').notNull(),
  subjectType: text('subject_type').notNull(), // campaign, asset, execution, etc.
  predicate: text('predicate').notNull(), // GENERATED_BY, BELONGS_TO, RESULTED_IN
  objectId: text('object_id').notNull(),
  objectType: text('object_type').notNull(),
  metadata: text('metadata', { mode: 'json' }),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  subjIdx: index('idx_know_edge_subj').on(table.subjectId),
  objIdx: index('idx_know_edge_obj').on(table.objectId),
  predIdx: index('idx_know_edge_pred').on(table.predicate),
}));

export const treasuryLedger = sqliteTable('treasury_ledger', {
  id: text('id').primaryKey(),
  transactionType: text('transaction_type').notNull(), // cost, revenue, transfer
  amount: real('amount').notNull(), // positive for revenue, negative for cost
  currency: text('currency').default('USD').notNull(),
  source: text('source').notNull(), // openai, tiktok_shop
  campaignId: text('campaign_id'),
  runId: text('run_id'),
  timestamp: text('timestamp').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  campIdx: index('idx_treasury_camp').on(table.campaignId),
  runIdx: index('idx_treasury_run').on(table.runId),
  typeIdx: index('idx_treasury_type').on(table.transactionType),
}));

// Agent Teams MVP Schema
export const teams = sqliteTable('teams', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  originalPrompt: text('original_prompt').notNull(),
  teamSheet: text('team_sheet', { mode: 'json' }),
  status: text('status').notNull().default('awaiting_approval'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const teamRuns = sqliteTable('team_runs', {
  id: text('id').primaryKey(),
  teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('pending'), // 'pending' | 'running' | 'paused' | 'completed' | 'failed'
  currentAgent: text('current_agent'), // deprecated in favor of activeAgentId
  activeAgentId: text('active_agent_id'),
  currentStep: integer('current_step').notNull().default(0), // Index in executionSequence
  goalId: text('goal_id'), // The active goal for the current agent
  verificationReport: text('verification_report', { mode: 'json' }), // Verification report output
  repairCount: integer('repair_count').notNull().default(0), // Max 1 repair cycle
  checkpointVersion: integer('checkpoint_version').notNull().default(1),
  checkpointSequence: integer('checkpoint_sequence').notNull().default(0),
  databaseRevision: integer('database_revision').notNull().default(1),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const agentTeamHandoffs = sqliteTable('agent_team_handoffs', {
  id: text('id').primaryKey(),
  teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  goalId: text('goal_id').notNull(),
  agentId: text('agent_id').notNull(),
  status: text('status').notNull(), // 'completed' | 'failed' | 'blocked'
  summary: text('summary').notNull(),
  decisions: text('decisions', { mode: 'json' }), // string[]
  artifacts: text('artifacts', { mode: 'json' }), // Array<{path, checksum, checksumAlgorithm, size, producedBy}>
  openIssues: text('open_issues', { mode: 'json' }), // string[]
  recommendedNextActions: text('recommended_next_actions', { mode: 'json' }), // string[]
  createdAt: text('created_at').notNull(),
});
export const agentTeamArtifacts = sqliteTable('agent_team_artifacts', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => teamRuns.id, { onDelete: 'cascade' }),
  teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  goalId: text('goal_id').notNull(),
  agentId: text('agent_id').notNull(),
  handoffId: text('handoff_id'),
  path: text('path').notNull(),
  checksum: text('checksum').notNull(),
  checksumAlgorithm: text('checksum_algorithm').notNull().default('sha256'),
  size: integer('size').notNull(),
  mimeType: text('mime_type'),
  createdAt: text('created_at').notNull(),
  verifiedAt: text('verified_at').notNull()
}, (table) => {
  return {
    runIdx: index('idx_agent_team_artifacts_run').on(table.runId),
    runAgentIdx: index('idx_agent_team_artifacts_run_agent').on(table.runId, table.agentId),
    uniqueArtifact: unique('uq_agent_team_artifacts_run_path_checksum').on(table.runId, table.path, table.checksum)
  };
});

export const verificationReports = sqliteTable('verification_reports', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => teamRuns.id, { onDelete: 'cascade' }),
  teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  goalId: text('goal_id').notNull(),
  verifierId: text('verifier_id').notNull(),
  passed: integer('passed', { mode: 'boolean' }).notNull(),
  checks: text('checks', { mode: 'json' }).notNull(),
  evidence: text('evidence').notNull(),
  blockingIssues: text('blocking_issues', { mode: 'json' }),
  recommendedFixes: text('recommended_fixes', { mode: 'json' }),
  createdAt: text('created_at').notNull()
});

/* Gateway & Security Architecture */

export const providerCredentials = sqliteTable('provider_credentials', {
  providerId: text('provider_id').primaryKey(), // canonical id (e.g. 'omniroot')
  configured: integer('configured', { mode: 'boolean' }).notNull().default(false),
  maskedPreview: text('masked_preview'),
  validationStatus: text('validation_status'), // valid, invalid, etc.
  lastValidatedAt: text('last_validated_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  migrationState: text('migration_state').default('none'),
  migrationOwner: text('migration_owner'),
  leaseExpiresAt: text('lease_expires_at'),
  migrationVersion: integer('migration_version').default(1)
});

export const agentProviderAssignments = sqliteTable('agent_provider_assignments', {
  agentId: text('agent_id').primaryKey(),
  providerId: text('provider_id').notNull(),
  modelId: text('model_id'),
  routingMode: text('routing_mode').notNull(), // 'automatic' | 'preferred' | 'forced'
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  migrationState: text('migration_state').default('none'),
  migrationOwner: text('migration_owner'),
  leaseExpiresAt: text('lease_expires_at'),
  migrationVersion: integer('migration_version').default(1)
});

export const gatewayConfiguration = sqliteTable('gateway_configuration', {
  id: integer('id').primaryKey(), // single row
  maxProviderRetries: integer('max_provider_retries').notNull().default(3),
  maxFallbackProviders: integer('max_fallback_providers').notNull().default(3),
  providerTimeoutMs: integer('provider_timeout_ms').notNull().default(30000),
  degradedLatencyMs: integer('degraded_latency_ms').notNull().default(2000),
  circuitFailureThreshold: integer('circuit_failure_threshold').notNull().default(5),
  circuitResetTimeoutMs: integer('circuit_reset_timeout_ms').notNull().default(60000),
  healthCheckIntervalMs: integer('health_check_interval_ms').notNull().default(300000),
  version: integer('version').notNull().default(1),
  updatedAt: text('updated_at').notNull(),
  migrationState: text('migration_state').default('none'),
  migrationOwner: text('migration_owner'),
  leaseExpiresAt: text('lease_expires_at'),
  migrationVersion: integer('migration_version').default(1)
});

// Projects — durable first-class entities
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  status: text('status').notNull().default('active'), // active | archived | paused
  tags: text('tags', { mode: 'json' }), // string[]
  workspacePath: text('workspace_path'), // optional default repo
  color: text('color'), // optional UI accent color
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// Knowledge items — Obsidian-inspired notes/decisions/research within projects
export const knowledgeItems = sqliteTable('knowledge_items', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  title: text('title').notNull(),
  content: text('content').notNull().default(''),
  type: text('type').notNull().default('note'), // note | decision | research | reference | meeting | result
  tags: text('tags', { mode: 'json' }), // string[]
  linkedIds: text('linked_ids', { mode: 'json' }), // string[] — forward links to other item ids
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// Entity links — generic relationship foundation
export const entityLinks = sqliteTable('entity_links', {
  id: text('id').primaryKey(),
  fromId: text('from_id').notNull(),
  fromType: text('from_type').notNull(), // note | task | run | project | decision | ...
  toId: text('to_id').notNull(),
  toType: text('to_type').notNull(),
  relation: text('relation').notNull(), // belongs_to | references | supersedes | blocks | ...
  metadata: text('metadata', { mode: 'json' }),
  createdAt: text('created_at').notNull(),
});
