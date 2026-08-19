/**
 * digitalProductEngine.ts — M5 Digital Product Engine.
 *
 * Drives the Digital Product lifecycle using the Revenue domain (missions /
 * experiments / ledger) and the canonical execution surface. No parallel
 * execution infrastructure: discovery research runs on Hermes, artifact build
 * runs on Codex, all through dispatchCanonicalTask → canonical goal/task/run.
 *
 * Lifecycle (canonical EXPERIMENT_LIFECYCLE):
 *   DISCOVERED → VALIDATING → APPROVED (GO) / KILLED (NO-GO) → BUILDING → QA
 *   → READY_TO_PUBLISH → PUBLISHING → LIVE → MEASURE → ITERATE/SCALE/KILL
 */
import { db } from '../../db/index.js';
import { revenueMetrics, revenueOpportunities } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import {
  getMission,
  createExperiment,
  getExperiment,
  transitionExperiment,
  addExperimentEvidence,
  scoreExperiment,
  recordLedgerEntry,
  linkExperimentRun,
} from './operatorService.js';
import { dispatchCanonicalTask, decideGoNoGo, resolveProjectId, type CanonicalDispatchOutcome } from './revenueEngine.js';

const now = () => new Date().toISOString();

/** The next lifecycle action for a given experiment status (pure, testable). */
export function nextAction(status: string): string | null {
  switch (status) {
    case 'DISCOVERED': return 'validate';
    case 'VALIDATING': return 'decide';
    case 'APPROVED': return 'build';
    case 'BUILDING': return 'qa';
    case 'QA': return 'ready';
    case 'READY_TO_PUBLISH': return 'publish';
    case 'PUBLISHING': return 'live';
    case 'LIVE': return 'measure';
    case 'ITERATING':
    case 'SCALING': return 'measure';
    case 'KILLED': return null;
    default: return null;
  }
}

/**
 * DISCOVER — research product opportunities via Hermes and create candidate
 * experiments (status DISCOVERED) with real evidence provenance.
 */
export async function discoverProducts(
  missionId: string,
  opts: { projectId?: string; count?: number } = {},
): Promise<{ experiments: any[]; dispatch: CanonicalDispatchOutcome }> {
  const mission = await getMission(missionId);
  if (!mission) throw Object.assign(new Error('Mission not found.'), { status: 404 });

  const projectId = resolveProjectId(opts.projectId ?? mission.projectId);
  if (!projectId) throw Object.assign(new Error('No canonical project available for discovery.'), { status: 400 });

  const count = opts.count ?? 5;
  const objective =
    `Discover ${count} concrete digital product opportunities for a revenue mission ` +
    `(target €${mission.targetAmount} ${mission.currency}, market ${mission.primaryMarket || 'DE/EU'}, ` +
    `channels ${JSON.stringify(mission.availableChannels || ['SHOPIFY'])}). ` +
    `Products must be legitimate and buildable with no inventory: spreadsheet templates, calculators, ` +
    `operational checklists, SOP packs, Notion-style systems, prompt/workflow packages. ` +
    `For each idea return: title, problem solved, target customer, price point (EUR), distribution channel, ` +
    `and an evidence note with source.`;

  const dispatch = await dispatchCanonicalTask({
    projectId,
    worker: 'hermes',
    title: 'Digital product discovery research',
    objective,
    taskType: 'research',
    acceptanceCriteria: 'Return a structured list of product opportunities with the requested fields.',
  });

  // Parse ideas from the result defensively; fall back to a single summary idea.
  const experiments: any[] = [];
  const rawIdeas = extractIdeas(dispatch.summary);
  const ideas = rawIdeas.length > 0 ? rawIdeas : [{ title: dispatch.summary || 'Digital product opportunity', problem: '', customer: '', price: null, channel: 'SHOPIFY', note: 'From discovery research' }];

  for (const idea of ideas.slice(0, count)) {
    const exp = await createExperiment({
      missionId,
      projectId,
      engine: 'digital_products',
      hypothesis: idea.title,
      targetCustomer: idea.customer || undefined,
      problem: idea.problem || undefined,
      product: idea.title,
      price: typeof idea.price === 'number' ? idea.price : undefined,
      distributionChannels: idea.channel ? [idea.channel] : undefined,
      expectedRevenue: typeof idea.price === 'number' ? idea.price : undefined,
    });
    if (!exp) throw new Error('Failed to create experiment (no row returned).');
    await addExperimentEvidence(exp.id, {
      classification: dispatch.ok ? 'FACT' : 'ESTIMATE',
      title: `Discovery evidence for "${idea.title}"`,
      source: 'hermes',
      summary: idea.note || 'Product opportunity surfaced by discovery research.',
      provenance: `canonical-run:${dispatch.runId}`,
    });
    if (dispatch.runId) await linkExperimentRun(exp.id, 'run', dispatch.runId);
    experiments.push(exp);
  }

  return { experiments, dispatch };
}

