/**
 * germanSmeEngine.ts — M6 German SME AI Automation Engine.
 *
 * Drives the German SME outreach pipeline on the Revenue domain + canonical
 * execution surface. Compliance-first: every contact is persisted with opt-out,
 * do-not-contact, suppression, retention, and lawful-basis state; outreach is
 * gated behind a genuine HUMAN gate (OUTBOUND_APPROVAL). No bulk-spam infra.
 *
 * Pipeline (maps onto EXPERIMENT_LIFECYCLE):
 *   DISCOVERED (discover company) → VALIDATING (inspect business) →
 *   APPROVED (qualified GO) / KILLED (NO-GO) → BUILDING (draft offer) →
 *   QA (compliance review) → READY_TO_PUBLISH (gate approved) →
 *   PUBLISHING (outreach sent) → LIVE (contacted) → WON / LOST
 */
import {
  getMission,
  createExperiment,
  getExperiment,
  transitionExperiment,
  addExperimentEvidence,
  scoreExperiment,
  recordLedgerEntry,
  createComplianceRecord,
  updateComplianceRecord,
  createHumanGate,
} from './operatorService.js';
import { dispatchCanonicalTask, decideGoNoGo, resolveProjectId, type CanonicalDispatchOutcome } from './revenueEngine.js';

const now = () => new Date().toISOString();

/** Next SME pipeline action for a status (pure, testable). */
export function smeNextAction(status: string): string | null {
  switch (status) {
    case 'DISCOVERED': return 'inspect';
    case 'VALIDATING': return 'qualify';
    case 'APPROVED': return 'find_contact';
    case 'BUILDING': return 'gate';
    case 'QA': return 'approve_outreach';
    case 'READY_TO_PUBLISH': return 'outreach';
    case 'PUBLISHING': return 'track';
    case 'LIVE': return 'outcome';
    case 'WON':
    case 'LOST':
    case 'KILLED': return null;
    default: return null;
  }
}

/**
 * DISCOVER COMPANY — research German SMEs with automation pain points via
 * Hermes and create candidate experiments (status DISCOVERED).
 */
export async function discoverCompanies(
  missionId: string,
  opts: { projectId?: string; count?: number; sector?: string; market?: string } = {},
): Promise<{ experiments: any[]; dispatch: CanonicalDispatchOutcome }> {
  const mission = await getMission(missionId);
  if (!mission) throw Object.assign(new Error('Mission not found.'), { status: 404 });

  const projectId = resolveProjectId(opts.projectId ?? mission.projectId);
  if (!projectId) throw Object.assign(new Error('No canonical project available for discovery.'), { status: 400 });

  const count = opts.count ?? 5;
  const sector = opts.sector ?? 'SME (small and medium enterprises)';
  const market = opts.market ?? mission.primaryMarket ?? 'DE';
  const objective =
    `Discover ${count} legitimate German ${sector} businesses in ${market} that would benefit from AI automation ` +
    `(e.g. manual reporting, quoting, document processing, customer service, bookkeeping). ` +
    `For each return: company name, website (public), business type, a likely operational pain point, ` +
    `and why AI automation is relevant. Use only public business information — no personal data.`;

  const dispatch = await dispatchCanonicalTask({
    projectId,
    worker: 'hermes',
    title: 'German SME discovery research',
    objective,
    taskType: 'research',
    acceptanceCriteria: 'Return a structured list of German SMEs with public business info and automation pain points.',
  });

  const ideas = extractCompanies(dispatch.summary, dispatch.structuredOutput);
  const experiments: any[] = [];
  for (const idea of (ideas.length > 0 ? ideas : [{ name: dispatch.summary || 'German SME opportunity' }]).slice(0, count)) {
    const exp = await createExperiment({
      missionId,
      projectId,
      engine: 'german_sme',
      hypothesis: idea.name,
      targetCustomer: idea.name,
      problem: idea.problem || undefined,
      product: idea.offer || 'AI automation offer',
      distributionChannels: ['DIRECT_OUTREACH'],
    });
    if (!exp) throw new Error('Failed to create experiment (no row returned).');
    await addExperimentEvidence(exp.id, {
      classification: dispatch.ok ? 'FACT' : 'ESTIMATE',
      title: `Discovery evidence for "${idea.name}"`,
      source: 'hermes',
      summary: idea.note || 'German SME surfaced by discovery research.',
      provenance: `canonical-run:${dispatch.runId}`,
    });
    if (dispatch.runId) await linkRun(exp.id, dispatch.runId);
    experiments.push(exp);
  }
  return { experiments, dispatch };
}

