/* ========================================================================
   TYPES — Agentic OS Domain Model
   All entity interfaces from the PRD plus UI state types.
   ======================================================================== */

/* ─── Core Entities ─── */

export interface AgentDefinition {
  id: string;
  name: string;
  slug: string;
  avatar: string;
  color: string;
  runtimeId: string;
  kind: "first-class" | "runtime-backed";
  status: "active" | "inactive" | "error";
  capabilities: string[];
  toolIds: string[];
  memoryScopes: string[];
  providerIds: string[];
  defaultBoardId: string;
  visibility: "public" | "private";
  description?: string;
  recentActivity?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeHealth {
  status: "healthy" | "unhealthy" | "unknown";
  lastCheck: string;
  latencyMs?: number;
}

export interface Runtime {
  id: string;
  label: string;
  adapterType: string;
  health: RuntimeHealth;
  supportedModes: ("chat" | "task" | "workflow")[];
  eventProtocol: string;
  toolAccessMode: string;
}

export interface ProviderModel {
  id: string;
  name: string;
  displayName?: string;
  contextLength?: number;
  inputCost?: number;
  outputCost?: number;
}

export interface ProviderDefinition {
  id: string;
  name: string;
  kind: "llm" | "mcp" | "api" | "browser" | "automation" | "scraper" | "storage";
  category: "local" | "remote" | "infra";
  adapter: string;
  authScheme: "token" | "oauth" | "key" | "none";
  status: "connected" | "disconnected" | "error" | "needs-auth" | "experimental" | "disabled";
  scopes?: string[];
  metadata?: Record<string, unknown>;
  description?: string;
  lastActivity?: string;
  errorMessage?: string;
  /** Default models available for this provider */
  models?: ProviderModel[];
  /** The default model selected for this provider */
  defaultModel?: string;
  /** Whether a valid API key is configured (server-side check) */
  hasKey?: boolean;
  /** Which agents are using this provider by default */
  usedByAgentDefaults?: string[];
  baseUrl?: string;
}

export interface AgentModelDefault {
  agentId: string;
  agentName: string;
  /** Primary (default) provider ID */
  providerId: string;
  /** The specific model on that provider */
  modelId: string;
  /** Fallback provider IDs in priority order */
  fallbackProviderIds: string[];
  /** Whether fallback is enabled */
  fallbackEnabled: boolean;
}

export interface MemoryScope {
  id: string;
  workspaceId: string;
  name: string;
  type: "global" | "board" | "agent" | "session" | "task" | "workspace";
  summary?: string;
  tags: string[];
  permissions: string[];
  entryCount?: number;
  lastUpdated?: string;
}

export interface MemoryEntry {
  id: string;
  scopeId: string;
  kind: "note" | "fact" | "artifact" | "conversation" | "decision" | "summary";
  title: string;
  content: string;
  links?: string[];
  sourceRunId?: string;
  createdAt: string;
  updatedAt: string;
  syncStatus?: SyncStatus;
  sourceType?: string;
  sourceId?: string;
}

export type MemoryPolicy = "immediate" | "batched" | "once-daily" | "manual";

export type SyncStatus = "pending" | "synced" | "failed";

export interface SyncJob {
  id: string;
  entryIds: string[];
  status: SyncStatus;
  retryCount: number;
  lastAttempt?: string;
  error?: string;
}

export interface ObsidianConfig {
  vaultPath: string;
  folderMapping: Record<string, string>;
  syncFrequency: MemoryPolicy;
  autoSummary: boolean;
  previewBeforeSync: boolean;
}

export interface RunRecord {
  id: string;
  agentId: string;
  sessionId: string;
  workspaceId: string;
  mode: "chat" | "task" | "workflow" | "goal";
  status: "running" | "queued" | "waiting" | "failed" | "completed" | "archived" | "intake" | "researching" | "drafting" | "awaiting_review" | "approved" | "exported" | "paused" | "cancelled";
  input: string;
  output?: string;
  logs: string[];
  events: string[];
  linkedArtifacts: string[];
  durationMs?: number;
  errorMessage?: string;
  stalled?: boolean;
  summary?: string;
  createdAt: string;
  updatedAt: string;
}

export type GoalState = "queued" | "planning" | "executing" | "reasoning" | "validating" | "checkpointed" | "paused" | "retrying" | "completed" | "failed" | "stopped" | "interrupted" | "pause_requested" | "waiting_for_approval" | "tool_completed" | "tool_started" | "artifact_created" | "agent_completed" | "checkpoint_written" | "verification_completed" | "handoff_created" | "recovery_conflict" | "recovery_available" | "agent_started" | "agent_switch" | "team_paused" | "team_completed" | "repair_requested" | "team_resumed" | "user_action_required";

export type NormalizedStatus = 'idle' | 'active' | 'planning' | 'attention' | 'completed' | 'failed';

export type EventCategory =
  | 'planning'
  | 'model'
  | 'tool'
  | 'file'
  | 'command'
  | 'validation'
  | 'error'
  | 'warning'
  | 'system'
  | 'idle';

export type LifecycleState = 'idle' | 'planning' | 'running' | 'waiting' | 'waiting_for_approval' | 'retrying' | 'paused' | 'completed' | 'failed' | 'stopped';

export type EventType = 
  | 'task_started' | 'planning_started' | 'planning_completed' 
  | 'step_started' | 'step_completed' | 'step_failed' 
  | 'tool_started' | 'tool_completed' | 'tool_failed' 
  | 'file_search_started' | 'file_found' | 'file_read_started' | 'file_read_completed' 
  | 'file_edit_started' | 'file_edit_completed' | 'command_started' | 'command_output' 
  | 'command_completed' | 'command_failed' | 'verification_completed' | 'handoff_created' | 'artifact_created' | 'agent_completed' | 'checkpoint_written' | 'agent_started' | 'model_request_started' | 'model_stream_active' 
  | 'model_request_slow' | 'model_request_completed' | 'model_request_timed_out' 
  | 'retry_started' | 'approval_requested' | 'approval_received' | 'validation_started' 
  | 'validation_passed' | 'validation_failed' | 'task_paused' | 'task_resumed' 
  | 'task_stopped' | 'task_completed' | 'task_failed' | 'user_action_required'
  | 'agent_switch' | 'agent_started' | 'artifact_created' | 'checkpoint_written'
  | 'recovery_conflict' | 'recovery_available' | 'agent_completed' | 'team_paused'
  | 'team_completed' | 'repair_requested' | 'team_resumed';

export interface AgentHandoff {
  agentId: string;
  status: 'completed' | 'failed' | 'blocked';
  summary: string;
  decisions: any[];
  artifacts: Array<{
    path: string;
    checksum: string;
    checksumAlgorithm: 'sha256';
    size: number;
    producedBy: string;
  }>;
  openIssues: any[];
  recommendedNextActions: any[];
  createdAt?: string;
}

export interface VerificationReport {
  passed: boolean;
  summary: string;
  checks: Array<{
    name: string;
    passed: boolean;
    command?: string;
    evidence: string;
  }>;
  blockingIssues: string[];
  recommendedFixes: string[];
  completedAt: string;
}

export interface AgentExecutionContext {
  runId?: string;
  teamId?: string;
  agentId?: string;
  role?: string;
  instructions?: string;
  responsibilities?: string[];
  acceptanceCriteria?: string[];
  workspaceRoot?: string;
  allowedTools?: string[];
  readScopes?: string[];
  writeScopes?: string[];
  dependencyArtifacts?: Array<{
    path: string;
    checksum: string;
    size: number;
    producedBy: string;
  }>;
  handoffs?: AgentHandoff[];
  approvalPolicy?: string;
  isTeamExecution?: boolean;
  repairContext?: {
    blockingIssues: string[];
    recommendedFixes: string[];
    attempt: number;
  };
}

export interface GoalEvent {
  goalId: string;
  sequence: number;
  timestamp: string;
  state: GoalState;
  step: number;
  message: string;
  provider?: string;
  model?: string;
  tool?: string;
  checkpointId?: string;
  error?: string;

