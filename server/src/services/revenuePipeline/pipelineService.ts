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
import { PIPELINE_STAGE_LABELS, type AuditFinding, type PipelineConfig, type PipelineRunRecord, type ProspectRecord, type PublicContactInfo } from './types.js';
import { revenuePipelineRepo } from './store.js';
import { discoverProspects } from './discovery.js';
import { fetchPublicPage } from './web.js';
import { auditWebsite, findingsToFacts, computeAuditScore, extractPublicContactInfo, hasPublicContact, contactBelongsToBusiness } from './audit.js';
import { scoreProspect, rankProspects } from './scoring.js';
import { buildRebuildBlueprint } from './blueprint.js';
import { generateSiteConcept } from './concept.js';
import { generateProposalPackage } from './proposal.js';
import { verifyPipelineArtifacts } from './verify.js';
import { checkBudget, createLedger, recordLlmCall } from './cost.js';
import { FIXTURE_PREFIX } from './fixtures.js';
import { logger } from '../../utils/logger.js';
import { codexService } from '../../domains/codex/service.js';
import { goalStore } from '../goalStore.js';
import { AgentProviderAssignmentService, mapCatalogToGatewayId } from '../agent/assignments.js';

const execFileAsync = promisify(execFile);

/** npm is a .cmd shim on Windows — spawn via the shell (bare spawn → ENOENT/EINVAL). */
const NPM_BIN = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const NPM_SPAWN_OPTS = process.platform === 'win32' ? { shell: true } : {};

const GOAL_TERMINAL = new Set(['completed', 'failed', 'stopped', 'cancelled', 'interrupted']);

