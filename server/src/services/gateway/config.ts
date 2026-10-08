import { logger } from '../../utils/logger.js';
import path from 'path';
import { GatewayConfig, ProviderDefinition } from './types.js';
import { secretStore } from './secretStore.js';

export function loadGatewayConfig(): GatewayConfig {
  const weakHardwareDefaults = process.env.WEAK_HARDWARE === 'true';

  // Define the legacy env-based providers
  const providers: ProviderDefinition[] = [];

  // Canonical OmniRoute provider (Phase 2)
  const omnirouteBaseUrl = process.env.OMNIROUTE_BASE_URL || process.env.OMNIROOT_BASE_URL || 'http://127.0.0.1:20128/v1';
  let omnirouteApiKey = process.env.OMNIROUTE_API_KEY || process.env.OMNIROOT_API_KEY;
  if (!omnirouteApiKey) {
    try {
      omnirouteApiKey = secretStore.getSync('omniroute') || undefined;
    } catch {}
  }
  providers.push({
    name: 'omniroute',
    baseUrl: omnirouteBaseUrl,
    apiKey: omnirouteApiKey,
    model: process.env.OMNIROUTE_MODEL || 'auto/chat',
    type: 'openai',
    capabilities: ['supportsTools', 'supportsStreaming', 'supportsLongContext', 'supportsReasoning'],
    tags: ['omniroute', 'cloud', 'proxy'],
    maxContext: 128000,
    costPer1kPrompt: 0,
    costPer1kCompletion: 0
  });

  // Codex App-Server Bridge provider (Phase 2B - authenticated ChatGPT Plus on-machine)
  const codexBaseUrl = process.env.CODEX_BASE_URL || 'http://127.0.0.1:20130/v1';
  providers.push({
    name: 'codex',
    baseUrl: codexBaseUrl,
    apiKey: 'codex-local-auth',
    model: process.env.CODEX_MODEL || 'gpt-6-astra',
    type: 'openai',
    capabilities: ['supportsTools', 'supportsStreaming', 'supportsCoding', 'supportsReasoning'],
    tags: ['coding', 'cloud', 'fast', 'chatgpt-plus'],
    maxContext: 128000,
    costPer1kPrompt: 0,
    costPer1kCompletion: 0
  });

  if (process.env.OMNIROOT_BASE_URL) {
    providers.push({
      name: 'omniroot',
      baseUrl: process.env.OMNIROOT_BASE_URL,
      apiKey: process.env.OMNIROOT_API_KEY,
      model: process.env.OMNIROOT_MODEL || 'poolside/laguna-s-2.1:free',
      type: 'openai',
      capabilities: ['supportsTools', 'supportsStreaming', 'supportsLongContext'],
      tags: ['coding', 'cloud', 'long-context'],
      maxContext: 128000,
      costPer1kPrompt: 0.001,
      costPer1kCompletion: 0.002
    });
  }

  if (process.env.NINEROUTER_BASE_URL) {
    providers.push({
      name: 'ninerouter',
      baseUrl: process.env.NINEROUTER_BASE_URL,
      apiKey: process.env.NINEROUTER_API_KEY,
      model: process.env.NINEROUTER_MODEL || 'claude-3-haiku-20240307',
      type: 'openai',
      capabilities: ['supportsTools', 'supportsStreaming', 'supportsVision'],
      tags: ['fast', 'cloud', 'vision'],
      maxContext: 200000,
      costPer1kPrompt: 0.00025,
      costPer1kCompletion: 0.00125
    });
  }

  // OpenRouter is OpenAI-compatible: reuse the existing OpenAI gateway adapter.
  let openrouterApiKey = process.env.OPENROUTER_API_KEY;
  if (!openrouterApiKey) {
    try {
      openrouterApiKey = secretStore.getSync('openrouter') || undefined;
    } catch {}
  }
  if (process.env.OPENROUTER_BASE_URL || openrouterApiKey) {
    providers.push({
      name: 'openrouter',
      baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
      apiKey: openrouterApiKey,
      model: process.env.JARVIS_PRIMARY_MODEL || process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct',
      type: 'openai',
      capabilities: ['supportsTools', 'supportsStreaming', 'supportsLongContext', 'supportsReasoning', 'supportsJSON'],
      tags: ['cloud', 'fast', 'llama3'],
      maxContext: 128000
    });
  }

  // DeepSeek V4: first-class provider gateway (Phase B). The API key always
  // comes from DEEPSEEK_API_KEY (secure credential store) — never hardcoded.
  if (process.env.DEEPSEEK_API_KEY) {
    providers.push({
      name: 'DeepSeek',
      baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
      apiKey: process.env.DEEPSEEK_API_KEY,
      model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
      type: 'deepseek',
      capabilities: ['supportsTools', 'supportsStreaming', 'supportsLongContext', 'supportsReasoning', 'supportsJSON'],
      tags: ['cloud', 'coding', 'long-context', 'reasoning'],
      maxContext: 128000
    });
  }

  providers.push({
    name: 'ollama',
    baseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
    // Keep Jarvis on the installed, latency-safe local model. The old 7B
    // default disagreed with both the live assignment and the fast lane,
    // forcing Ollama to swap models before every response.
    model: process.env.OLLAMA_MODEL || process.env.OLLAMA_FALLBACK_MODEL || 'qwen3.5:9b-hermes-64k',
    type: 'ollama',
    capabilities: ['supportsStreaming'],
    tags: ['local', 'cheap'],
    maxContext: 65536,
    costPer1kPrompt: 0,
    costPer1kCompletion: 0
  });

  // Allow custom provider definitions via JSON
  if (process.env.GATEWAY_PROVIDERS_JSON) {
    try {
      const custom = JSON.parse(process.env.GATEWAY_PROVIDERS_JSON);
      if (Array.isArray(custom)) {
        custom.forEach(c => {
          if (!providers.find(p => p.name === c.name)) providers.push(c);
        });
      }
    } catch (err) {
      logger.warn('Failed to parse GATEWAY_PROVIDERS_JSON');
    }
  }

  // Load priorities (Cloud First policy, Ollama as local emergency fallback)
  const envOrder = process.env.GATEWAY_PROVIDER_ORDER;
  let providerOrder = ['codex', 'omniroute', 'openrouter', 'omniroot', 'ninerouter', 'DeepSeek', 'ollama'];
  if (envOrder) {
    providerOrder = envOrder.split(',').map(s => s.trim());
  }

  const workspaceRoot = process.env.WORKSPACE_ROOT || path.join(process.cwd(), '.agentic');
  const logsPath = process.env.GATEWAY_LOGS_PATH || path.join(workspaceRoot, 'gateway-runs.jsonl');

  return {
    providers,
    providerOrder,
    timeoutMs: parseInt(process.env.GATEWAY_TIMEOUT_PRIMARY || '120000', 10),
    workspaceRoot,
    logsPath,

    // Phase 2 New Configuration
    streamBufferTokens: parseInt(process.env.GATEWAY_STREAM_BUFFER_TOKENS || '0', 10),
    streamBufferMilliseconds: parseInt(process.env.GATEWAY_STREAM_BUFFER_MS || '2000', 10),
    streamRecoveryPolicy: (process.env.GATEWAY_STREAM_RECOVERY_POLICY as any) || 'buffer',
    providerScoring: process.env.GATEWAY_PROVIDER_SCORING !== 'false',
    capabilityRouting: process.env.GATEWAY_CAPABILITY_ROUTING !== 'false',
    costTracking: process.env.GATEWAY_COST_TRACKING !== 'false',
    metricsRetentionDays: parseInt(process.env.GATEWAY_METRICS_RETENTION_DAYS || '30', 10),
    loggingFlushIntervalMs: parseInt(process.env.GATEWAY_LOGGING_FLUSH_INTERVAL_MS || '5000', 10),
    healthCacheTTLMs: parseInt(process.env.GATEWAY_HEALTH_CACHE_TTL_MS || '60000', 10),
    circuitBreakerCooldownMs: parseInt(process.env.GATEWAY_CIRCUIT_BREAKER_COOLDOWN_MS || '300000', 10),
    providerWeights: {}, // Can be extended from env later

    // Phase 2 Benchmark
    startupBenchmark: process.env.PROVIDER_STARTUP_BENCHMARK !== 'false',
    benchmarkTimeoutMs: parseInt(process.env.PROVIDER_BENCHMARK_TIMEOUT_MS || '3000', 10),
    benchmarkCacheTTLMs: parseInt(process.env.PROVIDER_BENCHMARK_CACHE_TTL_MS || '300000', 10),
    benchmarkCachePath: path.join(workspaceRoot, 'gateway-benchmark-cache.json')
  };
}