  // UX & Tracking fields
  eventType?: EventType;
  normalizedStatus?: NormalizedStatus;
  lifecycleState?: LifecycleState;
  userMessage?: string;
  technicalMessage?: string;
  durationMs?: number;
  filePath?: string;
  command?: string;
  nextAction?: string;
  retryCount?: number;
  requiresUserAction?: boolean;
  errorCode?: string;
  errorDetails?: string;
  eventSchemaVersion?: number;
  operationId?: string;
  
  teamId?: string;
  agentId?: string;
  payload?: any;
}

export interface RunDiagnostics {
  totalEvents: number;
  totalModelCalls: number;
  totalToolCalls: number;
  totalRetries: number;
  totalCommands: number;
  averageModelResponseMs?: number;
  longestOperation?: {
    eventId?: string;
    eventType: EventType;
    label: string;
    durationMs: number;
    tool?: string;
    filePath?: string;
    command?: string;
  };
}

export interface RunSummary {
  runSummaryVersion: number;
  runId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: string;
  provider: string;
  runtimeModel: string;
  filesRead: number;
  filesModified: number;
  commandsExecuted: number;
  validationStatus: string;
  retries: number;
  summary: string;
  changedFiles: string[];
  finalUserMessage: string;
  diagnostics?: RunDiagnostics;
  /** Project Memory retrieval proof (closure): exact memory IDs injected into
   *  the model context for this run (e.g. CodeX engineering retrieval). */
  memoryRetrieved?: {
    memoryIds: string[];
    count: number;
    truncated: boolean;
    at: number;
  };
}

export interface GoalRecord {
  id: string;
  workspacePath?: string;
  conversationId?: string;
  workspaceId?: string;
  originalGoal: string;
  status: GoalState;
  history: GoalEvent[];
  createdAt: string;
  updatedAt: string;
  retryCount: number;
  providerFallbackCount: number;
  executionOptions?: ExecutionOptions;
  checkpointId?: string;
  runSummary?: RunSummary;
}


export interface ResearchBrief {
  id: string;
  title: string;
  requestType: "competitor" | "company" | "market" | "prospect";
  target: string;
  goal: string;
  competitors: string[];
  priority: "high" | "medium" | "low";
  outputFormat: "markdown" | "pdf";
  status: "intake" | "queued" | "researching" | "drafting" | "awaiting_review" | "approved" | "exported" | "failed";
  createdAt: string;
  updatedAt: string;
  runId?: string;
  artifactIds: string[];
}

export interface ServiceLead {
  id: string;
  customerName: string;
  customerEmail: string;
  company: string;
  requestType: string;
  budget: string;
  goal: string;
  cvText?: string;
  jobDescription?: string;
  status: "new" | "scoring" | "qualified" | "rejected" | "offered" | "paid" | "in_progress" | "delivered";
  createdAt: string;
  updatedAt: string;
  proposalArtifactId?: string;
  briefId?: string;
}

export interface Artifact {
  id: string;
  type: string;
  title: string;
  preview: string;
  content?: string;
  rawJson?: string;
  sourceRunId?: string;
  linkedBoardId?: string;
  linkedAgentId?: string;
  version: string;
  status: "draft" | "active" | "review" | "done" | "archived";
  emailStatus?: "pending" | "sent" | "failed";
  emailTimestamp?: string;
  accessTokenHash?: string;
  accessTokenExpiresAt?: string;
  tokenUsed?: boolean;
  createdAt?: string;
  updatedAt?: string;
  // Project Workspace V2: project/task linkage + verification metadata.
  projectId?: string;
  taskId?: string;
  verificationState?: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
  location?: string;
  createdBy?: string;
}

export interface Board {
  id: string;
  name: string;
  purpose: string;
  color: string;
  icon?: string;
  cardTypes: string[];
  filters: Record<string, unknown>;
  layoutMode: "board" | "gallery" | "list" | "detail" | "kanban";
}

/* ─── Adapter Contracts ─── */

export interface ArtifactRef {
  id: string;
  type: string;
}

export interface ToolContext {
  allowedToolIds: string[];
}

export interface MemoryContext {
  scopeIds: string[];
}

export interface UIContext {
  currentRoute: string;
}

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  agentId?: string;
}