/** Injectable seams for tests (real defaults are used in production). */
export interface PipelineDeps {
  resolveCodexAssignment?: () => Promise<{ providerId: string; modelId?: string | null } | null>;
  codexTimeoutMs?: number;
}

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
  deps?: PipelineDeps;
}): Promise<PipelineResult> {
  const { runId, taskId, config, hooks } = opts;
  const deps = opts.deps || {};
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
    setStage('DISCOVERING PROSPECTS', config.fixturesOnly ? 'Discovering labelled sample prospects…' : 'Discovering real public prospects…');
    const discovered = await discoverProspects(config, undefined, (p) => {
      // Live discovery progress (source-resilience milestone): the same
      // source/attempt/discovered numbers reach the canonical record via the
      // manager's count mirror, so the bar shows which source + attempt.
      const action = p.error
        ? `Retrying ${p.source} after ${p.error} (attempt ${p.attempt}/${p.maxAttempts})`
        : p.reason === 'NO_RESULTS'
          ? `Switching source: ${p.source} returned no new candidates`
          : `Discovery — source ${p.source}, attempt ${p.attempt}/${p.maxAttempts}, discovered ${p.discovered}`;
      hooks.progress('task.progress', action, {
        discovered: p.discovered,
        requested: config.prospectCount,
        expanded: true,
        discoverySource: p.source,
        discoveryAttempt: p.attempt,
      });
    });
    if (discovered.blocker || discovered.prospects.length === 0) {
      return finishBlocked(runId, hooks, discovered.blocker || 'No prospects discovered.');
    }
    if (discovered.prospects.length < config.prospectCount) {
      hooks.progress('task.progress', `Requested ${config.prospectCount} prospects; only ${discovered.prospects.length} verifiable candidates found (truthful shortfall — nothing invented).`, { shortfall: true });
    }
    for (const p of discovered.prospects) {
      p.linkedTaskId = taskId;
      revenuePipelineRepo.upsertProspect(p);
    }
    run = revenuePipelineRepo.updateRun(runId, { prospects: discovered.prospects, discoveryStopReason: discovered.stopReason || null, discoverySourceLog: discovered.sourceLog || [] }) ?? run;
    hooks.progress('task.progress', `${discovered.prospects.length} prospect(s) discovered (source: ${discovered.prospects[0].discoverySource}${discovered.prospects[0].discoverySourceRecord ? ` — ${discovered.prospects[0].discoverySourceRecord.sourceType}` : ''}).`, { source: discovered.prospects[0].discoverySource }, { worker: 'research' });

    // ── Stage 2+3 — Public website inspection + structured audit ───────────
    // (contact-quality milestone) Discovery returns a HEADROOM pool; the
    // audit processes the initial batch, then EXPANDS while qualified < target
    // and candidates remain — a rejected candidate triggers replacement
    // instead of silently stopping at the first batch.
    setStage('INSPECTING WEBSITE', 'Inspecting public websites…');
    const pool = discovered.prospects;
    const target = config.prospectCount;
    const headroom = Math.max(target, target * (config.discoveryHeadroomMultiplier ?? 2));
    const audited: ProspectRecord[] = [];
    let cursor = 0;
    const qualifiedNow = () => audited.filter((p) => hasPublicContact(p.publicContact) && contactBelongsToBusiness(p.publicContact, canonicalDomainOf(p.websiteUrl))).length;
    const auditOne = async (prospect: ProspectRecord): Promise<boolean> => {
      if (hooks.isStopRequested()) return false;
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
      // Multi-lead contract: extract observed public contact methods. A lead
      // qualifies only when at least one real public contact is present AND
      // plausibly belongs to the business (identity sanity).
      prospect.publicContact = extractPublicContactInfo(html, prospect.websiteUrl);
      prospect.status = 'audited';
      prospect.updatedAt = new Date().toISOString();
      revenuePipelineRepo.upsertProspect(prospect);
      audited.push(prospect);
      return true;
    };

    // Initial batch = headroom.
    const initialEnd = Math.min(pool.length, headroom);
    for (; cursor < initialEnd; cursor++) {
      if (!(await auditOne(pool[cursor]))) return finishCancelled(runId, hooks);
    }
    let q = qualifiedNow();
    hooks.progress('task.progress', `${cursor}/${pool.length} candidates inspected, ${q} qualified, ${cursor - q} rejected (target ${target}).`, { discovered: cursor, qualified: q, rejected: cursor - q, requested: target });
    // Replacement expansion: while qualified < target and candidates remain,
    // inspect the next candidates — never stop at the first batch.
    while (q < target && cursor < pool.length) {
      const remainingNeed = target - q;
      const batch = Math.max(remainingNeed, Math.min(5, pool.length - cursor));
      const end = Math.min(pool.length, cursor + batch);
      for (; cursor < end; cursor++) {
        if (!(await auditOne(pool[cursor]))) return finishCancelled(runId, hooks);
      }
      q = qualifiedNow();
      hooks.progress('task.progress', `Expanded discovery: ${cursor}/${pool.length} candidates inspected, ${q} qualified, ${cursor - q} rejected (target ${target}).`, { discovered: cursor, qualified: q, rejected: cursor - q, requested: target, expanded: true });
      if (hooks.isStopRequested()) return finishCancelled(runId, hooks);
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
    }, { worker: 'hermes' });

    // ── Multi-lead delivery (separate lead discovery from deep-dive) ──
    // The requested deliverable is N qualified leads; the deep-dive targets
    // the strongest ONE but must never destroy the full lead list. A lead
    // counts toward the target ONLY when it has verified public contact AND
    // the contact plausibly belongs to the business (identity sanity).
    const qualifiedLeads = ranked.filter((p) => hasPublicContact(p.publicContact) && contactBelongsToBusiness(p.publicContact, canonicalDomainOf(p.websiteUrl)));
    const rejectedCount = ranked.length - qualifiedLeads.length;
    hooks.progress('task.progress', `${qualifiedLeads.length} qualified lead(s) with public contact found (requested ${config.prospectCount}); ${rejectedCount} candidate(s) rejected (no public contact observed).`, {
      qualified: qualifiedLeads.length,
      rejected: rejectedCount,
      requested: config.prospectCount,
    });

    // ── Stage 5 — Human target selection when confidence is low ─────────────
    // The deep-dive targets the strongest QUALIFIED lead — never a candidate
    // without verified public contact (contact-quality milestone).
    let selected = qualifiedLeads[0] || ranked[0];
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

    // ── Stage 8 — Bounded CodeX site implementation (worker routing) ────────
    // CodeX receives ONLY the bounded site-implementation task — never the
    // discovery/audit pipeline. It starts only after: prospect selected,
    // audit completed, blueprint created, concept scaffold prepared.
    // Model suitability gate: a local (ollama) assignment is unsuitable for a
    // real implementation task — route to a configured cloud provider on
    // human approval, or skip CodeX truthfully on denial.
    let codexState: 'not_requested' | 'approved' | 'denied' | 'goal_created' | 'completed' | 'failed' | 'timeout' | 'stopped' | 'interrupted' = 'not_requested';
    let codexGoalId: string | null = null;
    if (config.useCodex) {
      setStage('GENERATING SITE CONCEPT', 'Preparing the bounded CodeX site-implementation task…');
      hooks.progress('task.progress', 'Worker routing: Research (discovery) → Hermes (audit + blueprint) → CodeX (bounded build) → Reviewer (verification).', {}, {
        workerRouting: ['research', 'hermes', 'codex', 'reviewer'],
      });

      const assignment = deps.resolveCodexAssignment
        ? await deps.resolveCodexAssignment()
        : await AgentProviderAssignmentService.getAssignment('agent-codex');
      const assignedProvider = assignment ? mapCatalogToGatewayId(assignment.providerId) : 'unknown';
      const assignedModel = assignment?.modelId || 'auto';
      const isLocalAssignment = assignedProvider === 'ollama';
      let executionProvider: string | undefined;

      if (isLocalAssignment) {
        const choice = await hooks.requestApprovalAndWait({
          action: 'CodeX model suitability — route site build to cloud provider',
          reason: `CodeX is assigned to ${assignedProvider}/${assignedModel}, which is unsuitable for the bounded site-implementation task. Approve routing to the configured cloud provider (OpenRouter), or deny to skip CodeX and use the deterministic scaffold build.`,
          choices: ['allow', 'deny'],
        });
        if (choice === 'allow') {
          executionProvider = 'openrouter';
          codexState = 'approved';
          hooks.progress('task.progress', `CodeX routed to cloud provider (OpenRouter) for the bounded site task — local assignment ${assignedProvider}/${assignedModel} marked unsuitable.`, { executionProvider });
        } else {
          codexState = 'denied';
          hooks.progress('task.progress', 'CodeX skipped by human decision — the deterministic scaffold build will be used as build evidence (truthful).', { codexState });
        }
      } else {
        codexState = 'approved';
        hooks.progress('task.progress', `CodeX assignment ${assignedProvider}/${assignedModel} is suitable — dispatching the bounded site task.`, { assignedProvider, assignedModel });
      }

      if (codexState === 'approved') {
        const codexPrompt = buildBoundedCodexPrompt(selected, blueprintPath, concept.path);
        const codexTimeoutMs = deps.codexTimeoutMs ?? parseInt(process.env.REVENUE_CODEX_TIMEOUT_MS || '240000');
        try {
          codexGoalId = await codexService.createGoal(codexPrompt, concept.path, 'auto', executionProvider, undefined, undefined, { disableFallback: true });
          codexState = 'goal_created';
          hooks.progress('task.progress', `CodeX goal created (${codexGoalId}) with the BOUNDED site-implementation task only.`, { goalId: codexGoalId, executionProvider: executionProvider || 'assignment-default' });

          const outcome = await waitForGoalTerminal(codexGoalId, codexTimeoutMs, hooks);
          codexState = outcome.outcome === 'completed' ? 'completed' : outcome.outcome;
          hooks.progress('task.progress', `CodeX bounded task ${codexState}${outcome.detail ? ` — ${outcome.detail}` : ''}.`, { goalId: codexGoalId, codexState, detail: outcome.detail });
        } catch (err: any) {
          codexState = 'failed';
          hooks.progress('task.progress', `CodeX dispatch failed: ${err?.message} — deterministic scaffold build will be used as evidence.`, { codexState, lastError: err?.message });
        }
      }
    }

    // ── Stage 8b — Running build + focused tests (REVIEWER evidence) ────────
    // The deterministic build + verify script run regardless of the CodeX
    // outcome, so the artifact evidence is real and verifiable.
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
    hooks.progress('task.progress', 'Worker: Reviewer — checking artifacts, factual separation, and build/test evidence.', {}, { worker: 'reviewer' });
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
    const summary = buildRunSummary(run, selected, config, totalElapsedMs, { codexState, codexGoalId });
    const runSummaryPath = path.join(proposalDir, 'run_summary.json');
    fs.writeFileSync(runSummaryPath, JSON.stringify(summary, null, 2), 'utf8');
    run = revenuePipelineRepo.updateRun(runId, { currentStage: 'COMPLETED', runSummaryPath, totalElapsedMs }) ?? run;
    writeMemoryEntry(run, selected);

    // The RETURNED deliverable is exactly the requested count (top N by rank);
    // extra qualified candidates remain in the pool but do not overshoot.
    const returnedLeads = qualifiedLeads.slice(0, config.prospectCount);
    const leadLines = returnedLeads.map((p, i) =>
      `${i + 1}. ${p.businessName}\n` +
      `   Website: ${p.websiteUrl}\n` +
      `   Contact: ${formatContact(p.publicContact)}\n` +
      `   Source: ${p.discoverySourceRecord?.sourceType || p.discoverySource}${p.discoverySourceRecord?.sourceUrl ? ` (${p.discoverySourceRecord.sourceUrl})` : ''}\n` +
      `   Confidence: ${p.confidence} · opportunity score ${p.opportunityScore}/100`
    ).join('\n');
    const shortfallNote = qualifiedLeads.length < config.prospectCount
      ? `\nPARTIAL result — ${qualifiedLeads.length} of ${config.prospectCount} requested leads verified; ${rejectedCount} candidate(s) rejected (no verified business contact found). Discovery sources exhausted.`
      : '';
    const resultText =
      (qualifiedLeads.length >= config.prospectCount
        ? `Revenue pipeline completed — COMPLETED ${Math.min(qualifiedLeads.length, config.prospectCount)}/${config.prospectCount} qualified leads found.`
        : `Revenue pipeline completed — PARTIAL ${qualifiedLeads.length} of ${config.prospectCount} requested leads verified.`) +
      `\n\n${leadLines || '(no qualifying leads with public contact)'}\n` +
      `\nTop prospect: ${selected.businessName} (${selected.websiteUrl})\n` +
      `Deep-dive package: ${proposalDir}\n` +
      `Build ${run.buildState} · tests ${run.testState} · verification ${run.verificationState}.` +
      shortfallNote +
      `\nNo outreach was performed.`;

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

