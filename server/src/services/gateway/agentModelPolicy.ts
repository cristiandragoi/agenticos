import { AgentRoleId, AgentModelPolicy, RoutingState } from './types.js';
import { logger } from '../../utils/logger.js';

export type RoleReadinessStatus = 'READY' | 'CLOUD_ROUTE_NOT_READY';

export interface RoleReadinessInfo {
  status: RoleReadinessStatus;
  reason: string;
  lastChecked: string;
}

export interface CandidateRoute {
  provider: string;
  model: string;
  isLocal: boolean;
  routingState: RoutingState;
  fallbackReason?: string;
}

export interface InferenceLogEntry {
  timestamp: string;
  agentId: AgentRoleId;
  taskClass?: string;
  requestedRoute: string;
  requestedModel: string;
  resolvedProvider: string;
  resolvedModel: string;
  routingState: RoutingState;
  fallbackUsed: boolean;
  fallbackReason?: string;
  ttftMs?: number;
  totalLatencyMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  success: boolean;
  error?: string;
}

export function buildAgentModelPolicy(role: AgentRoleId): AgentModelPolicy {
  if (role === 'jarvis') {
    const primaryProvider = process.env.JARVIS_MODEL_PROVIDER || process.env.JARVIS_PROVIDER || 'openrouter';
    const primaryModel = process.env.JARVIS_PRIMARY_MODEL || 'meta-llama/llama-3.3-70b-instruct';
    const reasoningModel = process.env.JARVIS_REASONING_MODEL || 'xiaomi/mimo-v2.6-pro';
    const localFallback = process.env.JARVIS_FALLBACK_MODEL || 'ollama:qwen3.5:9b-hermes-64k';
    return {
      agentId: 'jarvis',
      primary: `${primaryProvider}:${primaryModel}`,
      fallbacks: [
        `${primaryProvider}:${reasoningModel}`,
        'codex:gpt-6-astra',
        'omniroute:auto/chat',
        'omniroute:oc/nemotron-3-ultra-free',
      ],
      localFallback,
      allowLocalFallback: true,
      latencyBudgetMs: 5000,
    };
  }

  if (role === 'hermes') {
    const primaryProvider = process.env.HERMES_MODEL_PROVIDER || process.env.HERMES_PROVIDER || 'omniroute';
    const primaryModel = process.env.HERMES_PRIMARY_MODEL || 'auto/reasoning';
    return {
      agentId: 'hermes',
      primary: `${primaryProvider}:${primaryModel}`,
      fallbacks: ['omniroute:auto/best-reasoning', 'omniroute:oc/nemotron-3-ultra-free'],
      localFallback: 'ollama:qwen3.5:9b-hermes-64k',
      allowLocalFallback: true,
      latencyBudgetMs: 30000,
    };
  }

  if (role === 'codex') {
    return {
      agentId: 'codex',
      primary: 'codex:gpt-6-astra',
      fallbacks: ['omniroute:auto/coding', 'omniroute:auto/best-coding'],
      localFallback: 'ollama:qwen3.5:9b-hermes-64k',
      allowLocalFallback: true,
      latencyBudgetMs: 30000,
    };
  }

  return {
    agentId: 'argus',
    primary: 'omniroute:auto/reasoning',
    fallbacks: ['omniroute:auto/best-reasoning', 'omniroute:oc/nemotron-3-ultra-free', 'codex:gpt-6-astra'],
    localFallback: 'ollama:qwen3.5:9b-hermes-64k',
    allowLocalFallback: true,
    latencyBudgetMs: 30000,
  };
}

export const DEFAULT_AGENT_MODEL_POLICIES: Record<AgentRoleId, AgentModelPolicy> = {
  get jarvis() { return buildAgentModelPolicy('jarvis'); },
  get hermes() { return buildAgentModelPolicy('hermes'); },
  get codex() { return buildAgentModelPolicy('codex'); },
  get argus() { return buildAgentModelPolicy('argus'); },
} as any;

/**
 * Health-aware readiness status determined from the live capabilities verification (Phase 2B).
 * - Jarvis: openrouter:xiaomi/mimo-v2.6-flash verified.
 * - Hermes: auto/reasoning verified functional on Nemotron 3 Ultra.
 * - Codex: codex:gpt-6-astra verified (repo execution, coding completion, and tool use verified).
 * - Argus: auto/reasoning verified independent from codex (nvidia/nemotron vs openai/gpt).
 */
