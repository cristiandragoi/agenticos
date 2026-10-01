#!/usr/bin/env node
/**
 * scripts/phase1/test-identities.cjs - baseline-aware regression gate for the historical
 * server test suite (Phase 1, Step 02).
 *
 * WHY
 *   The repository has historically failing tests, so a raw `vitest` exit code cannot be the
 *   deployment criterion. Comparing failure COUNTS is not acceptable either: a new failure
 *   would be hidden whenever an old failing test happens to turn green. This script compares
 *   FAILED TEST IDENTITIES:
 *
 *       current failing identities  -  approved baseline failing identities  =  EMPTY
 *
 *   Anything left over is a new failure and blocks the deployment.
 *
 * IDENTITY
 *   <server-relative test file>::<describe> > ... > <test name>        (+ " [#n]" for the n-th
 *   test with an identical path in the same file). A test file that cannot even be loaded
 *   (import error, process.exit, failing hook, ...) is the identity
 *   <server-relative test file>::<file-level failure>.
 *   File and suite path are part of the identity, so identical test names in two files are two
 *   different identities (the previous names-only comparison could not tell them apart).
 *
 * BASELINE
 *   A JSON document generated from the vitest JSON report of a run of the approved pre-Phase-1
 *   commit (63e8f8139ef66d5a7a0eb48fc6565140ab126850) in an isolated git worktree. It records the
 *   commit, the totals and a sha256 over the sorted identity list; the gate refuses a baseline
 *   whose commit is not the approved one or whose list was edited.
 *
 * FAILS CLOSED
 *   Unreadable / empty / inconsistent reports, a baseline for another commit, a vitest run that
 *   exited non-zero without any identifiable failing test, and (for strict gates) failed or
 *   skipped tests or a missing required test are all errors - never a pass.
 *
 * USAGE (exit codes: 0 pass, 1 gate failed, 2 invalid or inconclusive input)
 *   node scripts/phase1/test-identities.cjs baseline --report R1.json [--report R2.json ...] \
 *        --root <server dir> --commit <sha> --out BASELINE.json [--vitest-exit N ...]
 *        (several reports = several runs of the baseline commit; the baseline is the UNION of
 *        their failing identities, so a test that is merely flaky at the baseline is not a
 *        "new" failure later. Pass one --vitest-exit per --report, in the same order.)
 *   node scripts/phase1/test-identities.cjs verify-baseline --baseline BASELINE.json
 *   node scripts/phase1/test-identities.cjs compare --report R.json --root <server dir> \
 *        --baseline BASELINE.json [--out RESULT.json] [--vitest-exit N]
 *   node scripts/phase1/test-identities.cjs gate --report R.json --root <server dir> \
 *        [--min-passed N] [--allow-skipped] [--require-passed TEXT]... [--vitest-exit N]
 *
 * Console output is ASCII only (non-ASCII characters in test names are shown as \uXXXX); the
 * JSON files keep the exact characters.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const APPROVED_BASELINE_COMMIT = '63e8f8139ef66d5a7a0eb48fc6565140ab126850';
const BASELINE_SCHEMA = 1;
const BASELINE_KIND = 'phase1-failed-test-identities';
const FILE_LEVEL_FAILURE = '<file-level failure>';
const MAX_LISTED = 200;

class GateError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GateError';
  }
}

/* ------------------------------------------------------------------------------------------ */
/* helpers                                                                                     */
/* ------------------------------------------------------------------------------------------ */

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function readJson(file, what) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new GateError(`${what}: cannot read ${file}: ${err.message}`);
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (!text.trim()) throw new GateError(`${what}: ${file} is empty`);
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new GateError(`${what}: ${file} is not valid JSON (${err.message})`);
  }
}

