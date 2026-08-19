/**
 * traceService.ts — Revenue Operator UI traceability layer (READ-ONLY).
 *
 * Contract: every visible aggregate in the Revenue Operator UI must be
 * explainable from persisted records. This service computes KPI breakdowns,
 * Kanban boards, live-execution rows and drill-down traces exclusively from
 * the database (revenue_* domain tables + canonical execution_runs /
 * project_tasks / verifications / goals + ARGUS tables). It performs NO
 * writes and NO fabrication: queued work is reported as queued, missing
 * evidence as missing, €0 as €0.
 */
import { eq, desc } from 'drizzle-orm';
import { db, rawDb } from '../../db/index.js';
import {
  revenueExperiments, revenueExperimentEvents, revenueLedgerEntries,
  revenueHumanGates, revenueComplianceRecords, goals,
} from '../../db/schema.js';
import {
  getMission, listExperiments, listLedger, listHumanGates, getExperiment,
} from './operatorService.js';
import { smeNextAction } from './germanSmeEngine.js';
import { nextAction as dpNextAction } from './digitalProductEngine.js';

// ── KPI breakdowns ──────────────────────────────────────────────────────────

export type KpiKey = 'target' | 'realized' | 'verified' | 'pipeline' | 'cost' | 'net' | 'adSpend';

const AD_SPEND_SOURCES = ['ad_spend', 'ads', 'advertising', 'ad spend', 'paid_ads'];

function isAdSpend(entry: any): boolean {
  const src = String(entry.source || '').toLowerCase();
  if (AD_SPEND_SOURCES.some((s) => src.includes(s))) return true;
  const cat = String(entry.provenance?.category || '').toLowerCase();
  return AD_SPEND_SOURCES.some((s) => cat.includes(s));
}

function daysRemaining(deadline: string | null): number {
  if (!deadline) return 0;
  const ms = new Date(deadline).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86400000));
}

async function experimentTitleMap(missionId: string): Promise<Map<string, any>> {
  const exps = await listExperiments(missionId);
  return new Map(exps.map((e: any) => [e.id, e]));
}

function decorateEntry(entry: any, expMap: Map<string, any>) {
  const exp = entry.experimentId ? expMap.get(entry.experimentId) : undefined;
  return {
    ...entry,
    experimentTitle: exp ? (exp.product || exp.targetCustomer || exp.hypothesis) : null,
    experimentEngine: exp ? exp.engine : null,
    opportunityId: exp ? exp.opportunityId ?? null : null,
    channel: entry.provenance?.channel ?? (exp?.distributionChannels?.[0] || null),
    category: entry.provenance?.category ?? entry.source ?? 'uncategorized',
  };
}

/** Full mission trace: KPI totals + counts, all computed from persisted rows. */
export async function traceMission(missionId: string) {
  const mission = await getMission(missionId);
  if (!mission) throw Object.assign(new Error('Mission not found.'), { status: 404 });
  const entries = await listLedger(missionId);
  const experiments = await listExperiments(missionId);
  const gates = listHumanGates('open');

  const sum = (type: string) => entries.filter((e: any) => e.entryType === type)
    .reduce((s: number, e: any) => s + e.amount, 0);
  const realized = sum('REALIZED_REVENUE') - sum('REFUNDED_REVENUE');
  const verified = sum('VERIFIED_REVENUE');
  const pipelineEntries = sum('PIPELINE_VALUE');
  const cost = sum('ACTUAL_COST');
  const adSpend = entries.filter((e: any) => e.entryType === 'ACTUAL_COST' && isAdSpend(e))
    .reduce((s: number, e: any) => s + e.amount, 0);

  const activeExperiments = experiments.filter((e: any) => !['WON', 'LOST', 'KILLED'].includes(e.status));
  return {
    mission,
    daysRemaining: daysRemaining(mission.deadline),
    kpis: {
      target: { value: mission.targetAmount, currency: mission.currency, deadline: mission.deadline, missionState: mission.status, activeExperiments: activeExperiments.length, daysRemaining: daysRemaining(mission.deadline) },
      realized: { value: realized, entries: entries.filter((e: any) => e.entryType === 'REALIZED_REVENUE' || e.entryType === 'REFUNDED_REVENUE').length },
      verified: { value: verified, entries: entries.filter((e: any) => e.entryType === 'VERIFIED_REVENUE').length },
      pipeline: { value: mission.pipelineValue, ledgerValue: pipelineEntries, experimentsInPipeline: activeExperiments.length },
      cost: { value: cost, entries: entries.filter((e: any) => e.entryType === 'ACTUAL_COST').length },
      net: { value: realized - cost, formula: 'realized_revenue - actual_cost', realized, cost },
      adSpend: { value: adSpend, actualSpendField: mission.actualSpend, budget: mission.advertisingBudget, hypotheticalSpendExcluded: true },
    },
    openGates: gates.filter((g: any) => !g.experimentId || experiments.some((e: any) => e.id === g.experimentId)).length,
    experimentCount: experiments.length,
  };
}