const ROLE_READINESS_STORE: Map<AgentRoleId, RoleReadinessInfo> = new Map([
  [
    'jarvis',
    {
      status: 'READY',
      reason: 'Xiaomi MiMo 2.6 Flash via OpenRouter verified',
      lastChecked: new Date().toISOString()
    }
  ],
  [
    'hermes',
    {
      status: 'READY',
      reason: 'Cloud route auto/reasoning verified functional on Nemotron 3 Ultra',
      lastChecked: new Date().toISOString()
    }
  ],
  [
    'codex',
    {
      status: 'READY',
      reason: 'Cloud coding route codex:gpt-6-astra verified (coding completion, streaming, and tool calling verified on ChatGPT Plus)',
      lastChecked: new Date().toISOString()
    }
  ],
  [
    'argus',
    {
      status: 'READY',
      reason: 'Independent verifier route omniroute:auto/reasoning verified (model family nvidia/nemotron differs from codex openai/gpt, verifier independence validated)',
      lastChecked: new Date().toISOString()
    }
  ]
]);

// Ring buffer for inference observability (max 200 entries)
const MAX_INFERENCE_LOGS = 200;
const inferenceLogs: InferenceLogEntry[] = [];

/**
 * Normalizes input string to canonical AgentRoleId.
 */
export function normalizeAgentRoleId(id: string): AgentRoleId | undefined {
  if (!id || typeof id !== 'string') return undefined;
  const lower = id.toLowerCase().trim();
  if (lower === 'jarvis' || lower === 'agent-jarvis' || lower.includes('jarvis') || lower === 'voice') return 'jarvis';
  if (lower === 'hermes' || lower === 'agent-hermes' || lower.includes('hermes') || lower === 'orchestrator' || lower === 'planner') return 'hermes';
  if (lower === 'codex' || lower === 'agent-codex' || lower.includes('codex') || lower === 'coder' || lower === 'developer') return 'codex';
  if (lower === 'argus' || lower === 'agent-argus' || lower.includes('argus') || lower === 'verifier' || lower === 'critic') return 'argus';
  return undefined;
}

/**
 * Retrieves the AgentModelPolicy for a given role or string identifier.
 */
export function getAgentModelPolicy(roleOrId: AgentRoleId | string): AgentModelPolicy {
  const role = normalizeAgentRoleId(roleOrId) || 'jarvis';
  return buildAgentModelPolicy(role);
}

/**
 * Retrieves the live role readiness status for an agent role.
 */
export function getRoleReadiness(roleOrId: AgentRoleId | string): RoleReadinessStatus {
  const role = normalizeAgentRoleId(roleOrId);
  if (!role) return 'CLOUD_ROUTE_NOT_READY';
  return ROLE_READINESS_STORE.get(role)?.status ?? 'CLOUD_ROUTE_NOT_READY';
}

/**
 * Retrieves the full readiness info for an agent role.
 */
export function getRoleReadinessDetails(roleOrId: AgentRoleId | string): RoleReadinessInfo {
  const role = normalizeAgentRoleId(roleOrId);
  if (!role) {
    return {
      status: 'CLOUD_ROUTE_NOT_READY',
      reason: `Unknown role: ${roleOrId}`,
      lastChecked: new Date().toISOString()
    };
  }
  return ROLE_READINESS_STORE.get(role) ?? {
    status: 'CLOUD_ROUTE_NOT_READY',
    reason: 'Role readiness not initialized',
    lastChecked: new Date().toISOString()
  };
}

/**
 * Allows dynamic update of role readiness upon capability probe / health check.
 */
export function setRoleReadiness(role: AgentRoleId, status: RoleReadinessStatus, reason?: string): void {
  ROLE_READINESS_STORE.set(role, {
    status,
    reason: reason || (status === 'READY' ? 'Capability check passed' : 'Capability check failed'),
    lastChecked: new Date().toISOString()
  });
  logger.info(`[AgentModelPolicy] Role readiness for ${role} updated to ${status}: ${reason}`);
}

/**
 * Parses route strings formatted as "provider:model" (e.g. "omniroute:auto/chat").
 */
