/**
 * Discovery source resilience (source-resilience milestone).
 *
 * Covers: primary success, HTTP 504 → retry success, retry budget exhausted,
 * fallback source used, cross-source dedup + corroboration, partial result
 * after source exhaustion, no fabricated leads, target reached before budget
 * exhaustion, progress events (source + attempt + counts).
 *
 * A fake fetch simulates Nominatim + the three Overpass endpoints with
 * per-source response queues.
 */
import { describe, it, expect } from 'vitest';
import { discoverRealProspects } from '../services/revenuePipeline/realDiscovery.js';

const SOURCE_IDS = ['overpass-de', 'overpass-kumi', 'overpass-ch'];

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    niche: 'roofing',
    city: 'Berlin',
    serviceKeywords: [],
    prospectCount: 3,
    specificUrl: null,
    maxResearchBudgetUsd: null,
    dryRun: true,
    fixturesOnly: false,
    runBuild: false,
    useCodex: false,
    useLlm: false,
    rawRequest: 'find 3 roofers',
    workspacePath: '/tmp/ws',
    discoveryCap: 6,
    ...overrides,
  } as any;
}

interface FakeResponse { status: number; elements?: Array<Record<string, any>>; body?: unknown; }
type SourceQueue = Array<FakeResponse | number>;

/** Fake fetch: Nominatim OK; each Overpass endpoint pops its queue per call. */
function makeFetch(queues: Record<string, SourceQueue>) {
  const state: Record<string, number> = {};
  return async (url: string, opts?: any): Promise<any> => {
    if (url.includes('nominatim')) {
      return { ok: true, status: 200, json: async () => [{ boundingbox: ['52.3', '52.7', '13.0', '13.8'] }] };
    }
    const id = SOURCE_IDS.find((s) => url.includes(s === 'overpass-de' ? 'overpass-api.de' : s === 'overpass-kumi' ? 'kumi' : 'osm.ch')) || 'overpass-de';
    const q = queues[id] || [{ status: 200, elements: [] }];
    const idx = state[id] || 0;
    state[id] = idx + 1;
    const r = q[Math.min(idx, q.length - 1)];
    const resp = typeof r === 'number' ? { status: r } : r;
    return {
      ok: resp.status >= 200 && resp.status < 300,
      status: resp.status,
      json: async () => (resp.elements !== undefined ? { elements: resp.elements } : { ...(resp.body || {}) }),
    };
  };
}

const el = (id: number, name: string, website: string) => ({ type: 'node', id, tags: { name, website } });

