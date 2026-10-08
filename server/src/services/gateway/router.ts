import { ModelGateway, ChatRequest, ChatResponse, GatewayConfig, ChatStreamChunk, ProviderAttemptError, RoutingState } from './types.js';
import { recordInference, normalizeAgentRoleId } from './agentModelPolicy.js';
import { ProviderRateLimitError } from './gateways/openai.js';
import { ProviderScorer } from './scorer.js';
import { GatewayRunLedger } from './ledger.js';
import { ProviderRegistry } from './registry.js';
import fs from 'fs';
import path from 'path';
import { GatewayConfigurationService } from './configuration.js';
import { logger } from '../../utils/logger.js';
import { getActiveLanguage, withAnswerLanguage } from '../language/activeLanguageState.js';

export class GatewayRouter {
  private static instance: GatewayRouter;
  private config: GatewayConfig;
  private registry: ProviderRegistry;
  private eventListeners: Array<(event: any) => void> = [];
  
  // Circuit breaker state
  private healthCache: Map<string, { reachable: boolean, timestamp: number }> = new Map();
  private consecutiveFailures: Map<string, number> = new Map();
  private readonly FAILURE_THRESHOLD = 3;
  private scorer: ProviderScorer;
  private ledger: GatewayRunLedger;

  private constructor(config: GatewayConfig, ledger: GatewayRunLedger) {
    this.config = config;
    this.ledger = ledger;
    this.scorer = new ProviderScorer(ledger);
    this.registry = new ProviderRegistry(config);
  }

  public static getInstance(config: GatewayConfig, ledger?: GatewayRunLedger): GatewayRouter {
    if (!GatewayRouter.instance) {
      if (!ledger) ledger = new GatewayRunLedger(config.logsPath);
      GatewayRouter.instance = new GatewayRouter(config, ledger);
    }
    return GatewayRouter.instance;
  }

  public onEvent(listener: (event: any) => void) {
    this.eventListeners.push(listener);
  }