/** Itemized drill-down for one KPI — every contributing persisted record. */
export async function kpiBreakdown(missionId: string, kpi: KpiKey) {
  const mission = await getMission(missionId);
  if (!mission) throw Object.assign(new Error('Mission not found.'), { status: 404 });
  const entries = await listLedger(missionId);
  const expMap = await experimentTitleMap(missionId);
  const experiments = await listExperiments(missionId);
  const dec = (e: any) => decorateEntry(e, expMap);

  switch (kpi) {
    case 'target': {
      const active = experiments.filter((e: any) => !['WON', 'LOST', 'KILLED'].includes(e.status));
      return {
        kpi, total: mission.targetAmount,
        mission: { id: mission.id, title: mission.title, state: mission.status, deadline: mission.deadline, startDate: mission.startDate, daysRemaining: daysRemaining(mission.deadline) },
        activeExperiments: active.map((e: any) => ({
          id: e.id, engine: e.engine, status: e.status,
          title: e.product || e.targetCustomer || e.hypothesis,
          nextAction: e.engine === 'german_sme' ? smeNextAction(e.status) : dpNextAction(e.status),
        })),
      };
    }
    case 'realized': {
      const items = entries.filter((e: any) => ['REALIZED_REVENUE', 'REFUNDED_REVENUE'].includes(e.entryType)).map(dec);
      const total = items.reduce((s: number, e: any) => s + (e.entryType === 'REFUNDED_REVENUE' ? -e.amount : e.amount), 0);
      return { kpi, total, items };
    }
    case 'verified': {
      const items = entries.filter((e: any) => e.entryType === 'VERIFIED_REVENUE').map((e: any) => {
        const d = dec(e);
        const exp = e.experimentId ? expMap.get(e.experimentId) : undefined;
        return {
          ...d,
          verificationState: e.status === 'verified' ? `VERIFIED by ${e.verifiedBy || 'ledger rule'}` : 'RECORDED (unverified)',
          verifiedAt: e.verifiedAt,
          argusState: argusStateForExperiment(exp),
        };
      });
      return { kpi, total: items.reduce((s: number, e: any) => s + e.amount, 0), items };
    }
    case 'pipeline': {
      const items = entries.filter((e: any) => e.entryType === 'PIPELINE_VALUE').map(dec);
      const board = await boardForMission(missionId, 'pipeline');
      return { kpi, total: mission.pipelineValue, items, board };
    }
    case 'cost': {
      const items = entries.filter((e: any) => e.entryType === 'ACTUAL_COST').map(dec);
      return { kpi, total: items.reduce((s: number, e: any) => s + e.amount, 0), items };
    }
    case 'net': {
      const realizedItems = entries.filter((e: any) => ['REALIZED_REVENUE', 'REFUNDED_REVENUE'].includes(e.entryType)).map(dec);
      const costItems = entries.filter((e: any) => e.entryType === 'ACTUAL_COST').map(dec);
      const realized = realizedItems.reduce((s: number, e: any) => s + (e.entryType === 'REFUNDED_REVENUE' ? -e.amount : e.amount), 0);
      const cost = costItems.reduce((s: number, e: any) => s + e.amount, 0);
      return { kpi, total: realized - cost, formula: 'realized_revenue - actual_cost', realized, cost, realizedItems, costItems };
    }
    case 'adSpend': {
      const items = entries.filter((e: any) => e.entryType === 'ACTUAL_COST' && isAdSpend(e)).map(dec);
      return { kpi, total: items.reduce((s: number, e: any) => s + e.amount, 0), items, note: 'Actual ad spend only — hypothetical/budgeted spend is never counted.' };
    }
    default:
      throw Object.assign(new Error(`Unknown kpi: ${kpi}`), { status: 400 });
  }
}