/** The ONLY thing CodeX ever receives from this pipeline — never the full discovery/audit flow. */
function buildBoundedCodexPrompt(prospect: ProspectRecord, blueprintPath: string, conceptPath: string): string {
  return [
    'BOUNDED SITE-IMPLEMENTATION TASK (you receive ONLY this task — not the discovery/audit pipeline).',
    `Prospect: ${prospect.businessName} (${prospect.websiteUrl}).`,
    `Rebuild blueprint: ${blueprintPath}`,
    `Staged site concept scaffold: ${conceptPath}`,
    'Your ONLY job: improve the staged site concept copy/structure so it reflects the blueprint.',
    'STRICT CONSTRAINTS:',
    '- Do NOT modify package.json, tsconfig*.json, vite.config.ts, index.html structure, or tests/verify.mjs.',
    '- Do NOT run npm install, npm run build, or ANY shell command (build/tests are run by the pipeline reviewer).',
    '- Do NOT touch anything outside the concept directory.',
    '- Do NOT publish, deploy, or contact anyone.',
    '- Keep every [PLACEHOLDER: ...] marker intact.',
    'Finish by replying DONE with a one-paragraph summary of what you changed.',
  ].join('\n');
}

/**
 * Wait for a CodeX goal to reach a terminal state, with a hard deadline and
 * stop support. On timeout/stop the goal is aborted (abortGoal now interrupts
 * the in-flight model request) — no goal is ever left running forever.
 */