  private emit(event: any) {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (err) {
        logger.error('Error in GatewayRouter event listener', err);
      }
    }
  }

  // Benchmark state
  private benchmarkCache: Record<string, { timestamp: number, status: string }> = {};

  public async benchmarkProviders(): Promise<void> {
    if (!this.config.startupBenchmark) return;
    
    // We run the benchmark asynchronously so it doesn't block startup
    setImmediate(async () => {
      // Load cache
      if (fs.existsSync(this.config.benchmarkCachePath)) {
        try {
          const data = await fs.promises.readFile(this.config.benchmarkCachePath, 'utf8');
          this.benchmarkCache = JSON.parse(data);
        } catch {}
      }

      const available = this.registry.getAvailableProviders();
      let cacheUpdated = false;

      const promises = available.map(async (provider) => {
        const cached = this.benchmarkCache[provider.name];
        if (cached && (Date.now() - cached.timestamp < this.config.benchmarkCacheTTLMs)) {
          this.ledger.record({
            taskId: 'startup-benchmark',
            provider: provider.name,
            fallbackAttempts: 0,
            latencyMs: 0,
            model: provider.definition.model,
            status: 'success', // Cached success
            responseMetadata: { note: 'cached' }
          });
          return;
        }

        const start = Date.now();
        const health = await this.healthcheck(provider.name);
        
        let latencyMs = 0;
        let success = false;
        let note = 'measured';

        if (health.reachable) {
          try {
            // Extremely lightweight benchmark request, strictly enforce timeout
            const req: ChatRequest = { prompt: 'Hi', maxTokens: 1, timeoutMs: this.config.benchmarkTimeoutMs };
            await provider.chat(req);
            latencyMs = Date.now() - start;
            success = true;
          } catch (err: any) {
            latencyMs = Date.now() - start;
            if (err.message?.includes('timeout') || err.message?.includes('aborted')) {
              note = 'timed out';
            } else {
              note = 'unavailable';
            }
          }
        } else {
          latencyMs = Date.now() - start;
          note = 'unavailable';
        }
        
        this.benchmarkCache[provider.name] = { timestamp: Date.now(), status: success ? 'success' : 'failure' };
        cacheUpdated = true;
        
        // Record to ledger to seed scores
        this.ledger.record({
          taskId: 'startup-benchmark',
          provider: provider.name,
          fallbackAttempts: 0,
          latencyMs,
          model: provider.definition.model,
          status: success ? 'success' : 'failure',
          responseMetadata: { note }
        });
      });

      await Promise.allSettled(promises);

      // Save cache atomically
      if (cacheUpdated) {
        try {
          const tmpPath = `${this.config.benchmarkCachePath}.tmp`;
          await fs.promises.writeFile(tmpPath, JSON.stringify(this.benchmarkCache, null, 2), 'utf8');
          await fs.promises.rename(tmpPath, this.config.benchmarkCachePath);
        } catch (err) {
          logger.warn('Failed to save benchmark cache', { error: String(err) });
        }
      }
    });
  }

  public async resolveProviderOrder(req: ChatRequest, overrides?: { provider?: string }) {
    const { AgentProviderAssignmentService, mapCatalogToGatewayId } = await import('../agent/assignments.js');
    const available = this.registry.getAvailableProviders();
    let order = available;

    let targetProvider = overrides?.provider || req.preferredProvider || req.routing?.providerId;
    let routingMode = req.routing?.mode || 'automatic';
    // An explicit provider override (CLI arg, conversation-level routing
    // override, preferredProvider) takes precedence over the saved agent
    // assignment — a manual "use LongCat for this turn" must not be silently
    // re-routed to the assigned provider.
    const hasExplicitOverride = Boolean(overrides?.provider || req.preferredProvider || req.routing?.providerId);

    const { resolveCandidateRoutes, resolveCandidateRoutesForArgus, normalizeAgentRoleId } = await import('./agentModelPolicy.js');
    const role = req.agentId ? normalizeAgentRoleId(req.agentId) : undefined;

    if (role && !hasExplicitOverride) {
      // For Argus with a known producer model, use producer-aware independence routing.
      const candidates = (role === 'argus' && req.producerModel)
        ? resolveCandidateRoutesForArgus(req.producerModel)
        : resolveCandidateRoutes(role);
      if (candidates.length > 0) {
        const primaryCandidate = candidates[0];
        targetProvider = primaryCandidate.provider;
        routingMode = 'preferred';
        if (!req.modelId) {
          req.modelId = primaryCandidate.model;
        }
        if (!req.routing) {
          req.routing = { mode: 'preferred', providerId: targetProvider, modelId: primaryCandidate.model };
        }

        const orderedProviders: ModelGateway[] = [];
        for (const cand of candidates) {
          const match = available.find(p => p.name.toLowerCase() === cand.provider.toLowerCase());
          if (match && !orderedProviders.includes(match)) {
            orderedProviders.push(match);
          }
        }
        for (const p of available) {
          if (!orderedProviders.includes(p)) {
            orderedProviders.push(p);
          }
        }
        return orderedProviders;
      }
    } else if (req.agentId && !hasExplicitOverride) {
      const assignment = await AgentProviderAssignmentService.getAssignment(req.agentId);
      if (assignment && assignment.enabled) {
        targetProvider = mapCatalogToGatewayId(assignment.providerId);
        routingMode = assignment.routingMode;
        // Inject the model override if the assignment specifies one
        if (assignment.modelId) {
          req.modelId = assignment.modelId;
          if (!req.routing) {
            req.routing = { mode: routingMode, providerId: targetProvider };
          }
        }
      }
    }

    if (targetProvider) {
      targetProvider = mapCatalogToGatewayId(targetProvider);
    }

    if (routingMode === 'forced') {
      if (!targetProvider) throw new Error('Forced routing requires a target provider');
      const provider = available.find(p => p.name.toLowerCase() === targetProvider!.toLowerCase());
      if (!provider) throw new Error(`Forced provider ${targetProvider} is not available`);
      // Validate capability
      if (req.requiredCapabilities) {
        for (const cap of req.requiredCapabilities) {
          if (cap === 'vision' && !provider.supportsVision?.()) throw new Error(`Forced provider ${targetProvider} lacks required capability: ${cap}`);
          if (cap === 'reasoning' && !provider.supportsReasoning?.()) throw new Error(`Forced provider ${targetProvider} lacks required capability: ${cap}`);
          if (cap === 'long_context' && !provider.supportsLongContext?.()) throw new Error(`Forced provider ${targetProvider} lacks required capability: ${cap}`);
        }
      }
      return [provider];
    }

    // 'preferred' mode must keep the full fallback list; only reorder the target first.
    // Passing preferredProvider to the scorer would collapse the order to a single provider.
    const scorerPreferred = routingMode === 'preferred' ? undefined : targetProvider;
    order = this.scorer.rankProviders(available, { ...req, preferredProvider: scorerPreferred }, this.config.providerOrder);

    if (routingMode === 'preferred' && targetProvider) {
      const preferred = order.find(p => p.name.toLowerCase() === targetProvider!.toLowerCase());
      if (preferred) {
        order = [preferred, ...order.filter(p => p.name.toLowerCase() !== targetProvider!.toLowerCase())];
      }
    }

    return order;
  }

  public async chat(req: ChatRequest, overrides?: { provider?: string }): Promise<ChatResponse> {
    if (!req.agentId || req.agentId.toLowerCase().includes('jarvis')) {
      req.systemPrompt = withAnswerLanguage(req.systemPrompt, getActiveLanguage());
    }
    const liveConfig = await GatewayConfigurationService.getConfiguration();
    let order = await this.resolveProviderOrder(req, overrides);

    // Parse-failure escalation: exclude providers that already produced
    // unparseable structured output for this request, so the fallback chain
    // moves to the next compatible provider instead of retrying the failed one.
    const excluded = (req.excludeProviders || []).map((p) => p.toLowerCase());
    if (excluded.length) {
      const before = order.length;
      order = order.filter((p) => !excluded.includes(p.name.toLowerCase()));
      if (order.length === 0) {
        throw new Error(`All providers excluded from fallback chain: ${excluded.join(', ')}`);
      }
      this.emit({ type: 'gateway.selected', provider: order[0].name, requestId: req.requestId });
    }

    const attemptedProviders: string[] = [];
    const attemptErrors: ProviderAttemptError[] = [];
    const reasons: string[] = [];
    let fallbackCount = 0;
    const startTime = Date.now();

    for (const provider of order) {
      const providerName = provider.name;
      attemptedProviders.push(providerName);
      
      this.emit({
        type: 'gateway.selected',
        provider: providerName,
        requestId: req.requestId
      });

      // Circuit breaker check
      const failures = this.consecutiveFailures.get(providerName) || 0;
      if (failures >= liveConfig.circuitFailureThreshold) {
        const health = await this.healthcheck(providerName);
        if (!health.reachable) {
          reasons.push(`${providerName}: Circuit breaker open`);
          fallbackCount++;
          continue;
        }
        this.consecutiveFailures.set(providerName, 0);
      }

      console.log(JSON.stringify({
        provider: providerName,
        model: provider.definition.model,
        requestAgentId: req.agentId,
        routingMode: req.routing?.mode,
        baseUrl: provider.definition.baseUrl,
        circuitState: failures
      }));

      const attemptStart = Date.now();
      try {
        const response = await provider.chat(req);
        // Empty-response handling (Jarvis repair): a provider that returns an
        // empty/whitespace-only assistant reply is a provider fault, not a
        // successful conversational result. Throw so the existing fallback
        // loop below attempts the next provider and the request never returns
        // a blank answer that the caller would render as "Jarvis returned an
        // empty response".
        if (!response || typeof response.reply !== 'string' || response.reply.trim().length === 0) {
          const emptyErr = new Error(`Provider returned empty response (${providerName}/${provider.definition.model})`);
          (emptyErr as any).emptyResponse = true;
          throw emptyErr;
        }
        this.consecutiveFailures.set(providerName, 0); // reset
        
        this.emit({
          type: 'gateway.completed',
          provider: providerName,
          requestId: req.requestId,
          latencyMs: Date.now() - attemptStart,
          fallbackCount,
          promptTokens: response.promptTokens,
          completionTokens: response.completionTokens
        });

        const totalDuration = Date.now() - startTime;
        const isLocalProvider = providerName.toLowerCase() === 'ollama';

        let routingState: RoutingState = 'NORMAL';
        let fallbackUsed = fallbackCount > 0;
        let fallbackReason: string | undefined;

        if (isLocalProvider) {
          routingState = 'DEGRADED';
          fallbackUsed = true;
          fallbackReason = reasons.length > 0 ? reasons.join('; ') : 'Degraded to local Ollama fallback';
        } else if (fallbackCount > 0) {
          routingState = 'FALLBACK';
          fallbackReason = reasons.join('; ');
        }

        const agentRole = req.agentId ? normalizeAgentRoleId(req.agentId) : undefined;
        const requestedModel = req.routing?.modelId ?? req.modelId ?? provider.definition.model;
        const requestedRoute = `${providerName}:${requestedModel}`;

        response.agentId = agentRole;
        response.taskClass = req.taskClass;
        response.requestedRoute = requestedRoute;
        response.requestedModel = requestedModel;
        response.resolvedProvider = response.resolvedProvider || providerName;
        response.resolvedModel = response.resolvedModel || response.model || provider.definition.model;
        response.routingState = routingState;
        response.fallbackUsed = fallbackUsed;
        response.fallbackReason = fallbackReason;
        response.totalLatencyMs = totalDuration;

        // Truthful model identity: for the 'codex' provider the upstream WebSocket
        // protocol does not expose an authoritative resolvedModel field.
        if (providerName.toLowerCase() === 'codex') {
          response.resolvedModelIdentityExposed = false;
          response.resolvedModelSource = 'config'; // model is taken from config.toml, not confirmed by protocol
        } else {
          response.resolvedModelIdentityExposed = true;
          response.resolvedModelSource = 'protocol';
        }

        // Producer-aware Argus independence metadata + runtime rejection
        if (agentRole === 'argus' && req.producerModel) {
          const { validateVerifierIndependenceProducerAware, extractModelFamily } = await import('./agentModelPolicy.js');
          const actualResolvedModel = response.resolvedModel || '';
          const producerFamily = extractModelFamily(req.producerModel);
          const verifierActualFamily = extractModelFamily(actualResolvedModel);

          // RUNTIME REJECTION: if auto/* resolved to same family as producer, reject this result
          // and fall through to next provider candidate.
          if (
            producerFamily !== 'unknown' &&
            verifierActualFamily !== 'unknown' &&
            verifierActualFamily !== 'auto' &&
            producerFamily === verifierActualFamily
          ) {
            logger.warn('[GatewayRouter] Argus runtime independence REJECTED (chat): same-family verifier', {
              providerName,
              actualResolvedModel,
              producerModel: req.producerModel,
              producerFamily,
              verifierActualFamily
            });
            reasons.push(`${providerName}: Argus independence rejected — verifier resolved to ${actualResolvedModel} (family: ${verifierActualFamily}) same as producer ${req.producerModel} (family: ${producerFamily})`);
            fallbackCount++;
            continue;
          }

          const independenceResult = validateVerifierIndependenceProducerAware(req.producerModel, actualResolvedModel);
          response.argusIndependence = {
            producerFamily: independenceResult.producerFamily,
            verifierFamily: 'verifierFamily' in independenceResult ? independenceResult.verifierFamily : '',
            independent: independenceResult.independent,
            unavailable: 'unavailable' in independenceResult ? independenceResult.unavailable : undefined
          };
        }

        if (agentRole) {
          recordInference({
            timestamp: new Date().toISOString(),
            agentId: agentRole,
            taskClass: req.taskClass,
            requestedRoute,
            requestedModel,
            resolvedProvider: response.resolvedProvider,
            resolvedModel: response.resolvedModel,
            routingState,
            fallbackUsed,
            fallbackReason,
            totalLatencyMs: totalDuration,
            promptTokens: response.promptTokens,
            completionTokens: response.completionTokens,
            totalTokens: response.totalTokens,
            success: true
          });
        }

        return response;
      } catch (error: any) {
        const durationMs = Date.now() - attemptStart;
        const msg = (error.message || '').toLowerCase();
        
        let isProviderFault = true;
        if (msg.includes('http 400') || msg.includes('http 401') || msg.includes('http 403') || msg.includes('http 413') || msg.includes('http 422')) {
          isProviderFault = false;
        }

        let category: ProviderAttemptError['category'] = 'unknown';
        if (msg.includes('timeout')) category = 'timeout';
        else if (msg.includes('model-not-found')) category = 'model-not-found';
        else if (msg.includes('unreachable') || msg.includes('econnrefused')) category = 'unreachable';
        else if (msg.includes('transport') || msg.includes('econnreset') || msg.includes('enotfound') || msg.includes('etimedout') || msg.includes('dns')) category = 'transport';
        else if (msg.includes('malformed')) category = 'malformed-response';
        else if (!isProviderFault) category = 'http-error';
        
        attemptErrors.push({
          provider: providerName,
          model: provider.definition.model,
          stage: 'request',
          category,
          message: error.message,
          durationMs
        });

        if (isProviderFault) {
          const currentFailures = this.consecutiveFailures.get(providerName) || 0;
          this.consecutiveFailures.set(providerName, currentFailures + 1);
        }
        
        fallbackCount++;
        
        this.emit({
          type: 'gateway.failed',
          provider: providerName,
          requestId: req.requestId,
          error: error.message,
          latencyMs: Date.now() - attemptStart,
          isProviderFault
        });
        
        this.ledger.record({
          taskId: 'gateway-request',
          provider: providerName,
          fallbackAttempts: fallbackCount,
          latencyMs: Date.now() - attemptStart,
          model: provider.definition.model,
          status: 'failure',
          isProviderFault,
          responseMetadata: { error: error.message }
        });

        this.emit({
          type: 'gateway.fallback',
          from: providerName,
          requestId: req.requestId
        });
        // No yield here, chat is not a generator
      }
    }

    const totalLatency = Date.now() - startTime;
    throw new Error(JSON.stringify({
      message: `All configured providers failed`,
      attemptedProviders,
      attemptErrors,
      latencyMs: totalLatency
    }));
  }

  public async *stream(req: ChatRequest, overrides?: { provider?: string }): AsyncGenerator<ChatStreamChunk> {
    if (!req.agentId || req.agentId.toLowerCase().includes('jarvis')) {
      req.systemPrompt = withAnswerLanguage(req.systemPrompt, getActiveLanguage());
    }
    const liveConfig = await GatewayConfigurationService.getConfiguration();
    const order = await this.resolveProviderOrder(req, overrides);

    const attemptedProviders: string[] = [];
    const attemptErrors: ProviderAttemptError[] = [];
    const reasons: string[] = [];
    let fallbackCount = 0;
    const startTime = Date.now();

    for (const provider of order) {
      if (!provider.stream) continue;
      const providerName = provider.name;
      attemptedProviders.push(providerName);
      
      this.emit({ type: 'gateway.selected', provider: providerName, requestId: req.requestId });
      yield { type: 'gateway.selected', provider: providerName, requestId: req.requestId };

      const failureLimit = req.maxRetries ?? this.FAILURE_THRESHOLD;
      const failures = this.consecutiveFailures.get(providerName) || 0;
      if (failures >= failureLimit) {
        const health = await this.healthcheck(providerName);
        if (!health.reachable) {
          reasons.push(`${providerName}: Circuit breaker open`);
          fallbackCount++;
          continue;
        }
        this.consecutiveFailures.set(providerName, 0);
      }

      const attemptStart = Date.now();
      let streamBufferedTokens = 0;
      let streamFailed = false;
      let lastResolvedModel = provider.definition.model;
      let lastResolvedProvider = providerName;
      let ttftMs: number | undefined;

      try {
        for await (const chunk of provider.stream(req)) {
          if (chunk.resolvedModel) lastResolvedModel = chunk.resolvedModel;
          if (chunk.resolvedProvider) lastResolvedProvider = chunk.resolvedProvider;
          if (chunk.type === 'token' && chunk.content) {
            if (ttftMs === undefined) {
              ttftMs = Date.now() - attemptStart;
            }
            streamBufferedTokens++;
            yield chunk;
          } else {
            yield chunk;
          }
        }
        
        if (streamBufferedTokens === 0) throw new Error('Provider returned empty stream');

        // Argus runtime independence check:
        // The 'auto/*' routing aliases have UNKNOWN actual model family until execution.
        // After streaming completes, check the ACTUAL resolvedModel against the producer family.
        // If same family → this provider is NOT independent → reject and try next candidate.
        const agentRoleForCheck = req.agentId ? normalizeAgentRoleId(req.agentId) : undefined;
        if (agentRoleForCheck === 'argus' && req.producerModel && lastResolvedModel) {
          const { extractModelFamily } = await import('./agentModelPolicy.js');
          const producerFamily = extractModelFamily(req.producerModel);
          const verifierActualFamily = extractModelFamily(lastResolvedModel);
          // Only reject if neither family is 'unknown' or 'auto' (ambiguous aliases don't block)
          if (
            producerFamily !== 'unknown' &&
            verifierActualFamily !== 'unknown' &&
            verifierActualFamily !== 'auto' &&
            producerFamily === verifierActualFamily
          ) {
            logger.warn('[GatewayRouter] Argus runtime independence REJECTED: same-family provider', {
              providerName,
              requestedModel: req.modelId ?? provider.definition.model,
              actualResolvedModel: lastResolvedModel,
              producerModel: req.producerModel,
              producerFamily,
              verifierActualFamily
            });
            reasons.push(`${providerName}: Argus independence rejected — verifier resolved to ${lastResolvedModel} (family: ${verifierActualFamily}) which is same family as producer ${req.producerModel} (family: ${producerFamily})`);
            fallbackCount++;
            // Continue to next provider — do NOT yield the already-streamed tokens as the accepted response.
            // NOTE: tokens were already yielded to the client above. We emit a diagnostic chunk to
            // inform the consumer that this result was rejected, then continue the fallback loop.
            yield {
              type: 'gateway.argus_independence_rejected',
              provider: providerName,
              resolvedModel: lastResolvedModel,
              producerModel: req.producerModel,
              producerFamily,
              verifierActualFamily,
              requestId: req.requestId
            };
            continue;
          }
        }

        this.consecutiveFailures.set(providerName, 0);


        const totalDuration = Date.now() - startTime;
        const isLocalProvider = providerName.toLowerCase() === 'ollama';

        let routingState: RoutingState = 'NORMAL';
        let fallbackUsed = fallbackCount > 0;
        let fallbackReason: string | undefined;

        if (isLocalProvider) {
          routingState = 'DEGRADED';
          fallbackUsed = true;
          fallbackReason = reasons.length > 0 ? reasons.join('; ') : 'Degraded to local Ollama fallback';
        } else if (fallbackCount > 0) {
          routingState = 'FALLBACK';
          fallbackReason = reasons.join('; ');
        }

        const agentRole = req.agentId ? normalizeAgentRoleId(req.agentId) : undefined;
        const requestedModel = req.routing?.modelId ?? req.modelId ?? provider.definition.model;
        const requestedRoute = `${providerName}:${requestedModel}`;

        if (agentRole) {
          recordInference({
            timestamp: new Date().toISOString(),
            agentId: agentRole,
            taskClass: req.taskClass,
            requestedRoute,
            requestedModel,
            resolvedProvider: lastResolvedProvider,
            resolvedModel: lastResolvedModel,
            routingState,
            fallbackUsed,
            fallbackReason,
            totalLatencyMs: totalDuration,
            ttftMs,
            completionTokens: streamBufferedTokens,
            totalTokens: streamBufferedTokens,
            success: true
          });
        }

        this.emit({
          type: 'gateway.completed',
          provider: providerName,
          requestId: req.requestId,
          latencyMs: Date.now() - attemptStart,
          fallbackCount,
          completionTokens: streamBufferedTokens // Approximation for streaming
        });
        yield { 
          type: 'gateway.completed', 
          provider: providerName, 
          requestId: req.requestId, 
          durationMs: Date.now() - startTime,
          latencyMs: Date.now() - attemptStart,
          totalTokens: streamBufferedTokens,
          agentId: agentRole,
          resolvedModel: lastResolvedModel,
          resolvedProvider: lastResolvedProvider,
          routingState,
          fallbackUsed,
          fallbackReason
        };

        return;
      } catch (error: any) {
        streamFailed = true;
        const durationMs = Date.now() - attemptStart;
        const msg = (error.message || '').toLowerCase();

        // Structured HTTP 429 from the gateway: emit and yield exactly one
        // rate-limit diagnostic, then continue normal fallback routing below.
        // The diagnostic chunk is an event, never a token.
        if (error instanceof ProviderRateLimitError) {
          const rateLimitEvent: ChatStreamChunk = {
            type: 'gateway.rate_limited',
            stage: 'provider_rate_limited',
            provider: providerName,
            status: error.status,
            retryAfter: error.retryAfter,
            requestId: req.requestId
          };
          this.emit(rateLimitEvent);
          yield rateLimitEvent;
        }

        let isProviderFault = true;
        if (msg.includes('http 400') || msg.includes('http 401') || msg.includes('http 403') || msg.includes('http 413') || msg.includes('http 422')) {
          isProviderFault = false;
        }

        let category: ProviderAttemptError['category'] = 'unknown';
        if (msg.includes('timeout')) category = 'timeout';
        else if (msg.includes('model-not-found')) category = 'model-not-found';
        else if (msg.includes('unreachable') || msg.includes('econnrefused')) category = 'unreachable';
        else if (msg.includes('transport') || msg.includes('econnreset') || msg.includes('enotfound') || msg.includes('etimedout') || msg.includes('dns')) category = 'transport';
        else if (msg.includes('malformed')) category = 'malformed-response';
        else if (!isProviderFault) category = 'http-error';
        
        attemptErrors.push({
          provider: providerName,
          model: provider.definition.model,
          stage: 'stream',
          category,
          message: error.message,
          durationMs
        });

        if (isProviderFault) {
          const currentFailures = this.consecutiveFailures.get(providerName) || 0;
          this.consecutiveFailures.set(providerName, currentFailures + 1);
        }
        
        this.emit({ type: 'gateway.failed', provider: providerName, requestId: req.requestId, error: error.message, latencyMs: Date.now() - attemptStart, isProviderFault });

        this.ledger.record({
          taskId: 'gateway-stream',
          provider: providerName,
          fallbackAttempts: fallbackCount,
          latencyMs: Date.now() - attemptStart,
          model: provider.definition.model,
          status: 'failure',
          isProviderFault,
          responseMetadata: { error: error.message }
        });

        // Phase 2: Option A Failover Strategy.
        // The client-visible signal is streamBufferedTokens, NOT elapsed time:
        // a provider that failed before emitting ANY token (hung first token,
        // HTTP 429/5xx, connection reset, empty stream) is always safe to
        // transparently fall back to the next provider — the client has seen
        // nothing. The previous ms-threshold gate treated every failure after
        // degradedLatencyMs as "client already saw tokens", which refused
        // fallback for zero-token stalls (observed live: 20s silence, no
        // reply, no fallback). Once any token has been buffered/delivered,
        // fallback would produce a second answer — never do that.
        if (streamBufferedTokens === 0) {
          // Zero tokens emitted — transparent fallback allowed
          fallbackCount++;
          this.emit({ type: 'gateway.fallback', from: providerName, requestId: req.requestId });
          yield { type: 'gateway.fallback', provider: providerName, requestId: req.requestId, error: error.message };
          continue; // Try next provider
        } else {
          // Tokens WERE emitted — the client saw partial content. Never restart
          // from another provider (no double answers); abort the turn.
          this.emit({ type: 'gateway.stream_aborted', provider: providerName, requestId: req.requestId, reason: 'Mid-stream disconnect' });
          yield { type: 'streaming_interruption', provider: providerName, requestId: req.requestId };
          yield { type: 'error', provider: providerName, error: `[Stream aborted mid-way: ${error.message}]`, aborted: true };
          return; // Terminate entirely
        }
      }
    }

    const totalLatency = Date.now() - startTime;
    throw new Error(JSON.stringify({ message: `All configured providers failed during streaming`, attemptedProviders, attemptErrors, reasons, latencyMs: totalLatency }));
  }



  public async healthcheck(providerName: string): Promise<{ reachable: boolean; error?: string }> {
    const provider = this.registry.getProvider(providerName);
    if (!provider) return { reachable: false, error: 'Unknown provider' };
    
    const cached = this.healthCache.get(providerName);
    if (cached && (Date.now() - cached.timestamp < this.config.healthCacheTTLMs)) {
      return { reachable: cached.reachable };
    }
    
    const result = await provider.healthcheck();
    this.healthCache.set(providerName, { reachable: result.reachable, timestamp: Date.now() });
    
    this.emit({ type: 'gateway.healthcheck', provider: providerName, status: result.reachable ? 'up' : 'down', error: result.error });
    return result;
  }
}