async function linkRun(experimentId: string, runId: string) {
  const { linkExperimentRun } = await import('./operatorService.js');
  await linkExperimentRun(experimentId, 'run', runId);
}

/** Defensive parse of company list from a free-text/structured summary. */
export function extractCompanies(summary: string | null, structuredOutput?: Record<string, unknown> | null): Array<{ name: string; website?: string | null; problem?: string | null; note?: string | null; offer?: string | null }> {
  // PRIMARY SOURCE: canonical structured findings [{ claim, evidence[] }].
  const findings = (structuredOutput?.findings ?? structuredOutput?.results ?? null) as Array<Record<string, unknown>> | null;
  if (Array.isArray(findings) && findings.length > 0) {
    return findings.slice(0, 12).map((f) => {
      const claim = String(f.claim || f.name || f.company || '').slice(0, 160);
      const evidence = Array.isArray(f.evidence) ? (f.evidence as unknown[]).map((e) => String(typeof e === 'string' ? e : JSON.stringify(e))) : [];
      const chunk = [claim, ...evidence].join(' ');
      const urlMatch = chunk.match(/https?:\/\/[^\s,)]+|www\.[^\s,)]+/);
      return {
        name: claim || 'Untitled company',
        website: urlMatch ? urlMatch[0] : null,
        problem: evidence.join(' ').slice(0, 600) || null,
        note: chunk.slice(0, 900),
        offer: typeof f.offer === 'string' ? f.offer : null,
      };
    });
  }
  if (!summary) return [];
  const candidates = [summary];
  const fenced = summary.match(/```(?:json)?\s*\n([\s\S]*?)```/);
  if (fenced) candidates.push(fenced[1]);
  for (const text of candidates) {
    try {
      const parsed = JSON.parse(text.trim());
      const arr = Array.isArray(parsed) ? parsed : (parsed.companies || parsed.smes || parsed.list || []);
      if (Array.isArray(arr) && arr.length > 0) {
        return arr.map((x: any) => ({
          name: x.name || x.company || x.companyName || 'Untitled company',
          website: x.website || x.url || null,
          problem: x.problem || x.painPoint || null,
          note: x.note || x.relevance || null,
          offer: x.offer || null,
        }));
      }
    } catch { /* not JSON — fall through */ }
  }
  // Markdown / numbered-list fallback: each list item becomes one company.
  const lines = summary.split(/\r?\n/);
  const items: Array<{ title: string; body: string[] }> = [];
  const itemRe = /^\s*(?:\d+[.)]|[-*•])\s+(.*)$/;
  for (const line of lines) {
    const m = line.match(itemRe);
    if (m && m[1].trim().length >= 8) {
      items.push({ title: m[1].trim(), body: [] });
    } else if (items.length > 0 && line.trim()) {
      items[items.length - 1].body.push(line.trim());
    }
  }
  if (items.length === 0) {
    const blocks = summary.split(/\n(?=###\s)/);
    for (const b of blocks) {
      const hm = b.match(/^###\s+(.+)\n?([\s\S]*)$/);
      if (hm && hm[1].trim().length >= 8) items.push({ title: hm[1].trim(), body: (hm[2] || '').split(/\r?\n/).filter(Boolean) });
    }
  }
  if (items.length === 0) return [];
  return items.slice(0, 12).map((it) => {
    const chunk = [it.title, ...it.body].join(' ');
    const urlMatch = chunk.match(/https?:\/\/[^\s,)]+|www\.[^\s,)]+/);
    return {
      name: it.title.replace(/\*\*/g, '').slice(0, 120),
      website: urlMatch ? urlMatch[0] : null,
      problem: it.body.join(' ').slice(0, 500) || null,
      note: chunk.slice(0, 700),
      offer: null,
    };
  });
}

/**
 * INSPECT BUSINESS — research one company's public business profile via Hermes
 * and attach evidence, moving DISCOVERED → VALIDATING.
 */
