/**
 * Stage 1 — Prospect discovery.
 *
 * Sources:
 *   - `fixturesOnly`  → clearly-labelled SAMPLE FIXTURES (tests/demo only)
 *   - `specificUrl`   → a single user-supplied public URL (live inspection)
 *   - everything else → REAL public-business discovery (OpenStreetMap Overpass)
 *
 * Discovery never invents businesses. If the requested count exceeds the
 * available verified candidates, we return the truthful number found and note
 * the shortfall. If real discovery fails, the pipeline BLOCKS with the exact
 * limitation — fixtures are never substituted silently.
 */
import type { PipelineConfig, ProspectRecord, DiscoveryStopReason, DiscoverySourceAttempt } from './types.js';
import { fixturesFor } from './fixtures.js';
import { randomUUID } from 'node:crypto';
import { discoverRealProspects } from './realDiscovery.js';
import type { DiscoveryProgress } from './realDiscovery.js';

export interface DiscoveryResult {
  prospects: ProspectRecord[];
  blocker: string | null;
  /** Why discovery stopped (source-resilience milestone). */
  stopReason?: DiscoveryStopReason | null;
  /** Full attempt log across sources (retry/fallback evidence). */
  sourceLog?: DiscoverySourceAttempt[];
}

export async function discoverProspects(
  config: PipelineConfig,
  fetchImpl: typeof fetch = fetch,
  onProgress?: (p: DiscoveryProgress) => void
): Promise<DiscoveryResult> {
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
      discoverySourceRecord: null,
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

  if (config.fixturesOnly) {
    // Test/demo fixtures. Live + fixturesOnly is refused — real discovery is
    // the only acceptable live source.
    if (!config.dryRun) {
      return {
        prospects: [],
        blocker:
          'Fixture discovery is not allowed in live mode. Real prospect discovery requires a configured research source; provide a specific business URL or retry without fixture mode.',
      };
    }
    const fixtures = fixturesFor(config.niche, config.city);
    if (fixtures.length === 0) {
      return {
        prospects: [],
        blocker: `No sample fixtures match niche "${config.niche}" and city "${config.city}".`,
      };
    }
    // Discovery headroom: request more than the target so rejections can be
    // replaced without a second discovery round (contact-quality milestone).
    const wanted = Math.max(1, Math.min(config.prospectCount * (config.discoveryHeadroomMultiplier ?? 2), fixtures.length));
    const prospects: ProspectRecord[] = fixtures.slice(0, wanted).map((f) => ({
      prospectId: `pp-${randomUUID().replace(/-/g, '').slice(0, 12)}`,
      businessName: f.businessName,
      niche: f.niche,
      city: f.city,
      websiteUrl: f.websiteUrl,
      publicContactUrl: f.publicContactUrl,
      discoverySource: 'fixture',
      discoverySourceRecord: null,
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

  // REAL public-business discovery — read-only, robots-respecting, legal.
  return discoverRealProspects(config, fetchImpl, onProgress);
}
