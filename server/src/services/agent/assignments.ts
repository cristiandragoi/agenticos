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
      return {
        agentId: record.agentId,
        providerId: record.providerId,
        modelId: record.modelId || undefined,
        routingMode: record.routingMode as 'automatic' | 'preferred' | 'forced',
        enabled: record.enabled,
        updatedAt: record.updatedAt
      };
    }
    if (agentId === 'agent-codex') {
      return {
        agentId: 'agent-codex',
        providerId: 'prov-deepseek',
        modelId: 'deepseek-v4-flash',
        routingMode: 'forced',
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
