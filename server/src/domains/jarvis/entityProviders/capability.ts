/**
 * capability.ts — Capability entity provider (§5 of plan).
 *
 * Resolves capability names to EntityRefs from CAPABILITY_REGISTRY aliases.
 */

import { CAPABILITY_REGISTRY } from '../capabilityRegistry.js';
import { normalizeText, type EntityProvider, type EntityRef } from '../entityResolver.js';

export const CapabilityEntityProvider: EntityProvider = {
  domain: 'capabilities',

  resolve(query: string): EntityRef | null {
    const q = normalizeText(query);
    if (!q) return null;

    for (const cap of CAPABILITY_REGISTRY) {
      const aliases = [...(cap.aliases || []), cap.id, cap.displayName].map(normalizeText);
      // Exact alias match OR alias appears as a whole word in the query.
      // e.g. "delegate to Hermes" → q contains whole word "hermes".
      if (aliases.some((a) => {
        if (!a) return false;
        if (a === q) return true;
        const escaped = a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`\\b${escaped}\\b`, 'i').test(q);
      })) {
        return {
          id: cap.id,
          type: 'capability',
          domain: 'capabilities',
          displayName: cap.displayName,
          aliases: cap.aliases,
        };
      }
    }
    return null;
  },

  listAll(): EntityRef[] {
    return CAPABILITY_REGISTRY.map((cap) => ({
      id: cap.id,
      type: 'capability',
      domain: 'capabilities',
      displayName: cap.displayName,
      aliases: cap.aliases,
    }));
  },
};