export interface InvocationAck {
  status: "accepted" | "rejected";
  runId: string;
}

export interface RuntimeEvent {
  type: string;
  payload: unknown;
  timestamp: string;
}

export interface ExecutionOptions {
  modelOverride?: string;
  providerOverride?: string;
  executionModelId?: string;
  disableFallback?: boolean;
  executionProviderId?: 'auto' | 'none' | string;
  requiresApproval?: boolean;
  /** Policy gate (Stage 2): planning escalation to a cloud sibling model is
   *  only injected when this is true. Defaults true for legacy callers;
   *  localOnly / approvalRequired policies set it false at dispatch. */
  allowCloudEscalation?: boolean;
}

export interface AgentInvocation {
  runId: string;
  agentId: string;
  sessionId: string;
  workspaceId: string;
  mode: "chat" | "task" | "workflow";
  prompt: string;
  attachments?: ArtifactRef[];
  toolContext?: ToolContext;
  memoryContext?: MemoryContext;
  uiContext?: UIContext;
  executionOptions?: ExecutionOptions;
  requestedOutput?: "text" | "json" | "artifact" | "plan";
}

export interface RuntimeAdapter {
  id: string;
  label: string;
  health(): Promise<RuntimeHealth>;
  listAgents(): Promise<AgentDefinition[]>;
  invoke(input: AgentInvocation): Promise<InvocationAck>;
  stream(input: AgentInvocation): AsyncIterable<RuntimeEvent>;
  cancel(runId: string): Promise<void>;
  getRun(runId: string): Promise<RunRecord>;
  listTools(agentId?: string): Promise<ToolDefinition[]>;
  listMemoryScopes(agentId?: string): Promise<MemoryScope[]>;
}

