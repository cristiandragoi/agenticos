/**
 * Stage 9 — Proposal package generation.
 *
 * Writes into <workspacePath>/<runId>/
 *   opportunity_summary.md · audit_report.md · audit_report.json ·
 *   rebuild_blueprint.md · asset_checklist.md · proposal_offer.md ·
 *   verified_facts.json · site_concept/ · run_summary.json (pipeline service)
 *
 * The proposal strictly separates: verified facts / observations /
 * recommendations / placeholders / assumptions-requiring-confirmation.
 * Three pricing templates are included and clearly marked EDITABLE.
 * Nothing is sent externally — generation only.
 */
import fs from 'fs';
import path from 'path';
import type { PipelineConfig, PipelineRunRecord, ProspectRecord } from './types.js';
import { FIXTURE_PREFIX } from './fixtures.js';
import type { RebuildBlueprint } from './blueprint.js';

export interface ProposalPackageResult {
  dir: string;
  files: string[];
}

export function generateProposalPackage(opts: {
  run: PipelineRunRecord;
  prospect: ProspectRecord;
  config: PipelineConfig;
  blueprint: RebuildBlueprint;
  auditReportMd: string;
}): ProposalPackageResult {
  const { prospect, config, blueprint } = opts;
  const runId = opts.run.runId;
  const dir = path.join(config.workspacePath, runId);
  fs.mkdirSync(dir, { recursive: true });

  const label = prospect.fixture ? `${FIXTURE_PREFIX} ` : '';
  const name = prospect.businessName || '[BUSINESS NAME]';
  const niche = prospect.niche || 'local business';
  const city = prospect.city || config.city || '[CITY]';
  const now = new Date().toISOString();

  const files: Record<string, string> = {};

  // ── opportunity_summary.md ────────────────────────────────────────────────
  files['opportunity_summary.md'] = `# Opportunity summary — ${name}

> ${label}Generated ${now} by the AgenticOS Revenue Pipeline V1 (dry-run: ${config.dryRun ? 'yes' : 'no'}).
> ${prospect.fixture ? '**Clearly-labelled SAMPLE FIXTURE — not a real business.**' : prospect.discoverySourceRecord ? `Discovered via ${prospect.discoverySourceRecord.sourceType} (${prospect.discoverySourceRecord.sourceUrl}).` : 'Prospect from user-provided URL.'}

| Field | Value |
|---|---|
| Niche | ${niche} |
| City / region | ${city} |
| Website | ${prospect.websiteUrl} |
| Public contact page | ${prospect.publicContactUrl || 'not found (unavailable)'} |
| Audit score | ${prospect.auditScore ?? '—'}/100 (lower = weaker site) |
| Opportunity score | ${prospect.opportunityScore ?? '—'}/100 |
| Confidence | ${prospect.confidence} |
| Status | ${prospect.status} |

## Why this prospect (evidence, not vibes)
${prospect.scoringCriteria ? Object.entries(prospect.scoringCriteria).map(([k, v]) => `- **${k}**: ${v.score}/100 — ${v.reason}`).join('\n') : '- Not scored yet.'}

## Top weaknesses found (audit)
${prospect.auditFindings.filter((f) => f.severity === 'weakness').slice(0, 6).map((f) => `- [${f.label}] ${f.summary}`).join('\n') || '- None recorded.'}

## Recommended next step
1. Human review of this package (${prospect.websiteUrl}).
2. Confirm the 3 pricing templates in proposal_offer.md (editable).
3. Approval required BEFORE any outreach — V1 performs no automated outreach.
`;

  // ── audit_report.md + json ────────────────────────────────────────────────
  files['audit_report.md'] = opts.auditReportMd;
  files['audit_report.json'] = JSON.stringify(
    {
      prospectId: prospect.prospectId,
      businessName: name,
      websiteUrl: prospect.websiteUrl,
      fixture: prospect.fixture,
      auditedAt: now,
      auditScore: prospect.auditScore,
      findings: prospect.auditFindings,
      verifiedFacts: prospect.verifiedFacts,
      unverifiedObservations: prospect.unverifiedObservations,
      note: prospect.fixture ? `${FIXTURE_PREFIX} data comes from a labelled sample, not a real business.` : 'Audit of the user-provided public URL.',
    },
    null,
    2
  );

  // ── rebuild_blueprint.md ──────────────────────────────────────────────────
  files['rebuild_blueprint.md'] = blueprint.markdown;

  // ── asset_checklist.md ────────────────────────────────────────────────────
  files['asset_checklist.md'] = `# Asset checklist — ${name}

> ${label}Checklist of everything needed before the rebuild can use REAL content.
> Every item is either verified (from audit/fixture) or a placeholder requiring customer input.

## Required from the customer
- [ ] Logo (vector preferred) — [PLACEHOLDER: obtain]
- [ ] Business phone, email, address, opening hours — [PLACEHOLDER: verify]
- [ ] Service list and descriptions — [PLACEHOLDER: confirm real offerings]
- [ ] Service-area / district list — [PLACEHOLDER: confirm]
- [ ] Real photos (roofs, team, work samples) — [PLACEHOLDER: collect; no stock fakery]
- [ ] Testimonials / references (with consent) — [PLACEHOLDER: collect]
- [ ] Certifications / memberships — [PLACEHOLDER: verify]
- [ ] Impressum / Datenschutz legal texts — [PLACEHOLDER: legal review]

## Verified in the audit (${label.trim() || 'from user URL'})
${prospect.verifiedFacts.map((f) => `- [x] ${f}`).join('\n') || '- none'}

## Observations (not verified — do not publish without confirmation)
${prospect.unverifiedObservations.map((f) => `- [ ] ${f}`).join('\n') || '- none'}

## Never include (V1 rule)
- Prices, reviews, rankings, traffic, revenue, or contact details NOT verified by the customer.
`;

  // ── proposal_offer.md (3 EDITABLE pricing templates) ──────────────────────
  files['proposal_offer.md'] = `# Proposal offer — ${name}

> ${label}Draft only. **Nothing here is sent externally.** This file is EDITABLE by the user.
> Replace placeholders, adjust prices, and only then — after human approval — use it.

## Package A — Essential website refresh
- One-page or small multi-page site rebuild (static-friendly, mobile-first)
- Contact + CTA optimization, basic SEO metadata
- **Price: [€1,000 – €1,500] — EDITABLE**
- Timeline: [PLACEHOLDER: days]

## Package B — Growth website rebuild
- Full rebuild: homepage, service hub, key service pages, location pages
- SEO metadata scaffold + sitemap/robots, trust section, internal linking
- **Price: [€1,500 – €3,000] — EDITABLE**
- Timeline: [PLACEHOLDER: weeks]

## Package C — Website plus recurring AI/automation service
- Package B + recurring service (e.g. content updates, review monitoring, AI-assisted lead follow-up)
- **Price: Package B + [€150 – €400]/month — EDITABLE**
- Timeline: [PLACEHOLDER]

## Assumptions requiring customer confirmation
- [ ] Business offers the listed services in the listed districts
- [ ] Contact details are correct and consent to be published
- [ ] Real photos/reviews will be provided (or explicitly waived)
- [ ] Legal texts (Impressum/Datenschutz) will be reviewed

## Separation of facts
- Verified facts: see verified_facts.json
- Observations: see audit_report.md (labelled \`inferred\`)
- Placeholders: every \`[PLACEHOLDER: …]\` in this package
`;

  // ── verified_facts.json ───────────────────────────────────────────────────
  files['verified_facts.json'] = JSON.stringify(
    {
      prospectId: prospect.prospectId,
      businessName: name,
      websiteUrl: prospect.websiteUrl,
      fixture: prospect.fixture,
      verifiedFacts: prospect.verifiedFacts,
      unverifiedObservations: prospect.unverifiedObservations,
      placeholders: collectPlaceholders(Object.values(files)),
      assumptions: [
        'Customer must confirm service list, districts, contact details, and legal consent before publish.',
        'No pricing, reviews, rankings, traffic, or revenue figures are asserted as verified.',
      ],
      note: prospect.fixture ? `${FIXTURE_PREFIX} This prospect is sample data — nothing here describes a real business.` : 'Facts sourced from the user-provided public URL audit.',
    },
    null,
    2
  );

  const written: string[] = [];
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.writeFileSync(p, content, 'utf8');
    written.push(p);
  }

  return { dir, files: written };
}

function collectPlaceholders(docs: string[]): string[] {
  const set = new Set<string>();
  for (const doc of docs) {
    const matches = doc.match(/\[PLACEHOLDER:[^\]]+\]/g) || [];
    for (const m of matches) set.add(m);
  }
  return [...set].sort();
}
