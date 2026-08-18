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

export interface AgentProviderDefault {
  id: string;
  name: string;
  category: string;
  status: string;
  defaultModel?: string;
  models?: ProviderModel[];
  hasKey?: boolean;
  authScheme?: string;
}

export interface AgentModelDefaults {
  agentId: string;
  agentName: string;
  providerIds: string[];
  providers: AgentProviderDefault[];
}

export interface HealthCheckResult {
  providerId: string;
  providerName: string;
  reachable: boolean;
  latencyMs: number;
  status: string;
  errorMessage?: string;
  hasKey: boolean;
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
  mode: "chat" | "task" | "workflow";
  status: "running" | "queued" | "waiting" | "failed" | "completed" | "archived" | "intake" | "researching" | "drafting" | "awaiting_review" | "approved" | "exported";
  input: string;
  output?: string;
  logs: string[];
  events: string[];
  linkedArtifacts: string[];
  durationMs?: number;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
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

export interface Artifact {
  id: string;
  type: string;
  title: string;
  preview: string;
  content?: string;
  sourceRunId?: string;
  linkedBoardId?: string;
  linkedAgentId?: string;
  version: string;
  status: "draft" | "active" | "review" | "done" | "archived";
  createdAt?: string;
  updatedAt?: string;
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

export interface ServiceLead {
  id: string;
  customerName: string;
  customerEmail: string;
  company: string;
  requestType: string;
  budget: string;
  goal: string;
  status: "new" | "scoring" | "qualified" | "rejected" | "offered" | "paid" | "in_progress" | "delivered";
  createdAt: string;
  updatedAt: string;
  proposalArtifactId?: string;
  briefId?: string;
}

/* ─── UI State Types ─── */

export type DrawerEntityType = "agent" | "run" | "memory" | "provider" | "build" | "artifact" | "jarvis" | "brief" | "lead" | "hermes" | null;

export interface DrawerState {
  isOpen: boolean;
  entityType: DrawerEntityType;
  entityId: string | null;
  isPinned: boolean;
}

export interface GatewayUiEvent {
  type: string;
  timestamp: string;
  provider?: string;
  model?: string;
  durationMs?: number;
  reason?: string;
  target?: string;
  operationId?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "agent" | "system";
  agentId?: string;
  content: string;
  timestamp: string;
  gateway?: {
    provider?: string;
    model?: string;
    taskProfile?: string;
    status?: 'routing' | 'streaming' | 'completed' | 'fallback' | 'interrupted' | 'failed';
    fallbackFrom?: string;
    fallbackCount?: number;
    streamInterrupted?: boolean;
    latencyMs?: number;
    durationMs?: number;
    promptTokens?: number | null;
    completionTokens?: number | null;
    totalTokens?: number | null;
    estimatedCost?: number | null;
    tokensPerSecond?: number | null;
    events?: GatewayUiEvent[];
  };
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

export interface JarvisTranscriptEntry {
  id: string;
  role: "user" | "jarvis";
  text: string;
  timestamp: string;
}

export interface JarvisVoiceState {
  status: "idle" | "listening" | "transcribing" | "thinking" | "speaking" | "ducked" | "error";
  transcript: JarvisTranscriptEntry[];
}
