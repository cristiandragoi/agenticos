/**
 * Revenue Pipeline orchestrator — implements the 12-stage workflow:
 *
 *   1  Prospect discovery           7  Staged homepage concept
 *   2  Public website inspection    8  Running build (+ focused tests)
 *   3  Structured audit             9  Proposal package
 *   4  Opportunity scoring         10  Verification (REVIEWER)
 *   5  Human target selection      11  Approval required before outreach
 *   6  Rebuild blueprint           12  Final Jarvis summary / completion
 *
 * Pure orchestration: all persistence/state lives in the background task
 * manager + the pipeline store. The adapter supplies hooks; tests supply fake
 * hooks. No fabrication, no outreach, no publishing — by construction.
 */
import fs from 'fs';
import path from 'path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { PIPELINE_STAGE_LABELS, type AuditFinding, type PipelineConfig, type PipelineRunRecord, type ProspectRecord } from './types.js';
import { revenuePipelineRepo } from './store.js';
import { discoverProspects } from './discovery.js';
import { fetchPublicPage } from './web.js';
import { auditWebsite, findingsToFacts, computeAuditScore } from './audit.js';
import { scoreProspect, rankProspects } from './scoring.js';
import { buildRebuildBlueprint } from './blueprint.js';
import { generateSiteConcept } from './concept.js';
import { generateProposalPackage } from './proposal.js';
import { verifyPipelineArtifacts } from './verify.js';
import { checkBudget, createLedger, recordLlmCall } from './cost.js';
import { FIXTURE_PREFIX } from './fixtures.js';
import { logger } from '../../utils/logger.js';

const execFileAsync = promisify(execFile);

/** npm is a .cmd shim on Windows — spawn via the shell (bare spawn → ENOENT/EINVAL). */
const NPM_BIN = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const NPM_SPAWN_OPTS = process.platform === 'win32' ? { shell: true } : {};

export interface PipelineHooks {
  transition(status: string, patch?: Record<string, unknown>): void;
  progress(kind: string, summary: string, patch?: Record<string, unknown>, detail?: Record<string, unknown>): void;
  /** Request a task-owned approval and WAIT for the human decision. */
  requestApprovalAndWait(request: { action: string; reason: string; choices?: string[] }): Promise<'allow' | 'deny'>;
  /**
   * The ONLY completion path: route the final evidence through the task
   * manager's verification gate. The worker never transitions directly to
   * completed — the gate checks result text, pending approvals, and
   * build/test state, and sets verificationState to passed only on success.
   * Returns the resulting task status + blocker (null when the gate could
   * not run, e.g. terminal task).
   */
  verifyCompletion(evidence: {
    resultText: string;
    buildState?: 'idle' | 'running' | 'passed' | 'failed' | 'skipped';
    testState?: 'idle' | 'running' | 'passed' | 'failed' | 'skipped';
    readOnly?: boolean;
    verificationNote?: string;
  }): { status: string; blocker: string | null } | null;
  setFilesChanged(files: string[]): void;
  getTask(): { buildState: string; testState: string } | null;
  isStopRequested(): boolean;
}

export interface PipelineResult {
  status: 'completed' | 'review' | 'blocked' | 'failed' | 'cancelled';
  summary?: string;
  blocker?: string;
  error?: string;
}

