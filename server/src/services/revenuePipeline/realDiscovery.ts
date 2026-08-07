/**
 * Stage 1b — REAL public-business discovery (live mode).
 *
 * Sources (public, legally accessible, no keys):
 *   1. Nominatim (OpenStreetMap geocoder) — resolve the requested city to a
 *      bounding box. One query, descriptive User-Agent, 1 req/s policy.
 *   2. Overpass API — select businesses inside that bbox carrying a
 *      niche-mapped `craft` tag AND a public `website` tag. Every returned
 *      element is a REAL business mapped by volunteers; the OSM element page
 *      is recorded as the public source proving existence.
 *
 * Rules (milestone):
 *  - Only public, legally accessible sources; robots/rate limits respected
 *    (one geocode + one Overpass query per run, mirrors, bounded timeouts).
 *  - No fabricated businesses: entries without a name or a usable website are
 *    skipped, never invented.
 *  - Dedupe by canonical domain.
 *  - If fewer than `prospectCount` verifiable prospects exist, return the
 *    truthful number found — never pad.
 *  - On failure (geocode/overpass/rate limit) return a truthful blocker — the
 *    pipeline BLOCKS instead of substituting fixtures.
 */
import type { PipelineConfig, ProspectRecord, DiscoverySourceRecord } from './types.js';
import { randomUUID } from 'node:crypto';

export interface RealDiscoveryResult {
  prospects: ProspectRecord[];
  blocker: string | null;
}

/** Narrow niche → OSM tag mapping (V1 covers the acceptance niches). */
const NICHE_TO_OSM: Record<string, string[]> = {
  roofing: ['craft=roofer'],
  roofer: ['craft=roofer'],
  roofers: ['craft=roofer'],
  dachdecker: ['craft=roofer'],
  'dachdeckerei': ['craft=roofer'],
  plumbing: ['craft=plumber'],
  plumber: ['craft=plumber'],
  plumbers: ['craft=plumber'],
  electrical: ['craft=electrician'],
  electrician: ['craft=electrician'],
  electricians: ['craft=electrician'],
  painting: ['craft=painter'],
  painter: ['craft=painter'],
  painters: ['craft=painter'],
  hairdresser: ['craft=hairdresser'],
  hairdressers: ['craft=hairdresser'],
  barber: ['craft=barber'],
  barbers: ['craft=barber'],
};

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
];

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const UA = 'AgenticOS-RevenuePipeline/1.0 (public business discovery; local research tool)';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function canonicalDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return null;
  }
}

/** Normalize an OSM website tag into a usable public URL (or null). */
function normalizeWebsite(raw: string | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim();
  if (!t || /^(mailto:|tel:|fax:)/i.test(t)) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    return u.href.replace(/\/$/, '');
  } catch {
    return null;
  }
}

export interface CityBbox {
  south: number;
  north: number;
  west: number;
  east: number;
}

/** Geocode a city via Nominatim (single query, valid UA). */
export async function geocodeCityBbox(city: string, fetchImpl: typeof fetch = fetch): Promise<CityBbox | null> {
  const url = `${NOMINATIM}?q=${encodeURIComponent(city)}&format=json&limit=1`;
  try {
    const res = await fetchImpl(url, {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ boundingbox?: string[] }>;
    const bb = data?.[0]?.boundingbox;
    if (!bb || bb.length < 4) return null;
    const [s, n, w, e] = bb.map((v) => parseFloat(v));
    if (![s, n, w, e].every(Number.isFinite)) return null;
    return { south: s, north: n, west: w, east: e };
  } catch {
    return null;
  }
}

export function buildOverpassQuery(niche: string, bbox: CityBbox): string | null {
  const tags = NICHE_TO_OSM[niche.trim().toLowerCase()];
  if (!tags || tags.length === 0) return null;
  const { south, north, west, east } = bbox;
  const clauses = tags
    .map((t) => {
      // NICHE_TO_OSM entries are "key=value" — Overpass needs ["key"="value"].
      const eq = t.indexOf('=');
      if (eq <= 0) return null;
      const key = t.slice(0, eq);
      const value = t.slice(eq + 1);
      return `(node["${key}"="${value}"]["website"](${south},${west},${north},${east});way["${key}"="${value}"]["website"](${south},${west},${north},${east});)`;
    })
    .filter((c): c is string => Boolean(c))
    .join('');
  if (!clauses) return null;
  return `[out:json][timeout:30];${clauses};out center 50;`;
}

export interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  tags?: Record<string, string>;
}

