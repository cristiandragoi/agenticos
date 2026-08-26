/**
 * Revenue Operator Phase 1 — domain service.
 *
 * EXTENDS the canonical Agentic OS systems (goals, tasks, runs, ARGUS, canonical
 * verifier, project memory). This service deliberately does NOT create parallel
 * execution infrastructure: experiments link canonical goal/task/run ids; ARGUS
 * and the canonical verifier remain authoritative for verification.
 *
 * Domain tables (see db/schema.ts — revenue operator section):
 *   revenue_missions, revenue_experiments, revenue_experiment_events,
 *   revenue_ledger_entries, revenue_distribution_channels,
 *   revenue_compliance_records, revenue_human_gates
 */
import crypto from 'crypto';
import { db } from '../../db/index.js';
import { revenueMissions, revenueExperiments, revenueExperimentEvents, revenueLedgerEntries, revenueDistributionChannels, revenueComplianceRecords, revenueHumanGates, } from '../../db/schema.js';
import { eq, desc } from 'drizzle-orm';
// ── vocabulary ──────────────────────────────────────────────────────────────
export const EXPERIMENT_LIFECYCLE = [
    'DISCOVERED', 'VALIDATING', 'APPROVED', 'BUILDING', 'QA', 'READY_TO_PUBLISH',
    'PUBLISHING', 'LIVE', 'ITERATING', 'SCALING', 'WON', 'LOST', 'KILLED',
];
// Forward transitions (KILLED reachable from any active state; WON/LOST are the
// German SME pipeline terminal states reachable from the outreach states).
const VALID_TRANSITIONS = {
    DISCOVERED: ['VALIDATING', 'APPROVED', 'KILLED'],
    VALIDATING: ['APPROVED', 'DISCOVERED', 'KILLED'],
    APPROVED: ['BUILDING', 'QA', 'VALIDATING', 'KILLED'],
    BUILDING: ['QA', 'APPROVED', 'KILLED'],
    QA: ['READY_TO_PUBLISH', 'BUILDING', 'KILLED'],
    READY_TO_PUBLISH: ['PUBLISHING', 'QA', 'KILLED'],
    PUBLISHING: ['LIVE', 'READY_TO_PUBLISH', 'WON', 'LOST', 'KILLED'],
    LIVE: ['ITERATING', 'SCALING', 'PUBLISHING', 'WON', 'LOST', 'KILLED'],
    ITERATING: ['LIVE', 'SCALING', 'WON', 'LOST', 'KILLED'],
    SCALING: ['LIVE', 'ITERATING', 'WON', 'LOST', 'KILLED'],
    WON: [],
    LOST: [],
    KILLED: [],
};
export const LEDGER_TYPES = [
    'PIPELINE_VALUE', 'PROPOSED_VALUE', 'ORDER_VALUE', 'REALIZED_REVENUE',
    'VERIFIED_REVENUE', 'REFUNDED_REVENUE', 'ACTUAL_COST', 'NET_REVENUE',
];
// Only these entry types may flow into the mission's VERIFIED/REALIZED numbers.
const REVENUE_COUNTING_TYPES = new Set(['REALIZED_REVENUE', 'VERIFIED_REVENUE', 'REFUNDED_REVENUE']);
export const CHANNELS = [
    'SHOPIFY', 'EMAIL', 'GOOGLE', 'SEO', 'GEO', 'INSTAGRAM', 'TIKTOK',
    'FACEBOOK', 'MARKETPLACE', 'DIRECT_OUTREACH',
];
export const HUMAN_GATE_TYPES = [
    'SHOPIFY_AUTH_REQUIRED', 'OAUTH_REQUIRED', 'CAPTCHA', 'KYC',
    'CONTRACT_APPROVAL', 'PAYMENT_APPROVAL', 'OUTBOUND_APPROVAL',
    'LEGAL_REVIEW', 'PLATFORM_RESTRICTION',
];
// ── helpers ─────────────────────────────────────────────────────────────────
const now = () => new Date().toISOString();
const uid = (prefix) => `${prefix}-${crypto.randomUUID().slice(0, 9)}`;
async function addExperimentEvent(experimentId, eventType, prev, next, actorType = 'system', actorId = 'system', metadata = {}) {
    await db.insert(revenueExperimentEvents).values({
        id: uid('reve'),
        experimentId,
        eventType,
        previousStatus: prev,
        nextStatus: next,
        actorType,
        actorId,
        metadata,
        createdAt: now(),
    });
}
// ── Revenue Mission ─────────────────────────────────────────────────────────
export async function createMission(input) {
    const t = now();
    const id = uid('mission');
    await db.insert(revenueMissions).values({
        id,
        projectId: input.projectId || null,
        title: input.title,
        description: input.description || null,
        targetAmount: input.targetAmount,
        currency: input.currency || 'EUR',
        startDate: input.startDate,
        deadline: input.deadline,
        advertisingBudget: input.advertisingBudget || 0,
        actualSpend: 0,
        enabledEngines: input.enabledEngines ?? ['digital_products', 'german_sme'],
        availableChannels: input.availableChannels ?? null,
        primaryMarket: input.primaryMarket || 'DE/EU',
        status: 'active',
        realizedRevenue: 0, verifiedRevenue: 0, pipelineValue: 0, actualCost: 0, netRevenue: 0,
        createdAt: t, updatedAt: t,
    });
    const row = db.select().from(revenueMissions).where(eq(revenueMissions.id, id)).get();
    return row;
}
export async function getMission(id) {
    return db.select().from(revenueMissions).where(eq(revenueMissions.id, id)).get();
}
export async function listMissions() {
    return db.select().from(revenueMissions).orderBy(desc(revenueMissions.createdAt)).all();
}
export async function updateMission(id, patch) {
    await db.update(revenueMissions).set({ ...patch, updatedAt: now() }).where(eq(revenueMissions.id, id)).run();
    return getMission(id);
}
/** Recompute mission aggregates from its ledger entries (single source of truth). */
export function recomputeMissionAggregates(missionId) {
    const entries = db.select().from(revenueLedgerEntries).where(eq(revenueLedgerEntries.missionId, missionId)).all();
    let realizedRevenue = 0, verifiedRevenue = 0, pipelineValue = 0, actualCost = 0;
    for (const e of entries) {
        if (e.entryType === 'REALIZED_REVENUE')
            realizedRevenue += e.amount;
        if (e.entryType === 'VERIFIED_REVENUE')
            verifiedRevenue += e.amount;
        if (e.entryType === 'REFUNDED_REVENUE')
            realizedRevenue -= e.amount;
        if (e.entryType === 'PIPELINE_VALUE')
            pipelineValue += e.amount;
        if (e.entryType === 'ACTUAL_COST')
            actualCost += Math.abs(e.amount);
    }
    const netRevenue = realizedRevenue - actualCost;
    db.update(revenueMissions).set({
        realizedRevenue, verifiedRevenue, pipelineValue, actualCost, netRevenue, updatedAt: now(),
    }).where(eq(revenueMissions.id, missionId)).run();
    return { realizedRevenue, verifiedRevenue, pipelineValue, actualCost, netRevenue };
}
// ── Revenue Experiment ──────────────────────────────────────────────────────
export async function createExperiment(input) {
    const mission = await getMission(input.missionId);
    if (!mission)
        throw Object.assign(new Error('Mission not found.'), { status: 404 });
    const t = now();
    const id = uid('expt');
    await db.insert(revenueExperiments).values({
        id,
        missionId: input.missionId,
        projectId: input.projectId || mission.projectId || null,
        opportunityId: input.opportunityId || null,
        engine: input.engine,
        hypothesis: input.hypothesis,
        targetCustomer: input.targetCustomer || null,
        problem: input.problem || null,
        product: input.product || null,
        offer: input.offer || null,
        price: input.price ?? null,
        evidence: null,
        evidenceSources: null,
        confidence: input.confidence ?? null,
        competitors: null,
        distributionChannels: input.distributionChannels ?? null,
        estimatedCost: input.estimatedCost || 0,
        actualCost: 0,
        expectedRevenue: input.expectedRevenue || 0,
        actualRevenue: 0, verifiedRevenue: 0,
        status: 'DISCOVERED',
        createdAt: t, updatedAt: t,
    });
    await addExperimentEvent(id, 'experiment_discovered', null, 'DISCOVERED');
    return db.select().from(revenueExperiments).where(eq(revenueExperiments.id, id)).get();
}
export async function getExperiment(id) {
    return db.select().from(revenueExperiments).where(eq(revenueExperiments.id, id)).get();
}
export async function listExperiments(missionId) {
    const q = db.select().from(revenueExperiments);
    if (missionId)
        return q.where(eq(revenueExperiments.missionId, missionId)).orderBy(desc(revenueExperiments.createdAt)).all();
    return q.orderBy(desc(revenueExperiments.createdAt)).all();
}
/** Validated lifecycle transition (contract §9). Returns [row, error?]. */
export async function transitionExperiment(id, toStatus) {
    const row = await getExperiment(id);
    if (!row)
        throw Object.assign(new Error('Experiment not found.'), { status: 404 });
    const from = row.status;
    if (from === toStatus)
        return getExperiment(id);
    const allowed = VALID_TRANSITIONS[from] || [];
    if (!allowed.includes(toStatus)) {
        throw Object.assign(new Error(`Invalid experiment transition ${from} → ${toStatus}.`), { status: 400 });
    }
    db.update(revenueExperiments).set({ status: toStatus, updatedAt: now() }).where(eq(revenueExperiments.id, id)).run();
    const eventType = toStatus === 'KILLED' ? 'experiment_killed' : `experiment_${toStatus.toLowerCase().replace(/_/g, '_')}`;
    await addExperimentEvent(id, eventType, from, toStatus);
    return getExperiment(id);
}
/** Add an evidence entry (contract §10 — classification, source, provenance). */
export async function addExperimentEvidence(id, evidence) {
    const row = await getExperiment(id);
    if (!row)
        throw Object.assign(new Error('Experiment not found.'), { status: 404 });
    const entry = {
        id: uid('ev'),
        classification: evidence.classification || 'UNKNOWN',
        title: evidence.title,
        source: evidence.source || null,
        sourceUrl: evidence.sourceUrl || null,
        capturedAt: evidence.capturedAt || now(),
        summary: evidence.summary,
        confidence: evidence.confidence ?? null,
        provenance: evidence.provenance || null,
    };
    const current = Array.isArray(row.evidence) ? row.evidence : [];
    const updated = [...current, entry];
    db.update(revenueExperiments).set({ evidence: updated, updatedAt: now() }).where(eq(revenueExperiments.id, id)).run();
    await addExperimentEvent(id, 'evidence_added', row.status, row.status, 'system', 'system', { evidenceId: entry.id });
    return entry;
}
/** Link canonical goal/task/run/artifact ids to an experiment (no parallel engine). */
export async function linkExperimentRun(id, kind, refId) {
    const row = await getExperiment(id);
    if (!row)
        throw Object.assign(new Error('Experiment not found.'), { status: 404 });
    const field = kind === 'goal' ? 'goalIds' : kind === 'task' ? 'taskIds' : kind === 'run' ? 'runIds' : 'artifactIds';
    const cur = Array.isArray(row[field]) ? row[field] : [];
    if (!cur.includes(refId))
        cur.push(refId);
    db.update(revenueExperiments).set({ [field]: cur, updatedAt: now() }).where(eq(revenueExperiments.id, id)).run();
    return getExperiment(id);
}
/**
 * Opportunity scoring (contract §11). Normalized components 0..1, confidence,
 * explanation, unknown values, evidence links. Not mathematically exact.
 *   Demand × PurchaseIntent × ExpectedMargin × DistributionProbability ×
 *   AutomationPotential × CompetitiveAdvantage
 *   ÷ (BuildTime × AcquisitionDifficulty × CapitalRequirement × Risk)
 */