// ── Kanban boards ───────────────────────────────────────────────────────────

export const DIGITAL_BOARD_COLUMNS = [
  { key: 'DISCOVER', label: 'DISCOVER' },
  { key: 'VALIDATE', label: 'VALIDATE' },
  { key: 'SCORE', label: 'SCORE' },
  { key: 'GO_NO_GO', label: 'GO / NO-GO' },
  { key: 'BUILD', label: 'BUILD' },
  { key: 'QA', label: 'QA' },
  { key: 'READY_TO_PUBLISH', label: 'READY_TO_PUBLISH' },
  { key: 'PUBLISH', label: 'PUBLISH' },
  { key: 'MEASURE', label: 'MEASURE' },
  { key: 'SCALE_ITERATE_KILL', label: 'SCALE / ITERATE / KILL' },
] as const;

export const SME_BOARD_COLUMNS = [
  { key: 'DISCOVERED', label: 'DISCOVERED' },
  { key: 'QUALIFIED', label: 'QUALIFIED' },
  { key: 'CONTACT_READY', label: 'CONTACT_READY' },
  { key: 'OUTBOUND_APPROVAL', label: 'OUTBOUND_APPROVAL' },
  { key: 'CONTACTED', label: 'CONTACTED' },
  { key: 'REPLIED', label: 'REPLIED' },
  { key: 'INTERESTED', label: 'INTERESTED' },
  { key: 'PROPOSAL', label: 'PROPOSAL' },
  { key: 'WON', label: 'WON' },
  { key: 'LOST', label: 'LOST' },
] as const;

export const PIPELINE_BOARD_COLUMNS = [
  { key: 'discovered', label: 'Discovered' },
  { key: 'qualified', label: 'Qualified' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'interested', label: 'Interested' },
  { key: 'proposal', label: 'Proposal' },
  { key: 'won', label: 'Won' },
  { key: 'lost', label: 'Lost' },
] as const;

function digitalColumn(exp: any): string {
  switch (exp.status) {
    case 'DISCOVERED': return 'DISCOVER';
    case 'VALIDATING': return exp.scorePayload ? 'SCORE' : 'VALIDATE';
    case 'APPROVED': return 'GO_NO_GO';
    case 'BUILDING': return 'BUILD';
    case 'QA': return 'QA';
    case 'READY_TO_PUBLISH': return 'READY_TO_PUBLISH';
    case 'PUBLISHING': return 'PUBLISH';
    case 'LIVE': return 'MEASURE';
    case 'SCALING': case 'ITERATING': case 'KILLED': case 'WON': case 'LOST':
      return 'SCALE_ITERATE_KILL';
    default: return 'DISCOVER';
  }
}

function smeColumn(exp: any): string {
  switch (exp.status) {
    case 'DISCOVERED': return 'DISCOVERED';
    case 'VALIDATING': return 'QUALIFIED';
    case 'APPROVED': case 'BUILDING': return 'CONTACT_READY';
    case 'QA': case 'READY_TO_PUBLISH': return 'OUTBOUND_APPROVAL';
    case 'PUBLISHING': return 'CONTACTED';
    case 'LIVE':
      if ((exp.leads || 0) > 0) return 'INTERESTED';
      if ((exp.responses || 0) > 0) return 'REPLIED';
      return 'CONTACTED';
    case 'ITERATING': return 'PROPOSAL';
    case 'WON': return 'WON';
    case 'LOST': case 'KILLED': return 'LOST';
    default: return 'DISCOVERED';
  }
}

