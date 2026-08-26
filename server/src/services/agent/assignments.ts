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
    'prov-ollama': 'ollama',
    'prov-omniroute': 'omniroot',
    'prov-omni': 'omniroot',
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

      return {
        agentId: record.agentId,
        providerId: isForcedEmergencyFallback ? (process.env.OPENROUTER_API_KEY ? 'prov-openrouter' : record.providerId) : record.providerId,
        modelId: isForcedEmergencyFallback ? (process.env.OPENROUTER_MODEL || 'auto') : (record.modelId || undefined),
        routingMode: isForcedEmergencyFallback ? 'preferred' : (record.routingMode as 'automatic' | 'preferred' | 'forced'),
        enabled: record.enabled,
        updatedAt: record.updatedAt
      };
    }

    if (agentId === 'agent-jarvis') {
      return {
        agentId: 'agent-jarvis',
        providerId: 'prov-openrouter',
        modelId: process.env.OPENROUTER_MODEL || 'auto',
        routingMode: 'preferred',
        enabled: true,
        updatedAt: new Date().toISOString()
      };
    }

    if (agentId === 'agent-codex') {
      return {
        agentId: 'agent-codex',
        providerId: 'prov-deepseek',
        modelId: 'deepseek-v4-flash',
        // Preferred (not forced): keeps the gateway fallback chain alive so a
        // transient transport failure of DeepSeek can resolve on the next
        // available provider. (CODEX PROVIDER ROUTING RECOVERY — the previous
        // 'forced' default made any DeepSeek blip a hard goal failure.)
        routingMode: 'preferred',
        enabled: true,
        updatedAt: new Date().toISOString()
      };
    }

    if (agentId === 'agent-hermes') {
      return {
        agentId: 'agent-hermes',
        providerId: 'prov-deepseek',
        modelId: 'deepseek-v4-flash',
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