export async function runRevenuePipeline(opts: {
  runId: string;
  taskId: string;
  config: PipelineConfig;
  hooks: PipelineHooks;
}): Promise<PipelineResult> {
  const { runId, taskId, config, hooks } = opts;
  const startedAt = Date.now();
  let run = ensureRun(runId, taskId, config);
  const setStage = (label: (typeof PIPELINE_STAGE_LABELS)[number], message: string) => {
    run = revenuePipelineRepo.updateRun(runId, { currentStage: label }) ?? run;
    hooks.transition('running', { currentStage: label, progressMessage: message });
    hooks.progress('task.progress', message, { currentStage: label });
    logger.info(`[revenue-pipeline] ${runId} ${label} — ${message}`);
  };

  try {
    // ── Stage 1 — Prospect discovery ────────────────────────────────────────
    setStage('DISCOVERING PROSPECTS', 'Discovering prospects…');
    const discovered = discoverProspects(config);
    if (discovered.blocker || discovered.prospects.length === 0) {
      return finishBlocked(runId, hooks, discovered.blocker || 'No prospects discovered.');
    }
    if (discovered.prospects.length < config.prospectCount) {
      hooks.progress('task.progress', `Requested ${config.prospectCount} prospects; only ${discovered.prospects.length} labelled candidates available.`, { shortfall: true });
    }
    for (const p of discovered.prospects) {
      p.linkedTaskId = taskId;
      revenuePipelineRepo.upsertProspect(p);
    }
    run = revenuePipelineRepo.updateRun(runId, { prospects: discovered.prospects }) ?? run;
    hooks.progress('task.progress', `${discovered.prospects.length} prospect(s) discovered (source: ${discovered.prospects[0].discoverySource}).`, { source: discovered.prospects[0].discoverySource });

    // ── Stage 2+3 — Public website inspection + structured audit ───────────
    setStage('INSPECTING WEBSITE', 'Inspecting public websites…');
    const audited: ProspectRecord[] = [];
    for (const prospect of discovered.prospects) {
      if (hooks.isStopRequested()) return finishCancelled(runId, hooks);
      hooks.progress('task.progress', `Inspecting ${prospect.websiteUrl}…`, { url: prospect.websiteUrl });

      let html = '';
      let sitemapUrl: string | null = null;
      let fetchFailed: string | null = null;
      if (prospect.fixture) {
        // Fixture snapshot IS the sample "public page" — clearly labelled.
        const { fixturesFor } = await import('./fixtures.js');
        const fx = fixturesFor(prospect.niche, prospect.city).find((f) => f.websiteUrl === prospect.websiteUrl);
        html = fx?.snapshotHtml || '';
        if (!html) fetchFailed = 'fixture snapshot missing';
      } else {
        const page = await fetchPublicPage(prospect.websiteUrl);
        if (page.ok && page.html) {
          html = page.html;
          sitemapUrl = page.sitemapUrl ?? null;
        } else {
          fetchFailed = page.reason || 'fetch failed';
        }
      }

      setStage('AUDITING', `Auditing ${prospect.businessName}…`);
      const findings = auditWebsite({ html, fixture: prospect.fixture, sitemapUrl, fetchFailedReason: fetchFailed });
      findingsToFacts(prospect, findings);
      prospect.auditScore = computeAuditScore(findings);
      prospect.status = 'audited';
      prospect.updatedAt = new Date().toISOString();
      revenuePipelineRepo.upsertProspect(prospect);
      audited.push(prospect);
    }
    run = revenuePipelineRepo.updateRun(runId, { prospects: audited }) ?? run;

    // ── Stage 4 — Opportunity scoring ───────────────────────────────────────
    setStage('SCORING OPPORTUNITY', 'Scoring opportunities…');
    for (const prospect of audited) {
      const scored = scoreProspect(prospect);
      prospect.opportunityScore = scored.overall;
      prospect.scoringCriteria = scored.criteria;
      prospect.confidence = scored.confidence;
      prospect.status = 'scored';
      prospect.updatedAt = new Date().toISOString();
      revenuePipelineRepo.upsertProspect(prospect);
    }
    const ranked = rankProspects(audited);
    run = revenuePipelineRepo.updateRun(runId, { prospects: ranked }) ?? run;
    hooks.progress('task.progress', `Ranked ${ranked.length} prospect(s) — top: ${ranked[0]?.businessName} (${ranked[0]?.opportunityScore}/100, ${ranked[0]?.confidence} confidence).`, {
      ranking: ranked.map((p) => ({ businessName: p.businessName, score: p.opportunityScore, confidence: p.confidence })),
    });

    // ── Stage 5 — Human target selection when confidence is low ─────────────
    let selected = ranked[0];
    if (selected && selected.confidence === 'low') {
      setStage('SCORING OPPORTUNITY', 'Confidence low — requesting human target selection…');
      const choice = await hooks.requestApprovalAndWait({
        action: 'Select low-confidence prospect for rebuild',
        reason: `${selected.businessName} scored ${selected.opportunityScore}/100 with LOW factual confidence (${selected.auditFindings.filter((f) => f.label === 'verified').length}/${selected.auditFindings.length} verified). Confirm selection or deny to abort.`,
        choices: ['allow', 'deny'],
      });
      if (choice === 'deny') {
        return finishBlocked(runId, hooks, 'Human declined the low-confidence prospect selection.');
      }
    }
    if (!selected) return finishBlocked(runId, hooks, 'No prospect to select after scoring.');
    selected.selectedForBuild = true;
    selected.status = 'selected';
    selected.updatedAt = new Date().toISOString();
    revenuePipelineRepo.upsertProspect(selected);
    run = revenuePipelineRepo.updateRun(runId, { selectedProspectId: selected.prospectId, prospects: ranked.map((p) => (p.prospectId === selected?.prospectId ? selected : p)) }) ?? run;
    hooks.progress('task.progress', `Selected ${selected.businessName} for the rebuild concept (score ${selected.opportunityScore}/100, ${selected.confidence} confidence).`, { selectedProspectId: selected.prospectId });

    // ── Stage 6 — Rebuild blueprint ─────────────────────────────────────────
    setStage('BUILDING REBUILD PLAN', 'Building the rebuild blueprint…');
    const blueprint = buildRebuildBlueprint(selected, config);
    const proposalDir = path.join(config.workspacePath, runId);
    fs.mkdirSync(proposalDir, { recursive: true });
    const blueprintPath = path.join(proposalDir, 'rebuild_blueprint.md');
    fs.writeFileSync(blueprintPath, blueprint.markdown, 'utf8');
    run = revenuePipelineRepo.updateRun(runId, { blueprintPath }) ?? run;

    // ── Stage 7 — Staged homepage concept ───────────────────────────────────
    setStage('GENERATING SITE CONCEPT', 'Generating the staged site concept…');
    const concept = generateSiteConcept(selected, config, proposalDir);
    run = revenuePipelineRepo.updateRun(runId, { conceptPath: concept.path }) ?? run;
    hooks.setFilesChanged(concept.files);

    // ── Stage 8 — Running build + focused tests ─────────────────────────────
    if (config.runBuild) {
      setStage('RUNNING BUILD', 'Installing dependencies and building the concept…');
      const buildResult = await runConceptBuild(concept.path, proposalDir, hooks);
      run = revenuePipelineRepo.updateRun(runId, { buildState: buildResult.buildState, testState: buildResult.testState }) ?? run;
      if (buildResult.buildState === 'failed') {
        return finishBlocked(runId, hooks, `Concept build failed — see ${path.join(proposalDir, 'build.log')}.`);
      }
    } else {
      run = revenuePipelineRepo.updateRun(runId, { buildState: 'skipped', testState: 'skipped' }) ?? run;
      hooks.progress('task.progress', 'Build skipped by pipeline config.');
    }

    // ── Stage 9 — Proposal package ──────────────────────────────────────────
    setStage('PREPARING PROPOSAL', 'Preparing the proposal package…');
    if (config.useLlm) {
      const budget = checkBudget(run.costLedger, config.maxResearchBudgetUsd);
      if (!budget.within) {
        const choice = await hooks.requestApprovalAndWait({
          action: 'Continue despite budget estimate',
          reason: budget.reason,
          choices: ['allow', 'deny'],
        });
        if (choice === 'deny') return finishBlocked(runId, hooks, 'Budget exceeded — denied by user.');
      }
    }
    const auditMd = renderAuditReportMd(selected, config);
    const pkg = generateProposalPackage({ run, prospect: selected, config, blueprint, auditReportMd: auditMd });
    run = revenuePipelineRepo.updateRun(runId, { proposalDirPath: pkg.dir }) ?? run;
    hooks.setFilesChanged([...pkg.files, blueprintPath]);

    // ── Stage 10 — Verification (REVIEWER) ──────────────────────────────────
    // Write the run summary BEFORE verifying so the package is complete; the
    // final summary is re-written with the completed status at stage 12.
    setStage('VERIFYING', 'Verifying artifacts and factual separation…');
    const preSummary = buildRunSummary(run, selected, config, Date.now() - startedAt);
    const preSummaryPath = path.join(proposalDir, 'run_summary.json');
    fs.writeFileSync(preSummaryPath, JSON.stringify({ ...preSummary, status: 'verifying', completedAt: null }, null, 2), 'utf8');
    run = revenuePipelineRepo.updateRun(runId, { runSummaryPath: preSummaryPath }) ?? run;

    const verification = verifyPipelineArtifacts({ ...run, config, runId, prospects: [selected] });
    run = revenuePipelineRepo.updateRun(runId, { verificationState: verification.ok ? 'passed' : 'failed' }) ?? run;
    hooks.progress('task.progress', verification.ok ? `Verification passed (${verification.checks.length} checks).` : `Verification failed: ${verification.blocker}`, { checks: verification.checks });
    if (!verification.ok) {
      return finishBlocked(runId, hooks, verification.blocker || 'Verification failed.');
    }

    // ── Stage 11 — Approval required before outreach ────────────────────────
    setStage('AWAITING APPROVAL', 'Proposal ready — approval required before any outreach.');
    const approvalAction = config.dryRun
      ? 'Approve outreach decision (DRY-RUN — no actual contact will be made)'
      : 'Approve contacting the business / sending the proposal';
    const choice = await hooks.requestApprovalAndWait({
      action: approvalAction,
      reason: `Proposal package ready for ${selected.businessName} (${selected.websiteUrl}). V1 performs NO automated outreach — approval only records the decision.`,
      choices: ['allow', 'deny'],
    });
    if (choice === 'deny') {
      return finishBlocked(runId, hooks, 'Outreach approval denied — proposal package retained locally, nothing sent.');
    }
    run = revenuePipelineRepo.updateRun(runId, { approvalState: 'allowed', outreachApproved: true }) ?? run;
    hooks.progress('task.progress', 'Outreach decision approved (dry-run safe). V1 has no automated outreach — nothing was sent.', { outreachApproved: true });

    // ── Stage 12 — Final Jarvis summary / completion (through the gate) ────
    // The worker NEVER transitions directly to completed. The task manager's
    // verifyCompletion gate checks result text + no pending approval +
    // non-failed build/test and sets verificationState=passed only on success.
    setStage('COMPLETED', 'Pipeline completed and verified.');
    const totalElapsedMs = Date.now() - startedAt;
    const summary = buildRunSummary(run, selected, config, totalElapsedMs);
    const runSummaryPath = path.join(proposalDir, 'run_summary.json');
    fs.writeFileSync(runSummaryPath, JSON.stringify(summary, null, 2), 'utf8');
    run = revenuePipelineRepo.updateRun(runId, { currentStage: 'COMPLETED', runSummaryPath, totalElapsedMs }) ?? run;
    writeMemoryEntry(run, selected);

    const resultText =
      `Revenue pipeline completed — ${selected.businessName} (${selected.websiteUrl}). ` +
      `Score ${selected.opportunityScore}/100 (${selected.confidence} confidence). ` +
      `Proposal package: ${proposalDir}. ` +
      `Build ${run.buildState} · tests ${run.testState} · verification ${run.verificationState}. ` +
      `Outreach approved (dry-run safe) — no automated outreach in V1.`;

    const completion = hooks.verifyCompletion({
      resultText,
      buildState: run.buildState as 'idle' | 'running' | 'passed' | 'failed' | 'skipped',
      testState: run.testState as 'idle' | 'running' | 'passed' | 'failed' | 'skipped',
      readOnly: false,
      verificationNote: `Revenue pipeline verified — ${verification.checks.length} artifact checks, build ${run.buildState}, tests ${run.testState}.`,
    });
    if (!completion || completion.status !== 'completed') {
      const refusedStatus = completion?.status === 'review' ? 'review' : 'blocked';
      run = revenuePipelineRepo.updateRun(runId, {
        status: refusedStatus,
        blocker: completion?.blocker || 'Verification gate did not complete the task.',
        currentStage: refusedStatus === 'review' ? 'VERIFYING' : 'BLOCKED',
      }) ?? run;
      return { status: refusedStatus, blocker: completion?.blocker || 'Verification gate did not complete the task.' };
    }

    run = revenuePipelineRepo.updateRun(runId, { status: 'completed', completedAt: new Date().toISOString() }) ?? run;
    return { status: 'completed', summary: resultText };
  } catch (err: any) {
    logger.error(`[revenue-pipeline] ${runId} failed: ${err?.message}`);
    run = revenuePipelineRepo.updateRun(runId, { status: 'failed', lastError: err?.message || String(err) }) ?? run;
    hooks.transition('failed', { lastError: err?.message || String(err), currentStage: 'FAILED', progressMessage: `Pipeline failed: ${err?.message}` });
    return { status: 'failed', error: err?.message || String(err) };
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

function ensureRun(runId: string, taskId: string, config: PipelineConfig): PipelineRunRecord {
  const existing = revenuePipelineRepo.getRun(runId);
  if (existing) return existing;
  const now = new Date().toISOString();
  const run: PipelineRunRecord = {
    runId,
    taskId,
    config,
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
    costLedger: createLedger(),
    totalElapsedMs: 0,
    blocker: null,
    lastError: null,
    outreachApproved: false,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
  revenuePipelineRepo.insertRun(run);
  return run;
}

function finishBlocked(runId: string, hooks: PipelineHooks, blocker: string): PipelineResult {
  revenuePipelineRepo.updateRun(runId, { status: 'blocked', blocker, currentStage: 'BLOCKED' });
  hooks.transition('blocked', { blocker, currentStage: 'BLOCKED', progressMessage: blocker });
  return { status: 'blocked', blocker };
}

function finishCancelled(runId: string, hooks: PipelineHooks): PipelineResult {
  revenuePipelineRepo.updateRun(runId, { status: 'blocked', blocker: 'Stopped by user.', currentStage: 'BLOCKED' });
  hooks.transition('cancelled', { blocker: 'Stopped by user.', currentStage: 'BLOCKED', progressMessage: 'Stopped by user.' });
  return { status: 'cancelled' };
}

async function runConceptBuild(
  conceptDir: string,
  proposalDir: string,
  hooks: PipelineHooks
): Promise<{ buildState: 'passed' | 'failed'; testState: 'passed' | 'failed' | 'idle' }> {
  const buildLogPath = path.join(proposalDir, 'build.log');
  const testLogPath = path.join(proposalDir, 'test.log');
  const logs: string[] = [];
  const log = (s: string) => {
    logs.push(s);
    try { fs.appendFileSync(buildLogPath, s + '\n'); } catch { /* ignore */ }
  };

  try {
    log(`[${new Date().toISOString()}] npm install (${conceptDir})`);
    hooks.progress('task.progress', 'npm install — resolving dependencies…');
    await execFileAsync(NPM_BIN, ['install', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: conceptDir, timeout: 600000, maxBuffer: 8 * 1024 * 1024, ...NPM_SPAWN_OPTS });
    log('npm install OK');
  } catch (err: any) {
    log(`npm install FAILED: ${err?.message}`);
    hooks.transition('running', { buildState: 'failed' });
    hooks.progress('task.progress', `npm install failed: ${err?.message}`, { buildState: 'failed' });
    return { buildState: 'failed', testState: 'idle' };
  }

  try {
    log(`[${new Date().toISOString()}] npm run build`);
    hooks.progress('task.progress', 'npm run build (tsc -b && vite build)…');
    const { stdout, stderr } = await execFileAsync(NPM_BIN, ['run', 'build'], { cwd: conceptDir, timeout: 240000, maxBuffer: 8 * 1024 * 1024, ...NPM_SPAWN_OPTS });
    log(stdout + (stderr || ''));
    log('BUILD OK');
    hooks.transition('running', { buildState: 'passed' });
  } catch (err: any) {
    log(`npm run build FAILED: ${err?.message}`);
    log(String(err?.stdout || '') + String(err?.stderr || ''));
    hooks.transition('running', { buildState: 'failed' });
    hooks.progress('task.progress', `Concept build failed — see build.log`, { buildState: 'failed' });
    return { buildState: 'failed', testState: 'idle' };
  }

  try {
    log(`[${new Date().toISOString()}] node tests/verify.mjs`);
    const { stdout, stderr } = await execFileAsync('node', ['tests/verify.mjs'], { cwd: conceptDir, timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
    fs.writeFileSync(testLogPath, stdout + (stderr || ''), 'utf8');
    hooks.transition('running', { testState: 'passed' });
    return { buildState: 'passed', testState: 'passed' };
  } catch (err: any) {
    const out = String(err?.stdout || '') + String(err?.stderr || '');
    fs.writeFileSync(testLogPath, out, 'utf8');
    hooks.transition('running', { testState: 'failed' });
    hooks.progress('task.progress', `Concept verify tests failed — see test.log`, { testState: 'failed' });
    return { buildState: 'passed', testState: 'failed' };
  }
}

function renderAuditReportMd(prospect: ProspectRecord, config: PipelineConfig): string {
  const label = prospect.fixture ? `${FIXTURE_PREFIX} ` : '';
  const lines: string[] = [
    `# Website audit report — ${prospect.businessName}`,
    ``,
    `> ${label}Generated by the AgenticOS Revenue Pipeline V1.`,
    `> Website: ${prospect.websiteUrl} · Niche: ${prospect.niche} · City: ${prospect.city}`,
    `> Audit score: ${prospect.auditScore ?? '—'}/100 (lower = weaker website).`,
    ``,
    `## Findings by category`,
  ];
  const grouped: Record<string, AuditFinding[]> = {};
  for (const f of prospect.auditFindings) {
    (grouped[f.category] ||= []).push(f);
  }
  for (const [category, findings] of Object.entries(grouped)) {
    lines.push(`### ${category}`);
    for (const f of findings) {
      lines.push(`- **[${f.label}]** ${f.summary}${f.evidence ? ` (evidence: ${f.evidence})` : ''}`);
    }
  }
  lines.push(``, `## Label legend`, `- verified — observed in the inspected page/sample`, `- inferred — reasoned from absence or patterns; NOT verified`, `- unavailable — could not be inspected`, ``,
    `## Verified facts`, ...prospect.verifiedFacts.map((f) => `- ${f}`),
    ``,
    `## Unverified observations`, ...prospect.unverifiedObservations.map((f) => `- ${f}`));
  return lines.join('\n');
}

function buildRunSummary(
  run: PipelineRunRecord,
  selected: ProspectRecord,
  config: PipelineConfig,
  totalElapsedMs: number
): Record<string, unknown> {
  return {
    runId: run.runId,
    taskId: run.taskId,
    config: {
      niche: config.niche,
      city: config.city,
      serviceKeywords: config.serviceKeywords,
      prospectCount: config.prospectCount,
      specificUrl: config.specificUrl,
      maxResearchBudgetUsd: config.maxResearchBudgetUsd,
      dryRun: config.dryRun,
      runBuild: config.runBuild,
      useLlm: config.useLlm,
    },
    status: 'completed',
    stage: 'COMPLETED',
    selectedProspect: {
      prospectId: selected.prospectId,
      businessName: selected.businessName,
      websiteUrl: selected.websiteUrl,
      fixture: selected.fixture,
      auditScore: selected.auditScore,
      opportunityScore: selected.opportunityScore,
      confidence: selected.confidence,
    },
    ranking: run.prospects.map((p) => ({ businessName: p.businessName, score: p.opportunityScore, confidence: p.confidence })),
    buildState: run.buildState,
    testState: run.testState,
    verificationState: run.verificationState,
    approvalState: run.approvalState,
    outreachApproved: run.outreachApproved,
    costLedger: run.costLedger,
    totalElapsedMs,
    artifacts: {
      proposalDir: run.proposalDirPath,
      auditReport: run.auditReportPath,
      blueprint: run.blueprintPath,
      concept: run.conceptPath,
      runSummary: run.runSummaryPath,
    },
    safety: {
      noOutreachPerformed: true,
      noPublishPerformed: true,
      dryRun: config.dryRun,
      fixtureLabelApplied: selected.fixture,
    },
    createdAt: run.createdAt,
    completedAt: new Date().toISOString(),
  };
}

function writeMemoryEntry(run: PipelineRunRecord, selected: ProspectRecord): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { db: jsonDb } = require('../db.js');
    const now = new Date().toISOString();
    const summary =
      `Revenue pipeline ${run.runId} completed for ${selected.businessName} (${selected.websiteUrl}). ` +
      `Score ${selected.opportunityScore}/100 (${selected.confidence}). ` +
      `Build ${run.buildState} · tests ${run.testState} · verification ${run.verificationState}. ` +
      `Artifacts: ${run.proposalDirPath}. ` +
      `Dry-run: ${run.config.dryRun}. No outreach performed.`;
    jsonDb.memoryEntries.upsert({
      id: `mem-pipeline-${run.runId}`,
      scopeId: 'mem-jarvis-agent',
      kind: 'summary',
      title: `Revenue pipeline handoff: ${selected.businessName} (${run.status})`,
      content: summary,
      links: [],
      sourceRunId: run.taskId,
      sourceType: 'revenue-pipeline',
      sourceId: run.runId,
      createdAt: now,
      updatedAt: now,
    });
  } catch (err: any) {
    logger.warn(`[revenue-pipeline] memory entry failed: ${err?.message}`);
  }
}

/** Build a runId (exported for the adapter). */
export function newRunId(): string {
  return `rp-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}
