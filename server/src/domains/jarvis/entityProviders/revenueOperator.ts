/**
 * revenueOperator.ts — Revenue Operator entity provider (§5 of plan).
 *
 * Resolves revenue opportunities (e.g. "Free Cash") to EntityRefs from the
 * live revenue opportunities store.
 */

import { listOpportunities } from '../../../services/revenueOperator/opportunityService.js';
import { normalizeText, type EntityProvider, type EntityRef } from '../entityResolver.js';

/** Normalize a title for fuzzy comparison — drop "the", trailing "operator". */
function titleTokens(title: string): string[] {
  return normalizeText(title).split(' ').filter((t) => t && t !== 'the');
}

const SYSTEM_EXCLUSIONS = /\b(?:agentic\s*os|jarvis|system|adapter|adapters|probe|role of|what is|how does|explain|backend|electron|codex|hermes|package\.json)\b/i;

const STOP_TOKENS = new Set([
  'agentic', 'workflow', 'template', 'pack', 'solopreneurs', 'notion', 'system', 'operator',
  'revenue', 'opportunity', 'opportunities', 'automation', 'store', 'online',
  'project', 'projects', 'tasks', 'task', 'service', 'services', 'niche',
  'probe', 'verification', 'status', 'confirm', 'runtime'
]);

export const RevenueOperatorEntityProvider: EntityProvider = {
  domain: 'revenue_operator',

  async resolve(query: string): Promise<EntityRef | null> {
    const q = normalizeText(query);
    if (!q) return null;
    // Don't match generic capabilities like "revenue operator" itself.
    if (q === 'revenue operator' || q === 'revenue') return null;
    // An opportunity is NOT a project: don't substitute opportunities when user explicitly asks for a project
    if (/\b(?:projects?|workspace)\b/i.test(q)) return null;
    // Don't match on system/architecture queries
    if (SYSTEM_EXCLUSIONS.test(q)) return null;

    let opportunities: Array<{ id: string; title: string }> = [];
    try {
      opportunities = (await listOpportunities()) || [];
    } catch {
      return null;
    }

    const qTokens = q.split(' ').filter((t) => t && t !== 'the');

    for (const opp of opportunities) {
      const title = opp.title || '';
      const titleNorm = normalizeText(title);
      const titleTok = titleTokens(title);

      // Exact title match, or full title appears in query
      if (titleNorm === q || q.includes(titleNorm)) return toRef(opp.id, title);
      // All title tokens appear in the query
      if (titleTok.length >= 2 && titleTok.every((t) => q.includes(t))) return toRef(opp.id, title);

      // Partial overlap: a distinctive token of the title is present ("FreeCash",
      // "Shopify" when title is "Shopify Store Automation").
      const distinctive = titleTok.filter((t) => t.length >= 5 && !STOP_TOKENS.has(t));
      for (const d of distinctive) {
        const wordRe = new RegExp(`\\b${d}\\b`, 'i');
        if (wordRe.test(q)) return toRef(opp.id, title);
      }
    }
    return null;
  },

  async listAll(): Promise<EntityRef[]> {
    try {
      const opportunities = (await listOpportunities()) || [];
      return opportunities.map((o) => toRef(o.id, o.title));
    } catch {
      return [];
    }
  },
};

function toRef(id: string, title: string): EntityRef {
  return {
    id,
    type: 'revenue_opportunity',
    domain: 'revenue_operator',
    displayName: title,
  };
}