describe('Revenue discovery — source resilience', () => {
  it('primary source success: target reached before budget exhaustion', async () => {
    const fetchImpl = makeFetch({
      'overpass-de': [{ status: 200, elements: [el(1, 'A', 'https://a.example'), el(2, 'B', 'https://b.example'), el(3, 'C', 'https://c.example'), el(4, 'D', 'https://d.example'), el(5, 'E', 'https://e.example'), el(6, 'F', 'https://f.example')] }],
    });
    const r = await discoverRealProspects(makeConfig(), fetchImpl as any);
    expect(r.prospects.length).toBe(6);
    expect(r.stopReason).toBe('TARGET_REACHED');
    expect(r.blocker).toBeNull();
    expect(r.sourceLog?.length).toBe(1);
    expect(r.sourceLog?.[0].status).toBe('ok');
  });

  it('HTTP 504 then retry success (bounded backoff)', async () => {
    const fetchImpl = makeFetch({
      'overpass-de': [{ status: 504 }, { status: 200, elements: [el(1, 'A', 'https://a.example'), el(2, 'B', 'https://b.example'), el(3, 'C', 'https://c.example'), el(4, 'D', 'https://d.example'), el(5, 'E', 'https://e.example'), el(6, 'F', 'https://f.example')] }],
    });
    const r = await discoverRealProspects(makeConfig(), fetchImpl as any);
    expect(r.prospects.length).toBe(6);
    expect(r.stopReason).toBe('TARGET_REACHED');
    expect(r.sourceLog?.map((s) => `${s.source}/${s.attempt}/${s.status}`)).toEqual(['overpass-de/1/transient_failure', 'overpass-de/2/ok']);
  });

  it('retry budget exhausted → SOURCE_EXHAUSTED with classified failures', async () => {
    const fetchImpl = makeFetch({
      'overpass-de': [{ status: 504 }, { status: 504 }, { status: 504 }],
      'overpass-kumi': [{ status: 503 }, { status: 503 }, { status: 503 }],
      'overpass-ch': [{ status: 504 }, { status: 504 }, { status: 504 }],
    });
    const r = await discoverRealProspects(makeConfig({ discoveryMaxAttemptsPerSource: 3, discoveryMaxTotalAttempts: 6, discoveryBackoffBaseMs: 1 }), fetchImpl as any);
    expect(r.prospects).toEqual([]);
    expect(r.stopReason).toBe('SOURCE_EXHAUSTED');
    expect(r.blocker).toContain('Stop reason: SOURCE_EXHAUSTED');
    expect(r.blocker).toContain('overpass-de attempt 1 → transient_failure (HTTP 504)');
    expect(r.sourceLog?.length).toBe(6);
  });

  it('fallback source used when the primary exhausts', async () => {
    const fetchImpl = makeFetch({
      'overpass-de': [{ status: 504 }, { status: 504 }, { status: 504 }],
      'overpass-kumi': [{ status: 200, elements: [el(1, 'A', 'https://a.example'), el(2, 'B', 'https://b.example'), el(3, 'C', 'https://c.example'), el(4, 'D', 'https://d.example'), el(5, 'E', 'https://e.example'), el(6, 'F', 'https://f.example')] }],
    });
    const r = await discoverRealProspects(makeConfig({ discoveryBackoffBaseMs: 1 }), fetchImpl as any);
    expect(r.prospects.length).toBe(6);
    expect(r.stopReason).toBe('TARGET_REACHED');
    const tried = r.sourceLog?.map((s) => s.source).join(',');
    expect(tried).toContain('overpass-de');
    expect(tried).toContain('overpass-kumi');
    expect(r.sourceLog?.find((s) => s.source === 'overpass-kumi')?.status).toBe('ok');
  });

  it('duplicates across sources are merged + corroborated, never returned twice', async () => {
    const fetchImpl = makeFetch({
      'overpass-de': [{ status: 200, elements: [el(1, 'A', 'https://a.example'), el(2, 'B', 'https://b.example'), el(3, 'C', 'https://c.example')] }],
      'overpass-kumi': [{ status: 200, elements: [el(2, 'B', 'https://b.example'), el(3, 'C', 'https://c.example'), el(4, 'D', 'https://d.example')] }],
    });
    const r = await discoverRealProspects(makeConfig({ discoveryMaxTotalAttempts: 6 }), fetchImpl as any);
    const names = r.prospects.map((p) => p.businessName).sort();
    expect(names).toEqual(['A', 'B', 'C', 'D']);
    expect(new Set(names).size).toBe(names.length);
    const b = r.prospects.find((p) => p.businessName === 'B');
    expect(b?.discoverySourceRecord?.corroboratedBy).toContain('overpass-kumi');
    const d = r.prospects.find((p) => p.businessName === 'D');
    expect(d?.discoverySourceRecord?.corroboratedBy || []).not.toContain('overpass-kumi');
  });

  it('partial result after source exhaustion (some candidates, budget used)', async () => {
    const fetchImpl = makeFetch({
      'overpass-de': [{ status: 504 }, { status: 504 }, { status: 504 }],
      'overpass-kumi': [{ status: 200, elements: [el(1, 'A', 'https://a.example'), el(2, 'B', 'https://b.example'), el(3, 'C', 'https://c.example')] }],
      'overpass-ch': [{ status: 500 }, { status: 500 }, { status: 500 }],
    });
    const r = await discoverRealProspects(makeConfig({ discoveryMaxTotalAttempts: 7, discoveryBackoffBaseMs: 1 }), fetchImpl as any);
    expect(r.prospects.length).toBe(3);
    expect(r.stopReason).toBe('SOURCE_EXHAUSTED');
    expect(r.blocker).toBeNull(); // candidates found → success path
  });

  it('never fabricates leads: elements without name/website are skipped', async () => {
    const fetchImpl = makeFetch({
      'overpass-de': [{ status: 200, elements: [el(1, 'A', 'https://a.example'), { type: 'node', id: 2, tags: { name: 'NoSite' } }, { type: 'node', id: 3, tags: { website: 'https://noname.example' } }, el(4, 'D', 'https://d.example'), el(5, 'E', 'https://e.example'), el(6, 'F', 'https://f.example')] }],
    });
    const r = await discoverRealProspects(makeConfig(), fetchImpl as any);
    expect(r.prospects.map((p) => p.businessName).sort()).toEqual(['A', 'D', 'E', 'F']);
    expect(r.prospects.some((p) => p.businessName === 'NoSite')).toBe(false);
  });

  it('rate limit (429) is classified RATE_LIMITED and retried with backoff', async () => {
    const fetchImpl = makeFetch({
      'overpass-de': [{ status: 429 }, { status: 200, elements: [el(1, 'A', 'https://a.example'), el(2, 'B', 'https://b.example'), el(3, 'C', 'https://c.example'), el(4, 'D', 'https://d.example'), el(5, 'E', 'https://e.example'), el(6, 'F', 'https://f.example')] }],
    });
    const r = await discoverRealProspects(makeConfig(), fetchImpl as any);
    expect(r.prospects.length).toBe(6);
    expect(r.sourceLog?.[0].status).toBe('rate_limited');
    expect(r.sourceLog?.[0].error).toContain('429');
    expect(r.sourceLog?.[1].status).toBe('ok');
  });

  it('progress events report source + attempt + discovered counts', async () => {
    const events: Array<Record<string, unknown>> = [];
    const fetchImpl = makeFetch({
      'overpass-de': [{ status: 504 }, { status: 200, elements: [el(1, 'A', 'https://a.example'), el(2, 'B', 'https://b.example'), el(3, 'C', 'https://c.example'), el(4, 'D', 'https://d.example'), el(5, 'E', 'https://e.example'), el(6, 'F', 'https://f.example')] }],
    });
    await discoverRealProspects(makeConfig(), fetchImpl as any, (p) => events.push({ ...p }));
    expect(events.length).toBeGreaterThanOrEqual(2);
    const retry = events.find((e) => e.error);
    expect(retry).toBeTruthy();
    expect(retry?.source).toBe('overpass-de');
    expect(retry?.attempt).toBe(1);
    const ok = events[events.length - 1];
    expect(ok?.source).toBe('overpass-de');
    expect(ok?.discovered).toBe(6);
  });
});