export async function inspectCompany(experimentId: string, projectId?: string) {
  const exp = await getExperiment(experimentId);
  if (!exp) throw Object.assign(new Error('Experiment not found.'), { status: 404 });
  const mission = await getMission(exp.missionId);
  const pid = resolveProjectId(projectId ?? exp.projectId ?? mission?.projectId);
  if (!pid) throw Object.assign(new Error('No canonical project available.'), { status: 400 });

  if (exp.status === 'DISCOVERED') await transitionExperiment(experimentId, 'VALIDATING');

  const dispatch = await dispatchCanonicalTask({
    projectId: pid,
    worker: 'hermes',
    title: `Inspect company: ${exp.hypothesis}`,
    objective: `Inspect the public business profile of "${exp.hypothesis}" and identify concrete AI-automatable pain points, ` +
      `team size signals, and a relevant value proposition. Use only public sources.`,
    taskType: 'research',
    acceptanceCriteria: 'Return a structured business inspection with pain points and a relevance assessment.',
  });

  await addExperimentEvidence(experimentId, {
    classification: dispatch.ok ? 'FACT' : 'ESTIMATE',
    title: `Business inspection for "${exp.hypothesis}"`,
    source: 'hermes',
    summary: dispatch.summary || 'Inspection completed.',
    provenance: `canonical-run:${dispatch.runId}`,
  });
  if (dispatch.runId) await linkRun(experimentId, dispatch.runId);
  return { experiment: await getExperiment(experimentId), dispatch };
}

/**
 * QUALIFY — score the opportunity and GO/NO-GO (APPROVED = qualified to
 * pursue; KILLED = not qualified).
 */
export async function qualifyCompany(experimentId: string, inputs: Record<string, number> = {}, threshold?: number) {
  const exp = await getExperiment(experimentId);
  if (!exp) throw Object.assign(new Error('Experiment not found.'), { status: 404 });
  if (exp.status === 'VALIDATING' || exp.status === 'DISCOVERED') {
    if (exp.status === 'DISCOVERED') await transitionExperiment(experimentId, 'VALIDATING');
  }
  const score = await scoreExperiment(experimentId, inputs);
  const { go, reason } = decideGoNoGo(score.overallScore, threshold);
  const to = go ? 'APPROVED' : 'KILLED';
  const updated = await transitionExperiment(experimentId, to);
  await addExperimentEvidence(experimentId, {
    classification: 'FACT',
    title: go ? 'Qualified (GO)' : 'Not qualified (NO-GO)',
    summary: reason,
    provenance: 'german-sme-engine:qualify',
  });
  return { go, to, reason, score, experiment: updated };
}

/**
 * FIND LEGITIMATE BUSINESS CONTACT — research a public business contact and
 * create a compliance record with lawful basis + suppression defaults.
 */
export async function findContact(experimentId: string, projectId?: string) {
  const exp = await getExperiment(experimentId);
  if (!exp) throw Object.assign(new Error('Experiment not found.'), { status: 404 });
  const mission = await getMission(exp.missionId);
  const pid = resolveProjectId(projectId ?? exp.projectId ?? mission?.projectId);
  if (!pid) throw Object.assign(new Error('No canonical project available.'), { status: 400 });

  const dispatch = await dispatchCanonicalTask({
    projectId: pid,
    worker: 'hermes',
    title: `Find business contact: ${exp.hypothesis}`,
    objective: `Find the PUBLIC business contact (info@ or a published departmental contact) for "${exp.hypothesis}". ` +
      `Use only published business contact channels. Do NOT source personal data. Return the contact email/source and its public provenance.`,
    taskType: 'research',
    acceptanceCriteria: 'Return a published business contact with its public source, or explicit "none found".',
  });

  const record = await createComplianceRecord({
    experimentId,
    companyName: exp.hypothesis,
    contactSource: 'public_website',
    businessRelevance: exp.problem || 'AI automation relevance identified',
    purpose: 'One-time legitimate business inquiry about AI automation',
    lawfulBasis: 'legitimate_interest',
  });

  await addExperimentEvidence(experimentId, {
    classification: dispatch.ok ? 'FACT' : 'ESTIMATE',
    title: `Business contact for "${exp.hypothesis}"`,
    source: 'hermes',
    summary: dispatch.summary || 'Contact research completed.',
    provenance: `canonical-run:${dispatch.runId}`,
  });
  if (dispatch.runId) await linkRun(experimentId, dispatch.runId);
  return { compliance: record, dispatch };
}

/**
 * CREATE SPECIFIC OFFER — draft a tailored offer via Hermes, move to BUILDING.
 */
