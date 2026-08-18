export interface ChatRequest {
  systemPrompt?: string;
  prompt: string;
  maxTokens?: number;
  timeoutMs?: number;
  maxRetries?: number;
  signal?: AbortSignal;
  requestId?: string;

  // Conversation context: prior turns, in order, EXCLUDING the current
  // prompt (the gateway appends the current prompt after history).
  history?: { role: 'user' | 'assistant'; content: string }[];
  
  // Phase 2: Task-Aware Routing
  taskProfile?: 'tiny_summary' | 'simple_formatting' | 'repo_analysis' | 'coding' | 'heavy_refactor' | 'vision_task' | 'heavy_reasoning' | 'massive_context';
  requiredCapabilities?: string[];
  preferredProvider?: string;
  modelId?: string;
  // P4 — planning escalation: a stronger sibling model on the same provider,
  // used by the provider adapter ONLY when the base model exhausts its output
  // budget without producing content (EMPTY_CONTENT_AFTER_REASONING).
  escalationModel?: string;
  
  // Workspace Context
  taskObjective?: string;
  projectPath?: string;
  projectSummary?: string;

  // Phase 4: Backend authoritative routing
  agentId?: string;
  routing?: {
    mode: 'automatic' | 'preferred' | 'forced';
    providerId?: string;
    modelId?: string;
  };
}

export interface ChatResponse {
  reply: string;
  provider: string;
  model: string;
  offline: boolean;
  error?: string;
  
  // Phase 2: Token & Cost Accounting
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  estimatedCost?: number;
}

export interface ChatStreamChunk {
  type: 'token' | 'done' | 'error' | 'gateway.selected' | 'gateway.fallback' | 'gateway.failed' | 'gateway.completed' | 'gateway.rate_limited' | 'streaming_interruption';
  content?: string;
  provider: string;
  model?: string;
  
  // Mid-stream error handling
  error?: string;
  aborted?: boolean;
  
  // Gateway events
  requestId?: string;
  target?: string;
  durationMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  latencyMs?: number;

  // Rate-limit diagnostics (provider HTTP 429)
  stage?: string;
  status?: number;
  retryAfter?: string;
}

export interface ProviderAttemptError {
  provider: string;
  model?: string;
  stage: 'selection' | 'healthcheck' | 'request' | 'timeout' | 'response' | 'parse' | 'normalization' | 'stream';
  category: 'unreachable' | 'timeout' | 'model-not-found' | 'http-error' | 'malformed-response' | 'capability-mismatch' | 'circuit-open' | 'unknown';
  message: string;
  statusCode?: number;
  durationMs?: number;
}

export interface ProviderDefinition {
  name: string;
  baseUrl: string;
  apiKey?: string;
  model: string;
  type: 'openai' | 'ollama' | 'deepseek';
  capabilities?: string[];
  tags?: string[];
  maxContext?: number;
  costPer1kPrompt?: number;
  costPer1kCompletion?: number;
}

export interface GatewayConfig {
  providers: ProviderDefinition[];
  providerOrder: string[];
  timeoutMs: number;
  workspaceRoot: string;
  logsPath: string;
  
  // Phase 2
  streamBufferTokens: number; // e.g. 100 tokens
  streamBufferMilliseconds: number; // e.g. 2000 ms
  streamRecoveryPolicy: 'buffer' | 'reset' | 'abort';
  providerScoring: boolean;
  capabilityRouting: boolean;
  costTracking: boolean;
  metricsRetentionDays: number;
  loggingFlushIntervalMs: number;
  healthCacheTTLMs: number;
  circuitBreakerCooldownMs: number;
  providerWeights: Record<string, number>;

  // Phase 2 Benchmark Configuration
  startupBenchmark: boolean;
  benchmarkTimeoutMs: number;
  benchmarkCacheTTLMs: number;
  benchmarkCachePath: string;
}

export interface ModelGateway {
  name: string;
  definition: ProviderDefinition;
  
  healthcheck(): Promise<{ reachable: boolean; error?: string }>;
  listModels?(): Promise<string[]>;
  chat(req: ChatRequest): Promise<ChatResponse>;
  stream?(req: ChatRequest): AsyncGenerator<ChatStreamChunk>;
  estimateCost?(req: ChatRequest): Promise<number>;
  
  // Capabilities
  supportsTools?(): boolean;
  supportsVision?(): boolean;
  supportsReasoning?(): boolean;
  supportsStreaming?(): boolean;
  supportsJSON?(): boolean;
  supportsFunctionCalling?(): boolean;
  supportsEmbeddings?(): boolean;
  supportsImages?(): boolean;
  supportsAudio?(): boolean;
  supportsLongContext?(): boolean;
  maxContext?(): number;
}