export async function scoreExperiment(id, inputs) {
    const row = await getExperiment(id);
    if (!row)
        throw Object.assign(new Error('Experiment not found.'), { status: 404 });
    const clamp = (v, d) => (typeof v === 'number' && isFinite(v) && v >= 0 ? Math.min(v, 1) : d);
    const components = {
        demand: clamp(inputs.demand, 0.5),
        purchaseIntent: clamp(inputs.purchaseIntent, 0.5),
        expectedMargin: clamp(inputs.expectedMargin, 0.5),
        distributionProbability: clamp(inputs.distributionProbability, 0.5),
        automationPotential: clamp(inputs.automationPotential, 0.5),
        competitiveAdvantage: clamp(inputs.competitiveAdvantage, 0.5),
        buildTime: clamp(inputs.buildTime, 0.5),
        acquisitionDifficulty: clamp(inputs.acquisitionDifficulty, 0.5),
        capitalRequirement: clamp(inputs.capitalRequirement, 0.5),
        risk: clamp(inputs.risk, 0.5),
    };
    const numerator = components.demand * components.purchaseIntent * components.expectedMargin *
        components.distributionProbability * components.automationPotential * components.competitiveAdvantage;
    const denominator = components.buildTime * components.acquisitionDifficulty * components.capitalRequirement * components.risk;
    const overall = denominator > 0 ? numerator / denominator : 0;
    const provided = Object.values(inputs).filter((v) => typeof v === 'number').length;
    const confidence = provided >= 8 ? 'high' : provided >= 5 ? 'medium' : 'low';
    const reasons = [];
    if (components.demand >= 0.7)
        reasons.push('Demand signal is strong.');
    if (components.automationPotential >= 0.7)
        reasons.push('High automation potential — low marginal effort per sale.');
    if (components.buildTime < 0.4)
        reasons.push('Low build effort — fast to first experiment.');
    const missing = Object.keys(components).filter((k) => typeof inputs[k] !== 'number').map((k) => `missing ${k}`);
    const scorePayload = {
        overallScore: Math.round(overall * 1000) / 1000,
        components,
        confidence,
        explanation: reasons.length ? reasons.join(' ') : 'No dominant factor; balanced profile.',
        missingInformation: missing,
        assumptions: missing.map((m) => `assumed neutral 0.5 for ${m.replace('missing ', '')}`),
        scoredAt: now(),
        scoringVersion: 'revenue-operator-v1',
    };
    db.update(revenueExperiments).set({ scorePayload, updatedAt: now() }).where(eq(revenueExperiments.id, id)).run();
    return scorePayload;
}
// ── Revenue Ledger ──────────────────────────────────────────────────────────
/**
 * Record a ledger entry (contract §23/§24). VERIFIED_REVENUE is only allowed
 * with evidence + provenance. No fake revenue: proposals/listings/estimates
 * map to PIPELINE_VALUE/PROPOSED_VALUE and never count as realized cash.
 */