/** Convert Overpass elements to prospects with full discovery provenance. */
export function elementsToProspects(
  elements: OverpassElement[],
  config: PipelineConfig,
  now: string,
  cityEvidence: string
): ProspectRecord[] {
  const seen = new Set<string>();
  const prospects: ProspectRecord[] = [];
  for (const el of elements) {
    if (prospects.length >= config.prospectCount) break;
    const tags = el.tags || {};
    const name = tags.name?.trim();
    const website = normalizeWebsite(tags.website);
    if (!name || !website) continue; // never fabricate a name/website
    const domain = canonicalDomain(website);
    if (!domain || seen.has(domain)) continue; // dedupe by canonical domain
    seen.add(domain);

    const address = [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' ');
    const cityBit = tags['addr:city'] ? `city: ${tags['addr:city']}` : cityEvidence;
    const evidenceBits = [
      `OpenStreetMap ${el.type} ${el.id} (${name})`,
      `website tag: ${tags.website}`,
      address ? `address: ${address}${tags['addr:postcode'] ? ', ' + tags['addr:postcode'] : ''}` : null,
      cityBit,
    ].filter(Boolean);

    const hasAddress = Boolean(tags['addr:street'] || tags['addr:city'] || tags['addr:postcode']);
    const record: DiscoverySourceRecord = {
      sourceType: 'osm-overpass',
      sourceUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
      retrievedAt: now,
      evidence: evidenceBits.join('; '),
      confidence: hasAddress ? 'high' : 'medium',
    };

    prospects.push({
      prospectId: `pp-${randomUUID().replace(/-/g, '').slice(0, 12)}`,
      businessName: name,
      niche: config.niche,
      city: config.city,
      websiteUrl: website,
      publicContactUrl: null,
      discoverySource: 'osm-overpass',
      discoverySourceRecord: record,
      fixture: false,
      verifiedFacts: [],
      unverifiedObservations: [],
      auditFindings: [],
      auditScore: null,
      opportunityScore: null,
      scoringCriteria: null,
      confidence: hasAddress ? 'high' : 'medium',
      status: 'discovered',
      linkedTaskId: null,
      linkedBoardCardId: null,
      workspacePath: null,
      selectedForBuild: false,
      createdAt: now,
      updatedAt: now,
    });
  }
  return prospects;
}

/**
 * Discover real prospects for the niche+city. `fetchImpl` is injectable for
 * tests (defaults to the global fetch). Returns a truthful blocker on any
 * failure — never substitutes fixtures.
 */
export async function discoverRealProspects(
  config: PipelineConfig,
  fetchImpl: typeof fetch = fetch
): Promise<RealDiscoveryResult> {
  const now = new Date().toISOString();

  // 1. Resolve the city to a bounding box (Nominatim).
  const bbox = await geocodeCityBbox(config.city, fetchImpl);
  if (!bbox) {
    return {
      prospects: [],
      blocker:
        `Real prospect discovery could not geocode city "${config.city}" (Nominatim lookup failed). ` +
        `No candidates were invented.`,
    };
  }

  // 2. Build + run the Overpass query (retry the primary once, then mirrors).
  const query = buildOverpassQuery(config.niche, bbox);
  if (!query) {
    return {
      prospects: [],
      blocker:
        `Real prospect discovery has no OpenStreetMap tag mapping for niche "${config.niche}". ` +
        `No candidates were invented.`,
    };
  }
  const encoded = encodeURIComponent(query);
  const cityEvidence = `located inside the ${config.city} metro bounding box (Nominatim geocode + Overpass)`;
  const sourcesTried: string[] = [];
  let lastError: string | null = null;

  const attempt = async (endpoint: string): Promise<ProspectRecord[] | null> => {
    const url = `${endpoint}?data=${encoded}`;
    try {
      // Overpass/OSM reject requests without a descriptive User-Agent (406).
      const res = await fetchImpl(url, {
        signal: AbortSignal.timeout(30000),
        headers: { 'User-Agent': UA, Accept: 'application/json' },
      });
      sourcesTried.push(`${endpoint} → HTTP ${res.status}`);
      if (res.status === 429) { lastError = 'overpass rate limit (HTTP 429)'; return null; }
      if (!res.ok) { lastError = `overpass HTTP ${res.status}`; return null; }
      const data = (await res.json()) as { elements?: OverpassElement[] };
      return elementsToProspects(data?.elements || [], config, now, cityEvidence);
    } catch (err: any) {
      lastError = err?.name === 'TimeoutError' ? 'overpass request timed out' : String(err?.message || err);
      return null;
    }
  };

  // Primary endpoint: up to 2 attempts with a short backoff (it 429s/504s when busy).
  for (let retry = 0; retry < 2; retry++) {
    const prospects = await attempt(OVERPASS_ENDPOINTS[0]);
    if (prospects && prospects.length > 0) return { prospects, blocker: null };
    if (prospects && prospects.length === 0) { lastError = 'overpass returned zero candidates'; }
    if (retry === 0) await sleep(3000);
  }
  // Mirror fallback.
  const mirrored = await attempt(OVERPASS_ENDPOINTS[1]);
  if (mirrored && mirrored.length > 0) return { prospects: mirrored, blocker: null };
  if (mirrored && mirrored.length === 0) { lastError = lastError || 'overpass returned zero candidates'; }

  return {
    prospects: [],
    blocker:
      `Real prospect discovery failed for ${config.niche} in ${config.city}. ` +
      `Limitation: ${lastError}. Sources tried: ${sourcesTried.join(', ') || 'none'}. ` +
      `No fake prospects were substituted — retry later or provide a specific business URL.`,
  };
}
