import { randomUUID } from 'node:crypto';
/** Narrow niche → OSM tag mapping (V1 covers the acceptance niches). */
const NICHE_TO_OSM = {
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
    { id: 'overpass-de', url: 'https://overpass-api.de/api/interpreter' },
    { id: 'overpass-kumi', url: 'https://overpass.kumi.systems/api/interpreter' },
    { id: 'overpass-ch', url: 'https://overpass.osm.ch/api/interpreter' },
];
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const UA = 'AgenticOS-RevenuePipeline/1.0 (public business discovery; local research tool)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Classify an Overpass attempt outcome (source-resilience milestone). */
function classifyOverpassAttempt(status, error) {
    if (error) {
        if (/timed out|abort|network|fetch failed/i.test(error))
            return 'transient_failure';
        return 'invalid_response';
    }
    if (status === 429)
        return 'rate_limited';
    if (status !== null && (status === 408 || status >= 500))
        return 'transient_failure';
    if (status !== null && status >= 400)
        return 'invalid_response';
    if (status === 200)
        return 'ok';
    return 'invalid_response';
}
function canonicalDomain(url) {
    try {
        return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
    }
    catch {
        return null;
    }
}
/** Normalize an OSM website tag into a usable public URL (or null). */
function normalizeWebsite(raw) {
    if (!raw)
        return null;
    const t = raw.trim();
    if (!t || /^(mailto:|tel:|fax:)/i.test(t))
        return null;
    try {
        const u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
        if (u.protocol !== 'http:' && u.protocol !== 'https:')
            return null;
        u.hash = '';
        return u.href.replace(/\/$/, '');
    }
    catch {
        return null;
    }
}
/** Geocode a city via Nominatim (single query, valid UA). */
export async function geocodeCityBbox(city, fetchImpl = fetch) {
    const url = `${NOMINATIM}?q=${encodeURIComponent(city)}&format=json&limit=1`;
    try {
        const res = await fetchImpl(url, {
            signal: AbortSignal.timeout(15000),
            headers: { 'User-Agent': UA, Accept: 'application/json' },
        });
        if (!res.ok)
            return null;
        const data = (await res.json());
        const bb = data?.[0]?.boundingbox;
        if (!bb || bb.length < 4)
            return null;
        const [s, n, w, e] = bb.map((v) => parseFloat(v));
        if (![s, n, w, e].every(Number.isFinite))
            return null;
        return { south: s, north: n, west: w, east: e };
    }
    catch {
        return null;
    }
}
export function buildOverpassQuery(niche, bbox) {
    const tags = NICHE_TO_OSM[niche.trim().toLowerCase()];
    if (!tags || tags.length === 0)
        return null;
    const { south, north, west, east } = bbox;
    const clauses = tags
        .map((t) => {
        // NICHE_TO_OSM entries are "key=value" — Overpass needs ["key"="value"].
        const eq = t.indexOf('=');
        if (eq <= 0)
            return null;
        const key = t.slice(0, eq);
        const value = t.slice(eq + 1);
        return `(node["${key}"="${value}"]["website"](${south},${west},${north},${east});way["${key}"="${value}"]["website"](${south},${west},${north},${east});)`;
    })
        .filter((c) => Boolean(c))
        .join('');
    if (!clauses)
        return null;
    return `[out:json][timeout:30];${clauses};out center 50;`;
}
/** Convert Overpass elements to prospects with full discovery provenance. */
export function elementsToProspects(elements, config, now, cityEvidence) {
    const seen = new Set();
    const prospects = [];
    // Discovery headroom: request prospectCount × multiplier candidates so that
    // qualification rejections can be replaced without a second discovery round.
    const target = Math.max(config.prospectCount, config.prospectCount * (config.discoveryHeadroomMultiplier ?? 2));
    const cap = config.discoveryCap ?? 40;
    const limit = Math.min(target, cap);
    for (const el of elements) {
        if (prospects.length >= limit)
            break;
        const tags = el.tags || {};
        const name = tags.name?.trim();
        const website = normalizeWebsite(tags.website);
        if (!name || !website)
            continue; // never fabricate a name/website
        const domain = canonicalDomain(website);
        if (!domain || seen.has(domain))
            continue; // dedupe by canonical domain
        seen.add(domain);
        prospects.push(buildProspectFromElement(el, tags, website, config, now, cityEvidence, 'overpass-de'));
    }
    return prospects;
}
/** Build a single prospect from an Overpass element (shared by single + multi-source). */
function buildProspectFromElement(el, tags, website, config, now, cityEvidence, sourceId) {
    const domain = canonicalDomain(website);
    const address = [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' ');
    const cityBit = tags['addr:city'] ? `city: ${tags['addr:city']}` : cityEvidence;
    const evidenceBits = [
        `OpenStreetMap ${el.type} ${el.id} (${tags.name})`,
        `website tag: ${tags.website}`,
        address ? `address: ${address}${tags['addr:postcode'] ? ', ' + tags['addr:postcode'] : ''}` : null,
        cityBit,
    ].filter(Boolean);
    const hasAddress = Boolean(tags['addr:street'] || tags['addr:city'] || tags['addr:postcode']);
    const record = {
        sourceType: 'osm-overpass',
        sourceUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
        retrievedAt: now,
        evidence: evidenceBits.join('; '),
        confidence: hasAddress ? 'high' : 'medium',
        corroboratedBy: [],
    };
    return {
        prospectId: `pp-${randomUUID().replace(/-/g, '').slice(0, 12)}`,
        businessName: tags.name?.trim() || '',
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
    };
}
/** One fetch against one Overpass endpoint; never throws. */
async function attemptOverpass(endpoint, encodedQuery, fetchImpl) {
    const url = `${endpoint}?data=${encodedQuery}`;
    try {
        // Overpass/OSM reject requests without a descriptive User-Agent (406).
        const res = await fetchImpl(url, {
            signal: AbortSignal.timeout(30000),
            headers: { 'User-Agent': UA, Accept: 'application/json' },
        });
        if (res.status === 429)
            return { status: 'rate_limited', error: `HTTP 429` };
        if (!res.ok)
            return { status: classifyOverpassAttempt(res.status, null), error: `HTTP ${res.status}` };
        let data;
        try {
            data = (await res.json());
        }
        catch {
            return { status: 'invalid_response', error: 'response body was not valid JSON' };
        }
        return { status: 'ok', elements: data?.elements || [] };
    }
    catch (err) {
        const msg = err?.name === 'TimeoutError' ? 'request timed out' : String(err?.message || err);
        return { status: classifyOverpassAttempt(null, msg), error: msg };
    }
}
/**
 * Discover real prospects for the niche+city (source-resilience milestone).
 *
 * Strategy: primary Overpass endpoint with bounded retry (429/5xx/timeout →
 * backoff), then the mirror endpoints as fallbacks. Discovery stops when the
 * headroom target is reached, the source budget (max attempts) is exhausted,
 * or the time budget expires. Candidates are deduplicated globally by
 * canonical domain; a business seen from multiple sources is corroborated
 * (recorded on its DiscoverySourceRecord). `fetchImpl` is injectable for
 * tests (defaults to the global fetch). Never substitutes fixtures.
 */