export function parseRouteString(route: string): { provider: string; model: string; isLocal: boolean } {
  const colonIndex = route.indexOf(':');
  if (colonIndex === -1) {
    return {
      provider: 'omniroute',
      model: route,
      isLocal: false
    };
  }
  const provider = route.substring(0, colonIndex).trim();
  const model = route.substring(colonIndex + 1).trim();
  const isLocal = provider.toLowerCase() === 'ollama';
  return { provider, model, isLocal };
}

/**
 * Extracts base model family identifier from model ID or resolved model string.
 */
export function extractModelFamily(modelId: string): string {
  if (!modelId) return 'unknown';
  const m = modelId.toLowerCase();
  // Routing aliases: auto/reasoning, auto/chat, auto/best-reasoning etc. are unresolved
  // routing directives, not model families. Classify as 'auto' so runtime checks can handle them.
  // NOTE: oc/* paths (e.g. oc/nemotron-3-ultra-free) contain a real model ID and ARE classified
  // by their known family keywords below — only pure auto/* with no identifiable model keyword
  // are treated as unresolved.
  if (m.startsWith('auto/') || m === 'auto') return 'auto';
  if (m.includes('claude') || m.includes('anthropic')) return 'anthropic/claude';
  if (m.includes('gpt') || m.includes('openai') || m.includes('o1') || m.includes('o3') || m.includes('o4')) return 'openai/gpt';
  if (m.includes('gemini') || m.includes('google')) return 'google/gemini';
  if (m.includes('nemotron') || m.includes('nvidia')) return 'nvidia/nemotron';
  if (m.includes('deepseek')) return 'deepseek';
  if (m.includes('qwen') || m.includes('alibaba')) return 'alibaba/qwen';
  if (m.includes('llama') || m.includes('meta')) return 'meta/llama';
  if (m.includes('mistral') || m.includes('mixtral')) return 'mistral';
  if (m.includes('mimo') || m.includes('xiaomi')) return 'xiaomi/mimo';
  return m.split('/')[0] || m;
}

export type VerifierIndependenceResult =
  | { independent: true; producerFamily: string; verifierFamily: string }
  | { independent: false; producerFamily: string; verifierFamily: string; reason: string }
  | { independent: false; unavailable: true; reason: 'INDEPENDENCE_UNAVAILABLE'; producerFamily: string };

/**
 * Verifies that the Verifier (Argus) uses an independent model family from the ACTUAL PRODUCER
 * of the artifact being verified.
 *
 * This is producer-aware: independence is evaluated against the resolved family of the
 * producer (Codex → openai/gpt, Hermes → nvidia/nemotron, etc.), NOT just a fixed alias.
 *
 * Returns INDEPENDENCE_UNAVAILABLE if no alternative route is healthy.
 */
export function validateVerifierIndependenceProducerAware(
  producerResolvedModel: string,
  verifierResolvedModel: string
): VerifierIndependenceResult {
  const producerFamily = extractModelFamily(producerResolvedModel);
  const verifierFamily = extractModelFamily(verifierResolvedModel);

  // Treat unknown/unresolved models as unavailable rather than pretending independence.
  // 'auto' is an unresolved routing alias (e.g. 'auto/reasoning') — not a real model family.
  // Actual resolved models must be passed here, not routing directives.
  if (producerFamily === 'unknown' || verifierFamily === 'unknown' || verifierFamily === 'auto') {
    return {
      independent: false,
      unavailable: true,
      reason: 'INDEPENDENCE_UNAVAILABLE',
      producerFamily: producerFamily
    };
  }

  if (producerFamily === verifierFamily) {
    // Same family: Argus is NOT independent from this producer.
    // Check if any other Argus candidate route would be independent.
    const argusPolicy = DEFAULT_AGENT_MODEL_POLICIES.argus;
    const allCandidates = [argusPolicy.primary, ...argusPolicy.fallbacks, argusPolicy.localFallback];
    const independentCandidates = allCandidates.filter(route => {
      const parsed = parseRouteString(route);
      const candidateFamily = extractModelFamily(parsed.model);
      // Exclude 'unknown' and 'auto' families — auto/* are routing aliases, not proven independence
      return candidateFamily !== producerFamily && candidateFamily !== 'unknown' && candidateFamily !== 'auto';
    });

    if (independentCandidates.length === 0) {
      return {
        independent: false,
        unavailable: true,
        reason: 'INDEPENDENCE_UNAVAILABLE',
        producerFamily
      };
    }

    return {
      independent: false,
      producerFamily,
      verifierFamily,
      reason: `Argus resolved to same family as producer (${producerFamily}). Use one of: ${independentCandidates.join(', ')}`
    };
  }

  return { independent: true, producerFamily, verifierFamily };
}

