import { featurePatterns, type ResearchSpec } from './specification.js';
export interface Snapshot {
  metadata: any; commitSha: string | null; collectedAt: string; readme: string; readmePath: string;
  rootFiles: string[]; releases: any[]; issues: any[]; warnings: string[];
}
export interface Criterion { name: string; max: number; points: number; known: boolean; evidence: { url: string; fact: string; excerpt?: string }[]; }
export function assess(snapshot: Snapshot, spec: ResearchSpec, now = Date.now()) {
  const m = snapshot.metadata, url = `https://github.com/${m.full_name}`;
  const readmeUrl = `${url}/blob/${snapshot.commitSha || m.default_branch}/${snapshot.readmePath || 'README.md'}`;
  const text = `${m.description || ''}\n${snapshot.readme}`;
  const bindingEvidence = spec.languages.map(language => {
    const pattern = new RegExp(`\\b${language}\\b[^\\n.]{0,50}\\b(?:sdk|client|bindings?|package)\\b|\\b(?:sdk|client|bindings?)\\b[^\\n.]{0,50}\\b${language}\\b`, 'i');
    return pattern.exec(snapshot.readme)?.[0];
  }).find(Boolean);
  const stackFits = !spec.languages.length || spec.languages.includes(m.language) || Boolean(bindingEvidence);
  const criteria: Criterion[] = [];
  function add(name: string, max: number, points: number, known: boolean, fact: string, source = url, excerpt?: string) {
    criteria.push({ name, max, points: Math.min(max, Math.max(0, points)), known, evidence: known ? [{ url: source, fact, ...(excerpt ? { excerpt } : {}) }] : [] });
  }
  const matchedTerms = spec.terms.filter(t => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text));
  add('Functional fit: documented problem terms (not behavioral validation)', 25, 25 * matchedTerms.length / spec.terms.length, Boolean(text.trim()), `Matched ${matchedTerms.join(', ') || 'none'}; requested ${spec.terms.join(', ')}`, readmeUrl);
  const commitAge = Math.max(0, (now - Date.parse(m.pushed_at)) / 86400000);
  add('Recent repository push', 10, commitAge <= 90 ? 10 : commitAge <= 180 ? 7 : commitAge <= 365 ? 4 : 0, Number.isFinite(commitAge), `Last push ${m.pushed_at}; age ${Math.floor(commitAge)} days`);
  const release = snapshot.releases.find(r => !r.draft && !r.prerelease);
  add('Recent stable release', 5, release && now - Date.parse(release.published_at) <= 365 * 86400000 ? 5 : 0, !snapshot.warnings.includes('releases unavailable'), release ? `Stable release ${release.tag_name}, ${release.published_at}` : 'No stable release in sampled latest five', `${url}/releases`);
  const issues = snapshot.issues.filter(i => !i.pull_request);
  add('Sampled issue engagement', 5, issues.length ? 5 * issues.filter(i => i.comments > 0 || i.state === 'closed').length / issues.length : 0,
    issues.length > 0, `${issues.length} recently updated issues sampled; comment/closure presence only, not maintainer response time`, `${url}/issues`);
  const fits = spec.features.length ? spec.features : ['local'];
  for (const feature of fits) {
    const match = featurePatterns[feature].exec(snapshot.readme);
    add(`Architecture: documented ${feature}`, 10 / fits.length, match ? 10 / fits.length : 0, Boolean(snapshot.readme), match ? 'README mentions capability; implementation untested' : 'Not found in README', readmeUrl,
      match ? snapshot.readme.slice(Math.max(0, match.index - 50), match.index + 130) : undefined);
  }
  add('Documented stack compatibility', 5, stackFits ? 5 : 0, Boolean(m.language || bindingEvidence), `Main language ${m.language}; allowed ${spec.languages.join(', ') || 'not restricted'}; bindings ${bindingEvidence || 'not established'}`, bindingEvidence ? readmeUrl : url, bindingEvidence);
  add('Comparable measured performance', 15, 0, false, 'Not benchmarked in Phase 1');
  add('Documented local deployment', 5, featurePatterns.local.test(snapshot.readme) ? 5 : 0, Boolean(snapshot.readme), 'README local deployment evidence only; external transmission not audited', readmeUrl);
  add('Dependency and data-flow security validation', 5, 0, false, 'Not audited in Phase 1');
  add('README substance', 3, snapshot.readme.length >= 1000 ? 3 : snapshot.readme.length >= 250 ? 1 : 0, true, `README ${snapshot.readme.length} characters`, readmeUrl);
  for (const [name, pattern, max] of [['Installation guidance', /\b(?:pip install|npm install|uv add|docker run|installation)\b/i, 2], ['Usable example documented', /\b(?:quickstart|quick start|example|getting started)\b/i, 2]] as const) {
    const match = pattern.exec(snapshot.readme);
    add(name, max, match ? max : 0, Boolean(snapshot.readme), match ? 'Documentation marker found; not executed' : 'No marker found', readmeUrl, match ? snapshot.readme.slice(match.index, match.index + 120) : undefined);
  }
  add('Tests directory', 2, snapshot.rootFiles.some(f => /^(__tests__|tests?|spec)$/i.test(f)) ? 2 : 0, !snapshot.warnings.includes('files unavailable'), 'Root directory inventory; tests not executed', `${url}/tree/${snapshot.commitSha || m.default_branch}`);
  add('CI configuration indicator', 1, snapshot.rootFiles.includes('.github') ? 1 : 0, !snapshot.warnings.includes('files unavailable'), '.github presence is an indicator only; workflow success not checked', url);
  add('Stars (capped)', 1, Math.min(1, Math.log10(1 + (m.stargazers_count || 0)) / 4), true, `${m.stargazers_count} stars`);
  add('Forks (capped)', 1, Math.min(1, Math.log10(1 + (m.forks_count || 0)) / 3), true, `${m.forks_count} forks`);
  add('Public issue and discussion channels', 1, m.has_issues || m.has_discussions ? 1 : 0, true, `Issues enabled: ${Boolean(m.has_issues)}; discussions: ${Boolean(m.has_discussions)}`);
  add('External adoption/integration evidence', 2, 0, false, 'Not collected in Phase 1');
  const rejected: string[] = [];
  if (spec.features.includes('browser_automation') && !/browser automation|playwright|puppeteer|selenium|browser.{0,60}(?:click|control|interact)|(?:click|control|interact).{0,60}browser/i.test(snapshot.readme))
    rejected.push('No documented browser control capability in the collected README');
  if (!matchedTerms.length) rejected.push('No documented match to the requested problem terms');
  if (!stackFits) rejected.push('Main language outside requested stack; compatible bindings not established in Phase 1');
  if (spec.features.includes('local') && !featurePatterns.local.test(snapshot.readme)) rejected.push('Required local deployment is not established by the collected README');
  if (m.private) rejected.push('Private repository excluded from public research');
  if (m.archived || m.disabled) rejected.push('Repository archived or disabled');
  const license = m.license?.spdx_id;
  if (!license || license === 'NOASSERTION') rejected.push('No clearly identified license; manual review required');
  else if (!/^(MIT|Apache-2\.0|BSD-[23]-Clause|ISC|MPL-2\.0|GPL-[23]\.0(?:-only|-or-later)?|LGPL-[23]\.0(?:-only|-or-later)?|LGPL-2\.1(?:-only|-or-later)?|AGPL-3\.0(?:-only|-or-later)?|Unlicense|0BSD|Zlib|BSL-1\.0)$/.test(license)) rejected.push('License outside the initial recognized open-source set; manual review required');
  if (commitAge > 730 && !release) rejected.push('No push for over two years and no sampled stable release');
  if (snapshot.readme.length < 100) rejected.push('Insufficient README evidence');
  if (/\b(?:cloud[- ]only|requires? (?:a )?paid (?:subscription|account)|no (?:local|self[- ]hosted) (?:support|deployment))\b/i.test(snapshot.readme)) rejected.push('README indicates cloud/paid/local-deployment restriction; review cited README');
  const provisional = ['Installation and performance untested', 'Security/privacy and dependency behavior not audited',
    `License ${license || 'unknown'}: obligations require review; no legal compatibility guarantee`];
  if (spec.languages.length && !spec.languages.includes(m.language)) provisional.push(bindingEvidence ? 'Requested-language bindings documented, but integration is untested' : 'Main language differs from requested stack; adapter compatibility unknown');
  const total = criteria.reduce((s,c) => s+c.points,0);
  return { repository: m.full_name, url, license, score: Math.round(total*10)/10, coverage: Math.round(criteria.filter(c=>c.known).reduce((s,c)=>s+c.max,0)*10)/10,
    eligible: rejected.length === 0, rejected, caveats: [...provisional, ...snapshot.warnings], criteria, rubricVersion: 'phase1-v1' };
}