function asciiSafe(s) {
  return String(s).replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function uniqueSorted(list) {
  return Array.from(new Set(list)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Test file path relative to the server root, forward slashes. */
function normalizeFile(file, root) {
  const f = String(file || '').replace(/\\/g, '/');
  if (!f) return '';
  if (root) {
    const r = String(root).replace(/\\/g, '/').replace(/\/+$/, '');
    if (r && f.toLowerCase().startsWith(`${r.toLowerCase()}/`)) return f.slice(r.length + 1);
  }
  return f;
}

function normalizeStatus(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'passed' || s === 'pass') return 'passed';
  if (s === 'failed' || s === 'fail') return 'failed';
  return 'skipped'; // skipped, pending, todo, disabled, anything else that did not run to a verdict
}

/* ------------------------------------------------------------------------------------------ */
/* report -> identities                                                                        */
/* ------------------------------------------------------------------------------------------ */

/**
 * Extract every test (with its identity and status) from a vitest JSON report.
 * Returns { tests: [{id,status,file,fileLevel?}], failing: [id], totals }.
 */
function extractTests(report, opts = {}) {
  if (!report || typeof report !== 'object' || !Array.isArray(report.testResults)) {
    throw new GateError('not a vitest JSON report: "testResults" array is missing');
  }
  const tests = [];
  const seen = new Map();
  for (const fr of report.testResults) {
    const file = normalizeFile(fr && fr.name, opts.root);
    if (!file) throw new GateError('report contains a file result without a name');
    const results = Array.isArray(fr.assertionResults) ? fr.assertionResults : [];
    let failedHere = 0;
    for (const a of results) {
      const titles = []
        .concat(Array.isArray(a.ancestorTitles) ? a.ancestorTitles : [])
        .concat([a.title == null ? '' : a.title])
        .map((t) => String(t).trim())
        .filter((t) => t.length > 0);
      if (titles.length === 0) throw new GateError(`report contains a test without a title in ${file}`);
      const base = `${file}::${titles.join(' > ')}`;
      const n = (seen.get(base) || 0) + 1;
      seen.set(base, n);
      const status = normalizeStatus(a.status);
      if (status === 'failed') failedHere += 1;
      tests.push({ id: n === 1 ? base : `${base} [#${n}]`, status, file });
    }
    if (normalizeStatus(fr.status) === 'failed' && failedHere === 0) {
      tests.push({ id: `${file}::${FILE_LEVEL_FAILURE}`, status: 'failed', file, fileLevel: true });
    }
  }
  const totals = { total: 0, passed: 0, failed: 0, skipped: 0, fileLevelFailures: 0 };
  for (const t of tests) {
    if (t.fileLevel) {
      totals.fileLevelFailures += 1;
      totals.failed += 1;
      continue;
    }
    totals.total += 1;
    totals[t.status] += 1;
  }
  return { tests, failing: tests.filter((t) => t.status === 'failed').map((t) => t.id), totals };
}

/** The report must be usable as evidence; otherwise the answer is "inconclusive", never "pass". */
function assertConclusive(report, extracted, vitestExit) {
  if (extracted.totals.total === 0) {
    throw new GateError('the report contains no tests at all (the run did not execute the suite)');
  }
  const claimsFailures = report.success === false
    || (typeof report.numFailedTests === 'number' && report.numFailedTests > 0)
    || (typeof report.numFailedTestSuites === 'number' && report.numFailedTestSuites > 0);
  if (claimsFailures && extracted.failing.length === 0) {
    throw new GateError('the report says there are failures but none could be identified');
  }
  if (Number.isFinite(vitestExit) && vitestExit !== 0 && extracted.failing.length === 0) {
    throw new GateError(
      `vitest exited with ${vitestExit} but the report lists no failing test (crash, timeout, unhandled error or truncated report); this is not a pass`,
    );
  }
}

/* ------------------------------------------------------------------------------------------ */
/* baseline                                                                                    */
/* ------------------------------------------------------------------------------------------ */

/**
 * @param runs  one run `{ report, vitestExit? }` or an array of runs of the SAME approved commit
 *              (a bare vitest report object is accepted for a single run).
 */
function buildBaseline(runs, opts) {
  const commit = String(opts.commit || '').toLowerCase();
  const approved = String(opts.approvedCommit || APPROVED_BASELINE_COMMIT).toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new GateError('--commit must be the full 40-character commit sha');
  if (commit !== approved) {
    throw new GateError(`refusing to build a baseline for ${commit}: the approved pre-Phase-1 commit is ${approved}`);
  }
  const list = Array.isArray(runs) ? runs : [{ report: runs, vitestExit: opts.vitestExit }];
  if (list.length === 0) throw new GateError('no baseline run was supplied');

  const perRun = list.map((run, i) => {
    const ex = extractTests(run.report, { root: opts.root });
    try {
      assertConclusive(run.report, ex, run.vitestExit);
    } catch (err) {
      throw new GateError(`baseline run ${i + 1}: ${err.message}`);
    }
    return { ex, vitestExit: Number.isFinite(run.vitestExit) ? run.vitestExit : null };
  });

  const union = new Set();
  const counts = new Map();
  for (const r of perRun) {
    for (const id of new Set(r.ex.failing)) {
      union.add(id);
      counts.set(id, (counts.get(id) || 0) + 1);
    }
  }
  const failing = uniqueSorted(Array.from(union));
  const stable = failing.filter((id) => counts.get(id) === perRun.length).length;
  return {
    schema: BASELINE_SCHEMA,
    kind: BASELINE_KIND,
    commit,
    generatedAt: new Date().toISOString(),
    identityScheme: '<server-relative test file>::<describe> > <test> [ [#n] ]; file-level failures: <file>::<file-level failure>',
    runs: perRun.map((r) => ({ total: r.ex.totals.total, failing: uniqueSorted(r.ex.failing).length, vitestExit: r.vitestExit })),
    totals: perRun[0].ex.totals,
    stableFailingCount: stable,
    intermittentFailingCount: failing.length - stable,
    vitestExit: perRun[0].vitestExit,
    failingCount: failing.length,
    failingSha256: sha256(failing.join('\n')),
    failing,
  };
}

function verifyBaseline(baseline, opts = {}) {
  const approved = String(opts.approvedCommit || APPROVED_BASELINE_COMMIT).toLowerCase();
  if (!baseline || typeof baseline !== 'object') throw new GateError('baseline: not a JSON object');
  if (baseline.schema !== BASELINE_SCHEMA || baseline.kind !== BASELINE_KIND) {
    throw new GateError('baseline: unknown schema (it was not produced by this script; regenerate it)');
  }
  if (String(baseline.commit || '').toLowerCase() !== approved) {
    throw new GateError(`baseline: it was generated from ${baseline.commit}, not from the approved pre-Phase-1 commit ${approved}`);
  }
  if (!Array.isArray(baseline.failing) || baseline.failing.some((x) => typeof x !== 'string' || !x)) {
    throw new GateError('baseline: "failing" must be an array of identity strings');
  }
  const canonical = uniqueSorted(baseline.failing);
  if (canonical.length !== baseline.failing.length) throw new GateError('baseline: duplicate identities in "failing"');
  if (sha256(baseline.failing.join('\n')) !== baseline.failingSha256 || baseline.failingCount !== baseline.failing.length) {
    throw new GateError('baseline: the identity list does not match its recorded sha256/count (the file was edited or truncated)');
  }
  if (!baseline.totals || !(baseline.totals.total > 0)) {
    throw new GateError('baseline: it records no executed tests (the baseline run did not execute the suite)');
  }
  return baseline;
}

/* ------------------------------------------------------------------------------------------ */
/* compare / gate                                                                              */
/* ------------------------------------------------------------------------------------------ */

/**
 * current failing - baseline failing. Also reports (informationally) what became of every
 * baseline failure: fixed (now passes), skipped, or absent from the current run.
 */
function compareToBaseline(report, baseline, opts = {}) {
  verifyBaseline(baseline, opts);
  const ex = extractTests(report, { root: opts.root });
  assertConclusive(report, ex, opts.vitestExit);

  const currentFailing = uniqueSorted(ex.failing);
  const baselineSet = new Set(baseline.failing);
  const currentSet = new Set(currentFailing);
  const status = new Map(ex.tests.map((t) => [t.id, t.status]));

  const newFailures = currentFailing.filter((id) => !baselineSet.has(id));
  const stillFailing = currentFailing.filter((id) => baselineSet.has(id));
  const fixed = [];
  const nowSkipped = [];
  const absent = [];
  for (const id of baseline.failing) {
    if (currentSet.has(id)) continue;
    const st = status.get(id);
    if (st === 'passed') fixed.push(id);
    else if (st === 'skipped') nowSkipped.push(id);
    else absent.push(id);
  }
  return {
    verdict: newFailures.length === 0 ? 'PASS' : 'FAIL',
    rule: 'current failing - approved baseline failing = empty',
    baselineCommit: baseline.commit,
    baselineFailingSha256: baseline.failingSha256,
    currentTotals: ex.totals,
    baselineTotals: baseline.totals,
    currentFailingCount: currentFailing.length,
    baselineFailingCount: baseline.failing.length,
    newFailures,
    stillFailingCount: stillFailing.length,
    fixed,
    nowSkipped,
    absentFromCurrentRun: absent,
  };
}

function evaluateGate(report, opts = {}) {
  const ex = extractTests(report, { root: opts.root });
  const problems = [];
  if (ex.totals.total === 0) problems.push('the report contains no tests (nothing was executed)');
  for (const t of ex.tests) {
    if (t.status === 'failed') problems.push(`FAILED: ${t.id}`);
  }
  if (Number.isFinite(opts.vitestExit) && opts.vitestExit !== 0 && ex.failing.length === 0) {
    problems.push(`vitest exited with ${opts.vitestExit} but no failing test is listed (crash, timeout or unhandled error)`);
  }
  if (!opts.allowSkipped && ex.totals.skipped > 0) {
    problems.push(`${ex.totals.skipped} test(s) were skipped; a skipped test is not a pass`);
  }
  const minPassed = Number.isFinite(opts.minPassed) ? opts.minPassed : 1;
  if (ex.totals.passed < minPassed) problems.push(`only ${ex.totals.passed} test(s) passed; at least ${minPassed} are required`);
  for (const needle of opts.requirePassed || []) {
    const matching = ex.tests.filter((t) => t.id.includes(needle));
    if (!matching.some((t) => t.status === 'passed')) {
      problems.push(`required test did not pass (${matching.length ? 'it did not run to a pass' : 'no test matches'}): ${needle}`);
    }
  }
  return { ok: problems.length === 0, problems, totals: ex.totals };
}

/* ------------------------------------------------------------------------------------------ */
/* CLI                                                                                         */
/* ------------------------------------------------------------------------------------------ */

const REPEATABLE = new Set(['report', 'vitest-exit', 'require-passed']);

/** `--key value` pairs (repeatable for report / vitest-exit / require-passed) and the flag --allow-skipped. */
function parseArgs(argv) {
  const out = { _: [], opts: {}, flags: new Set() };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      out._.push(a);
      continue;
    }
    const key = a.slice(2);
    if (key === 'allow-skipped') {
      out.flags.add(key);
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new GateError(`option --${key} needs a value`);
    i += 1;
    if (!out.opts[key]) out.opts[key] = [];
    out.opts[key].push(value);
    if (!REPEATABLE.has(key) && out.opts[key].length > 1) throw new GateError(`option --${key} was given more than once`);
  }
  return out;
}

function numberOpt(value, name) {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new GateError(`--${name} must be a number`);
  return n;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function printList(label, items) {
  const shown = items.slice(0, MAX_LISTED);
  for (const id of shown) console.log(`${label}: ${asciiSafe(id)}`);
  if (items.length > shown.length) console.log(`${label}: ... and ${items.length - shown.length} more (see the result file)`);
}

function main(argv) {
  const args = parseArgs(argv);
  const cmd = args._[0];
  const many = (name) => args.opts[name] || [];
  const one = (name) => {
    const v = many(name);
    if (v.length !== 1) throw new GateError(`exactly one --${name} is required`);
    return v[0];
  };
  const optional = (name) => (many(name).length ? one(name) : undefined);
  const exits = many('vitest-exit').map((v) => numberOpt(v, 'vitest-exit'));
  const root = optional('root');

  if (cmd === 'baseline') {
    const reports = many('report');
    if (reports.length === 0) throw new GateError('at least one --report is required');
    if (exits.length !== 0 && exits.length !== reports.length) {
      throw new GateError('pass one --vitest-exit per --report (same order), or none');
    }
    const runs = reports.map((file, i) => ({ report: readJson(file, `report ${i + 1}`), vitestExit: exits[i] }));
    const baseline = buildBaseline(runs, { root, commit: one('commit') });
    writeJson(one('out'), baseline);
    console.log(`BASELINE written: ${baseline.failingCount} failing test identities (union of ${baseline.runs.length} run(s): ${baseline.stableFailingCount} in every run, ${baseline.intermittentFailingCount} intermittent), ${baseline.totals.total} tests executed per run, commit ${baseline.commit}`);
    console.log(`BASELINE sha256 of the identity list: ${baseline.failingSha256}`);
    return 0;
  }

  if (cmd === 'verify-baseline') {
    const baseline = verifyBaseline(readJson(one('baseline'), 'baseline'));
    console.log(`BASELINE OK: commit ${baseline.commit}, ${baseline.failingCount} failing identities, sha256 ${baseline.failingSha256}`);
    return 0;
  }

  if (cmd === 'compare') {
    const report = readJson(one('report'), 'report');
    const baseline = readJson(one('baseline'), 'baseline');
    const result = compareToBaseline(report, baseline, { root, vitestExit: exits[0] });
    if (optional('out')) writeJson(one('out'), result);
    console.log(`RULE: ${result.rule}`);
    console.log(`BASELINE: commit ${result.baselineCommit}, ${result.baselineFailingCount} failing identities (sha256 ${result.baselineFailingSha256})`);
    console.log(`CURRENT: ${result.currentTotals.total} tests executed, ${result.currentFailingCount} failing identities`);
    console.log(`still failing as in the baseline: ${result.stillFailingCount}`);
    console.log(`baseline failures now passing: ${result.fixed.length}; now skipped: ${result.nowSkipped.length}; absent from the current run: ${result.absentFromCurrentRun.length}`);
    if (result.currentTotals.total < result.baselineTotals.total) {
      console.log(`NOTE: the current run executed fewer tests (${result.currentTotals.total}) than the baseline run (${result.baselineTotals.total})`);
    }
    // Informational: a baseline failure that passes now is an improvement, but it is also where a baseline
    // generated in a pristine worktree (no untracked local files) could differ from the real environment,
    // so a reviewer should be able to see exactly which ones they are.
    printList('BASELINE FAILURE NOW PASSING (informational)', result.fixed);
    printList('NOW SKIPPED (was failing in baseline)', result.nowSkipped);
    printList('ABSENT FROM CURRENT RUN (was failing in baseline)', result.absentFromCurrentRun);
    if (result.newFailures.length > 0) {
      console.log(`NEW FAILURES NOT IN THE APPROVED BASELINE: ${result.newFailures.length}`);
      printList('NEW FAILURE', result.newFailures);
      console.log('RESULT: FAIL');
      return 1;
    }
    console.log('NEW FAILURES NOT IN THE APPROVED BASELINE: 0');
    console.log('RESULT: PASS');
    return 0;
  }

  if (cmd === 'gate') {
    const report = readJson(one('report'), 'report');
    const gate = evaluateGate(report, {
      root,
      minPassed: numberOpt(optional('min-passed'), 'min-passed'),
      allowSkipped: args.flags.has('allow-skipped'),
      requirePassed: many('require-passed'),
      vitestExit: exits[0],
    });
    console.log(`GATE: ${gate.totals.passed} passed, ${gate.totals.failed} failed, ${gate.totals.skipped} skipped`);
    if (!gate.ok) {
      printList('GATE PROBLEM', gate.problems);
      console.log('RESULT: FAIL');
      return 1;
    }
    console.log('RESULT: PASS');
    return 0;
  }

  throw new GateError('usage: test-identities.cjs <baseline|verify-baseline|compare|gate> [options] (see the file header)');
}

module.exports = {
  APPROVED_BASELINE_COMMIT,
  FILE_LEVEL_FAILURE,
  GateError,
  asciiSafe,
  assertConclusive,
  buildBaseline,
  compareToBaseline,
  evaluateGate,
  extractTests,
  main,
  normalizeFile,
  parseArgs,
  verifyBaseline,
};

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    if (err instanceof GateError) {
      console.error(`INCONCLUSIVE: ${asciiSafe(err.message)}`);
      console.error('RESULT: INCONCLUSIVE (treated as a failure: the gate fails closed)');
      process.exitCode = 2;
    } else {
      console.error(`INTERNAL ERROR: ${asciiSafe((err && err.stack) || err)}`);
      process.exitCode = 2;
    }
  }
}
