/**
 * modelRouter.ts — Capability- and Cost-Aware Multi-Provider Model Router
 *
 * Implements:
 * - Central registry of models & capabilities
 * - Routing roles: FAST, PLANNER, WORKER, CODER, REVIEWER
 * - Cost policy integration (ZERO, LOW_COST, UNRESTRICTED)
 * - Safe fallback chains: Local Ollama -> Free/Low-Cost Cloud -> Truthful failure
 * - Hermes remains the planner/orchestrator; worker models provide reasoning within AgenticOS bounds.
 */

import { costPolicy, type CostClass } from './costPolicy.js';
import { secretStore } from './secretStore.js';
import { logger } from '../../utils/logger.js';

export type RoutingRole = 'FAST' | 'PLANNER' | 'WORKER' | 'CODER' | 'REVIEWER';

export interface ModelDescriptor {
  provider: string;
  modelId: string;
  contextWindow: number;
  costClass: CostClass;
  toolCalling: boolean;
  structuredOutput: boolean;
  streaming: boolean;
  vision: boolean;
  coding: boolean;
  reasoning: boolean;
  enabled: boolean;
  priority: number; // lower number = higher priority
  roles: RoutingRole[];
}

export class ModelRouter {
  private static instance: ModelRouter;
  private registry: Map<string, ModelDescriptor> = new Map();

  private constructor() {
    this.initRegistry();
  }

  public static getInstance(): ModelRouter {
    if (!ModelRouter.instance) {
      ModelRouter.instance = new ModelRouter();
    }
    return ModelRouter.instance;
  }

  private initRegistry() {
    const models: ModelDescriptor[] = [
      // ── Local Ollama Models (LOCAL_FREE) ───────────────────────────
      {
        provider: 'ollama',
        modelId: process.env.OLLAMA_MODEL || 'qwen3.5:9b-hermes-64k',
        contextWindow: 65536,
        costClass: 'LOCAL_FREE',
        toolCalling: true,
        structuredOutput: true,
        streaming: true,
        vision: false,
        coding: true,
        reasoning: true,
        enabled: true,
        priority: 10,
        roles: ['FAST', 'PLANNER', 'WORKER', 'CODER', 'REVIEWER'],
      },
      {
        provider: 'ollama',
        modelId: 'llama3.2:3b',
        contextWindow: 131072,
        costClass: 'LOCAL_FREE',
        toolCalling: false,
        structuredOutput: true,
        streaming: true,
        vision: false,
        coding: false,
        reasoning: false,
        enabled: true,
        priority: 15,
        roles: ['FAST'],
      },
      {
        provider: 'ollama',
        modelId: 'deepseek-coder-v2:16b',
        contextWindow: 65536,
        costClass: 'LOCAL_FREE',
        toolCalling: true,
        structuredOutput: true,
        streaming: true,
        vision: false,
        coding: true,
        reasoning: true,
        enabled: true,
        priority: 12,
        roles: ['CODER', 'WORKER'],
      },

      // ── OmniRoute Free / Quota Models ──────────────────────────────
      {
        provider: 'omniroute',
        modelId: 'oc/nemotron-3-ultra-free',
        contextWindow: 128000,
        costClass: 'CLOUD_FREE_QUOTA',
        toolCalling: true,
        structuredOutput: true,
        streaming: true,
        vision: false,
        coding: true,
        reasoning: true,
        enabled: true,
        priority: 20,
        roles: ['PLANNER', 'WORKER', 'REVIEWER'],
      },
      {
        provider: 'omniroute',
        modelId: 'auto/chat',
        contextWindow: 128000,
        costClass: 'CLOUD_FREE_QUOTA',
        toolCalling: true,
        structuredOutput: true,
        streaming: true,
        vision: false,
        coding: true,
        reasoning: true,
        enabled: true,
        priority: 25,
        roles: ['FAST', 'WORKER'],
      },

      // ── OpenRouter Models (MiMo & Free Quota) ─────────────────────
      {
        provider: 'openrouter',
        modelId: 'xiaomi/mimo-v2.6-flash',
        contextWindow: 128000,
        costClass: 'CLOUD_FREE_QUOTA',
        toolCalling: true,
        structuredOutput: true,
        streaming: true,
        vision: false,
        coding: true,
        reasoning: true,
        enabled: true,
        priority: 15,
        roles: ['FAST', 'PLANNER', 'WORKER', 'CODER', 'REVIEWER'],
      },
      {
        provider: 'openrouter',
        modelId: 'xiaomi/mimo-v2.6-pro',
        contextWindow: 128000,
        costClass: 'CLOUD_FREE_QUOTA',
        toolCalling: true,
        structuredOutput: true,
        streaming: true,
        vision: false,
        coding: true,
        reasoning: true,
        enabled: true,
        priority: 18,
        roles: ['PLANNER', 'WORKER', 'CODER', 'REVIEWER'],
      },
      {
        provider: 'openrouter',
        modelId: 'meta-llama/llama-3.3-70b-instruct:free',
        contextWindow: 131072,
        costClass: 'CLOUD_FREE_QUOTA',
        toolCalling: true,
        structuredOutput: true,
        streaming: true,
        vision: false,
        coding: true,
        reasoning: true,
        enabled: true,
        priority: 30,
        roles: ['PLANNER', 'WORKER', 'REVIEWER'],
      },
      {
        provider: 'openrouter',
        modelId: 'deepseek/deepseek-r1:free',
        contextWindow: 64000,
        costClass: 'CLOUD_FREE_QUOTA',
        toolCalling: false,
        structuredOutput: true,
        streaming: true,
        vision: false,
        coding: true,
        reasoning: true,
        enabled: true,
        priority: 35,
        roles: ['REVIEWER', 'PLANNER'],
      },

      // ── Low-Cost Paid Providers (LOW_COST_PAID) ────────────────────
      {
        provider: 'qwen',
        modelId: 'qwen3.8-flash',
        contextWindow: 131072,
        costClass: 'LOW_COST_PAID',
        toolCalling: true,
        structuredOutput: true,
        streaming: true,
        vision: false,
        coding: true,
        reasoning: true,
        enabled: true,
        priority: 32,
        roles: ['FAST', 'PLANNER', 'WORKER', 'CODER', 'REVIEWER'],
      },
      {
        provider: 'qwen',
        modelId: 'qwen-plus',
        contextWindow: 131072,
        costClass: 'LOW_COST_PAID',
        toolCalling: true,
        structuredOutput: true,
        streaming: true,
        vision: false,
        coding: true,
        reasoning: true,
        enabled: true,
        priority: 34,
        roles: ['PLANNER', 'WORKER', 'CODER', 'REVIEWER'],
      },
      {
        provider: 'DeepSeek',
        modelId: 'deepseek-v4-flash',
        contextWindow: 128000,
        costClass: 'LOW_COST_PAID',
        toolCalling: true,
        structuredOutput: true,
        streaming: true,
        vision: false,
        coding: true,
        reasoning: true,
        enabled: true,
        priority: 40,
        roles: ['FAST', 'WORKER', 'CODER'],
      },
      {
        provider: 'DeepSeek',
        modelId: 'deepseek-chat',
        contextWindow: 128000,
        costClass: 'LOW_COST_PAID',
        toolCalling: true,
        structuredOutput: true,
        streaming: true,
        vision: false,
        coding: true,
        reasoning: true,
        enabled: true,
        priority: 42,
        roles: ['WORKER', 'CODER', 'REVIEWER'],
      },

      // ── Subscribed / On-Machine Bridge (CLOUD_PROMOTIONAL_CREDIT / PAID) ─
      {
        provider: 'codex',
        modelId: 'gpt-6-astra',
        contextWindow: 128000,
        costClass: 'CLOUD_PROMOTIONAL_CREDIT',
        toolCalling: true,
        structuredOutput: true,
        streaming: true,
        vision: false,
        coding: true,
        reasoning: true,
        enabled: true,
        priority: 50,
        roles: ['CODER', 'WORKER'],
      },
    ];

    for (const m of models) {
      this.registry.set(`${m.provider}:${m.modelId}`, m);
    }
  }