export async function discoverRealProspects(config, fetchImpl = fetch, onProgress) {
    const now = new Date().toISOString();
    const sourceLog = [];
    // 1. Resolve the city to a bounding box (Nominatim).
    const bbox = await geocodeCityBbox(config.city, fetchImpl);
    if (!bbox) {
        return {
            prospects: [],
            blocker: `Real prospect discovery could not geocode city "${config.city}" (Nominatim lookup failed). ` +
                `No candidates were invented.`,
            stopReason: 'INVALID_RESPONSE',
            sourceLog,
        };
    }
    // 2. Build + run the Overpass query (retry primary, then fallback mirrors).
    const query = buildOverpassQuery(config.niche, bbox);
    if (!query) {
        return {
            prospects: [],
            blocker: `Real prospect discovery has no OpenStreetMap tag mapping for niche "${config.niche}". ` +
                `No candidates were invented.`,
            stopReason: 'NO_RESULTS',
            sourceLog,
        };
    }
    const encoded = encodeURIComponent(query);
    const cityEvidence = `located inside the ${config.city} metro bounding box (Nominatim geocode + Overpass)`;
    const target = Math.max(config.prospectCount, config.prospectCount * (config.discoveryHeadroomMultiplier ?? 2));
    const limit = Math.min(target, config.discoveryCap ?? 40);
    const maxAttemptsPerSource = config.discoveryMaxAttemptsPerSource ?? 3;
    const maxTotalAttempts = config.discoveryMaxTotalAttempts ?? 6;
    const timeBudgetMs = config.discoveryTimeBudgetMs ?? 120000;
    const globalSeen = new Set();
    const domainToProspect = new Map();
    const allProspects = [];
    const startedAt = Date.now();
    let totalAttempts = 0;
    let stopReason = 'SOURCE_EXHAUSTED';
    const report = (source, attempt, error, reason) => {
        onProgress?.({ source, attempt, maxAttempts: maxAttemptsPerSource, discovered: allProspects.length, error, reason });
    };
    for (const source of OVERPASS_ENDPOINTS) {
        if (allProspects.length >= limit) {
            stopReason = 'TARGET_REACHED';
            break;
        }
        if (Date.now() - startedAt > timeBudgetMs) {
            stopReason = 'TIME_EXHAUSTED';
            break;
        }
        for (let attempt = 1; attempt <= maxAttemptsPerSource; attempt++) {
            if (totalAttempts >= maxTotalAttempts) {
                stopReason = 'SOURCE_EXHAUSTED';
                break;
            }
            if (Date.now() - startedAt > timeBudgetMs) {
                stopReason = 'TIME_EXHAUSTED';
                break;
            }
            if (allProspects.length >= limit) {
                stopReason = 'TARGET_REACHED';
                break;
            }
            totalAttempts++;
            const attemptStarted = Date.now();
            report(source.id, attempt, null, null);
            const outcome = await attemptOverpass(source.url, encoded, fetchImpl);
            const latencyMs = Date.now() - attemptStarted;
            sourceLog.push({ source: source.id, attempt, status: outcome.status, error: outcome.error ?? null, latencyMs });
            if (outcome.status !== 'ok') {
                report(source.id, attempt, outcome.error || outcome.status, outcome.status === 'rate_limited' ? 'RATE_LIMITED' : 'TRANSIENT_SOURCE_FAILURE');
                // Bounded backoff for transient failures only (429/5xx/timeout).
                if (outcome.status === 'transient_failure' || outcome.status === 'rate_limited') {
                    const backoff = Math.min(4000, (config.discoveryBackoffBaseMs ?? 500) * 2 ** attempt);
                    await sleep(backoff);
                }
                continue;
            }
            // OK: convert + dedupe globally by canonical domain.
            let added = 0;
            for (const el of outcome.elements || []) {
                if (allProspects.length >= limit)
                    break;
                const tags = el.tags || {};
                const name = tags.name?.trim();
                const website = normalizeWebsite(tags.website);
                if (!name || !website)
                    continue;
                const domain = canonicalDomain(website);
                if (!domain)
                    continue;
                if (globalSeen.has(domain)) {
                    // Multi-source corroboration: same business from another source.
                    const existing = domainToProspect.get(domain);
                    if (existing?.discoverySourceRecord) {
                        existing.discoverySourceRecord.corroboratedBy = [
                            ...new Set([...(existing.discoverySourceRecord.corroboratedBy || []), source.id]),
                        ];
                    }
                    continue;
                }
                globalSeen.add(domain);
                const prospect = buildProspectFromElement(el, tags, website, config, now, cityEvidence, source.id);
                domainToProspect.set(domain, prospect);
                allProspects.push(prospect);
                added++;
            }
            report(source.id, attempt, null, added === 0 ? 'NO_RESULTS' : null);
            if (added === 0) {
                // Healthy source but nothing new — try the next source.
                sourceLog[sourceLog.length - 1].status = 'no_results';
                stopReason = 'NO_RESULTS';
                break;
            }
            if (allProspects.length >= limit) {
                stopReason = 'TARGET_REACHED';
                break;
            }
            // Partial candidates found — the next source can add more.
            break;
        }
    }
    if (allProspects.length >= limit)
        stopReason = 'TARGET_REACHED';
    else if (Date.now() - startedAt > timeBudgetMs)
        stopReason = 'TIME_EXHAUSTED';
    else if (totalAttempts >= maxTotalAttempts)
        stopReason = 'SOURCE_EXHAUSTED';
    if (allProspects.length > 0) {
        return { prospects: allProspects, blocker: null, stopReason, sourceLog };
    }
    const failed = sourceLog
        .filter((s) => s.status !== 'ok' && s.status !== 'no_results')
        .map((s) => `${s.source} attempt ${s.attempt} → ${s.status}${s.error ? ` (${s.error})` : ''} (${s.latencyMs}ms)`);
    const exhausted = sourceLog
        .filter((s) => s.status === 'no_results')
        .map((s) => `${s.source} attempt ${s.attempt} → no results`);
    return {
        prospects: [],
        blocker: `Real prospect discovery failed for ${config.niche} in ${config.city}. ` +
            `Stop reason: ${stopReason}. ` +
            `${failed.length ? `Failed: ${failed.join('; ')}. ` : ''}` +
            `${exhausted.length ? `Exhausted: ${exhausted.join('; ')}. ` : ''}` +
            `No fake prospects were substituted — retry later or provide a specific business URL.`,
        stopReason,
        sourceLog,
    };
}
