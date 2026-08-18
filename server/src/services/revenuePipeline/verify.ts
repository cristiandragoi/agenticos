/**
 * Stage 10 — Verification (REVIEWER role).
 *
 * Deterministic artifact checks:
 *   - all proposal files exist and are non-empty
 *   - verified_facts.json separates facts / observations / placeholders
 *   - no fabricated claims (banlist scan on generated docs)
 *   - build + test evidence present and passing (when a build ran)
 *   - dry-run safety: no outreach artifacts, fixture data labelled
 */
import fs from 'fs';
import path from 'path';
import type { PipelineRunRecord } from './types.js';
import { FABRICATION_BANLIST } from './types.js';
import { FIXTURE_PREFIX } from './fixtures.js';

export interface VerificationCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface VerificationResult {
  ok: boolean;
  checks: VerificationCheck[];
  blocker: string | null;
}

const REQUIRED_PACKAGE_FILES = [
  'opportunity_summary.md',
  'audit_report.md',
  'audit_report.json',
  'rebuild_blueprint.md',
  'asset_checklist.md',
  'proposal_offer.md',
  'verified_facts.json',
  'run_summary.json',
];

export function verifyPipelineArtifacts(run: PipelineRunRecord): VerificationResult {
  const checks: VerificationCheck[] = [];
  const dir = run.config.workspacePath && run.runId ? path.join(run.config.workspacePath, run.runId) : null;

  // 1. Files exist + non-empty.
  if (!dir || !fs.existsSync(dir)) {
    return { ok: false, checks: [{ name: 'proposal_dir', passed: false, detail: `Missing proposal directory ${dir || '(none)'}` }], blocker: 'Proposal package directory does not exist.' };
  }
  for (const rel of REQUIRED_PACKAGE_FILES) {
    const p = path.join(dir, rel);
    const ok = fs.existsSync(p) && fs.statSync(p).size > 0;
    checks.push({ name: `file:${rel}`, passed: ok, detail: ok ? `${rel} exists and is non-empty` : `${rel} missing or empty` });
  }

  // 2. Factual separation in verified_facts.json.
  let factsJson: any = null;
  try {
    factsJson = JSON.parse(fs.readFileSync(path.join(dir, 'verified_facts.json'), 'utf8'));
  } catch (err: any) {
    checks.push({ name: 'verified_facts.json parse', passed: false, detail: err?.message || 'invalid JSON' });
  }
  if (factsJson) {
    checks.push({
      name: 'factual separation',
      passed: Array.isArray(factsJson.verifiedFacts) && Array.isArray(factsJson.unverifiedObservations) && Array.isArray(factsJson.placeholders),
      detail: `verifiedFacts=${Array.isArray(factsJson.verifiedFacts) ? factsJson.verifiedFacts.length : '—'} · observations=${Array.isArray(factsJson.unverifiedObservations) ? factsJson.unverifiedObservations.length : '—'} · placeholders=${Array.isArray(factsJson.placeholders) ? factsJson.placeholders.length : '—'}`,
    });
  }

  // 3. No fabricated claims across generated docs.
  const docTexts = REQUIRED_PACKAGE_FILES
    .filter((rel) => rel !== 'run_summary.json')
    .map((rel) => {
      try { return fs.readFileSync(path.join(dir, rel), 'utf8'); } catch { return ''; }
    })
    .join('\n');
  const bannedHits: string[] = [];
  for (const re of FABRICATION_BANLIST) {
    const hits = docTexts.match(re) || [];
    for (const h of hits) {
      // Allow hits inside placeholders or fixture-labelled lines.
      const line = docTexts.split('\n').find((l) => l.includes(h));
      if (line && (line.includes('PLACEHOLDER') || line.includes(FIXTURE_PREFIX))) continue;
      bannedHits.push(`${re.source}: "${h.slice(0, 60)}"`);
    }
  }
  checks.push({
    name: 'no fabricated claims',
    passed: bannedHits.length === 0,
    detail: bannedHits.length === 0 ? 'banlist scan clean' : `banned: ${bannedHits.join(' | ')}`,
  });

  // 4. Real-vs-fixture provenance (discovery truthfulness).
  const nonFixture = run.prospects.filter((p) => !p.fixture);
  if (nonFixture.length > 0) {
    // Real prospects: every one must carry a public discovery source and no
    // fixture/.example domain may appear. Fixtures are never substituted
    // silently into a real run.
    const example = nonFixture.filter((p) => /\.example(?::|\/|$)/i.test(p.websiteUrl));
    const missingEvidence = nonFixture.filter((p) => !p.discoverySourceRecord?.sourceUrl || !p.discoverySourceRecord?.evidence);
    const problemNames = [...new Set([...example, ...missingEvidence].map((p) => p.businessName))];
    checks.push({
      name: 'real prospect provenance',
      passed: example.length === 0 && missingEvidence.length === 0,
      detail: problemNames.length
        ? `non-fixture prospects with .example domain or missing discovery evidence: ${problemNames.join(', ')}`
        : `${nonFixture.length}/${run.prospects.length} real prospects each carry a public discovery source; no .example domains`,
    });
  }
  // All-fixture runs still require full labelling + no outreach material.
  if (run.config.dryRun && run.prospects.length > 0 && run.prospects.every((p) => p.fixture)) {
    const fixtureCount = run.prospects.filter((p) => p.fixture).length;
    const allLabelled = run.prospects.every((p) => p.fixture && p.verifiedFacts.every((f) => f.startsWith(FIXTURE_PREFIX)));
    checks.push({
      name: 'dry-run fixture labelling',
      passed: fixtureCount === run.prospects.length && allLabelled,
      detail: `${fixtureCount}/${run.prospects.length} prospects are labelled fixtures; all verified facts prefixed`,
    });
  }
  if (run.config.dryRun) {
    const outreachFiles = docTexts.match(/(outreach plan|email template|call script|send proposal to)/gi) || [];
    checks.push({
      name: 'no outreach artifacts',
      passed: outreachFiles.length === 0,
      detail: outreachFiles.length === 0 ? 'no outreach material generated' : `outreach markers found: ${outreachFiles.join(', ')}`,
    });
  }

  // 5. Build + test evidence.
  if (run.buildState !== 'skipped') {
    const buildLog = path.join(dir, 'build.log');
    const testLog = path.join(dir, 'test.log');
    const buildOk = fs.existsSync(buildLog) && /BUILD OK|built in|✓ built|done in|built successfully/i.test(fs.readFileSync(buildLog, 'utf8'));
    const testOk = fs.existsSync(testLog) && /VERIFY OK|PASS/i.test(fs.readFileSync(testLog, 'utf8'));
    checks.push({ name: 'build evidence', passed: buildOk, detail: buildOk ? 'build.log shows successful build' : 'build.log missing or no success marker' });
    checks.push({ name: 'test evidence', passed: testOk, detail: testOk ? 'test.log shows passing verify tests' : 'test.log missing or no PASS marker' });
    checks.push({
      name: 'build/test state matches task',
      passed: run.buildState === 'passed' && run.testState === 'passed',
      detail: `buildState=${run.buildState} testState=${run.testState}`,
    });
  } else {
    checks.push({ name: 'build skipped', passed: true, detail: 'build was skipped by config' });
  }

  // 6. Site concept directory present.
  const conceptDir = path.join(dir, 'site_concept');
  const conceptOk = fs.existsSync(path.join(conceptDir, 'index.html')) && fs.existsSync(path.join(conceptDir, 'src', 'App.tsx'));
  checks.push({ name: 'site_concept scaffold', passed: conceptOk, detail: conceptOk ? 'site_concept/ present with index.html + src/App.tsx' : 'site_concept/ incomplete' });

  const failed = checks.filter((c) => !c.passed);
  return {
    ok: failed.length === 0,
    checks,
    blocker: failed.length
      ? `Verification failed: ${failed.map((c) => (c.detail && c.detail !== `${c.name} missing or empty` ? `${c.name} (${c.detail.slice(0, 140)})` : c.name)).join(', ')}`
      : null,
  };
}