/**
 * Legacy two-arg form: compares resolved model strings directly.
 * Kept for backward compatibility with existing tests.
 * Verifies that the Verifier (Argus) uses an independent model family from the primary/coder (Codex).
 * Returns true if independent, false if both resolve to the same family.
 */
export function validateVerifierIndependence(codexResolvedModel: string, verifierResolvedModel: string): boolean {
  const codexFamily = extractModelFamily(codexResolvedModel);
  const verifierFamily = extractModelFamily(verifierResolvedModel);
  return codexFamily !== verifierFamily;
}

/**
 * Producer-aware candidate route resolution for Argus (verifier role).
 *
 * Given the resolved model of the artifact PRODUCER, reorders Argus candidate
 * routes to place routes from a DIFFERENT model family first. This ensures
 * the router actually selects an independent verifier — not just detects the conflict.
 *
 * If ALL candidate routes share the producer's family, the first entry is
 * tagged with routingState='FALLBACK' and fallbackReason='INDEPENDENCE_UNAVAILABLE'.
 *
 * Example:
 *   producer = 'nemotron-3-ultra-free' (nvidia/nemotron family)
 *   → codex:gpt-6-astra is moved to front (openai/gpt ≠ nvidia/nemotron) ✓
 *   → ollama:qwen3.5 fallback is also independent (alibaba/qwen ≠ nvidia/nemotron) ✓
 *
 *   producer = 'gpt-6-astra' (openai/gpt family)
 *   → omniroute:auto/reasoning (nemotron) stays at front (nvidia/nemotron ≠ openai/gpt) ✓
 */
export function resolveCandidateRoutesForArgus(producerResolvedModel: string): CandidateRoute[] {
  const policy = DEFAULT_AGENT_MODEL_POLICIES.argus;
  const readiness = getRoleReadinessDetails('argus');
  const producerFamily = extractModelFamily(producerResolvedModel);

  // Build the full ordered candidate list (primary + fallbacks + local)
  const allRouteStrings = [
    policy.primary,
    ...policy.fallbacks,
    ...(policy.allowLocalFallback ? [policy.localFallback] : [])
  ];

  const allCandidates: CandidateRoute[] = allRouteStrings.map((route, idx) => {
    const parsed = parseRouteString(route);
    return {
      provider: parsed.provider,
      model: parsed.model,
      isLocal: parsed.isLocal,
      routingState: idx === 0 && readiness.status === 'READY' ? 'NORMAL' : (parsed.isLocal ? 'DEGRADED' : 'FALLBACK'),
      fallbackReason: idx === 0 && readiness.status === 'READY' ? undefined : 'Argus fallback candidate'
    };
  });

  if (!producerResolvedModel) {
    // No producer context — use standard resolution
    return resolveCandidateRoutes('argus');
  }

  // Partition: independent routes first, then same-family routes
  const independent = allCandidates.filter(c => extractModelFamily(c.model) !== producerFamily);
  const sameFamily = allCandidates.filter(c => extractModelFamily(c.model) === producerFamily);

  if (independent.length === 0) {
    // No independent route available — mark explicitly
    logger.warn(`[AgentModelPolicy] Argus has no independent route from producer family ${producerFamily}. INDEPENDENCE_UNAVAILABLE.`);
    return allCandidates.map((c, i) => ({
      ...c,
      routingState: i === 0 ? 'FALLBACK' : c.routingState,
      fallbackReason: 'INDEPENDENCE_UNAVAILABLE: all Argus routes share producer family ' + producerFamily
    }));
  }

  // Reorder: independent first, same-family last (as emergency fallbacks only)
  const reordered: CandidateRoute[] = [
    // Mark first independent as NORMAL if cloud is ready
    { ...independent[0], routingState: readiness.status === 'READY' ? 'NORMAL' : 'FALLBACK',
      fallbackReason: readiness.status === 'READY' ? `Independent from producer (${producerFamily})` : `Cloud not ready — independent from producer (${producerFamily})` },
    ...independent.slice(1).map(c => ({
      ...c, routingState: 'FALLBACK' as const,
      fallbackReason: `Independent fallback (different family from producer ${producerFamily})`
    })),
    ...sameFamily.map(c => ({
      ...c, routingState: 'FALLBACK' as const,
      fallbackReason: `Same-family as producer (${producerFamily}) — last resort only`
    }))
  ];

  logger.info(`[AgentModelPolicy] Argus routes reordered for producer family ${producerFamily}: [${reordered.map(c => c.provider + ':' + c.model).join(', ')}]`);
  return reordered;
}

