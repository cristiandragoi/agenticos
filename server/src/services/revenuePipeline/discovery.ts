/**
 * Stage 1 — Prospect discovery.
 *
 * Sources (V1, honest):
 *   - `dryRun`   → clearly-labelled SAMPLE FIXTURES (never real businesses)
 *   - `specificUrl` → a single user-supplied public URL (live inspection)
 *   - anything else → NO candidates + a truthful blocker explaining that
 *     live discovery needs a configured research source (out of scope V1).
 *
 * Discovery never invents businesses. If a requested count exceeds the
 * available labelled candidates, we return what exists and note the shortfall.
 */
import type { PipelineConfig, ProspectRecord } from './types.js';
import { fixturesFor } from './fixtures.js';
import { randomUUID } from 'node:crypto';

export interface DiscoveryResult {
  prospects: ProspectRecord[];
  blocker: string | null;
}

export function discoverProspects(config: PipelineConfig): DiscoveryResult {
  const now = new Date().toISOString();

  if (config.specificUrl) {
    let host = '';
    try {
      host = new URL(config.specificUrl).hostname.replace(/^www\./, '');
    } catch {
      host = config.specificUrl;
    }
    const prospect: ProspectRecord = {
      prospectId: `pp-${randomUUID().replace(/-/g, '').slice(0, 12)}`,
      businessName: host || 'Provided business URL',
      niche: config.niche,
      city: config.city,
      websiteUrl: config.specificUrl,
      publicContactUrl: null,
      discoverySource: 'user-url',
      fixture: false,
      verifiedFacts: [],
      unverifiedObservations: [],
      auditFindings: [],
      auditScore: null,
      opportunityScore: null,
      scoringCriteria: null,
      confidence: 'low',
      status: 'discovered',
      linkedTaskId: null,
      linkedBoardCardId: null,
      workspacePath: null,
      selectedForBuild: false,
      createdAt: now,
      updatedAt: now,
    };
    return { prospects: [prospect], blocker: null };
  }

  if (!config.dryRun) {
    return {
      prospects: [],
      blocker:
        'Live prospect discovery is not available in V1 without a configured research source. ' +
        'Run in dry-run mode (sample fixtures) or provide a specific business URL.',
    };
  }

  const fixtures = fixturesFor(config.niche, config.city);
  if (fixtures.length === 0) {
    return {
      prospects: [],
      blocker: `No sample fixtures match niche "${config.niche}" and city "${config.city}".`,
    };
  }

  const wanted = Math.max(1, Math.min(config.prospectCount, fixtures.length));
  const prospects: ProspectRecord[] = fixtures.slice(0, wanted).map((f) => ({
    prospectId: `pp-${randomUUID().replace(/-/g, '').slice(0, 12)}`,
    businessName: f.businessName,
    niche: f.niche,
    city: f.city,
    websiteUrl: f.websiteUrl,
    publicContactUrl: f.publicContactUrl,
    discoverySource: 'fixture',
    fixture: true,
    verifiedFacts: [...f.verifiedFacts],
    unverifiedObservations: [...f.unverifiedObservations],
    auditFindings: [],
    auditScore: null,
    opportunityScore: null,
    scoringCriteria: null,
    confidence: 'low',
    status: 'discovered',
    linkedTaskId: null,
    linkedBoardCardId: null,
    workspacePath: null,
    selectedForBuild: false,
    createdAt: now,
    updatedAt: now,
  }));

  return { prospects, blocker: null };
}