export async function createOffer(experimentId: string, projectId?: string) {
  const exp = await getExperiment(experimentId);
  if (!exp) throw Object.assign(new Error('Experiment not found.'), { status: 404 });
  const mission = await getMission(exp.missionId);
  const pid = resolveProjectId(projectId ?? exp.projectId ?? mission?.projectId);
  if (!pid) throw Object.assign(new Error('No canonical project available.'), { status: 400 });

  await transitionExperiment(experimentId, 'BUILDING');

  const dispatch = await dispatchCanonicalTask({
    projectId: pid,
    worker: 'hermes',
    title: `Draft offer: ${exp.hypothesis}`,
    objective: `Draft a concise, specific AI automation offer for "${exp.hypothesis}" addressing: ${exp.problem || 'operational efficiency'}. ` +
      `Include a concrete deliverable, expected outcome, and a clear call-to-action. Compliant, no bulk language.`,
    taskType: 'research',
    acceptanceCriteria: 'Return a specific, human-reviewable offer draft.',
  });

  await addExperimentEvidence(experimentId, {
    classification: 'FACT',
    title: `Offer drafted for "${exp.hypothesis}"`,
    source: 'hermes',
    summary: dispatch.summary || 'Offer drafted.',
    provenance: `canonical-run:${dispatch.runId}`,
  });
  if (dispatch.runId) await linkRun(experimentId, dispatch.runId);
  return { experiment: await getExperiment(experimentId), dispatch };
}

/**
 * GATE OUTREACH — require a genuine human approval before any outbound contact.
 */
export async function gateOutreach(experimentId: string, description?: string) {
  const exp = await getExperiment(experimentId);
  if (!exp) throw Object.assign(new Error('Experiment not found.'), { status: 404 });
  await transitionExperiment(experimentId, 'QA');
  const gate = await createHumanGate({
    experimentId,
    gateType: 'OUTBOUND_APPROVAL',
    description: description || `Approve outbound outreach to "${exp.hypothesis}".`,
    branchPaused: true,
  });
  return { gate };
}

/**
 * RECORD OUTREACH — after human approval, record the outreach attempt on the
 * compliance record and move the pipeline forward.
 */
export async function recordOutreach(experimentId: string, input: { channel?: string; note?: string }) {
  const exp = await getExperiment(experimentId);
  if (!exp) throw Object.assign(new Error('Experiment not found.'), { status: 404 });

  // Compliance enforcement: outreach is blocked while an OUTBOUND_APPROVAL
  // gate is still open (no outreach without human approval).
  const { listHumanGates, listCompliance } = await import('./operatorService.js');
  const gates = await listHumanGates();
  const openGate = gates.find((g) => g.experimentId === experimentId && g.gateType === 'OUTBOUND_APPROVAL' && g.status === 'open');
  if (openGate) {
    throw Object.assign(new Error('Outreach blocked: OUTBOUND_APPROVAL gate is still open.'), { status: 409 });
  }

  // QA → READY_TO_PUBLISH (gate approved) → PUBLISHING (outreach sent).
  let status = exp.status;
  if (status === 'QA') {
    await transitionExperiment(experimentId, 'READY_TO_PUBLISH');
    status = 'READY_TO_PUBLISH';
  }
  if (status === 'READY_TO_PUBLISH') {
    await transitionExperiment(experimentId, 'PUBLISHING');
  } else if (status !== 'PUBLISHING' && status !== 'LIVE') {
    throw Object.assign(new Error(`Outreach requires READY_TO_PUBLISH (current: ${status}).`), { status: 400 });
  }

  const records = await listCompliance(experimentId);
  const record = records.find((r) => r.experimentId === experimentId);
  if (record && (record.optOut || record.doNotContact)) {
    throw Object.assign(new Error('Outreach blocked: contact is suppressed (opt-out / do-not-contact).'), { status: 409 });
  }
  if (record) {
    const history = Array.isArray(record.outreachHistory) ? record.outreachHistory : [];
    await updateComplianceRecord(record.id, {
      outreachHistory: [...history, { channel: input.channel || 'email', note: input.note || 'Initial outreach', at: now() }],
    });
  }
  return { experiment: await getExperiment(experimentId), compliance: record };
}

/**
 * RECORD OUTCOME — WON (with optional verified revenue) or LOST.
 */
export async function recordOutcome(experimentId: string, input: { won: boolean; amount?: number }) {
  const exp = await getExperiment(experimentId);
  if (!exp) throw Object.assign(new Error('Experiment not found.'), { status: 404 });

  const to = input.won ? 'WON' : 'LOST';
  const updated = await transitionExperiment(experimentId, to);

  let ledger = null;
  if (input.won && input.amount != null && input.amount > 0) {
    ledger = await recordLedgerEntry({
      missionId: exp.missionId,
      experimentId,
      entryType: 'REALIZED_REVENUE',
      amount: input.amount,
      source: 'direct_outreach',
    });
  }

  await addExperimentEvidence(experimentId, {
    classification: 'FACT',
    title: input.won ? 'Deal won' : 'Deal lost',
    summary: input.won ? `Won with revenue ${input.amount ?? 0}.` : 'Opportunity closed without a deal.',
    provenance: 'german-sme-engine:outcome',
  });

  return { experiment: updated, ledger };
}
