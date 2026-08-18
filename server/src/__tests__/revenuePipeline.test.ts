/**
 * Focused tests — Local Business Revenue Pipeline V1.
 *
 * Covers: intake parsing, prospect record validation, audit evidence labels,
 * scoring, board linkage, background execution, approval before outreach,
 * no fabricated claims, no duplicate prospects/cards, build artifact
 * verification, cost-limit enforcement, stale-event rejection, dry-run safety.
 *
 * Isolation recipe (same as backgroundTaskManager.test.ts): temp DB path +
 * vi.resetModules() + dynamic imports.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'node:path';
import os from 'node:os';

// This host is slow to boot the manager/gateway module chain inside
// freshModules(); give hooks headroom so environment slowness never reads as
// a test failure.
vi.setConfig({ hookTimeout: 60000, testTimeout: 30000 });

let tmpDir: string;
let wsDir: string;
let intakeMod: any;
let discoveryMod: any;
let auditMod: any;
let scoringMod: any;
let storeMod: any;
let verifyMod: any;
let costMod: any;
let pipelineMod: any;
let mgr: any;
let repo: any;

const ACCEPTANCE_PROMPT =
  'Find three roofing businesses in Berlin with weak websites. Audit them, rank the opportunities, and prepare a staged rebuild concept and proposal for the strongest candidate. Do not contact anyone and do not publish anything.';

async function freshModules() {
  vi.resetModules();
  intakeMod = await import('../services/revenuePipeline/intake.js');
  discoveryMod = await import('../services/revenuePipeline/discovery.js');
  auditMod = await import('../services/revenuePipeline/audit.js');
  scoringMod = await import('../services/revenuePipeline/scoring.js');
  storeMod = await import('../services/revenuePipeline/store.js');
  verifyMod = await import('../services/revenuePipeline/verify.js');
  costMod = await import('../services/revenuePipeline/cost.js');
  pipelineMod = await import('../services/revenuePipeline/pipelineService.js');
  const managerMod = await import('../services/backgroundTasks/manager.js');
  mgr = managerMod.backgroundTaskManager;
  repo = (await import('../services/backgroundTasks/store.js')).backgroundTaskRepo;
}

async function waitFor(fn: () => boolean, timeoutMs = 15000, stepMs = 50): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

function baseConfig(overrides: Record<string, unknown> = {}) {
  return {
    niche: 'roofing',
    city: 'Berlin',
    serviceKeywords: [],
    prospectCount: 3,
    specificUrl: null,
    maxResearchBudgetUsd: null,
    dryRun: true,
    fixturesOnly: true,
    runBuild: false,
    useCodex: false,
    useLlm: false,
    rawRequest: ACCEPTANCE_PROMPT,
    workspacePath: wsDir,
    ...overrides,
  };
}

function fakeHooks(approval: 'allow' | 'deny' = 'allow') {
  const calls: string[] = [];
  return {
    calls,
    transition: (status: string, patch: Record<string, unknown> = {}) => {
      calls.push(`transition:${status}`);
    },
    progress: (kind: string, summary: string) => {
      calls.push(`progress:${summary}`);
    },
    requestApprovalAndWait: async (request: { action: string }) => {
      calls.push(`approval:${request.action}`);
      return approval;
    },
    verifyCompletion: (evidence: { resultText: string }) => {
      calls.push(`verify:${evidence.resultText.slice(0, 40)}`);
      return { status: 'completed', blocker: null };
    },
    setFilesChanged: () => {},
    getTask: () => ({ buildState: 'idle', testState: 'idle' }),
    isStopRequested: () => false,
  };
}

describe('Revenue Pipeline — intake', () => {
  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-intake-'));
    process.env.AGENT_TEAMS_DB_PATH = path.join(tmpDir, 'test.db');
    await freshModules();
  });
  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('parses the acceptance phrase (roofing · Berlin · 3 · dry-run)', () => {
    const r = intakeMod.parsePipelineRequest(ACCEPTANCE_PROMPT);
    expect(r.missing).toEqual([]);
    expect(r.config.niche).toBe('roofing');
    expect(r.config.city).toBe('Berlin');
    expect(r.config.prospectCount).toBe(3);
    expect(r.config.dryRun).toBe(true);
    expect(r.config.specificUrl).toBeNull();
  });

  it('parses the EXACT real prompt (multiline: roofers · Berlin · 5 · dry-run)', () => {
    const realPrompt = [
      'Run a real Local Business Revenue Pipeline for roofers in Berlin.',
      'Find 5 legitimate roofing businesses with weak websites, audit them, rank the opportunities, and prepare a staged rebuild concept and proposal for the strongest candidate.',
      'Do not contact anyone, do not publish anything, and do not spend any money.',
    ].join('\n');
    const r = intakeMod.parsePipelineRequest(realPrompt);
    expect(r.missing).toEqual([]);
    // niche may be the find-form noun or the for-form noun — both are the real niche.
    expect(['roofing', 'roofers']).toContain(r.config.niche);
    expect(r.config.city).toBe('Berlin');
    expect(r.config.prospectCount).toBe(5);
    expect(r.config.dryRun).toBe(true);
    // The reply message must NOT say "run a real local" or default count 3.
    expect(r.config.niche).not.toContain('run');
    expect(r.config.prospectCount).not.toBe(3);
  });

  it('parses numbered-list + lowercase variants', () => {
    const r = intakeMod.parsePipelineRequest('1. Find 5 roofing companies in munich\n2. audit them\n3. do not contact anyone');
    expect(r.missing).toEqual([]);
    expect(r.config.niche).toBe('roofing');
    expect(r.config.city).toBe('Munich');
    expect(r.config.prospectCount).toBe(5);
    expect(r.config.dryRun).toBe(true);
  });

  it('parses singular/plural niche forms ("a plumber in Hamburg")', () => {
    const r = intakeMod.parsePipelineRequest('Find 3 plumbers in Hamburg and prepare proposals. Do not contact anyone.');
    expect(r.missing).toEqual([]);
    expect(r.config.niche).toBe('plumbers');
    expect(r.config.city).toBe('Hamburg');
    expect(r.config.prospectCount).toBe(3);
  });

  it('parses explicit markers (niche/city/budget/count/URL/dry-run)', () => {
    const text = 'niche: plumbing, city: Munich, budget: $10, count: 5, dry-run, https://example.com/plumbing';
    const r = intakeMod.parsePipelineRequest(text);
    expect(r.missing).toEqual([]);
    expect(r.config.niche).toBe('plumbing');
    expect(r.config.city).toBe('Munich');
    expect(r.config.maxResearchBudgetUsd).toBe(10);
    expect(r.config.prospectCount).toBe(5);
    expect(r.config.dryRun).toBe(true);
    expect(r.config.specificUrl).toBe('https://example.com/plumbing');
  });

  it('asks for missing fields instead of inventing defaults', () => {
    // No count anywhere.
    const r1 = intakeMod.parsePipelineRequest('Find roofing businesses in Berlin');
    expect(r1.missing).toContain('prospectCount');
    // No niche.
    const r2 = intakeMod.parsePipelineRequest('Find 5 businesses in Berlin');
    expect(r2.missing).toContain('niche');
    // No city.
    const r3 = intakeMod.parsePipelineRequest('Find 5 roofing businesses');
    expect(r3.missing).toContain('city');
  });

  it('defaults to dry-run true and honours explicit live mode', () => {
    const r = intakeMod.parsePipelineRequest('Find 5 roofing businesses in Berlin');
    expect(r.config.dryRun).toBe(true);
    const live = intakeMod.parsePipelineRequest('Find five roofing businesses in Berlin. Live mode. Do contact them.');
    expect(live.config.dryRun).toBe(false);
    expect(live.config.prospectCount).toBe(5);
  });
});

describe('Revenue Pipeline — prospect records', () => {
  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-prospect-'));
    process.env.AGENT_TEAMS_DB_PATH = path.join(tmpDir, 'test.db');
    await freshModules();
  });
  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('discovers labelled fixture prospects with the canonical record shape', async () => {
    const cfg = baseConfig();
    const { prospects, blocker } = await discoveryMod.discoverProspects(cfg);
    expect(blocker).toBeNull();
    // Discovery headroom (contact-quality milestone): requested 3 → up to 6
    // candidates so qualification rejections can be replaced.
    expect(prospects.length).toBe(6);
    for (const p of prospects) {
      expect(p.prospectId).toBeTruthy();
      expect(p.businessName).toBeTruthy();
      expect(p.websiteUrl).toMatch(/\.example$/);
      expect(p.fixture).toBe(true);
      expect(p.discoverySource).toBe('fixture');
      expect(Array.isArray(p.verifiedFacts)).toBe(true);
      expect(Array.isArray(p.unverifiedObservations)).toBe(true);
      expect(p.verifiedFacts.every((f: string) => f.startsWith('FIXTURE SAMPLE:'))).toBe(true);
      expect(p.status).toBe('discovered');
      expect(p.auditScore).toBeNull();
      expect(p.opportunityScore).toBeNull();
    }
  });

  it('refuses live discovery in fixture mode (no fabrication)', async () => {
    const cfg = baseConfig({ dryRun: false });
    const { prospects, blocker } = await discoveryMod.discoverProspects(cfg);
    expect(prospects).toEqual([]);
    expect(blocker).toContain('not allowed in live mode');
  });

  it('accepts a user-provided URL as a single non-fixture prospect', async () => {
    const cfg = baseConfig({ dryRun: false, specificUrl: 'https://www.dachfirma.example' });
    const { prospects } = await discoveryMod.discoverProspects(cfg);
    expect(prospects.length).toBe(1);
    expect(prospects[0].fixture).toBe(false);
    expect(prospects[0].discoverySource).toBe('user-url');
  });

  it('never creates duplicate prospects for the same website URL', async () => {
    const cfg = baseConfig();
    const { prospects } = await discoveryMod.discoverProspects(cfg);
    const first = storeMod.revenuePipelineRepo.upsertProspect(prospects[0]);
    const second = storeMod.revenuePipelineRepo.upsertProspect({ ...prospects[0], prospectId: 'pp-other' });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.prospect.prospectId).toBe(first.prospect.prospectId);
    expect(storeMod.revenuePipelineRepo.findProspectByWebsite(prospects[0].websiteUrl)?.prospectId).toBe(first.prospect.prospectId);
  });
});

describe('Revenue Pipeline — real discovery (OpenStreetMap Overpass)', () => {
  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-real-'));
    process.env.AGENT_TEAMS_DB_PATH = path.join(tmpDir, 'test.db');
    await freshModules();
  });
  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  // Routes by URL: Nominatim → a Berlin bounding box; Overpass → elements.
  const routedFetch = (elements: any[]) => async (url: string) => {
    if (url.includes('nominatim')) {
      return { ok: true, status: 200, json: async () => [{ boundingbox: ['52.34', '52.68', '13.09', '13.76'], name: 'Berlin' }] };
    }
    return { ok: true, status: 200, json: async () => ({ elements }) };
  };

  const SAMPLE_ELEMENTS = [
    {
      type: 'node', id: 1001, lat: 52.4, lon: 13.3,
      tags: { craft: 'roofer', name: 'Dachdeckerei Beispiel GmbH', website: 'https://www.dachdeckerei-beispiel.de', 'addr:city': 'Berlin', 'addr:street': 'Hauptstraße', 'addr:housenumber': '7', 'addr:postcode': '10115' },
    },
    {
      type: 'node', id: 1002, lat: 52.5, lon: 13.4,
      tags: { craft: 'roofer', name: 'Zweitdach GmbH', website: 'http://zweitdach.de/', 'addr:city': 'Berlin', 'addr:street': 'Nebenweg', 'addr:housenumber': '3' },
    },
    {
      type: 'node', id: 1003, lat: 52.6, lon: 13.5,
      tags: { craft: 'roofer', name: 'No Site Betrieb', phone: '+49 30 1234567' },
    },
  ];

  it('builds a valid Overpass tag clause (key="value", not key=value inside quotes)', async () => {
    const { buildOverpassQuery } = await import('../services/revenuePipeline/realDiscovery.js');
    const q = buildOverpassQuery('roofing', { south: 52.34, north: 52.68, west: 13.09, east: 13.76 });
    expect(q).toContain('["craft"="roofer"]["website"]');
    expect(q).not.toContain('["craft=roofer"]');
    expect(q).toContain('(52.34,13.09,52.68,13.76)');
    expect(q).toContain(';);out center 50;');
  });

  it('parses Overpass elements into real prospects with the discovery source contract', async () => {
    const cfg = baseConfig({ fixturesOnly: false });
    const { prospects, blocker } = await discoveryMod.discoverProspects(cfg, routedFetch(SAMPLE_ELEMENTS.slice(0, 1)) as any);
    expect(blocker).toBeNull();
    expect(prospects).toHaveLength(1);
    const p = prospects[0];
    expect(p.fixture).toBe(false);
    expect(p.discoverySource).toBe('osm-overpass');
    expect(p.businessName).toBe('Dachdeckerei Beispiel GmbH');
    expect(p.websiteUrl).toBe('https://www.dachdeckerei-beispiel.de');
    expect(p.city).toBe('Berlin');
    expect(p.discoverySourceRecord).toBeTruthy();
    expect(p.discoverySourceRecord!.sourceType).toBe('osm-overpass');
    expect(p.discoverySourceRecord!.sourceUrl).toContain('openstreetmap.org/node/1001');
    expect(p.discoverySourceRecord!.retrievedAt).toBeTruthy();
    expect(p.discoverySourceRecord!.evidence).toContain('Dachdeckerei Beispiel GmbH');
    expect(p.discoverySourceRecord!.evidence).toContain('website tag');
    expect(p.discoverySourceRecord!.confidence).toBe('high');
    expect(p.websiteUrl).not.toMatch(/\.example/);
  });

  it('dedupes by canonical domain and limits to prospectCount', async () => {
    const dup = { ...SAMPLE_ELEMENTS[1], tags: { ...SAMPLE_ELEMENTS[1].tags, website: 'https://www.zweitdach.de' } };
    const cfg = baseConfig({ fixturesOnly: false, prospectCount: 2 });
    const { prospects } = await discoveryMod.discoverProspects(cfg, routedFetch([SAMPLE_ELEMENTS[0], SAMPLE_ELEMENTS[1], dup]) as any);
    expect(prospects).toHaveLength(2);
    expect(new Set(prospects.map((p) => p.businessName)).size).toBe(2);
  });

  it('returns the truthful number found when fewer than requested (no padding)', async () => {
    const cfg = baseConfig({ fixturesOnly: false, prospectCount: 5 });
    const third = { ...SAMPLE_ELEMENTS[2], tags: { ...SAMPLE_ELEMENTS[2].tags, website: 'https://drittes-dach.de', name: 'Drittes Dach GmbH' } };
    const { prospects } = await discoveryMod.discoverProspects(cfg, routedFetch([SAMPLE_ELEMENTS[0], SAMPLE_ELEMENTS[1], third]) as any);
    expect(prospects).toHaveLength(3); // never padded to 5
    expect(prospects.every((p) => p.businessName)).toBe(true);
  });

  it('skips elements without a name or a usable website', async () => {
    const cfg = baseConfig({ fixturesOnly: false });
    const { prospects } = await discoveryMod.discoverProspects(cfg, routedFetch(SAMPLE_ELEMENTS) as any);
    expect(prospects).toHaveLength(2); // 1003 has no website tag
    expect(prospects.every((p) => p.websiteUrl.startsWith('http'))).toBe(true);
  });

  it('blocks truthfully when the source fails (no fabricated prospects)', async () => {
    const cfg = baseConfig({ fixturesOnly: false });
    const failing = async () => { throw new Error('ECONNREFUSED'); };
    const { prospects, blocker } = await discoveryMod.discoverProspects(cfg, failing as any);
    expect(prospects).toEqual([]);
    expect(blocker).toContain('No candidates were invented');
  });

  it('uses real discovery in live mode (read-only, no fixtures)', async () => {
    const cfg = baseConfig({ dryRun: false, fixturesOnly: false });
    const { prospects, blocker } = await discoveryMod.discoverProspects(cfg, routedFetch(SAMPLE_ELEMENTS.slice(0, 2)) as any);
    expect(blocker).toBeNull();
    expect(prospects).toHaveLength(2);
    expect(prospects.every((p) => p.fixture === false)).toBe(true);
  });
});

describe('Revenue Pipeline — audit evidence labels', () => {
  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-audit-'));
    process.env.AGENT_TEAMS_DB_PATH = path.join(tmpDir, 'test.db');
    await freshModules();
  });
  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('labels every finding verified | inferred | unavailable with category + severity', async () => {
    const fx = (await import('../services/revenuePipeline/fixtures.js')).SAMPLE_FIXTURES[0];
    const findings = auditMod.auditWebsite({ html: fx.snapshotHtml, fixture: true, sitemapUrl: null });
    expect(findings.length).toBeGreaterThanOrEqual(10);
    for (const f of findings) {
      expect(['verified', 'inferred', 'unavailable']).toContain(f.label);
      expect(f.category).toBeTruthy();
      expect(['positive', 'neutral', 'weakness']).toContain(f.severity);
      expect(f.summary).toContain('FIXTURE SAMPLE:');
    }
    // The weak Dachfix fixture must expose real, verifiable weaknesses.
    expect(findings.some((f: any) => f.category === 'title_meta' && f.severity === 'weakness')).toBe(true);
    expect(findings.some((f: any) => f.category === 'broken_placeholder' && f.severity === 'weakness')).toBe(true);
    expect(findings.some((f: any) => f.category === 'stale_unrelated' && f.severity === 'weakness')).toBe(true);
  });

  it('reports unavailable when the page cannot be inspected', () => {
    const findings = auditMod.auditWebsite({ html: '', fixture: false, sitemapUrl: null, fetchFailedReason: 'HTTP 403' });
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((f: any) => f.label === 'unavailable')).toBe(true);
  });

  it('separates verified facts from inferred observations', async () => {
    const fx = (await import('../services/revenuePipeline/fixtures.js')).SAMPLE_FIXTURES[1];
    const findings = auditMod.auditWebsite({ html: fx.snapshotHtml, fixture: true, sitemapUrl: 'https://example/sitemap.xml' });
    const prospect: any = { verifiedFacts: [...fx.verifiedFacts], unverifiedObservations: [...fx.unverifiedObservations] };
    auditMod.findingsToFacts(prospect, findings);
    expect(prospect.auditFindings).toBe(findings);
    // Audit appended NEW fixture-labelled verified facts beyond the fixture's own.
    expect(prospect.verifiedFacts.length).toBeGreaterThan(fx.verifiedFacts.length);
    // Audit-derived facts are still fixture-labelled (dry-run safety).
    expect(prospect.verifiedFacts.every((f: string) => f.startsWith('FIXTURE SAMPLE:'))).toBe(true);
    expect(prospect.unverifiedObservations.length).toBeGreaterThanOrEqual(fx.unverifiedObservations.length);
    const score = auditMod.computeAuditScore(findings);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

describe('Revenue Pipeline — scoring', () => {
  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-score-'));
    process.env.AGENT_TEAMS_DB_PATH = path.join(tmpDir, 'test.db');
    await freshModules();
  });
  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('scores with all seven transparent criteria and evidence reasons', async () => {
    const fx = (await import('../services/revenuePipeline/fixtures.js')).SAMPLE_FIXTURES[0];
    const findings = auditMod.auditWebsite({ html: fx.snapshotHtml, fixture: true, sitemapUrl: null });
    const prospect: any = {
      prospectId: 'pp-test',
      businessName: fx.businessName,
      niche: fx.niche,
      city: fx.city,
      websiteUrl: fx.websiteUrl,
      fixture: true,
      verifiedFacts: [...fx.verifiedFacts],
      unverifiedObservations: [...fx.unverifiedObservations],
      auditFindings: findings,
      auditScore: auditMod.computeAuditScore(findings),
    };
    const r = scoringMod.scoreProspect(prospect);
    expect(Object.keys(r.criteria).sort()).toEqual([
      'abilityToDemonstrateImprovement',
      'businessLegitimacyEvidence',
      'factualConfidence',
      'implementationComplexity',
      'likelyValueOfRebuild',
      'recurringServicePotential',
      'visibleWebsiteWeakness',
    ]);
    for (const [k, v] of Object.entries(r.criteria)) {
      expect(v.score).toBeGreaterThanOrEqual(0);
      expect(v.score).toBeLessThanOrEqual(100);
      expect(v.reason.length).toBeGreaterThan(0);
      expect(scoringMod.SCORING_WEIGHTS[k]).toBeDefined();
    }
    expect(r.overall).toBeGreaterThanOrEqual(0);
    expect(r.overall).toBeLessThanOrEqual(100);
    expect(r.reasons.length).toBeGreaterThan(0);
    expect(['low', 'medium', 'high']).toContain(r.confidence);
  });

  it('ranks prospects by score descending', () => {
    const mk = (id: string, score: number) => ({ prospectId: id, opportunityScore: score });
    const ranked = scoringMod.rankProspects([mk('a', 40), mk('b', 80), mk('c', 55)] as any);
    expect(ranked.map((p: any) => p.prospectId)).toEqual(['b', 'c', 'a']);
  });
});

describe('Revenue Pipeline — end-to-end (fake hooks, no build)', () => {
  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-e2e-'));
    wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-ws-'));
    process.env.AGENT_TEAMS_DB_PATH = path.join(tmpDir, 'test.db');
    await freshModules();
  });
  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    try { fs.rmSync(wsDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('runs the full pipeline to completion and produces the proposal package', async () => {
    const runId = pipelineMod.newRunId();
    const hooks = fakeHooks('allow');
    const result = await pipelineMod.runRevenuePipeline({ runId, taskId: 'bgtask-test', config: baseConfig(), hooks });

    expect(result.status, `pipeline failed: ${result.error || result.blocker}`).toBe('completed');
    expect(hooks.calls.some((c) => c.includes('approval:Approve outreach'))).toBe(true);

    const run = storeMod.revenuePipelineRepo.getRun(runId);
    expect(run).not.toBeNull();
    expect(run.status).toBe('completed');
    expect(run.selectedProspectId).toBeTruthy();
    expect(run.outreachApproved).toBe(true);
    expect(run.buildState).toBe('skipped');
    expect(run.verificationState).toBe('passed');
    expect(run.prospects.length).toBe(6);
    expect(run.proposalDirPath).toBeTruthy();
    expect(run.runSummaryPath).toBeTruthy();
    expect(run.costLedger).toEqual([]);

    const dir = path.join(wsDir, runId);
    for (const f of ['opportunity_summary.md', 'audit_report.md', 'audit_report.json', 'rebuild_blueprint.md', 'asset_checklist.md', 'proposal_offer.md', 'verified_facts.json', 'run_summary.json']) {
      expect(fs.existsSync(path.join(dir, f))).toBe(true);
    }
    // Site concept scaffold present (build skipped).
    expect(fs.existsSync(path.join(dir, 'site_concept', 'index.html'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'site_concept', 'src', 'App.tsx'))).toBe(true);

    const summary = JSON.parse(fs.readFileSync(path.join(dir, 'run_summary.json'), 'utf8'));
    expect(summary.status).toBe('completed');
    expect(summary.safety.noOutreachPerformed).toBe(true);
    expect(summary.safety.noPublishPerformed).toBe(true);
    expect(summary.selectedProspect.fixture).toBe(true);
  });

  it('enters approval-required state before any outreach and deny blocks', async () => {
    const runId = pipelineMod.newRunId();
    const hooks = fakeHooks('deny');
    const result = await pipelineMod.runRevenuePipeline({ runId, taskId: 'bgtask-test2', config: baseConfig(), hooks });
    expect(result.status).toBe('blocked');
    expect(result.blocker).toContain('denied');
    const run = storeMod.revenuePipelineRepo.getRun(runId);
    expect(run.outreachApproved).toBe(false);
    // The package was still generated locally, but nothing was sent.
    expect(fs.existsSync(path.join(wsDir, runId, 'proposal_offer.md'))).toBe(true);
  });

  it('CodeX suitability gate: local (ollama) assignment → approval, deny skips CodeX truthfully', async () => {
    const runId = pipelineMod.newRunId();
    const approvals: string[] = [];
    const hooks = {
      ...fakeHooks('allow'),
      requestApprovalAndWait: async (request: { action: string }) => {
        approvals.push(request.action);
        // Deny ONLY the suitability gate; allow the outreach approval so the
        // run reaches completion.
        return request.action.includes('suitability') ? 'deny' : 'allow';
      },
    };
    const result = await pipelineMod.runRevenuePipeline({
      runId,
      taskId: 'bgtask-codex-gate',
      config: baseConfig({ useCodex: true, runBuild: false }),
      hooks,
      deps: { resolveCodexAssignment: async () => ({ providerId: 'prov-ollama', modelId: 'qwen3.5:4b' }) },
    });
    expect(result.status).toBe('completed');
    // The suitability approval was requested (local model marked unsuitable).
    expect(approvals.some((a) => a.includes('suitability'))).toBe(true);
    // Deny → CodeX skipped truthfully; the run still completed with the
    // deterministic scaffold as evidence.
    const run = storeMod.revenuePipelineRepo.getRun(runId);
    expect(run.status).toBe('completed');
    expect(run.proposalDirPath).toBeTruthy();
  });

  it('cost-limit enforcement stops the run when budget is exceeded', async () => {
    const runId = pipelineMod.newRunId();
    // Pre-seed an over-budget ledger (simulating gateway usage).
    storeMod.revenuePipelineRepo.insertRun({
      runId,
      taskId: 'bgtask-test3',
      config: baseConfig({ useLlm: true, maxResearchBudgetUsd: 0.01 }),
      status: 'queued',
      currentStage: 'DISCOVERING PROSPECTS',
      prospects: [],
      selectedProspectId: null,
      auditReportPath: null,
      blueprintPath: null,
      conceptPath: null,
      proposalDirPath: null,
      runSummaryPath: null,
      buildState: 'idle',
      testState: 'idle',
      verificationState: 'pending',
      approvalState: 'none',
      costLedger: [{ provider: 'ollama', model: 'qwen3.5:4b', requestCount: 3, costUsd: 0.5, elapsedMs: 100, failures: 0, fallbacks: 0, note: 'simulated' }],
      totalElapsedMs: 0,
      blocker: null,
      lastError: null,
      outreachApproved: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
    });
    const hooks = fakeHooks('deny');
    const result = await pipelineMod.runRevenuePipeline({ runId, taskId: 'bgtask-test3', config: baseConfig({ useLlm: true, maxResearchBudgetUsd: 0.01 }), hooks });
    expect(result.status).toBe('blocked');
    expect(result.blocker).toContain('Budget');
  });
});

describe('Revenue Pipeline — verification (no fabrication)', () => {
  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-verify-'));
    wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-vws-'));
    process.env.AGENT_TEAMS_DB_PATH = path.join(tmpDir, 'test.db');
    await freshModules();
  });
  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    try { fs.rmSync(wsDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  async function makeRunWithPackage(overrides: Record<string, unknown> = {}): Promise<{ run: any; dir: string }> {
    const runId = pipelineMod.newRunId();
    const hooks = fakeHooks('allow');
    await pipelineMod.runRevenuePipeline({ runId, taskId: 'bgtask-v', config: baseConfig(), hooks });
    const run = storeMod.revenuePipelineRepo.getRun(runId);
    const dir = path.join(wsDir, runId);
    if (overrides.buildState) {
      fs.writeFileSync(path.join(dir, 'build.log'), 'BUILD OK\n', 'utf8');
      fs.writeFileSync(path.join(dir, 'test.log'), 'VERIFY OK (10 checks)\n', 'utf8');
    }
    return { run: { ...run, ...overrides }, dir };
  }

  it('verifies a clean package (build evidence included)', async () => {
    const { run } = await makeRunWithPackage({ buildState: 'passed', testState: 'passed' });
    const v = verifyMod.verifyPipelineArtifacts(run);
    expect(v.ok).toBe(true);
    expect(v.checks.length).toBeGreaterThan(8);
    expect(v.blocker).toBeNull();
  });

  it('rejects fabricated business claims in verified facts', async () => {
    const { run, dir } = await makeRunWithPackage({ buildState: 'passed', testState: 'passed' });
    const vfPath = path.join(dir, 'verified_facts.json');
    const vf = JSON.parse(fs.readFileSync(vfPath, 'utf8'));
    vf.verifiedFacts.push('Monthly revenue is EUR 5,000');
    fs.writeFileSync(vfPath, JSON.stringify(vf, null, 2), 'utf8');
    const v = verifyMod.verifyPipelineArtifacts(run);
    expect(v.ok).toBe(false);
    const fabricated = v.checks.find((c: any) => c.name === 'no fabricated claims');
    expect(fabricated.passed).toBe(false);
  });

  it('fails when build evidence is missing', async () => {
    const { run } = await makeRunWithPackage({ buildState: 'passed', testState: 'passed' });
    // Remove the build log after the run claims it passed.
    const dir = path.join(wsDir, run.runId);
    fs.unlinkSync(path.join(dir, 'build.log'));
    const v = verifyMod.verifyPipelineArtifacts(run);
    expect(v.ok).toBe(false);
    expect(v.checks.find((c: any) => c.name === 'build evidence').passed).toBe(false);
  });
});

describe('Revenue Pipeline — background task integration', () => {
  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-bg-'));
    wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-bgws-'));
    process.env.AGENT_TEAMS_DB_PATH = path.join(tmpDir, 'test.db');
    await freshModules();
  });
  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    try { fs.rmSync(wsDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('creates one task + one Board card, waits for approval, completes after allow', async () => {
    const { task } = mgr.createTask({
      title: 'Revenue pipeline — roofing · Berlin',
      objective: ACCEPTANCE_PROMPT,
      originalRequest: ACCEPTANCE_PROMPT,
      route: 'revenue_pipeline',
      selectedAgent: 'Revenue Pipeline',
      worker: 'revenue',
      conversationId: 'conv-rp',
      resumable: false,
      metadata: { runBuild: false, workspacePath: wsDir },
    });
    expect(task).toBeTruthy();
    expect(task.worker).toBe('revenue');

    // Board linkage is async fire-and-forget — await a microtask, then reload
    // (createTask does not mutate the returned object in place).
    await new Promise((r) => setTimeout(r, 50));
    const created = repo.getTask(task.taskId);
    expect(created.linkedBoardCardId).toBeTruthy();
    const boardCardId = created.linkedBoardCardId;

    // Wire the pipeline like the adapter (approval gate + manager hooks).
    const gates: Array<(c: 'allow' | 'deny') => void> = [];
    const hooks = {
      transition: (status: string, patch: Record<string, unknown> = {}) => {
        mgr.transition(task.taskId, status as any, patch as any);
      },
      progress: (kind: string, summary: string, patch: Record<string, unknown> = {}) => {
        mgr.progress(task.taskId, kind as any, summary, patch as any);
      },
      requestApprovalAndWait: (request: { action: string; reason: string }) => {
        mgr.requestApproval(task.taskId, request);
        return new Promise<'allow' | 'deny'>((resolve) => gates.push(resolve));
      },
      verifyCompletion: (evidence: any) => {
        const updated = mgr.verifyCompletion(task.taskId, evidence);
        return updated ? { status: updated.status, blocker: updated.blocker } : null;
      },
      setFilesChanged: () => {},
      getTask: () => ({ buildState: 'idle', testState: 'idle' }),
      isStopRequested: () => false,
    };
    mgr.registerApprovalResolver(task.taskId, async (choice) => {
      const gate = gates.shift();
      if (gate) gate(choice);
    });

    const runId = pipelineMod.newRunId();
    mgr.appendEvent(task.taskId, 'task.run_linked', `Revenue pipeline run linked (${runId}).`, { runId });
    const p = pipelineMod.runRevenuePipeline({ runId, taskId: task.taskId, config: baseConfig({ runBuild: false, workspacePath: wsDir }), hooks });

    // Stage 11 — approval required before outreach.
    await waitFor(() => repo.getTask(task.taskId)?.status === 'waiting_approval');
    const pending = mgr.getPendingApproval(task.taskId);
    expect(pending).toBeTruthy();
    expect(pending.action).toContain('outreach');
    // Human approves (same path as the modal → /approval endpoint).
    const resolved = await mgr.resolveApproval(task.taskId, 'allow', async () => {});
    expect(resolved.ok).toBe(true);

    const result = await p;
    expect(result.status, `completion refused: ${result.blocker || result.error}`).toBe('completed');
    await waitFor(() => repo.getTask(task.taskId)?.status === 'completed');
    const finalTask = repo.getTask(task.taskId);
    expect(finalTask.verificationState).toBe('passed');
    expect(finalTask.resultText).toContain('Revenue pipeline completed');
    expect(finalTask.linkedBoardCardId).toBe(boardCardId); // same card, no duplicate
  }, 30000);
});

describe('Revenue Pipeline — stale-event rejection & dry-run safety', () => {
  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-stale-'));
    process.env.AGENT_TEAMS_DB_PATH = path.join(tmpDir, 'test.db');
    await freshModules();
  });
  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('ignores stale worker transitions after the task is terminal (Test F)', () => {
    const { task } = mgr.createTask({
      title: 'T', objective: 'O', originalRequest: 'O', route: 'r', selectedAgent: 'Revenue Pipeline',
      worker: 'revenue', resumable: false,
    });
    mgr.transition(task.taskId, 'completed', { resultText: 'done' });
    const after = mgr.transition(task.taskId, 'running', { currentStage: 'RUNNING' });
    expect(after.status).toBe('completed'); // terminal is immutable
    mgr.progress(task.taskId, 'task.progress', 'late event');
    const events = repo.getEvents(task.taskId);
    expect(events.filter((e: any) => e.kind === 'task.progress' && e.summary === 'late event').length).toBe(0);
  });

  it('dry-run safety: fixtures labelled, no outreach artifacts, live mode refused', async () => {
    const fx = (await import('../services/revenuePipeline/fixtures.js')).SAMPLE_FIXTURES;
    expect(fx.every((f: any) => f.websiteUrl.endsWith('.example'))).toBe(true);
    expect(fx.every((f: any) => f.verifiedFacts.every((fact: string) => fact.startsWith('FIXTURE SAMPLE:')))).toBe(true);

    const cfg = baseConfig();
    const { prospects } = await discoveryMod.discoverProspects(cfg);
    expect(prospects.every((p: any) => p.fixture === true)).toBe(true);

    const live = await discoveryMod.discoverProspects(baseConfig({ dryRun: false }));
    expect(live.prospects).toEqual([]);
    expect(live.blocker).toBeTruthy();
  });
});

describe('Revenue Pipeline — multi-lead delivery', () => {
  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-ml-'));
    wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-mlws-'));
    process.env.AGENT_TEAMS_DB_PATH = path.join(tmpDir, 'test.db');
    await freshModules();
  });
  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    try { fs.rmSync(wsDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  async function runPipeline(prospectCount: number, overrides: Record<string, unknown> = {}) {
    let resultText = '';
    const hooks = {
      transition: () => {},
      progress: () => {},
      requestApprovalAndWait: async () => 'allow' as const,
      verifyCompletion: (evidence: { resultText: string }) => {
        resultText = evidence.resultText;
        return { status: 'completed', blocker: null };
      },
      setFilesChanged: () => {},
      getTask: () => ({ buildState: 'idle', testState: 'idle' }),
      isStopRequested: () => false,
    };
    const runId = pipelineMod.newRunId();
    const result = await pipelineMod.runRevenuePipeline({ runId, taskId: 'bgtask-ml', config: baseConfig({ prospectCount, ...overrides }), hooks });
    let summary: any = null;
    const summaryPath = path.join(wsDir, runId, 'run_summary.json');
    if (fs.existsSync(summaryPath)) summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
    return { result, resultText, summary };
  }

  it('requested 1 → returns 1 qualified lead (headroom discovers 2, returns 1)', async () => {
    const { result, resultText, summary } = await runPipeline(1);
    expect(result.status).toBe('completed');
    expect(summary.counts.discovered).toBe(2); // headroom 1×2
    expect(summary.counts.qualified).toBe(2);
    expect(summary.counts.returned).toBe(1);
    expect(resultText).toContain('COMPLETED 1/1 qualified leads found.');
  });

  it('requested 5 → returns 5 qualified leads, full list preserved with top prospect', async () => {
    const { resultText, summary } = await runPipeline(5);
    expect(summary.counts.discovered).toBe(6); // headroom 5×2 capped at 6 fixtures
    expect(summary.counts.qualified).toBe(5);
    expect(summary.counts.rejected).toBe(1); // Weber (no public contact)
    expect(summary.counts.returned).toBe(5);
    expect(summary.leads.length).toBe(5);
    expect(summary.selectedProspect.businessName).toBeTruthy();
    expect(resultText).toContain('COMPLETED 5/5 qualified leads found.');
    expect(resultText).toContain('Top prospect:');
    expect(resultText).toContain('No outreach was performed.');
    for (const l of summary.leads) {
      expect(l.contactAvailability).toBe('available');
      expect(l.contact).toBeTruthy();
    }
  });

  it('requested 10 → attempts 10, truthful PARTIAL shortfall when only 6 discoverable', async () => {
    const { resultText, summary } = await runPipeline(10);
    expect(summary.counts.requested).toBe(10);
    expect(summary.counts.discovered).toBe(6);
    expect(summary.counts.qualified).toBe(5); // Weber rejected (no public contact)
    expect(summary.counts.rejected).toBe(1);
    expect(resultText).toContain('PARTIAL 5 of 10 requested leads verified');
    expect(resultText).toContain('Discovery sources exhausted');
  });

  it('no contact info → lead rejected, never counted or invented', async () => {
    const { summary } = await runPipeline(6);
    expect(summary.counts.discovered).toBe(6);
    expect(summary.counts.qualified).toBe(5);
    const names = summary.leads.map((l: any) => l.businessName);
    expect(names).not.toContain('Meisterbetrieb Weber Dach & Fassade');
  });

  it('replacement discovery: a rejected candidate does not stop at the first batch', async () => {
    // requested 5 with 6 candidates: 5 qualified + 1 rejected — the headroom
    // pool provides the replacement, so the run returns the full target.
    const { summary } = await runPipeline(5);
    expect(summary.counts.qualified).toBe(5);
    expect(summary.counts.returned).toBe(5);
  });

  it('deduplication does not reduce the count without replacement search', async () => {
    const { summary } = await runPipeline(5);
    const names = summary.leads.map((l: any) => l.businessName);
    expect(new Set(names).size).toBe(names.length);
  });

  it('deep-dive chooses one top lead but preserves the full lead list', async () => {
    const { summary } = await runPipeline(5);
    expect(summary.selectedProspect).toBeTruthy();
    expect(summary.leads.length).toBe(5);
    const selectedInList = summary.leads.some((l: any) => l.businessName === summary.selectedProspect.businessName);
    expect(selectedInList).toBe(true);
  });
});

describe('Revenue Pipeline — contact quality (no false positives)', () => {
  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-cq-'));
    wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-cqws-'));
    process.env.AGENT_TEAMS_DB_PATH = path.join(tmpDir, 'test.db');
    await freshModules();
  });
  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    try { fs.rmSync(wsDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  const extract = (html: string, baseUrl: string) => auditMod.extractPublicContactInfo(html, baseUrl);
  const belongs = (c: any, d: string) => auditMod.contactBelongsToBusiness(c, d);

  it('rejects asset URLs as contact pages (css/js/images/plugin paths)', () => {
    const html = `<a href="/kontakt">Kontakt</a><a href="/wp-content/plugins/contact-form-7/includes/css/styles.css">form</a><a href="/wp-content/themes/x/js/main.js">js</a><a href="/static/img/logo.png">img</a><a href="/uploads/banner.jpg">banner</a>`;
    const c = extract(html, 'https://pilch-dachbau.de');
    expect(c).toBeTruthy();
    // The real /kontakt page IS the contact page; the assets are rejected.
    expect(c.contactPageUrl).toBe('https://pilch-dachbau.de/kontakt');
  });

  it('rejects an asset-only page as having NO contact page', () => {
    const html = `<a href="/wp-content/plugins/contact-form-7/includes/css/styles.css?ver=123">form css</a>`;
    const c = extract(html, 'https://pilch-dachbau.de');
    expect(c).toBeNull();
  });

  it('does not count external/legal links (EU ODR) as contact information', () => {
    const html = `<a href="https://ec.europa.eu/consumers/odr">ODR</a><a href="/impressum">Impressum</a><a href="/datenschutz">Datenschutz</a>`;
    const c = extract(html, 'https://dachdeckerei-hasenbein.de');
    expect(c).toBeNull();
  });

  it('rejects non-email values (mailto: ODR pattern) by format validation', () => {
    const html = `<a href="mailto:info@dachdeckerei-hasenbein.de">info</a><a href="mailto:https://ec.europa.eu/consumers/odr">odr</a>`;
    const c = extract(html, 'https://dachdeckerei-hasenbein.de');
    expect(c?.email).toEqual(['info@dachdeckerei-hasenbein.de']);
  });

  it('identity sanity: same-domain contact belongs to the business', () => {
    const c = extract('<a href="mailto:info@pilch-dachbau.de">info</a><a href="/kontakt">Kontakt</a>', 'https://pilch-dachbau.de');
    expect(belongs(c, 'pilch-dachbau.de')).toBe(true);
  });

  it('identity sanity: external chamber/legal email alone does not qualify the lead', () => {
    const c = extract('<a href="mailto:info@hwkpotsdam.de">kammer</a><a href="https://ec.europa.eu/consumers/odr">odr</a>', 'https://dachdeckerei-hasenbein.de');
    expect(belongs(c, 'dachdeckerei-hasenbein.de')).toBe(false);
  });

  it('identity sanity: common free-mail providers still qualify (small-business norm)', () => {
    const c = extract('<a href="mailto:kontakt@web.de">kontakt</a>', 'https://dachdeckerei-mueller.example');
    expect(belongs(c, 'dachdeckerei-mueller.example')).toBe(true);
  });
});