  public getRegistry(): ModelDescriptor[] {
    return Array.from(this.registry.values());
  }

  /**
   * Resolve a model candidate for the given role, honoring active cost policy.
   */
  public selectModel(role: RoutingRole, requiredCapabilities?: {
    toolCalling?: boolean;
    coding?: boolean;
    reasoning?: boolean;
    vision?: boolean;
  }): { selected: ModelDescriptor | null; candidates: ModelDescriptor[]; reason?: string } {
    const all = Array.from(this.registry.values()).filter(m => m.enabled && m.roles.includes(role));

    // Filter by capabilities
    const capable = all.filter(m => {
      if (requiredCapabilities?.toolCalling && !m.toolCalling) return false;
      if (requiredCapabilities?.coding && !m.coding) return false;
      if (requiredCapabilities?.reasoning && !m.reasoning) return false;
      if (requiredCapabilities?.vision && !m.vision) return false;
      return true;
    });

    // Filter by Cost Policy
    const allowed = capable.filter(m => {
      const check = costPolicy.isAllowed(m.costClass);
      return check.allowed;
    });

    if (allowed.length === 0) {
      const mode = costPolicy.getMode();
      return {
        selected: null,
        candidates: [],
        reason: `No eligible models available for role "${role}" under COST_MODE=${mode}. (Checked ${capable.length} capable models).`,
      };
    }

    // Sort by priority (lowest number first)
    allowed.sort((a, b) => a.priority - b.priority);

    return {
      selected: allowed[0],
      candidates: allowed,
    };
  }

  /**
   * Get an ordered fallback chain for a role.
   */
  public getFallbackChain(role: RoutingRole): ModelDescriptor[] {
    const all = Array.from(this.registry.values()).filter(m => m.enabled && m.roles.includes(role));
    const allowed = all.filter(m => costPolicy.isAllowed(m.costClass).allowed);
    return allowed.sort((a, b) => a.priority - b.priority);
  }
}

export const modelRouter = ModelRouter.getInstance();
