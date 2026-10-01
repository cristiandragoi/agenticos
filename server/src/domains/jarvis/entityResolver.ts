/**
 * entityResolver.ts — Cross-domain entity resolution abstraction (§5 of plan).
 *
 * Resolves natural-language queries to typed EntityRefs. Domain providers are
 * registered at startup. First provider match wins (ordered registration).
 *
 * Precedence contract: Revenue Operator providers are registered BEFORE
 * capability providers so "Free Cash" resolves to the revenue opportunity, not
 * a capability with an overlapping alias.
 */

export interface EntityRef {
  id: string;
  type: string;           // 'revenue_opportunity' | 'capability' | 'project' | 'task' | 'agent'
  domain: string;         // 'revenue_operator' | 'capabilities' | 'projects' | 'tasks' | 'agents'
  displayName: string;
  aliases?: string[];
}

export interface EntityProvider {
  /** Canonical domain this provider produced entities for. */
  domain: string;
  /** Resolve a normalized query to a single EntityRef, or null. */
  resolve(query: string): Promise<EntityRef | null> | EntityRef | null;
  /** Optional: list all entities in this domain (used for disambiguation). */
  listAll?(): Promise<EntityRef[]> | EntityRef[];
}

const providers: EntityProvider[] = [];

export function registerEntityProvider(provider: EntityProvider): void {
  providers.push(provider);
}

/** Normalize text for matching: lowercase, collapse whitespace. */
export function normalizeText(input: string): string {
  return (input || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

let defaultProvidersRegistered = false;
export async function ensureDefaultEntityProviders(): Promise<void> {
  if (defaultProvidersRegistered) return;
  defaultProvidersRegistered = true;
  if (providers.length === 0) {
    const { RevenueOperatorEntityProvider } = await import('./entityProviders/revenueOperator.js');
    const { ProjectEntityProvider } = await import('./entityProviders/project.js');
    const { CapabilityEntityProvider } = await import('./entityProviders/capability.js');
    const { TaskEntityProvider } = await import('./entityProviders/task.js');
    providers.push(RevenueOperatorEntityProvider, ProjectEntityProvider, CapabilityEntityProvider, TaskEntityProvider);
  }
}

/**
 * Resolve a query to an EntityRef. Iterates providers in registration order.
 * First non-null match wins.
 */
export async function resolveEntity(query: string): Promise<EntityRef | null> {
  const normalized = normalizeText(query);
  if (!normalized) return null;

  await ensureDefaultEntityProviders();

  const prefersProject = /\b(?:projects?|workspace|operat(?:e|ing)|work(?:ing)?(?:\s+(?:inside|on|in))?|moving)\b/i.test(normalized);
  const candidates: Array<{ entity: EntityRef; providerDomain: string; score: number; reason: string }> = [];

  for (const provider of providers) {
    try {
      const res = await provider.resolve(normalized);
      if (res) {
        let score = 50;
        let reason = `matched provider ${provider.domain}`;
        if (res.type === 'project' && prefersProject) {
          score += 100;
          reason = 'explicit project keyword in query matched project entity type';
        } else if (res.type === 'revenue_opportunity' && prefersProject) {
          score -= 50;
          reason = 'revenue opportunity deprioritized due to project keyword in query';
        } else if (res.type === 'project') {
          score += 10;
        }
        candidates.push({ entity: res, providerDomain: provider.domain, score, reason });
      }
    } catch (err) {
      console.warn(`[EntityResolver] provider '${provider.domain}' failed`, err);
    }
  }

  if (candidates.length > 0) {
    candidates.sort((a, b) => b.score - a.score);
    const candidateLines = candidates.map((c, i) => `  ${i + 1}. ${c.entity.id} / ${c.entity.type} / score=${c.score} (${c.reason})`).join('\n');
    console.log(`[EntityResolver] ENTITY_CANDIDATES:\n${candidateLines}\n  Winner: ${candidates[0].entity.id} (${candidates[0].entity.type})`);
    return candidates[0].entity;
  }
  return null;
}

/** List all entities across all providers (for disambiguation). */
export async function listAllEntities(): Promise<EntityRef[]> {
  const all: EntityRef[] = [];
  for (const provider of providers) {
    try {
      if (provider.listAll) {
        all.push(...(await provider.listAll()));
      }
    } catch {
      // best effort
    }
  }
  return all;
}