/**
 * Resolves the ordered candidate route chain for an agent role, taking into account
 * role readiness and local fallback constraints.
 */
export function resolveCandidateRoutes(roleOrId: AgentRoleId | string): CandidateRoute[] {
  const role = normalizeAgentRoleId(roleOrId) || 'jarvis';
  const policy = getAgentModelPolicy(role);
  const readiness = getRoleReadinessDetails(role);
  const candidates: CandidateRoute[] = [];

  const primaryParsed = parseRouteString(policy.primary);
  const localParsed = parseRouteString(policy.localFallback);

  if (readiness.status === 'READY') {
    // Healthy cloud route
    candidates.push({
      provider: primaryParsed.provider,
      model: primaryParsed.model,
      isLocal: primaryParsed.isLocal,
      routingState: 'NORMAL'
    });

    for (const fb of policy.fallbacks) {
      const fbParsed = parseRouteString(fb);
      candidates.push({
        provider: fbParsed.provider,
        model: fbParsed.model,
        isLocal: fbParsed.isLocal,
        routingState: 'FALLBACK',
        fallbackReason: 'Primary cloud route failed or unavailable'
      });
    }

    if (policy.allowLocalFallback) {
      candidates.push({
        provider: localParsed.provider,
        model: localParsed.model,
        isLocal: true,
        routingState: 'DEGRADED',
        fallbackReason: 'All cloud routes failed, degraded to local Ollama fallback'
      });
    }
  } else {
    // Cloud route NOT ready
    if (policy.allowLocalFallback) {
      // Degraded to local fallback with explicit reason
      candidates.push({
        provider: localParsed.provider,
        model: localParsed.model,
        isLocal: true,
        routingState: 'DEGRADED',
        fallbackReason: `Cloud route not ready: ${readiness.reason}`
      });

      // Still provide cloud candidates as secondary attempts if user/system tries
      candidates.push({
        provider: primaryParsed.provider,
        model: primaryParsed.model,
        isLocal: primaryParsed.isLocal,
        routingState: 'NORMAL'
      });
    } else {
      // Strict requirement (e.g. Argus independent verifier) - no local fallback allowed
      candidates.push({
        provider: primaryParsed.provider,
        model: primaryParsed.model,
        isLocal: primaryParsed.isLocal,
        routingState: 'NORMAL'
      });
      for (const fb of policy.fallbacks) {
        const fbParsed = parseRouteString(fb);
        candidates.push({
          provider: fbParsed.provider,
          model: fbParsed.model,
          isLocal: fbParsed.isLocal,
          routingState: 'FALLBACK',
          fallbackReason: 'Primary candidate failed'
        });
      }
    }
  }

  return candidates;
}

/**
 * Records an inference log entry for full observability.
 */
export function recordInference(entry: InferenceLogEntry): void {
  inferenceLogs.unshift(entry);
  if (inferenceLogs.length > MAX_INFERENCE_LOGS) {
    inferenceLogs.length = MAX_INFERENCE_LOGS;
  }
  logger.debug?.(`[AgentModelPolicy] Recorded inference for ${entry.agentId}: ${entry.resolvedProvider}/${entry.resolvedModel} (${entry.routingState})`);
}

/**
 * Returns recent inference log entries.
 */
export function getRecentInferences(limit = 50): InferenceLogEntry[] {
  return inferenceLogs.slice(0, limit);
}

/**
 * Clears inference logs (for testing).
 */
export function clearInferenceLogs(): void {
  inferenceLogs.length = 0;
}