function pipelineStage(exp: any): string {
  switch (exp.status) {
    case 'DISCOVERED': return 'discovered';
    case 'VALIDATING': case 'APPROVED': case 'BUILDING': case 'QA': case 'READY_TO_PUBLISH':
      return 'qualified';
    case 'PUBLISHING': return 'contacted';
    case 'LIVE': return ((exp.responses || 0) > 0 || (exp.leads || 0) > 0) ? 'interested' : 'contacted';
    case 'ITERATING': case 'SCALING': return 'proposal';
    case 'WON': return 'won';
    case 'LOST': case 'KILLED': return 'lost';
    default: return 'discovered';
  }
}

function argusStateForExperiment(exp: any): string {
  if (!exp) return 'n/a';
  const goalIds: string[] = exp.goalIds || [];
  if (goalIds.length === 0) return 'no_argus_goal';
  try {
    const states = goalIds
      .map((gid) => {
        try { return rawDb.prepare('SELECT verification_state FROM goals WHERE id = ?').get(gid) as any; }
        catch { return null; }
      })
      .filter(Boolean)
      .map((r: any) => r.verification_state);
    return states.length > 0 ? states.join(',') : 'no_argus_goal';
  } catch {
    return 'unknown';
  }
}

function toCard(exp: any, openGates: any[], nextAction: string | null) {
  const gate = openGates.find((g: any) => g.experimentId === exp.id);
  return {
    id: exp.id,
    status: exp.status,
    engine: exp.engine,
    title: exp.product || exp.targetCustomer || exp.hypothesis,
    company: exp.targetCustomer || null,
    product: exp.product || null,
    value: exp.expectedRevenue || exp.price || 0,
    verifiedRevenue: exp.verifiedRevenue || 0,
    source: exp.evidenceSources?.[0] || exp.engine,
    nextAction,
    humanGate: gate ? { id: gate.id, gateType: gate.gateType, description: gate.description } : null,
    argusState: argusStateForExperiment(exp),
    confidence: exp.confidence ?? null,
    updatedAt: exp.updatedAt,
  };
}

async function boardForMission(missionId: string, engine: 'digital_products' | 'german_sme' | 'pipeline') {
  const experiments = await listExperiments(missionId);
  const gates = listHumanGates('open');
  const scoped = engine === 'pipeline'
    ? experiments
    : experiments.filter((e: any) => e.engine === engine);

  const columns = engine === 'digital_products' ? DIGITAL_BOARD_COLUMNS
    : engine === 'german_sme' ? SME_BOARD_COLUMNS
    : PIPELINE_BOARD_COLUMNS;

  const stageOf = engine === 'digital_products' ? digitalColumn
    : engine === 'german_sme' ? smeColumn
    : pipelineStage;

  const cards: Record<string, any[]> = {};
  for (const c of columns) cards[c.key] = [];
  for (const exp of scoped as any[]) {
    const next = exp.engine === 'german_sme' ? smeNextAction(exp.status) : dpNextAction(exp.status);
    const col = stageOf(exp);
    if (!cards[col]) cards[col] = [];
    cards[col].push(toCard(exp, gates, next));
  }
  return {
    engine,
    columns: columns.map((c) => ({ ...c })),
    cards,
    total: scoped.length,
    placed: Object.values(cards).reduce((s, arr) => s + arr.length, 0),
  };
}

export const engineBoard = boardForMission;

// ── Live execution (canonical surface — truthful statuses only) ─────────────

