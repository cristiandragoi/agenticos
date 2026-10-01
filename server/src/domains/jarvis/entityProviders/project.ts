/**
 * project.ts — Project entity provider (§5 of plan).
 *
 * Resolves project names (e.g. "Free Cash project") to EntityRefs from the
 * projects store. All name matching lives in `projectNameMatch.ts` so the
 * planner, the guards and this provider agree — including on near misses such
 * as "shop by" -> Shopify.
 */

import { projectsStore } from '../../../services/projectsStore.js';
import { logger } from '../../../utils/logger.js';
import { type EntityProvider, type EntityRef } from '../entityResolver.js';
import { matchProjectByName } from '../projectNameMatch.js';

export const ProjectEntityProvider: EntityProvider = {
  domain: 'projects',

  resolve(query: string): EntityRef | null {
    if (!query || !query.trim()) return null;

    let projects: Array<{ id: string; name: string }> = [];
    try {
      projects = projectsStore.listProjects() || [];
    } catch {
      return null;
    }

    const m = matchProjectByName(query, projects);
    if (!m) return null;

    if (m.match === 'near_miss') {
      logger.info('[ProjectEntityProvider] ENTITY_NEAR_MISS resolved by phonetic similarity', {
        query, matchedProjectId: m.id, matchedName: m.name, score: m.score,
      });
    }
    return toRef(m.id, m.name);
  },

  listAll(): EntityRef[] {
    try {
      return (projectsStore.listProjects() || []).map((p) => toRef(p.id, p.name));
    } catch {
      return [];
    }
  },
};

function toRef(id: string, name: string): EntityRef {
  return {
    id,
    type: 'project',
    domain: 'projects',
    displayName: name,
  };
}