async function waitForGoalTerminal(
  goalId: string,
  timeoutMs: number,
  hooks: PipelineHooks
): Promise<{ outcome: 'completed' | 'failed' | 'stopped' | 'timeout' | 'interrupted'; detail?: string }> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    let timer: NodeJS.Timeout | null = null;
    let settled = false;
    const finish = (result: { outcome: 'completed' | 'failed' | 'stopped' | 'timeout' | 'interrupted'; detail?: string }) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      goalStore.off('goal:updated', listener);
      resolve(result);
    };
    const check = () => {
      const goal = goalStore.get(goalId);
      if (goal && GOAL_TERMINAL.has(goal.status)) {
        finish({ outcome: goal.status as any, detail: (goal as any).runSummary?.summary || goal.status });
        return;
      }
      if (hooks.isStopRequested()) {
        codexService.abortGoal(goalId);
        finish({ outcome: 'interrupted', detail: 'Pipeline stopped by user — CodeX goal aborted.' });
        return;
      }
      if (Date.now() > deadline) {
        codexService.abortGoal(goalId);
        finish({ outcome: 'timeout', detail: `CodeX goal exceeded the bounded wait of ${timeoutMs} ms — aborted truthfully.` });
        return;
      }
      timer = setTimeout(check, 2000);
    };
    const listener = (g: any) => {
      if (g?.id === goalId) check();
    };
    goalStore.on('goal:updated', listener);
    timer = setTimeout(check, 500);
  });
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
  totalElapsedMs: number,
  extra: { codexState?: string; codexGoalId?: string | null } = {}
): Record<string, unknown> {
  const qualifiedLeads = (run.prospects || []).filter((p) => hasPublicContact(p.publicContact));
  const rejectedCount = (run.prospects || []).length - qualifiedLeads.length;
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
      fixturesOnly: config.fixturesOnly,
      runBuild: config.runBuild,
      useCodex: config.useCodex,
      useLlm: config.useLlm,
    },
    discovery: {
      mode: config.fixturesOnly ? 'fixtures' : 'real',
      requested: config.prospectCount,
      found: run.prospects.length,
      stopReason: run.discoveryStopReason || null,
      sourcesTried: (run.discoverySourceLog || []).map((s) => ({
        source: s.source,
        attempt: s.attempt,
        status: s.status,
        error: s.error,
        latencyMs: s.latencyMs,
      })),
      sources: run.prospects.map((p) => ({
        businessName: p.businessName,
        website: p.websiteUrl,
        sourceType: p.discoverySourceRecord?.sourceType || p.discoverySource,
        sourceUrl: p.discoverySourceRecord?.sourceUrl || null,
        evidence: p.discoverySourceRecord?.evidence || null,
        corroboratedBy: p.discoverySourceRecord?.corroboratedBy || [],
      })),
    },
    workerRouting: {
      research: 'prospect discovery + public inspection',
      hermes: 'audit, scoring, rebuild blueprint',
      codex: extra.codexState || 'not_requested',
      codexGoalId: extra.codexGoalId || null,
      reviewer: 'artifact verification + build/test evidence',
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
    counts: {
      requested: config.prospectCount,
      discovered: (run.prospects || []).length,
      qualified: qualifiedLeads.length,
      rejected: rejectedCount,
      returned: Math.min(qualifiedLeads.length, config.prospectCount),
    },
    leads: qualifiedLeads.slice(0, config.prospectCount).map((p) => ({
      businessName: p.businessName,
      website: p.websiteUrl,
      contact: p.publicContact,
      contactAvailability: p.publicContact ? 'available' : 'unavailable',
      location: p.city,
      source: p.discoverySourceRecord?.sourceType || p.discoverySource,
      sourceUrl: p.discoverySourceRecord?.sourceUrl || null,
      confidence: p.confidence,
      opportunityScore: p.opportunityScore,
      reason: p.scoringCriteria ? Object.entries(p.scoringCriteria).slice(0, 2).map(([k, v]) => `${k}: ${v.reason}`).join('; ') : null,
    })),
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

function formatContact(contact: PublicContactInfo | null | undefined): string {
  if (!contact) return '(no public contact found)';
  const parts: string[] = [];
  if (contact.phone.length) parts.push(`phone ${contact.phone.join(', ')}`);
  if (contact.email.length) parts.push(`email ${contact.email.join(', ')}`);
  if (contact.contactPageUrl) parts.push(`contact page ${contact.contactPageUrl}`);
  if (contact.address) parts.push(`address "${contact.address}"`);
  return parts.length ? parts.join(' · ') : '(no public contact found)';
}

function canonicalDomainOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
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
