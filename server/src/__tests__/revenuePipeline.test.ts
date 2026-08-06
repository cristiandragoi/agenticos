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
    runBuild: false,
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
    expect(r.config.niche).toBe('roofing');
    expect(r.config.city).toBe('Berlin');
    expect(r.config.prospectCount).toBe(3);
    expect(r.config.dryRun).toBe(true);
    expect(r.config.specificUrl).toBeNull();
  });

  it('parses explicit markers (niche/city/budget/count/URL/dry-run)', () => {
    const text = 'niche: plumbing, city: Munich, budget: $10, five prospects, dry-run, https://example.com/plumbing';
    const r = intakeMod.parsePipelineRequest(text);
    expect(r.config.niche).toBe('plumbing');
    expect(r.config.city).toBe('Munich');
    expect(r.config.maxResearchBudgetUsd).toBe(10);
    expect(r.config.prospectCount).toBe(5);
    expect(r.config.dryRun).toBe(true);
    expect(r.config.specificUrl).toBe('https://example.com/plumbing');
  });

  it('defaults to dry-run true and count 3 when unspecified', () => {
    const r = intakeMod.parsePipelineRequest('Find roofing businesses in Berlin');
    expect(r.config.dryRun).toBe(true);
    expect(r.config.prospectCount).toBe(3);
    expect(r.notes.some((n: string) => n.includes('dry-run'))).toBe(true);
  });

  it('honours explicit live mode', () => {
    const r = intakeMod.parsePipelineRequest('Find five roofing businesses in Berlin. Live mode. Do contact them.');
    expect(r.config.dryRun).toBe(false);
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

  it('discovers labelled fixture prospects with the canonical record shape', () => {
    const cfg = baseConfig();
    const { prospects, blocker } = discoveryMod.discoverProspects(cfg);
    expect(blocker).toBeNull();
    expect(prospects.length).toBe(3);
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

  it('refuses live discovery without a specific URL (no fabrication)', () => {
    const cfg = baseConfig({ dryRun: false });
    const { prospects, blocker } = discoveryMod.discoverProspects(cfg);
    expect(prospects).toEqual([]);
    expect(blocker).toContain('Live prospect discovery');
  });

  it('accepts a user-provided URL as a single non-fixture prospect', () => {
    const cfg = baseConfig({ dryRun: false, specificUrl: 'https://www.dachfirma.example' });
    const { prospects } = discoveryMod.discoverProspects(cfg);
    expect(prospects.length).toBe(1);
    expect(prospects[0].fixture).toBe(false);
    expect(prospects[0].discoverySource).toBe('user-url');
  });

  it('never creates duplicate prospects for the same website URL', () => {
    const cfg = baseConfig();
    const { prospects } = discoveryMod.discoverProspects(cfg);
    const first = storeMod.revenuePipelineRepo.upsertProspect(prospects[0]);
    const second = storeMod.revenuePipelineRepo.upsertProspect({ ...prospects[0], prospectId: 'pp-other' });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.prospect.prospectId).toBe(first.prospect.prospectId);
    expect(storeMod.revenuePipelineRepo.findProspectByWebsite(prospects[0].websiteUrl)?.prospectId).toBe(first.prospect.prospectId);
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
    expect(run.prospects.length).toBe(3);
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
    const { prospects } = discoveryMod.discoverProspects(cfg);
    expect(prospects.every((p: any) => p.fixture === true)).toBe(true);

    const live = discoveryMod.discoverProspects(baseConfig({ dryRun: false }));
    expect(live.prospects).toEqual([]);
    expect(live.blocker).toBeTruthy();
  });
});