/** Defensive parse of idea list from a free-text/structured summary. */
export function extractIdeas(summary: string | null): Array<{ title: string; problem?: string | null; customer?: string | null; price?: number | null; channel?: string | null; note?: string | null }> {
  if (!summary) return [];
  // Try to parse a JSON array/object if the summary is JSON.
  const candidates = [summary];
  const fenced = summary.match(/```(?:json)?\s*\n([\s\S]*?)```/);
  if (fenced) candidates.push(fenced[1]);
  for (const text of candidates) {
    try {
      const parsed = JSON.parse(text.trim());
      const arr = Array.isArray(parsed) ? parsed : (parsed.ideas || parsed.products || parsed.opportunities || []);
      if (Array.isArray(arr) && arr.length > 0) {
        return arr.map((x: any) => ({
          title: x.title || x.name || x.product || 'Untitled product',
          problem: x.problem || x.problemSolved || null,
          customer: x.customer || x.targetCustomer || null,
          price: typeof x.price === 'number' ? x.price : (parseFloat(x.price) || null),
          channel: x.channel || x.distributionChannel || null,
          note: x.note || x.evidence || null,
        }));
      }
    } catch { /* not JSON — fall through to list parsing */ }
  }
  // Markdown / numbered-list fallback: each list item becomes one candidate.
  const lines = summary.split(/\r?\n/);
  const items: Array<{ title: string; body: string[] }> = [];
  const itemRe = /^\s*(?:\d+[.)]|[-*•])\s+(.*)$/;
  for (const line of lines) {
    const m = line.match(itemRe);
    if (m && m[1].trim().length >= 12) {
      items.push({ title: m[1].trim(), body: [] });
    } else if (items.length > 0 && line.trim()) {
      items[items.length - 1].body.push(line.trim());
    }
  }
  // Also accept "### Title" style blocks.
  if (items.length === 0) {
    const blocks = summary.split(/\n(?=###\s)/);
    for (const b of blocks) {
      const hm = b.match(/^###\s+(.+)\n?([\s\S]*)$/);
      if (hm && hm[1].trim().length >= 12) items.push({ title: hm[1].trim(), body: (hm[2] || '').split(/\r?\n/).filter(Boolean) });
    }
  }
  if (items.length === 0) return [];
  return items.slice(0, 12).map((it) => {
    const chunk = [it.title, ...it.body].join(' ');
    const priceMatch = chunk.match(/€\s*(\d+(?:[.,]\d+)?)/);
    const channelMatch = chunk.match(/\b(SHOPIFY|ETSY|GUMROAD|INSTAGRAM|TIKTOK|SEO|EMAIL|GOOGLE|MARKETPLACE|DIRECT_OUTREACH)\b/i);
    return {
      title: it.title.replace(/\*\*/g, '').slice(0, 120),
      problem: it.body.join(' ').slice(0, 500) || null,
      customer: null,
      price: priceMatch ? parseFloat(priceMatch[1].replace(',', '.')) : null,
      channel: channelMatch ? channelMatch[1].toUpperCase() : null,
      note: chunk.slice(0, 700),
    };
  });
}

/**
 * VALIDATE + SCORE — score an experiment and attach evidence, moving it to
 * VALIDATING (or leaving DISCOVERED for the decide step).
 */
export async function validateAndScore(experimentId: string, inputs: Record<string, number> = {}) {
  const exp = await getExperiment(experimentId);
  if (!exp) throw Object.assign(new Error('Experiment not found.'), { status: 404 });
  if (exp.status === 'DISCOVERED') {
    await transitionExperiment(experimentId, 'VALIDATING');
  }
  const score = await scoreExperiment(experimentId, inputs);
  await addExperimentEvidence(experimentId, {
    classification: 'INFERENCE',
    title: 'Opportunity scoring',
    summary: `Scored ${score.overallScore} (confidence ${score.confidence}). ${score.explanation}`,
    provenance: 'digital-product-engine:validate',
  });
  return score;
}

/**
 * GO/NO-GO — decide from the stored score, transitioning to APPROVED or KILLED.
 */
export async function decideGoNoGoForExperiment(experimentId: string, threshold?: number) {
  const exp = await getExperiment(experimentId);
  if (!exp) throw Object.assign(new Error('Experiment not found.'), { status: 404 });
  const score = (exp as any).scorePayload?.overallScore;
  if (!Number.isFinite(score)) throw Object.assign(new Error('Experiment has no score — run validate first.'), { status: 400 });
  const { go, reason } = decideGoNoGo(score, threshold);
  const to = go ? 'APPROVED' : 'KILLED';
  const updated = await transitionExperiment(experimentId, to);
  await addExperimentEvidence(experimentId, {
    classification: 'FACT',
    title: go ? 'GO decision' : 'NO-GO decision',
    summary: reason,
    provenance: 'digital-product-engine:decide',
  });
  return { go, to, reason, experiment: updated };
}

/**
 * BUILD — build the product artifact via Codex (requires APPROVED).
 */
export async function buildProduct(experimentId: string, opts: { projectId?: string } = {}) {
  const exp = await getExperiment(experimentId);
  if (!exp) throw Object.assign(new Error('Experiment not found.'), { status: 404 });
  if (exp.status !== 'APPROVED' && exp.status !== 'BUILDING') {
    throw Object.assign(new Error(`Build requires APPROVED status (current: ${exp.status}).`), { status: 400 });
  }
  const mission = await getMission(exp.missionId);
  const projectId = resolveProjectId(opts.projectId ?? exp.projectId ?? mission?.projectId);
  if (!projectId) throw Object.assign(new Error('No canonical project available for build.'), { status: 400 });

  await transitionExperiment(experimentId, 'BUILDING');

  const objective =
    `Build the digital product "${exp.product || exp.hypothesis}" (${exp.engine}). ` +
    `Produce a complete, deliverable artifact (spreadsheet template, checklist, SOP pack, or workflow package). ` +
    `Target customer: ${exp.targetCustomer || 'DE/EU small business'}. ` +
    `Return the artifact content/path and a short QA checklist.`;

  const dispatch = await dispatchCanonicalTask({
    projectId,
    worker: 'codex',
    title: `Build product: ${exp.product || exp.hypothesis}`,
    objective,
    taskType: 'engineering',
    acceptanceCriteria: 'A complete, usable product artifact plus a QA checklist is produced.',
  });

  if (dispatch.runId) await linkExperimentRun(experimentId, 'run', dispatch.runId);
  if (dispatch.goalId) await linkExperimentRun(experimentId, 'goal', dispatch.goalId);
  if (dispatch.taskId) await linkExperimentRun(experimentId, 'task', dispatch.taskId);

  if (dispatch.ok) {
    await transitionExperiment(experimentId, 'QA');
    await addExperimentEvidence(experimentId, {
      classification: 'FACT',
      title: 'Product artifact built',
      summary: `Artifact built via canonical Codex run ${dispatch.runId}. Verdict: ${dispatch.verdict ?? 'n/a'}`,
      provenance: `canonical-run:${dispatch.runId}`,
    });
  }

  return { experiment: await getExperiment(experimentId), dispatch };
}

/**
 * MEASURE — record yield metric + ledger entry for an experiment.
 * Only REALIZED/COST ledger types flow here; VERIFIED_REVENUE still requires
 * external evidence (no fake revenue).
 */
export async function measureExperiment(
  experimentId: string,
  input: { revenue?: number; cost?: number; clicks?: number; conversions?: number; expectedYield?: number; actualYield?: number },
) {
  const exp = await getExperiment(experimentId);
  if (!exp) throw Object.assign(new Error('Experiment not found.'), { status: 404 });

  const results: any = {};

  if (input.revenue != null && input.revenue > 0) {
    results.ledger = await recordLedgerEntry({
      missionId: exp.missionId,
      experimentId,
      entryType: 'REALIZED_REVENUE',
      amount: input.revenue,
      source: 'shopify',
      evidence: [{
        id: `ev-${Date.now()}`,
        classification: 'FACT',
        title: 'Realized revenue measurement',
        summary: `Measured realized revenue ${input.revenue} for experiment ${experimentId}.`,
        capturedAt: now(),
      }],
    });
  }
  if (input.cost != null && input.cost > 0) {
    results.cost = await recordLedgerEntry({
      missionId: exp.missionId,
      experimentId,
      entryType: 'ACTUAL_COST',
      amount: input.cost,
      source: 'manual',
    });
  }

  // Per-opportunity yield metric (only when the experiment links an opportunity).
  if (exp.opportunityId) {
    const opp = db.select().from(revenueOpportunities).where(eq(revenueOpportunities.id, exp.opportunityId!)).get();
    if (opp) {
      const metricId = `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await db.insert(revenueMetrics).values({
        id: metricId,
        opportunityId: exp.opportunityId,
        expectedYield: input.expectedYield ?? null,
        actualYield: input.actualYield ?? null,
        clicks: input.clicks ?? null,
        conversions: input.conversions ?? null,
        revenue: input.revenue ?? null,
        status: 'measuring',
        measuredAt: now(),
        createdAt: now(),
      }).run();
      results.metricId = metricId;
    }
  }

  return { experiment: await getExperiment(experimentId), ...results };
}