export interface ChatTargetRequest {
  workspaceId: string;
  sessionId: string;
  preferredAgentId?: string;
  preferredMode?: "manual" | "auto" | "delegated";
  intent?: string;
}

export interface RouteResolution {
  agentId: string;
  mode: string;
}

export interface ChatMessageInput {
  target: RouteResolution;
  message: string;
}

export interface ChatRouter {
  resolveTarget(input: ChatTargetRequest): Promise<RouteResolution>;
  sendMessage(input: ChatMessageInput): Promise<InvocationAck>;
  streamMessage(input: ChatMessageInput): AsyncIterable<RuntimeEvent>;
}

/* ─── Loop Engineering ─── */

export interface LoopStep {
  id: string;
  name: string;
  agentId: string;
  prompt: string;
  dependsOn?: string[];
  mode: "chat" | "task" | "workflow";
  outputKey?: string;
}

export interface LoopDefinition {
  id: string;
  name: string;
  description?: string;
  steps: LoopStep[];
  createdAt: string;
  status: "draft" | "running" | "completed" | "failed";
  maxIterations?: number;
  stopCondition?: string;
}

export interface StepStatus {
  stepId: string;
  name: string;
  status: "pending" | "running" | "completed" | "failed";
  startedAt?: string;
  completedAt?: string;
  errorMessage?: string;
}

export interface LoopRun {
  id: string;
  loopId: string;
  stepResults: Record<string, any>; // stepId -> result object or string
  stepStatuses: StepStatus[];
  status: "running" | "completed" | "failed";
  createdAt: string;
  completedAt?: string;
  errorMessage?: string;
  iteration: number;
  score?: number;
  stopReason?: string;
}

/* ─── Video-Agent Pipeline ─── */

export type VideoFormat = "vertical-short" | "landscape-long" | "animated" | "screen-record";
export type VideoStage = "scripting" | "asset-gathering" | "rendering" | "review" | "publish";

export interface VideoJobRequest {
  prompt: string;
  format: VideoFormat;
  assetRefs?: { id: string; type: string }[];
  targetDurationSeconds?: number;
}

export interface VideoJobRecord {
  id: string;
  agentId: string;
  request: VideoJobRequest;
  stage: VideoStage;
  status: "queued" | "running" | "completed" | "failed";
  artifactId?: string;
  runId: string;
  createdAt: string;
  updatedAt: string;
}

/* ─── UI State Types ─── */

export type DrawerEntityType = "agent" | "run" | "memory" | "provider" | "build" | "artifact" | null;

export interface DrawerState {
  isOpen: boolean;
  entityType: DrawerEntityType;
  entityId: string | null;
  isPinned: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "agent" | "system";
  agentId?: string;
  content: string;
  timestamp: string;
}

export interface ChatState {
  targetAgentId: string | null;
  routingMode: "manual" | "auto" | "delegated";
  sessionId: string;
  messages: ChatMessage[];
  isExpanded: boolean;
}

export interface RouteContext {
  currentBoard: string | null;
  currentWorkspace: string;
  activeFilters: Record<string, string[]>;
  viewMode: "board" | "gallery" | "list";
}

export interface AppState {
  drawer: DrawerState;
  chat: ChatState;
  route: RouteContext;
  commandPaletteOpen: boolean;
}

export interface StripeEventRecord {
  id: string;
  createdAt: string;
}
