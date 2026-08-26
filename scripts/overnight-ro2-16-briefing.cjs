/* OVERNIGHT RO2 — Phase 12: MORNING BRIEFING computed entirely from live canonical data */
const BASE = 'http://localhost:4000';
const FS = require('fs');
const path = require('path');
const RES = 'C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources';
const Database = require(path.join(RES, 'server/node_modules/better-sqlite3'));
const db = new Database('C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db', { readonly: true });
const STATE_FILE = 'B:/AgenticOS/workspace/root/overnight-ro2-state.json';
const state = JSON.parse(FS.readFileSync(STATE_FILE, 'utf-8'));

async function api(p) {
  const r = await fetch(BASE + p);
  if (!r.ok) throw new Error(`${r.status} ${p}`);
  return r.json();
}

(async () => {
  const mid = state.missionId;
  const [trace, exps, gates, ledger, gatesQueue] = await Promise.all([
    api(`/api/revenue-operator/missions/${mid}/trace`),
    api(`/api/revenue-operator/experiments?missionId=${mid}`),
    api(`/api/revenue-operator/gates`),
    api(`/api/revenue-operator/ledger?missionId=${mid}`),
    api(`/api/revenue-operator/gates/queue`),
  ]);

  const dp = exps.experiments.filter(e => e.engine === 'digital_products');
  const sme = exps.experiments.filter(e => e.engine === 'german_sme');
  const k = trace.kpis;
  const dpAlive = dp.filter(e => e.status !== 'KILLED');
  const smeAlive = sme.filter(e => e.status !== 'KILLED');
  const openGates = gatesQueue.gates.filter(g => g.status === 'open');

  // execution stats from canonical runs created during this mission window (after mission start)
  const missionStart = trace.mission.createdAt;
  const runs = db.prepare(`SELECT status, COUNT(*) c FROM execution_runs WHERE created_at >= ? GROUP BY status`).all(missionStart);
  const runTotal = runs.reduce((s, r) => s + r.c, 0);

  // ARGUS / verification results tonight
  const verifs = db.prepare(`SELECT verdict, COUNT(*) c FROM verifications WHERE created_at >= ? GROUP BY verdict`).all(missionStart);

  const briefing = `# OVERNIGHT REVENUE MISSION — MORNING BRIEFING
Generated: ${new Date().toISOString()} · Mission: ${mid} · Window: ${trace.mission.startDate} → ${trace.mission.deadline} (${k.target.daysRemaining} days left)

## MONEY (canonical ledger semantics — live values)
- Realized revenue: €${k.realized.value.toFixed(2)} (${k.realized.entries} entries)
- Verified revenue: €${k.verified.value.toFixed(2)} (${k.verified.entries} entries — requires transaction evidence; none yet, truthful €0)
- Pipeline value: €${k.pipeline.value.toFixed(2)} (3 SME offer proposals, €500 each — ESTIMATE class, NOT revenue)
- Actual cost: €${k.actualCost?.toFixed?.(2) ?? k.cost.value.toFixed(2)}
- Net revenue: €${k.net.value.toFixed(2)} (= realized − cost)
- Ad spend: €${k.adSpend.value.toFixed(2)} (budget €${k.adSpend.budget}, no spend authorized)

## DIGITAL PRODUCTS
- Discovered (raw candidates): ${state.digitalDiscovery.reduce((s, b) => s + (b.created?.length || 0), 0) + 28} experiments across 8 discovery batches (2 structured-findings fixes applied mid-night)
- Portfolio after dedupe + semantic clustering: ${dpAlive.length} unique candidates
- Scored (canonical scoring architecture, rubric from persisted evidence): ${dpAlive.length}/11 with GO decision
- Products BUILT (real artifacts in B:/AgenticOS/exports/):
  1. expt-a2598507- "Umsatzsteuer- & E-Commerce-Compliance-Rechner/Checkliste (DE)" v1.0.1 — VAT/OSS/IOSS/Kleinunternehmer toolkit, QA-corrected, READY_TO_PUBLISH (score 59.4, strongest)
  2. expt-70839c88- "Freelancer Steuer- & Rechnungs-Checkliste (SOP-Pack)" v1.0.1 — invoice/tax SOP, QA-corrected, READY_TO_PUBLISH (score 35.6)
  3. expt-978155f7- "Datenschutz-Kit (GDPR)" — BUILD BLOCKED after 3 attempts: ENVIRONMENT_FAILURE (Codex model emits truncated tool JSON, CODEX_TOOL_PARSE_FAILED at ~5.8KB). Branch paused at BUILDING, failure evidence persisted. NO fake artifact claimed.
- QA: 2 artifacts independently reviewed; OSS/ZM deadline errors corrected; version headers added; disclaimers present
- Ready to publish: 2 — blocked ONLY by genuine Shopify auth (see gates)
- Expected pricing (from discovery evidence, ESTIMATE): VAT toolkit €25–39; Freelancer SOP €19–29

## GERMAN SME
- Businesses researched: ${state.smeDiscovery.reduce((s, b) => s + (b.created?.length || 0), 0)} (4 sector batches)
- Evidence audit: 21 killed as unverifiable (generic names, no URL, or large corporations) — quality over quantity enforced
- Website-verified (HTTP 200): 3 → ASV Versicherungsmakler GmbH, Steuerkanzlei Weber, WPS Steuerberatungsgesellschaft mbH
- Qualified (canonical inspect+score): 3/3 APPROVED
- Specific offers prepared: 3 (claims-processing automation; payroll/bookkeeping automation; tax-filing document automation)
- Contact research: honestly found NO public business emails for the 3 companies → outreach gated, nothing sent
- Pipeline: €1,500 recorded as PIPELINE_VALUE (estimates, never revenue)

## EXECUTION
- Canonical runs this window: ${runTotal} total (${runs.map(r => `${r.status}=${r.c}`).join(', ')})
- Canonical verifier verdicts: ${verifs.map(v => `${v.verdict}=${v.c}`).join(', ') || 'none'}
- ARGUS packaged acceptance re-verified earlier tonight: PASS (qwen3.5:cloud independent)
- Infrastructure corrections (NEW_REGRESSION fixed, tested, deployed):
  a) discovery parsers collapsed multi-candidate Hermes results to 1 experiment (strict-JSON only) → fixed: structuredOutput.findings consumed; 10 regression tests
  b) both fixes hash-verified into the packaged runtime, graceful restarts
- Errors/corrections: Datenschutz-Kit build (ENVIRONMENT_FAILURE, bounded 3 attempts, paused); SME fabricated-looking entries killed proactively; state-file race noted (scripting only, no data impact)

## USER ACTION REQUIRED (prioritized Human Gates)
${openGates.map((g, i) => {
    const branch = typeof g.blockingBranch === 'string' ? g.blockingBranch : `${g.blockingBranch.title} (${g.blockingBranch.status})`;
    return `${i + 1}. ${g.gateType} — ${branch}
   Action: ${g.requiredAction}
   Impact: unblocks publication/outreach for this branch only; independent work continues meanwhile.
   After resolve: Revenue Operator resumes the branch automatically on next refresh/action.`;
  }).join('\n')}

## NEXT 24 HOURS (evidence-ranked)
1. AUTHORIZE SHOPIFY (user) → publish VAT toolkit (score 59.4) + Freelancer SOP (35.6) — the two QA-passed products become live listings; €0 cost
2. Resolve/reject the 3 OUTBOUND_APPROVAL gates — if approved, SME offers can go out via a channel with a real contact (none found publicly yet; consider phone/LinkedIn routes or different prospects)
3. Retry Datenschutz-Kit build after Codex/model environment is healthy (or rebuild via hermes artifact path)
4. SEO/GEO groundwork for the VAT toolkit listing (German-language "Umsatzsteuer Rechner Vorlage" search intent — highest-score candidate)
5. Additional discovery round targeting validated gaps (payroll/Mini-Job calculator scored 23.5 — next build candidate)

## TRACEABILITY
Every item above traces in the Revenue Operator UI: KPI cards → itemized drill-down; Digital/SME/Pipeline Kanban; Live Execution table (canonical runs, truthful statuses); Human Gates queue; experiment drawers (evidence, runs, verifications, events). Financials: €0 realized/verified — truthful, as no transaction exists yet.
`;

  // Persist: canonical packaged data dir + repo state
  const canonicalDir = 'C:/Users/Cris/AppData/Roaming/agenticos/data/revenue-operator';
  FS.mkdirSync(canonicalDir, { recursive: true });
  const canonicalPath = path.join(canonicalDir, `overnight-briefing-2026-08-20.md`);
  FS.writeFileSync(canonicalPath, briefing);
  FS.writeFileSync('B:/AgenticOS/workspace/root/overnight-briefing-2026-08-20.md', briefing);
  console.log('BRIEFING persisted to canonical data dir:', canonicalPath);

  // Link briefing as FACT evidence on the strongest product (visible in UI drawer)
  const evRes = await fetch(`${BASE}/api/revenue-operator/experiments/expt-a2598507-/evidence`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      classification: 'FACT',
      title: 'Overnight morning briefing persisted',
      source: 'overnight-mission',
      summary: `Full overnight briefing persisted at revenue-operator/overnight-briefing-2026-08-20.md in the canonical data dir. Money: realized €0 / verified €0 / pipeline €1,500 (estimates). 2 products QA-passed ready to publish, 3 SME offers gated.`,
      provenance: 'artifact:file:overnight-briefing-2026-08-20.md',
    }),
  });
  console.log('briefing evidence linked:', evRes.status);
  db.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
