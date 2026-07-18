import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';

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
  originalGoal: text('original_goal').notNull(),
  status: text('status').notNull().default('queued'),
  retryCount: integer('retry_count').notNull().default(0),
  providerFallbackCount: integer('provider_fallback_count').notNull().default(0),
  activeCheckpointId: text('active_checkpoint_id'),
  workerId: text('worker_id'), // For atomic worker leases
  leaseExpiresAt: text('lease_expires_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  runSummary: text('run_summary', { mode: 'json' }),
});

export const goalEvents = sqliteTable('goal_events', {
  id: text('id').primaryKey(), // Usually runId + sequenceId
  goalId: text('goal_id').notNull().references(() => goals.id, { onDelete: 'cascade' }),
  sequenceId: integer('sequence_id').notNull(),
  timestamp: text('timestamp').notNull(),
  state: text('state').notNull(),
  step: integer('step').notNull(),
  message: text('message').notNull(),
  provider: text('provider').notNull().default('unknown'),
  model: text('model').notNull().default('unknown'),
  tool: text('tool'),
  checkpointId: text('checkpoint_id'),
  error: text('error'),
  
  // UX Fields
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
  eventSchemaVersion: integer('event_schema_version').notNull().default(1),
  operationId: text('operation_id')
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
  updatedAt: text('updated_at').notNull()
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
