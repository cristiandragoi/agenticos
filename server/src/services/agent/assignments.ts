import { db } from '../../db/index.js';
import { agentProviderAssignments } from '../../db/schema.js';
import { eq } from 'drizzle-orm';

export interface AgentProviderAssignment {
  agentId: string;
  providerId: string;
  modelId?: string;
  routingMode: 'automatic' | 'preferred' | 'forced';
  enabled: boolean;
  updatedAt: string;
}

/**
 * Maps frontend catalog provider IDs to canonical backend gateway registry IDs.
 * Do not silently mix frontend catalog IDs with gateway IDs without this layer.
 */
export function mapCatalogToGatewayId(catalogId: string): string {
  const map: Record<string, string> = {
    'prov-codex': 'codex',
    'prov-ollama': 'ollama',
    'prov-omniroute': 'omniroute',
    'prov-omni': 'omniroute',
    'prov-openrouter': 'OpenRouter',
    'prov-deepseek': 'DeepSeek',
    'prov-longcat': 'openrouter',
    'prov-groq': 'Groq',
    'prov-fugu': 'Fugu Ultra',
    'prov-fusion': 'Fusion',
    'prov-qwable': 'Qwable 27B Coder'
  };
  return map[catalogId] || catalogId;
}

export class AgentProviderAssignmentService {
  static async getAssignment(agentId: string): Promise<AgentProviderAssignment | null> {
    const record = db.select().from(agentProviderAssignments).where(eq(agentProviderAssignments.agentId, agentId)).get();
    
    if (record && record.enabled) {
      // Emergency fallback protection: if agent-jarvis was unintentionally forced
      // to the small emergency fallback model (llama3.2:3b), relax routing mode to
      // preferred and let the primary gateway route to a capable model while retaining
      // llama3.2:3b as fallback.
      const isForcedEmergencyFallback = agentId === 'agent-jarvis' &&
        record.modelId === (process.env.OLLAMA_FALLBACK_MODEL || 'llama3.2:3b') &&
        record.routingMode === 'forced';

      // Stale pre-Phase 2 Ollama override for Hermes: relax to OmniRoute policy
      const isStaleHermesOllama = (agentId === 'agent-hermes' || agentId === 'hermes') &&
        record.providerId === 'prov-ollama' &&
        record.modelId === 'qwen3.5:27b';

      if (isStaleHermesOllama) {
        return {
          agentId: record.agentId,
          providerId: 'prov-omniroute',
          modelId: 'auto/reasoning',
          routingMode: 'preferred',
          enabled: true,
          updatedAt: new Date().toISOString()
        };
      }

      // Migrate stale MiMo assignment for Jarvis to meta-llama/llama-3.3-70b-instruct
      const isStaleJarvisMimo = (agentId === 'agent-jarvis' || agentId === 'jarvis') &&
        record.modelId === 'xiaomi/mimo-v2.6-flash';

      if (isStaleJarvisMimo) {
        return {
          agentId: record.agentId,
          providerId: 'prov-openrouter',
          modelId: process.env.JARVIS_PRIMARY_MODEL || 'meta-llama/llama-3.3-70b-instruct',
          routingMode: 'preferred',
          enabled: true,
          updatedAt: new Date().toISOString()
        };
      }

      return {
        agentId: record.agentId,
        providerId: isForcedEmergencyFallback ? (process.env.OPENROUTER_API_KEY ? 'prov-openrouter' : record.providerId) : record.providerId,
        modelId: isForcedEmergencyFallback ? (process.env.OPENROUTER_MODEL || 'auto') : (record.modelId || undefined),
        routingMode: isForcedEmergencyFallback ? 'preferred' : (record.routingMode as 'automatic' | 'preferred' | 'forced'),
        enabled: record.enabled,
        updatedAt: record.updatedAt
      };
    }

    const norm = (agentId || '').toLowerCase();
    if (norm === 'agent-jarvis' || norm === 'jarvis') {
      const providerId = (process.env.JARVIS_MODEL_PROVIDER === 'openrouter' || !process.env.JARVIS_MODEL_PROVIDER)
        ? 'prov-openrouter'
        : (process.env.JARVIS_MODEL_PROVIDER.startsWith('prov-') ? process.env.JARVIS_MODEL_PROVIDER : `prov-${process.env.JARVIS_MODEL_PROVIDER}`);
      return {
        agentId: 'agent-jarvis',
        providerId,
        modelId: process.env.JARVIS_PRIMARY_MODEL || 'meta-llama/llama-3.3-70b-instruct',
        routingMode: 'preferred',
        enabled: true,
        updatedAt: new Date().toISOString()
      };
    }

    if (norm === 'agent-codex' || norm === 'codex') {
      return {
        agentId: 'agent-codex',
        providerId: 'prov-omniroute',
        modelId: 'auto/coding',
        routingMode: 'preferred',
        enabled: true,
        updatedAt: new Date().toISOString()
      };
    }

    if (norm === 'agent-hermes' || norm === 'hermes') {
      return {
        agentId: 'agent-hermes',
        providerId: 'prov-omniroute',
        modelId: 'auto/reasoning',
        routingMode: 'preferred',
        enabled: true,
        updatedAt: new Date().toISOString()
      };
    }

    if (norm === 'agent-argus' || norm === 'argus') {
      return {
        agentId: 'agent-argus',
        providerId: 'prov-omniroute',
        modelId: 'auto/claude-sonnet',
        routingMode: 'preferred',
        enabled: true,
        updatedAt: new Date().toISOString()
      };
    }

    return null;
  }

  static async saveAssignment(assignment: AgentProviderAssignment): Promise<void> {
    const now = new Date().toISOString();
    db.insert(agentProviderAssignments)
      .values({
        agentId: assignment.agentId,
        providerId: assignment.providerId,
        modelId: assignment.modelId,
        routingMode: assignment.routingMode,
        enabled: assignment.enabled,
        createdAt: now,
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: agentProviderAssignments.agentId,
        set: {
          providerId: assignment.providerId,
          modelId: assignment.modelId,
          routingMode: assignment.routingMode,
          enabled: assignment.enabled,
          updatedAt: now
        }
      })
      .run();
  }
}