export async function liveExecution(missionId: string) {
  const experiments = await listExperiments(missionId);
  const runIds = new Set<string>();
  const goalIds = new Set<string>();
  const taskIds = new Set<string>();
  for (const e of experiments as any[]) {
    (e.runIds || []).forEach((r: string) => runIds.add(r));
    (e.goalIds || []).forEach((g: string) => goalIds.add(g));
    (e.taskIds || []).forEach((t: string) => taskIds.add(t));
  }

  let rows: any[] = [];
  try {
    const ph = (n: number) => Array.from({ length: n }, () => '?').join(',');
    const clauses: string[] = [];
    const params: any[] = [];
    if (runIds.size > 0) { clauses.push(`er.id IN (${ph(runIds.size)})`); params.push(...runIds); }
    clauses.push(`er.task_id IN (SELECT id FROM project_tasks WHERE metadata LIKE '%"revenueOperator"%')`);
    const sql = `
      SELECT er.id, er.task_id, er.goal_id, er.worker_type, er.provider, er.model,
             er.status, er.start_time, er.end_time, er.created_at, er.failure_reason,
             pt.title AS task_title
      FROM execution_runs er
      LEFT JOIN project_tasks pt ON pt.id = er.task_id
      WHERE ${clauses.join(' OR ')}
      ORDER BY er.created_at DESC LIMIT 100`;
    rows = rawDb.prepare(sql).all(...params) as any[];
  } catch (e: any) {
    return { rows: [], note: `canonical execution tables unavailable: ${e?.message}` };
  }

  const expByRun = new Map<string, any>();
  for (const e of experiments as any[]) {
    for (const r of e.runIds || []) expByRun.set(r, e);
  }

  const out = rows.map((r) => {
    let verification: any = null;
    let argus: any = null;
    try {
      verification = rawDb.prepare(
        'SELECT verdict, verifier_provider, verifier_model, same_provider, created_at FROM verifications WHERE target_run_id = ? ORDER BY created_at DESC LIMIT 1',
      ).get(r.id) || null;
    } catch { /* verifications table optional */ }
    const exp = expByRun.get(r.id);
    const gid = r.goal_id || exp?.goalIds?.[0];
    if (gid) {
      try {
        const g = rawDb.prepare('SELECT id, status, verification_state FROM goals WHERE id = ?').get(gid) as any;
        if (g) argus = { goalId: g.id, goalStatus: g.status, verificationState: g.verification_state };
      } catch { /* goals lookup optional */ }
    }
    const startedMs = r.start_time ? Date.parse(r.start_time) : Date.parse(r.created_at);
    const endedMs = r.end_time ? Date.parse(r.end_time) : (r.status === 'running' || r.status === 'queued' ? Date.now() : startedMs);
    return {
      runId: r.id,
      task: r.task_title || '(untitled task)',
      taskId: r.task_id,
      executor: r.worker_type,
      provider: r.provider || null,
      model: r.model || null,
      status: r.status,                 // truthful DB status — never upgraded
      startedAt: r.start_time || r.created_at,
      elapsedMs: Number.isFinite(startedMs) ? Math.max(0, endedMs - startedMs) : null,
      failureReason: r.failure_reason || null,
      verification: verification ? { verdict: verification.verdict, verifierProvider: verification.verifier_provider, verifierModel: verification.verifier_model, sameProvider: !!verification.same_provider } : null,
      argus,
      experimentId: exp?.id || null,
      nextAction: exp ? (exp.engine === 'german_sme' ? smeNextAction(exp.status) : dpNextAction(exp.status)) : null,
    };
  });
  return { rows: out, goalIdsTracked: [...goalIds], taskIdsTracked: [...taskIds] };
}

// ── Human gates (actionable queue) ──────────────────────────────────────────

export const GATE_REQUIRED_ACTIONS: Record<string, string> = {
  SHOPIFY_AUTH_REQUIRED: 'Authorize Shopify via OAuth in the Shopify admin, then resolve this gate to resume publishing.',
  OAUTH_REQUIRED: 'Complete the OAuth authorization flow for the affected service, then resolve this gate.',
  CAPTCHA: 'A CAPTCHA blocks automation. Solve it manually in the target system, then resolve this gate.',
  KYC: 'Complete Know-Your-Customer verification with the provider, then resolve this gate.',
  CONTRACT_APPROVAL: 'Review the contract terms and approve or reject before the branch continues.',
  PAYMENT_APPROVAL: 'Approve the payment transaction manually; automation must not spend without approval.',
  OUTBOUND_APPROVAL: 'Review the outreach content and recipient; approve outbound contact or reject the branch.',
  LEGAL_REVIEW: 'Obtain legal review for this branch (e.g. outreach lawfulness) before continuing.',
  PLATFORM_RESTRICTION: 'A platform restriction applies. Adjust the approach or kill the branch; do not bypass.',
};