export async function recordLedgerEntry(input) {
    if (!LEDGER_TYPES.includes(input.entryType))
        throw Object.assign(new Error(`Invalid ledger type: ${input.entryType}`), { status: 400 });
    const mission = await getMission(input.missionId);
    if (!mission)
        throw Object.assign(new Error('Mission not found.'), { status: 404 });
    if (input.entryType === 'VERIFIED_REVENUE') {
        if (!input.evidence || !Array.isArray(input.evidence) || input.evidence.length === 0) {
            throw Object.assign(new Error('VERIFIED_REVENUE requires evidence (transaction record / provenance).'), { status: 400 });
        }
    }
    if (input.entryType === 'REALIZED_REVENUE' && input.amount < 0) {
        throw Object.assign(new Error('Use REFUNDED_REVENUE for negative revenue adjustments.'), { status: 400 });
    }
    const t = now();
    const id = uid('ledg');
    const verified = input.entryType === 'VERIFIED_REVENUE';
    db.insert(revenueLedgerEntries).values({
        id,
        missionId: input.missionId,
        experimentId: input.experimentId || null,
        entryType: input.entryType,
        amount: input.amount,
        currency: input.currency || 'EUR',
        status: verified ? 'verified' : 'recorded',
        evidence: input.evidence ?? null,
        provenance: input.provenance ?? null,
        source: input.source || null,
        verifiedAt: verified ? t : null,
        verifiedBy: verified ? 'ARGUS_LEDGER_RULE' : null,
        createdAt: t, updatedAt: t,
    }).run();
    // Recompute mission aggregates for every ledger type that affects them
    // (revenue, cost, and pipeline — not just revenue types).
    if (['VERIFIED_REVENUE', 'REALIZED_REVENUE', 'REFUNDED_REVENUE', 'ACTUAL_COST', 'PIPELINE_VALUE'].includes(input.entryType)) {
        recomputeMissionAggregates(input.missionId);
    }
    if (input.experimentId) {
        const exp = await getExperiment(input.experimentId);
        if (exp) {
            const t2 = now();
            if (input.entryType === 'VERIFIED_REVENUE') {
                const curV = exp.verifiedRevenue || 0;
                db.update(revenueExperiments).set({ verifiedRevenue: curV + input.amount, actualRevenue: (exp.actualRevenue || 0) + input.amount, updatedAt: t2 }).where(eq(revenueExperiments.id, exp.id)).run();
                await addExperimentEvent(exp.id, 'revenue_verified', exp.status, exp.status, 'system', 'ledger', { entryId: id, amount: input.amount });
            }
            else if (input.entryType === 'REALIZED_REVENUE') {
                db.update(revenueExperiments).set({ actualRevenue: (exp.actualRevenue || 0) + input.amount, sales: (exp.sales || 0) + 1, updatedAt: t2 }).where(eq(revenueExperiments.id, exp.id)).run();
                await addExperimentEvent(exp.id, 'sale_recorded', exp.status, exp.status, 'system', 'ledger', { entryId: id, amount: input.amount });
            }
        }
    }
    return db.select().from(revenueLedgerEntries).where(eq(revenueLedgerEntries.id, id)).get();
}
export function listLedger(missionId) {
    const q = db.select().from(revenueLedgerEntries);
    if (missionId)
        return q.where(eq(revenueLedgerEntries.missionId, missionId)).orderBy(desc(revenueLedgerEntries.createdAt)).all();
    return q.orderBy(desc(revenueLedgerEntries.createdAt)).all();
}
// ── Distribution channels ───────────────────────────────────────────────────
export function seedChannels() {
    const defaults = {
        SHOPIFY: { capabilities: ['authenticate', 'catalog', 'product', 'listing', 'publish', 'checkout', 'orders', 'analytics', 'revenue', 'inventory'], automationAllowed: true, humanGateRequired: true, status: 'auth_required' },
        EMAIL: { capabilities: ['message', 'measure'], automationAllowed: true, humanGateRequired: false, status: 'configured' },
        GOOGLE: { capabilities: ['discover', 'measure'], automationAllowed: true, humanGateRequired: false, status: 'configured' },
        SEO: { capabilities: ['publish', 'measure'], automationAllowed: true, humanGateRequired: false, status: 'configured' },
        GEO: { capabilities: ['publish', 'measure'], automationAllowed: true, humanGateRequired: false, status: 'configured' },
        INSTAGRAM: { capabilities: ['publish', 'message', 'measure'], automationAllowed: false, humanGateRequired: true, status: 'configured' },
        TIKTOK: { capabilities: ['publish', 'message', 'measure'], automationAllowed: false, humanGateRequired: true, status: 'configured' },
        FACEBOOK: { capabilities: ['publish', 'message', 'measure'], automationAllowed: false, humanGateRequired: true, status: 'configured' },
        MARKETPLACE: { capabilities: ['publish', 'sell', 'measure'], automationAllowed: true, humanGateRequired: false, status: 'configured' },
        DIRECT_OUTREACH: { capabilities: ['message', 'measure'], automationAllowed: true, humanGateRequired: false, status: 'configured' },
    };
    const t = now();
    for (const [channel, cfg] of Object.entries(defaults)) {
        const existing = db.select().from(revenueDistributionChannels).where(eq(revenueDistributionChannels.channel, channel)).get();
        if (!existing) {
            db.insert(revenueDistributionChannels).values({
                id: uid('chan'),
                channel,
                capabilities: Object.fromEntries(cfg.capabilities.map((c) => [c, true])),
                automationAllowed: cfg.automationAllowed,
                humanGateRequired: cfg.humanGateRequired,
                status: cfg.status,
                config: null,
                createdAt: t, updatedAt: t,
            }).run();
        }
    }
    return listChannels();
}
export function listChannels() {
    return db.select().from(revenueDistributionChannels).orderBy(revenueDistributionChannels.channel).all();
}
export function updateChannel(id, patch) {
    const data = { updatedAt: now() };
    if (patch.status)
        data.status = patch.status;
    if (patch.config !== undefined)
        data.config = patch.config;
    if (patch.automationAllowed !== undefined)
        data.automationAllowed = patch.automationAllowed;
    if (patch.humanGateRequired !== undefined)
        data.humanGateRequired = patch.humanGateRequired;
    db.update(revenueDistributionChannels).set(data).where(eq(revenueDistributionChannels.id, id)).run();
    return db.select().from(revenueDistributionChannels).where(eq(revenueDistributionChannels.id, id)).get();
}
// ── Compliance ──────────────────────────────────────────────────────────────
export function createComplianceRecord(input) {
    const t = now();
    const id = uid('comp');
    db.insert(revenueComplianceRecords).values({
        id,
        experimentId: input.experimentId || null,
        companyName: input.companyName || null,
        website: input.website || null,
        contactEmail: input.contactEmail || null,
        contactSource: input.contactSource || null,
        businessRelevance: input.businessRelevance || null,
        purpose: input.purpose || null,
        outreachHistory: null,
        optOut: false, doNotContact: false,
        suppressionState: 'none',
        retentionState: 'active',
        lawfulBasis: input.lawfulBasis || null,
        complianceReviewState: 'not_required',
        createdAt: t, updatedAt: t,
    }).run();
    return db.select().from(revenueComplianceRecords).where(eq(revenueComplianceRecords.id, id)).get();
}
export function listCompliance(experimentId) {
    const q = db.select().from(revenueComplianceRecords);
    if (experimentId)
        return q.where(eq(revenueComplianceRecords.experimentId, experimentId)).orderBy(desc(revenueComplianceRecords.createdAt)).all();
    return q.orderBy(desc(revenueComplianceRecords.createdAt)).all();
}
export function updateComplianceRecord(id, patch) {
    const data = { updatedAt: now() };
    if (patch.optOut !== undefined) {
        data.optOut = patch.optOut;
        if (patch.optOut)
            data.suppressionState = 'opt_out';
    }
    if (patch.doNotContact !== undefined) {
        data.doNotContact = patch.doNotContact;
        if (patch.doNotContact)
            data.suppressionState = 'do_not_contact';
    }
    if (patch.suppressionState)
        data.suppressionState = patch.suppressionState;
    if (patch.retentionState)
        data.retentionState = patch.retentionState;
    if (patch.complianceReviewState)
        data.complianceReviewState = patch.complianceReviewState;
    if (patch.outreachHistory !== undefined)
        data.outreachHistory = patch.outreachHistory;
    db.update(revenueComplianceRecords).set(data).where(eq(revenueComplianceRecords.id, id)).run();
    return db.select().from(revenueComplianceRecords).where(eq(revenueComplianceRecords.id, id)).get();
}
// ── Human gates ─────────────────────────────────────────────────────────────
export function createHumanGate(input) {
    if (!HUMAN_GATE_TYPES.includes(input.gateType)) {
        throw Object.assign(new Error(`Invalid gate type: ${input.gateType}`), { status: 400 });
    }
    const t = now();
    const id = uid('gate');
    db.insert(revenueHumanGates).values({
        id,
        experimentId: input.experimentId || null,
        gateType: input.gateType,
        status: 'open',
        description: input.description || null,
        branchPaused: !!input.branchPaused,
        resolvedBy: null, resolvedAt: null,
        metadata: null,
        createdAt: t, updatedAt: t,
    }).run();
    return db.select().from(revenueHumanGates).where(eq(revenueHumanGates.id, id)).get();
}
export function listHumanGates(status) {
    const q = db.select().from(revenueHumanGates);
    if (status)
        return q.where(eq(revenueHumanGates.status, status)).orderBy(desc(revenueHumanGates.createdAt)).all();
    return q.orderBy(desc(revenueHumanGates.createdAt)).all();
}
export async function resolveHumanGate(id, resolvedBy) {
    const t = now();
    db.update(revenueHumanGates).set({ status: 'resolved', resolvedBy, resolvedAt: t, branchPaused: false, updatedAt: t }).where(eq(revenueHumanGates.id, id)).run();
    const gate = db.select().from(revenueHumanGates).where(eq(revenueHumanGates.id, id)).get();
    if (gate?.experimentId) {
        await addExperimentEvent(gate.experimentId, 'human_gate_resolved', null, null, 'human', resolvedBy, { gateId: id });
        try {
            const { revenueSupervisor } = await import('./revenueSupervisor.js');
            await revenueSupervisor.onGateResolved(gate);
        }
        catch (err) {
            console.warn('[OperatorService] Supervisor gate wake warning:', err?.message);
        }
    }
    return gate;
}
// ── Observability (contract §32) ────────────────────────────────────────────
export async function missionObservability(missionId) {
    const mission = await getMission(missionId);
    if (!mission)
        throw Object.assign(new Error('Mission not found.'), { status: 404 });
    const experiments = await listExperiments(missionId);
    const gates = listHumanGates('open');
    const ledger = await listLedger(missionId);
    return {
        missionId,
        whatIsRunning: experiments.filter((e) => ['BUILDING', 'QA', 'READY_TO_PUBLISH', 'PUBLISHING', 'ITERATING', 'SCALING'].includes(e.status)).map((e) => ({ id: e.id, status: e.status })),
        whatIsQueued: experiments.filter((e) => ['DISCOVERED', 'VALIDATING', 'APPROVED'].includes(e.status)).map((e) => ({ id: e.id, status: e.status })),
        whatIsBlocked: experiments.filter((e) => e.status === 'KILLED').map((e) => ({ id: e.id, status: e.status })),
        openHumanGates: gates.filter((g) => !g.experimentId || experiments.some((e) => e.id === g.experimentId)).map((g) => ({ id: g.id, gateType: g.gateType, status: g.status })),
        ledger: { entries: ledger.length, verifiedRevenue: ledger.filter((l) => l.entryType === 'VERIFIED_REVENUE').reduce((s, l) => s + l.amount, 0) },
        aggregates: {
            realizedRevenue: mission.realizedRevenue,
            verifiedRevenue: mission.verifiedRevenue,
            pipelineValue: mission.pipelineValue,
            actualCost: mission.actualCost,
            netRevenue: mission.netRevenue,
        },
    };
}
