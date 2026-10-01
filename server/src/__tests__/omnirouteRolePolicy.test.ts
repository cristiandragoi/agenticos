import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getAgentModelPolicy,
  getRoleReadiness,
  getRoleReadinessDetails,
  setRoleReadiness,
  resolveCandidateRoutes,
  validateVerifierIndependence,
  extractModelFamily,
  recordInference,
  getRecentInferences,
  clearInferenceLogs,
  normalizeAgentRoleId,
  parseRouteString,
  DEFAULT_AGENT_MODEL_POLICIES
} from '../services/gateway/agentModelPolicy.js';
import { mapCatalogToGatewayId, AgentProviderAssignmentService } from '../services/agent/assignments.js';
import { GatewayRouter } from '../services/gateway/router.js';
import { GatewayConfig, ModelGateway, ProviderDefinition } from '../services/gateway/types.js';

describe('OmniRoute Role-Based Model Routing (Phase 2)', () => {
  beforeEach(() => {
    clearInferenceLogs();
  });

  describe('Role Normalization & Policy Defaults', () => {
    it('normalizes role aliases correctly', () => {
      expect(normalizeAgentRoleId('jarvis')).toBe('jarvis');
      expect(normalizeAgentRoleId('agent-jarvis')).toBe('jarvis');
      expect(normalizeAgentRoleId('voice')).toBe('jarvis');

      expect(normalizeAgentRoleId('hermes')).toBe('hermes');
      expect(normalizeAgentRoleId('agent-hermes')).toBe('hermes');
      expect(normalizeAgentRoleId('planner')).toBe('hermes');

      expect(normalizeAgentRoleId('codex')).toBe('codex');
      expect(normalizeAgentRoleId('agent-codex')).toBe('codex');
      expect(normalizeAgentRoleId('coder')).toBe('codex');

      expect(normalizeAgentRoleId('argus')).toBe('argus');
      expect(normalizeAgentRoleId('agent-argus')).toBe('argus');
      expect(normalizeAgentRoleId('verifier')).toBe('argus');

      expect(normalizeAgentRoleId('unknown-role')).toBeUndefined();
    });

    it('returns authoritative policies for all 4 roles', () => {
      const jarvisPolicy = getAgentModelPolicy('jarvis');
      expect(jarvisPolicy.agentId).toBe('jarvis');
      expect(jarvisPolicy.primary).toBe('codex:gpt-6-astra');
      expect(jarvisPolicy.localFallback).toBe('ollama:qwen3.5:9b-hermes-64k');
      expect(jarvisPolicy.allowLocalFallback).toBe(true);
      expect(jarvisPolicy.latencyBudgetMs).toBe(5000);

      const hermesPolicy = getAgentModelPolicy('hermes');
      expect(hermesPolicy.agentId).toBe('hermes');
      expect(hermesPolicy.primary).toBe('omniroute:auto/reasoning');
      expect(hermesPolicy.localFallback).toBe('ollama:qwen3.5:9b-hermes-64k');
      expect(hermesPolicy.allowLocalFallback).toBe(true);

      const codexPolicy = getAgentModelPolicy('codex');
      expect(codexPolicy.agentId).toBe('codex');
      expect(codexPolicy.primary).toBe('codex:gpt-6-astra');
      expect(codexPolicy.localFallback).toBe('ollama:qwen3.5:9b-hermes-64k');
      expect(codexPolicy.allowLocalFallback).toBe(true);

      const argusPolicy = getAgentModelPolicy('argus');
      expect(argusPolicy.agentId).toBe('argus');
      expect(argusPolicy.primary).toBe('omniroute:auto/reasoning');
      expect(argusPolicy.allowLocalFallback).toBe(true);
    });

    it('parses route strings into provider and model', () => {
      const r1 = parseRouteString('omniroute:auto/chat');
      expect(r1).toEqual({ provider: 'omniroute', model: 'auto/chat', isLocal: false });

      const r2 = parseRouteString('ollama:qwen3.5:9b-hermes-64k');
      expect(r2).toEqual({ provider: 'ollama', model: 'qwen3.5:9b-hermes-64k', isLocal: true });

      const r3 = parseRouteString('auto/reasoning');
      expect(r3).toEqual({ provider: 'omniroute', model: 'auto/reasoning', isLocal: false });

      const r4 = parseRouteString('codex:gpt-6-astra');
      expect(r4).toEqual({ provider: 'codex', model: 'gpt-6-astra', isLocal: false });
    });
  });

  describe('Health-Aware Role Readiness Gating (Phase 2B)', () => {
    it('reports Hermes as READY (Nemotron-3-Ultra reasoning passed)', () => {
      expect(getRoleReadiness('hermes')).toBe('READY');
      const details = getRoleReadinessDetails('hermes');
      expect(details.status).toBe('READY');
      expect(details.reason).toContain('verified functional');
    });

    it('reports Jarvis as READY (codex:gpt-6-astra verified fast cloud route <4s TTFT)', () => {
      expect(getRoleReadiness('jarvis')).toBe('READY');
      const details = getRoleReadinessDetails('jarvis');
      expect(details.status).toBe('READY');
      expect(details.reason).toContain('gpt-6-astra');
    });

    it('reports Codex as READY (codex:gpt-6-astra coding and tool use verified)', () => {
      expect(getRoleReadiness('codex')).toBe('READY');
      const details = getRoleReadinessDetails('codex');
      expect(details.status).toBe('READY');
      expect(details.reason).toContain('gpt-6-astra');
    });

    it('reports Argus as READY (independent verifier model family verified)', () => {
      expect(getRoleReadiness('argus')).toBe('READY');
      const details = getRoleReadinessDetails('argus');
      expect(details.status).toBe('READY');
      expect(details.reason.toLowerCase()).toContain('independent');
    });

    it('allows dynamic status updates when capabilities change', () => {
      const original = getRoleReadiness('jarvis');
      try {
        setRoleReadiness('jarvis', 'CLOUD_ROUTE_NOT_READY', 'Degraded test');
        expect(getRoleReadiness('jarvis')).toBe('CLOUD_ROUTE_NOT_READY');
        expect(getRoleReadinessDetails('jarvis').reason).toBe('Degraded test');
      } finally {
        setRoleReadiness('jarvis', original, 'Restored test baseline');
      }
    });
  });

  describe('Candidate Route Resolution & Degraded State', () => {
    it('resolves Hermes candidates starting with primary NORMAL route', () => {
      const candidates = resolveCandidateRoutes('hermes');
      expect(candidates.length).toBeGreaterThanOrEqual(2);
      expect(candidates[0].provider).toBe('omniroute');
      expect(candidates[0].model).toBe('auto/reasoning');
      expect(candidates[0].routingState).toBe('NORMAL');

      // Last candidate is local fallback tagged DEGRADED
      const last = candidates[candidates.length - 1];
      expect(last.isLocal).toBe(true);
      expect(last.routingState).toBe('DEGRADED');
      expect(last.fallbackReason).toContain('degraded to local Ollama fallback');
    });

    it('resolves Jarvis candidates starting with primary NORMAL cloud route when READY', () => {
      const candidates = resolveCandidateRoutes('jarvis');
      expect(candidates[0].isLocal).toBe(false);
      expect(candidates[0].provider).toBe('codex');
      expect(candidates[0].model).toBe('gpt-6-astra');
      expect(candidates[0].routingState).toBe('NORMAL');
    });

    it('resolves Codex candidates starting with primary NORMAL cloud route when READY', () => {
      const candidates = resolveCandidateRoutes('codex');
      expect(candidates[0].isLocal).toBe(false);
      expect(candidates[0].provider).toBe('codex');
      expect(candidates[0].model).toBe('gpt-6-astra');
      expect(candidates[0].routingState).toBe('NORMAL');
    });

    it('resolves to DEGRADED local fallback when cloud route is not ready', () => {
      const original = getRoleReadiness('jarvis');
      try {
        setRoleReadiness('jarvis', 'CLOUD_ROUTE_NOT_READY', 'Cloud route offline');
        const candidates = resolveCandidateRoutes('jarvis');
        expect(candidates[0].isLocal).toBe(true);
        expect(candidates[0].provider).toBe('ollama');
        expect(candidates[0].routingState).toBe('DEGRADED');
      } finally {
        setRoleReadiness('jarvis', original, 'Restored');
      }
    });
  });

  describe('Argus Verifier Model Independence Validation', () => {
    it('extracts base model families truthfully', () => {
      expect(extractModelFamily('nvidia/nemotron-3-ultra-free')).toBe('nvidia/nemotron');
      expect(extractModelFamily('oc/nemotron-3-ultra-free')).toBe('nvidia/nemotron');
      expect(extractModelFamily('claude-3-5-sonnet-20241022')).toBe('anthropic/claude');
      expect(extractModelFamily('anthropic/claude-3-haiku')).toBe('anthropic/claude');
      expect(extractModelFamily('gpt-4o')).toBe('openai/gpt');
      expect(extractModelFamily('google/gemini-2.5-pro')).toBe('google/gemini');
      expect(extractModelFamily('deepseek-chat')).toBe('deepseek');
      expect(extractModelFamily('qwen3.5:9b-hermes-64k')).toBe('alibaba/qwen');
    });

    it('rejects verification when both Codex and Argus resolve to Nemotron', () => {
      const codexResolved = 'nvidia/nemotron-3-ultra-free';
      const argusResolved = 'nvidia/nemotron-3-ultra-free';

      const isIndependent = validateVerifierIndependence(codexResolved, argusResolved);
      expect(isIndependent).toBe(false);
    });

    it('accepts verification when Argus resolves to an independent family (Claude vs GPT)', () => {
      const codexResolved = 'gpt-4o';
      const argusResolved = 'claude-3-5-sonnet';

      const isIndependent = validateVerifierIndependence(codexResolved, argusResolved);
      expect(isIndependent).toBe(true);
    });

    it('accepts verification when Argus resolves to Claude vs Nemotron', () => {
      const codexResolved = 'nvidia/nemotron-3-ultra-free';
      const argusResolved = 'claude-3-5-sonnet';

      const isIndependent = validateVerifierIndependence(codexResolved, argusResolved);
      expect(isIndependent).toBe(true);
    });
  });

  describe('Inference Observability Recording', () => {
    it('records and retrieves inference entries with full metrics', () => {
      recordInference({
        timestamp: new Date().toISOString(),
        agentId: 'hermes',
        taskClass: 'planning',
        requestedRoute: 'omniroute:auto/reasoning',
        requestedModel: 'auto/reasoning',
        resolvedProvider: 'omniroute',
        resolvedModel: 'nvidia/nemotron-3-ultra-free',
        routingState: 'NORMAL',
        fallbackUsed: false,
        totalLatencyMs: 1420,
        ttftMs: 310,
        promptTokens: 120,
        completionTokens: 85,
        totalTokens: 205,
        success: true
      });

      const logs = getRecentInferences(10);
      expect(logs.length).toBe(1);
      expect(logs[0].agentId).toBe('hermes');
      expect(logs[0].requestedRoute).toBe('omniroute:auto/reasoning');
      expect(logs[0].resolvedModel).toBe('nvidia/nemotron-3-ultra-free');
      expect(logs[0].routingState).toBe('NORMAL');
      expect(logs[0].fallbackUsed).toBe(false);
      expect(logs[0].ttftMs).toBe(310);
    });

    it('records degraded inference when fallback is used', () => {
      recordInference({
        timestamp: new Date().toISOString(),
        agentId: 'jarvis',
        requestedRoute: 'omniroute:auto/chat',
        requestedModel: 'auto/chat',
        resolvedProvider: 'ollama',
        resolvedModel: 'qwen3.5:9b-hermes-64k',
        routingState: 'DEGRADED',
        fallbackUsed: true,
        fallbackReason: 'Cloud route latency budget exceeded',
        totalLatencyMs: 820,
        success: true
      });

      const logs = getRecentInferences(10);
      expect(logs.length).toBe(1);
      expect(logs[0].routingState).toBe('DEGRADED');
      expect(logs[0].fallbackUsed).toBe(true);
      expect(logs[0].fallbackReason).toBe('Cloud route latency budget exceeded');
    });
  });

  describe('Assignments & Catalog Mapping', () => {
    it('maps prov-omniroute and prov-omni to canonical omniroute', () => {
      expect(mapCatalogToGatewayId('prov-omniroute')).toBe('omniroute');
      expect(mapCatalogToGatewayId('prov-omni')).toBe('omniroute');
      expect(mapCatalogToGatewayId('prov-ollama')).toBe('ollama');
    });

    it('returns omniroute defaults for agents in AgentProviderAssignmentService', async () => {
      const hermes = await AgentProviderAssignmentService.getAssignment('agent-hermes');
      expect(hermes?.providerId).toBe('prov-omniroute');
      expect(hermes?.modelId).toBe('auto/reasoning');

      const codex = await AgentProviderAssignmentService.getAssignment('agent-codex');
      expect(codex?.providerId).toBe('prov-omniroute');
      expect(codex?.modelId).toBe('auto/coding');

      const argus = await AgentProviderAssignmentService.getAssignment('agent-argus');
      expect(argus?.providerId).toBe('prov-omniroute');
      expect(argus?.modelId).toBe('auto/claude-sonnet');
    });
  });
});