export async function gateQueue(status?: string) {
  const gates = listHumanGates(status);
  const out: any[] = [];
  for (const g of gates as any[]) {
    let experiment: any = null;
    if (g.experimentId) {
      experiment = await getExperiment(g.experimentId);
    }
    out.push({
      ...g,
      requiredAction: GATE_REQUIRED_ACTIONS[g.gateType] || 'Human confirmation required before this branch can continue.',
      blockingBranch: experiment
        ? { experimentId: experiment.id, title: experiment.product || experiment.targetCustomer || experiment.hypothesis, status: experiment.status, engine: experiment.engine }
        : (g.description || 'mission-level gate'),
      createdAt: g.createdAt,
    });
  }
  return out;
}

// ── Full drill-down traces ──────────────────────────────────────────────────

export async function traceExperiment(experimentId: string) {
  const exp = await getExperiment(experimentId);
  if (!exp) throw Object.assign(new Error('Experiment not found.'), { status: 404 });
  const events = db.select().from(revenueExperimentEvents)
    .where(eq(revenueExperimentEvents.experimentId, experimentId))
    .orderBy(desc(revenueExperimentEvents.createdAt)).all();
  const ledger = db.select().from(revenueLedgerEntries)
    .where(eq(revenueLedgerEntries.experimentId, experimentId))
    .orderBy(desc(revenueLedgerEntries.createdAt)).all();
  const gates = db.select().from(revenueHumanGates)
    .where(eq(revenueHumanGates.experimentId, experimentId))
    .orderBy(desc(revenueHumanGates.createdAt)).all();
  const compliance = db.select().from(revenueComplianceRecords)
    .where(eq(revenueComplianceRecords.experimentId, experimentId)).all();

  let runs: any[] = [];
  let verifications: any[] = [];
  try {
    const ids: string[] = (exp as any).runIds || [];
    if (ids.length > 0) {
      const ph = Array.from({ length: ids.length }, () => '?').join(',');
      runs = rawDb.prepare(
        `SELECT id, task_id, goal_id, worker_type, provider, model, status, start_time, end_time, failure_reason
         FROM execution_runs WHERE id IN (${ph}) ORDER BY created_at DESC`).all(...ids) as any[];
      verifications = rawDb.prepare(
        `SELECT id, target_run_id, verdict, verifier_provider, verifier_model, same_provider, created_at
         FROM verifications WHERE target_run_id IN (${ph}) ORDER BY created_at DESC`).all(...ids) as any[];
    }
  } catch { /* canonical tables optional in trace */ }

  let goalStates: any[] = [];
  try {
    for (const gid of (exp as any).goalIds || []) {
      const g = rawDb.prepare('SELECT id, status, verification_state, contract_id FROM goals WHERE id = ?').get(gid) as any;
      if (g) goalStates.push(g);
    }
  } catch { /* optional */ }

  const mission = (exp as any).missionId ? await getMission((exp as any).missionId) : null;
  return {
    experiment: exp,
    mission,
    nextAction: (exp as any).engine === 'german_sme' ? smeNextAction((exp as any).status) : dpNextAction((exp as any).status),
    argusState: argusStateForExperiment(exp),
    events, ledger, gates, compliance, runs, verifications, goalStates,
  };
}

export async function traceLedgerEntry(entryId: string) {
  const entry = db.select().from(revenueLedgerEntries).where(eq(revenueLedgerEntries.id, entryId)).get();
  if (!entry) throw Object.assign(new Error('Ledger entry not found.'), { status: 404 });
  const mission = entry.missionId ? await getMission(entry.missionId) : null;
  const experiment = entry.experimentId ? await getExperiment(entry.experimentId) : null;
  return { entry, mission, experiment };
}
