/**
 * Phase 1 deployment gate: failed-test IDENTITY comparison against the approved pre-Phase-1 baseline.
 *
 * Proves the rule `current failing - approved baseline failing = empty` for the historical server
 * suite - in particular that a NEW failure can never be hidden by another, old test turning green
 * (so counts are never compared), and that every ambiguous situation fails closed.
 *
 * The script under test is scripts/phase1/test-identities.cjs; Step 02 calls it after the full
 * server suite has produced a vitest JSON report.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../scripts/phase1/test-identities.cjs');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const gate: any = createRequire(import.meta.url)(SCRIPT);

const BASELINE_COMMIT = '63e8f8139ef66d5a7a0eb48fc6565140ab126850';
const ROOT = 'D:\\AgenticOS\\server';
const BASELINE_ROOT = 'D:\\AgenticOS-phase1-baseline\\server';

type T = [status: string, ancestors: string[], title: string];
/** Build a vitest-JSON-shaped report: { file: [[status, ancestors, title], ...] } */
function report(files: Record<string, T[] | { fileFailed: true; tests?: T[] }>, extra: Record<string, unknown> = {}) {
  let failedTests = 0;
  let total = 0;
  const testResults = Object.entries(files).map(([name, spec]) => {
    const tests: T[] = Array.isArray(spec) ? spec : spec.tests ?? [];
    const fileFailed = !Array.isArray(spec) || tests.some((t) => t[0] === 'failed');
    for (const t of tests) { total += 1; if (t[0] === 'failed') failedTests += 1; }
    return {
      name,
      status: fileFailed ? 'failed' : 'passed',
      message: !Array.isArray(spec) ? 'Error: cannot load' : '',
      assertionResults: tests.map(([status, ancestorTitles, title]) => ({ ancestorTitles, fullName: [...ancestorTitles, title].join(' '), status, title })),
    };
  });
  return { numTotalTests: total, numFailedTests: failedTests, success: failedTests === 0 && !testResults.some((f) => f.status === 'failed'), testResults, ...extra };
}

const pass = (...path: string[]): T => ['passed', path.slice(0, -1), path[path.length - 1]];
const fail = (...path: string[]): T => ['failed', path.slice(0, -1), path[path.length - 1]];
const skip = (...path: string[]): T => ['skipped', path.slice(0, -1), path[path.length - 1]];

/** A baseline built the way Step 02 builds it: from the report of the approved commit. */
function baselineOf(rep: object, root = BASELINE_ROOT) {
  return gate.buildBaseline(rep, { root, commit: BASELINE_COMMIT });
}

describe('identity', () => {
  it('is <server-relative file>::<describe path> > <test>, independent of the worktree location', () => {
    const a = gate.extractTests(report({ [`${BASELINE_ROOT.replace(/\\/g, '/')}/src/__tests__/x.test.ts`]: [fail('suite', 'inner', 'does it')] }), { root: BASELINE_ROOT });
    const b = gate.extractTests(report({ [`${ROOT.replace(/\\/g, '/')}/src/__tests__/x.test.ts`]: [fail('suite', 'inner', 'does it')] }), { root: ROOT });
    expect(a.failing).toEqual(['src/__tests__/x.test.ts::suite > inner > does it']);
    expect(b.failing).toEqual(a.failing);
  });

  it('the same test name in two different files is two different identities', () => {
    const ex = gate.extractTests(report({
      [`${ROOT}\\src\\__tests__\\a.test.ts`]: [fail('1. discover', 'then run')],
      [`${ROOT}\\src\\__tests__\\b.test.ts`]: [fail('1. discover', 'then run')],
    }), { root: ROOT });
    expect(new Set(ex.failing).size).toBe(2);
  });

  it('identically named tests inside one file get an ordinal so one of them failing is still identified', () => {
    const ex = gate.extractTests(report({ [`${ROOT}/src/__tests__/d.test.ts`]: [pass('dup'), fail('dup')] }), { root: ROOT });
    expect(ex.failing).toEqual(['src/__tests__/d.test.ts::dup [#2]']);
  });

  it('a file that cannot be loaded is a file-level failure identity (it is not silently empty)', () => {
    const ex = gate.extractTests(report({ [`${ROOT}/src/__tests__/broken.test.ts`]: { fileFailed: true } }), { root: ROOT });
    expect(ex.failing).toEqual([`src/__tests__/broken.test.ts::${gate.FILE_LEVEL_FAILURE}`]);
  });

  it('a failing hook (file failed, every test skipped) is still a failure identity', () => {
    const ex = gate.extractTests(report({ [`${ROOT}/src/__tests__/hook.test.ts`]: { fileFailed: true, tests: [skip('hooked', 't1'), skip('hooked', 't2')] } }), { root: ROOT });
    expect(ex.failing).toEqual([`src/__tests__/hook.test.ts::${gate.FILE_LEVEL_FAILURE}`]);
  });
});

describe('compare: current failing - approved baseline failing = empty', () => {
  const FILE = (n: string) => `${ROOT}/src/__tests__/${n}.test.ts`;
  const BFILE = (n: string) => `${BASELINE_ROOT}/src/__tests__/${n}.test.ts`;

  const baselineReport = report({
    [BFILE('old')]: [fail('old suite', 'known failure A'), fail('old suite', 'known failure B'), pass('old suite', 'fine')],
    [BFILE('other')]: [pass('other', 'fine')],
  });
  const baseline = baselineOf(baselineReport);

  it('the same failures as the baseline pass', () => {
    const cur = report({
      [FILE('old')]: [fail('old suite', 'known failure A'), fail('old suite', 'known failure B'), pass('old suite', 'fine')],
      [FILE('other')]: [pass('other', 'fine')],
    });
    const r = gate.compareToBaseline(cur, baseline, { root: ROOT });
    expect(r.verdict).toBe('PASS');
    expect(r.newFailures).toEqual([]);
    expect(r.stillFailingCount).toBe(2);
  });

  it('fewer failures than the baseline pass and the repaired tests are reported as fixed', () => {
    const cur = report({
      [FILE('old')]: [pass('old suite', 'known failure A'), fail('old suite', 'known failure B'), pass('old suite', 'fine')],
      [FILE('other')]: [pass('other', 'fine')],
    });
    const r = gate.compareToBaseline(cur, baseline, { root: ROOT });
    expect(r.verdict).toBe('PASS');
    expect(r.fixed).toEqual(['src/__tests__/old.test.ts::old suite > known failure A']);
  });

  it('A NEW FAILURE IS NOT HIDDEN WHEN OLD FAILURES TURN GREEN: fewer failures in total, still FAIL', () => {
    const cur = report({
      [FILE('old')]: [pass('old suite', 'known failure A'), pass('old suite', 'known failure B'), pass('old suite', 'fine')],
      [FILE('other')]: [fail('other', 'fine')], // a test that PASSED in the baseline is now failing
    });
    const r = gate.compareToBaseline(cur, baseline, { root: ROOT });
    expect(r.currentFailingCount).toBeLessThan(r.baselineFailingCount); // counts alone would say "better"
    expect(r.verdict).toBe('FAIL');
    expect(r.newFailures).toEqual(['src/__tests__/other.test.ts::other > fine']);
  });

  it('the same NUMBER of failures with different identities is a FAIL', () => {
    const cur = report({
      [FILE('old')]: [fail('old suite', 'known failure A'), pass('old suite', 'known failure B'), fail('old suite', 'fine')],
      [FILE('other')]: [pass('other', 'fine')],
    });
    const r = gate.compareToBaseline(cur, baseline, { root: ROOT });
    expect(r.currentFailingCount).toBe(r.baselineFailingCount);
    expect(r.verdict).toBe('FAIL');
    expect(r.newFailures).toEqual(['src/__tests__/old.test.ts::old suite > fine']);
  });

  it('a baseline failure with the same NAME in a different FILE does not cover a new failure', () => {
    const cur = report({
      [FILE('old')]: [fail('old suite', 'known failure A'), fail('old suite', 'known failure B'), pass('old suite', 'fine')],
      [FILE('moved')]: [fail('old suite', 'known failure A')],
      [FILE('other')]: [pass('other', 'fine')],
    });
    const r = gate.compareToBaseline(cur, baseline, { root: ROOT });
    expect(r.verdict).toBe('FAIL');
    expect(r.newFailures).toEqual(['src/__tests__/moved.test.ts::old suite > known failure A']);
  });

  it('a brand-new test that fails is a new failure; a brand-new file that cannot load is one too', () => {
    const cur = report({
      [FILE('old')]: [fail('old suite', 'known failure A'), fail('old suite', 'known failure B'), pass('old suite', 'fine')],
      [FILE('other')]: [pass('other', 'fine')],
      [FILE('fresh')]: [fail('fresh', 'new behaviour')],
      [FILE('fresh2')]: { fileFailed: true },
    });
    const r = gate.compareToBaseline(cur, baseline, { root: ROOT });
    expect(r.verdict).toBe('FAIL');
    expect(r.newFailures).toHaveLength(2);
  });

  it('baseline failures that were removed or are now skipped are reported, not silently dropped', () => {
    const cur = report({
      [FILE('old')]: [skip('old suite', 'known failure A'), pass('old suite', 'fine')],
      [FILE('other')]: [pass('other', 'fine')],
    });
    const r = gate.compareToBaseline(cur, baseline, { root: ROOT });
    expect(r.verdict).toBe('PASS');
    expect(r.nowSkipped).toEqual(['src/__tests__/old.test.ts::old suite > known failure A']);
    expect(r.absentFromCurrentRun).toEqual(['src/__tests__/old.test.ts::old suite > known failure B']);
  });
});

describe('fails closed', () => {
  const baseline = baselineOf(report({ [`${BASELINE_ROOT}/src/__tests__/old.test.ts`]: [fail('s', 'known'), pass('s', 'ok')] }));
  const passing = report({ [`${ROOT}/src/__tests__/old.test.ts`]: [pass('s', 'known'), pass('s', 'ok')] });

  it('rejects things that are not a vitest report', () => {
    expect(() => gate.extractTests({}, { root: ROOT })).toThrow(/testResults/);
    expect(() => gate.extractTests(null, { root: ROOT })).toThrow(/testResults/);
  });

  it('an empty report is not a pass', () => {
    expect(() => gate.compareToBaseline(report({}), baseline, { root: ROOT })).toThrow(/no tests/);
  });

  it('vitest exiting non-zero without any identifiable failure is inconclusive, not a pass', () => {
    expect(() => gate.compareToBaseline(passing, baseline, { root: ROOT, vitestExit: 1 })).toThrow(/exited with 1/);
    expect(gate.compareToBaseline(passing, baseline, { root: ROOT, vitestExit: 0 }).verdict).toBe('PASS');
  });

  it('a report that claims failures but lists none is inconclusive', () => {
    expect(() => gate.compareToBaseline({ ...passing, success: false }, baseline, { root: ROOT })).toThrow(/none could be identified/);
    expect(() => gate.compareToBaseline({ ...passing, numFailedTests: 3 }, baseline, { root: ROOT })).toThrow(/none could be identified/);
  });

  it('refuses a baseline of another commit, a hand-edited baseline and a baseline of an unexecuted suite', () => {
    expect(() => gate.compareToBaseline(passing, { ...baseline, commit: '9ca7ac63fe04f8a89b4522ef1c63ebc9bc447b9a' }, { root: ROOT })).toThrow(/approved pre-Phase-1 commit/);
    expect(() => gate.compareToBaseline(passing, { ...baseline, failing: [...baseline.failing, 'src/x.test.ts::added by hand'] }, { root: ROOT })).toThrow(/edited or truncated/);
    expect(() => gate.compareToBaseline(passing, { ...baseline, failing: [], failingCount: 0, failingSha256: 'x' }, { root: ROOT })).toThrow(/edited or truncated/);
    expect(() => gate.compareToBaseline(passing, { ...baseline, totals: { total: 0 } }, { root: ROOT })).toThrow(/no executed tests/);
    expect(() => gate.compareToBaseline(passing, { ...baseline, schema: 99 }, { root: ROOT })).toThrow(/unknown schema/);
  });

  it('refuses to build a baseline for any commit other than the approved one', () => {
    expect(() => gate.buildBaseline(passing, { root: ROOT, commit: '9ca7ac63fe04f8a89b4522ef1c63ebc9bc447b9a' })).toThrow(/approved pre-Phase-1 commit/);
    expect(() => gate.buildBaseline(passing, { root: ROOT, commit: '63e8f81' })).toThrow(/40-character/);
  });

  it('a baseline is sorted, unique and sealed with a sha256 of its identity list', () => {
    expect(baseline.commit).toBe(BASELINE_COMMIT);
    expect(baseline.failing).toEqual(['src/__tests__/old.test.ts::s > known']);
    expect(baseline.failingCount).toBe(1);
    expect(gate.verifyBaseline(baseline)).toBe(baseline);
  });
});

describe('baseline from several runs of the approved commit', () => {
  const BFILE = `${BASELINE_ROOT}/src/__tests__/flaky.test.ts`;
  const run1 = report({ [BFILE]: [fail('s', 'always fails'), fail('s', 'flaky'), pass('s', 'ok')] });
  const run2 = report({ [BFILE]: [fail('s', 'always fails'), pass('s', 'flaky'), pass('s', 'ok')] });

  it('is the UNION of the failing identities, and says which ones were intermittent', () => {
    const b = gate.buildBaseline([{ report: run1, vitestExit: 1 }, { report: run2, vitestExit: 1 }], { root: BASELINE_ROOT, commit: BASELINE_COMMIT });
    expect(b.failing).toEqual(['src/__tests__/flaky.test.ts::s > always fails', 'src/__tests__/flaky.test.ts::s > flaky']);
    expect(b.runs).toHaveLength(2);
    expect(b.stableFailingCount).toBe(1);
    expect(b.intermittentFailingCount).toBe(1);
    expect(gate.verifyBaseline(b)).toBe(b);
  });

  it('a test that is flaky at the baseline is not a new failure later, but a test that never failed there is', () => {
    const b = gate.buildBaseline([{ report: run1, vitestExit: 1 }, { report: run2, vitestExit: 1 }], { root: BASELINE_ROOT, commit: BASELINE_COMMIT });
    const cur = report({ [`${ROOT}/src/__tests__/flaky.test.ts`]: [fail('s', 'always fails'), pass('s', 'flaky'), fail('s', 'ok')] });
    const r = gate.compareToBaseline(cur, b, { root: ROOT });
    expect(r.newFailures).toEqual(['src/__tests__/flaky.test.ts::s > ok']);
  });

  it('one inconclusive run makes the whole baseline inconclusive (it is never silently dropped)', () => {
    const empty = report({});
    expect(() => gate.buildBaseline([{ report: run1, vitestExit: 1 }, { report: empty, vitestExit: 1 }], { root: BASELINE_ROOT, commit: BASELINE_COMMIT })).toThrow(/baseline run 2/);
    expect(() => gate.buildBaseline([{ report: run1, vitestExit: 1 }, { report: run2, vitestExit: 7 }, { report: report({ [BFILE]: [pass('s', 'ok')] }), vitestExit: 1 }], { root: BASELINE_ROOT, commit: BASELINE_COMMIT })).toThrow(/baseline run 3.*exited with 1/);
    expect(() => gate.buildBaseline([], { root: BASELINE_ROOT, commit: BASELINE_COMMIT })).toThrow(/no baseline run/);
  });
});

describe('strict gates (lifecycle / ownership / self-heal / delegation) fail closed', () => {
  const FILE = `${ROOT}/src/__tests__/s.test.ts`;

  it('pass only when nothing failed, nothing was skipped and enough tests really passed', () => {
    const ok = gate.evaluateGate(report({ [FILE]: [pass('a', '1'), pass('a', '2')] }), { root: ROOT, minPassed: 2 });
    expect(ok.ok).toBe(true);
  });

  it('a failed test fails the gate', () => {
    const g = gate.evaluateGate(report({ [FILE]: [pass('a', '1'), fail('a', '2')] }), { root: ROOT });
    expect(g.ok).toBe(false);
    expect(g.problems.join('\n')).toMatch(/FAILED: src\/__tests__\/s.test.ts::a > 2/);
  });

  it('a skipped test is not a pass', () => {
    const rep = report({ [FILE]: [pass('a', '1'), skip('a', '2')] });
    expect(gate.evaluateGate(rep, { root: ROOT }).ok).toBe(false);
    expect(gate.evaluateGate(rep, { root: ROOT, allowSkipped: true }).ok).toBe(true);
  });

  it('too few passing tests (a filter that matched nothing) fails the gate', () => {
    expect(gate.evaluateGate(report({ [FILE]: [skip('a', '1')] }), { root: ROOT, allowSkipped: true }).ok).toBe(false);
    expect(gate.evaluateGate(report({ [FILE]: [pass('a', '1')] }), { root: ROOT, minPassed: 5 }).ok).toBe(false);
  });

  it('a named required test must have run and passed', () => {
    const rep = report({ [FILE]: [pass('explicit use CodeX creates exactly one delegated goal request'), skip('other')] });
    expect(gate.evaluateGate(rep, { root: ROOT, allowSkipped: true, requirePassed: ['exactly one delegated goal'] }).ok).toBe(true);
    const missing = gate.evaluateGate(rep, { root: ROOT, allowSkipped: true, requirePassed: ['no such test'] });
    expect(missing.ok).toBe(false);
    expect(missing.problems.join('\n')).toMatch(/no test matches/);
    const skippedOnly = gate.evaluateGate(rep, { root: ROOT, allowSkipped: true, requirePassed: ['other'] });
    expect(skippedOnly.ok).toBe(false);
  });

  it('a file that failed to load fails the gate even though it contributed no test', () => {
    const g = gate.evaluateGate(report({ [FILE]: [pass('a', '1')], [`${ROOT}/src/__tests__/t.test.ts`]: { fileFailed: true } }), { root: ROOT });
    expect(g.ok).toBe(false);
    expect(g.problems.join('\n')).toMatch(/file-level failure/);
  });
});

describe('real vitest 4.1.10 JSON report (captured from a fixture project)', () => {
  // numFailedTests = 6: a.test (fails, dup #2, top level fails, each 2), b.test (fails), e.test (process.exit).
  // c.test cannot be loaded and d.test has a failing beforeAll (its tests are reported as skipped).
  const REAL = {"numTotalTestSuites":9,"numFailedTestSuites":9,"numTotalTests":13,"numPassedTests":3,"numFailedTests":6,"numPendingTests":3,"numTodoTests":1,"success":false,"testResults":[{"name":"D:/AgenticOS/server/src/__tests__/a.test.ts","status":"failed","message":"","assertionResults":[{"ancestorTitles":["outer","inner"],"fullName":"outer inner passes","status":"passed","title":"passes"},{"ancestorTitles":["outer","inner"],"fullName":"outer inner fails","status":"failed","title":"fails"},{"ancestorTitles":["outer"],"fullName":"outer is skipped","status":"skipped","title":"is skipped"},{"ancestorTitles":["outer"],"fullName":"outer is todo","status":"todo","title":"is todo"},{"ancestorTitles":["outer"],"fullName":"outer dup","status":"passed","title":"dup"},{"ancestorTitles":["outer"],"fullName":"outer dup","status":"failed","title":"dup"},{"ancestorTitles":[],"fullName":"top level fails","status":"failed","title":"top level fails"},{"ancestorTitles":[],"fullName":"each 1","status":"passed","title":"each 1"},{"ancestorTitles":[],"fullName":"each 2","status":"failed","title":"each 2"}]},{"name":"D:/AgenticOS/server/src/__tests__/b.test.ts","status":"failed","message":"","assertionResults":[{"ancestorTitles":["outer"],"fullName":"outer fails","status":"failed","title":"fails"}]},{"name":"D:/AgenticOS/server/src/__tests__/c.test.ts","status":"failed","message":"Cannot find module './does-not-exist.js' imported from /home","assertionResults":[]},{"name":"D:/AgenticOS/server/src/__tests__/d.test.ts","status":"failed","message":"","assertionResults":[{"ancestorTitles":["hooked"],"fullName":"hooked t1","status":"skipped","title":"t1"},{"ancestorTitles":["hooked"],"fullName":"hooked t2","status":"skipped","title":"t2"}]},{"name":"D:/AgenticOS/server/src/__tests__/e.test.ts","status":"failed","message":"","assertionResults":[{"ancestorTitles":[],"fullName":"exits the worker","status":"failed","title":"exits the worker"}]}]};

  it('every failing test, the unloadable file and the failing hook are identified', () => {
    const ex = gate.extractTests(REAL, { root: ROOT });
    expect(ex.totals.failed - ex.totals.fileLevelFailures).toBe(REAL.numFailedTests);
    expect(ex.failing).toEqual(expect.arrayContaining([
      'src/__tests__/a.test.ts::outer > inner > fails',
      'src/__tests__/a.test.ts::outer > dup [#2]',
      'src/__tests__/a.test.ts::top level fails',
      'src/__tests__/a.test.ts::each 2',
      'src/__tests__/b.test.ts::outer > fails',
      `src/__tests__/c.test.ts::${gate.FILE_LEVEL_FAILURE}`,
      `src/__tests__/d.test.ts::${gate.FILE_LEVEL_FAILURE}`,
      'src/__tests__/e.test.ts::exits the worker',
    ]));
    expect(ex.failing).toHaveLength(8);
  });

  it('passing, skipped and todo tests are not failures', () => {
    const ex = gate.extractTests(REAL, { root: ROOT });
    expect(ex.failing.join('\n')).not.toMatch(/passes|is skipped|is todo|each 1/);
  });

  it('as its own baseline it passes, and one more failure on top of it fails', () => {
    const baseline = gate.buildBaseline(REAL, { root: ROOT, commit: BASELINE_COMMIT });
    expect(gate.compareToBaseline(REAL, baseline, { root: ROOT, vitestExit: 1 }).verdict).toBe('PASS');
    const worse = JSON.parse(JSON.stringify(REAL));
    worse.testResults[0].assertionResults.find((a: { title: string }) => a.title === 'passes').status = 'failed';
    expect(gate.compareToBaseline(worse, baseline, { root: ROOT, vitestExit: 1 }).newFailures).toEqual(['src/__tests__/a.test.ts::outer > inner > passes']);
  });
});

describe('command line', () => {
  let dir: string;
  beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase1-gate-')); });
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  const run = (args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  const write = (name: string, value: unknown) => { const p = path.join(dir, name); fs.writeFileSync(p, typeof value === 'string' ? value : JSON.stringify(value), 'utf8'); return p; };

  it('baseline -> compare: exit 0 when nothing is new, exit 1 listing the new failure, exit 2 when inconclusive', () => {
    const baseRep = write('base.json', report({ [`${BASELINE_ROOT}/src/__tests__/old.test.ts`]: [fail('s', 'known'), pass('s', 'ok')] }));
    const baselinePath = path.join(dir, 'baseline.json');
    const made = run(['baseline', '--report', baseRep, '--root', BASELINE_ROOT, '--commit', BASELINE_COMMIT, '--out', baselinePath, '--vitest-exit', '1']);
    expect(made.status).toBe(0);
    expect(made.stdout).toMatch(/BASELINE written: 1 failing test identities/);
    expect(run(['verify-baseline', '--baseline', baselinePath]).status).toBe(0);

    const same = write('same.json', report({ [`${ROOT}/src/__tests__/old.test.ts`]: [fail('s', 'known'), pass('s', 'ok')] }));
    const okRun = run(['compare', '--report', same, '--root', ROOT, '--baseline', baselinePath, '--vitest-exit', '1', '--out', path.join(dir, 'ok-result.json')]);
    expect(okRun.status).toBe(0);
    expect(okRun.stdout).toMatch(/RESULT: PASS/);

    const worse = write('worse.json', report({ [`${ROOT}/src/__tests__/old.test.ts`]: [pass('s', 'known'), fail('s', 'ok \u2192 arrow')] }));
    const bad = run(['compare', '--report', worse, '--root', ROOT, '--baseline', baselinePath, '--vitest-exit', '1', '--out', path.join(dir, 'bad-result.json')]);
    expect(bad.status).toBe(1);
    expect(bad.stdout).toMatch(/NEW FAILURE: src\/__tests__\/old.test.ts::s > ok \\u2192 arrow/); // console output is ASCII only
    expect(bad.stdout).toMatch(/RESULT: FAIL/);
    // the baseline failure that now passes is listed by name (informational), next to the new failure
    expect(bad.stdout).toMatch(/BASELINE FAILURE NOW PASSING \(informational\): src\/__tests__\/old.test.ts::s > known/);
    const result = JSON.parse(fs.readFileSync(path.join(dir, 'bad-result.json'), 'utf8'));
    expect(result.newFailures).toEqual(['src/__tests__/old.test.ts::s > ok \u2192 arrow']); // the JSON keeps the exact characters

    const broken = write('broken.json', '{ not json');
    const inconclusive = run(['compare', '--report', broken, '--root', ROOT, '--baseline', baselinePath]);
    expect(inconclusive.status).toBe(2);
    expect(inconclusive.stderr).toMatch(/INCONCLUSIVE/);
    expect(run(['compare', '--report', same, '--root', ROOT, '--baseline', path.join(dir, 'missing.json')]).status).toBe(2);
    expect(run(['nonsense']).status).toBe(2);
  });

  it('baseline accepts several --report/--vitest-exit pairs and refuses mismatched counts', () => {
    const r1 = write('multi1.json', report({ [`${BASELINE_ROOT}/src/__tests__/m.test.ts`]: [fail('s', 'a'), pass('s', 'b')] }));
    const r2 = write('multi2.json', report({ [`${BASELINE_ROOT}/src/__tests__/m.test.ts`]: [pass('s', 'a'), fail('s', 'b')] }));
    const out = path.join(dir, 'multi-baseline.json');
    const ok = run(['baseline', '--report', r1, '--report', r2, '--root', BASELINE_ROOT, '--commit', BASELINE_COMMIT, '--out', out, '--vitest-exit', '1', '--vitest-exit', '1']);
    expect(ok.status).toBe(0);
    expect(ok.stdout).toMatch(/2 failing test identities \(union of 2 run\(s\): 0 in every run, 2 intermittent\)/);
    expect(JSON.parse(fs.readFileSync(out, 'utf8')).failing).toHaveLength(2);
    const bad = run(['baseline', '--report', r1, '--report', r2, '--root', BASELINE_ROOT, '--commit', BASELINE_COMMIT, '--out', path.join(dir, 'x.json'), '--vitest-exit', '1']);
    expect(bad.status).toBe(2);
    expect(bad.stderr).toMatch(/one --vitest-exit per --report/);
    const wrongCommit = run(['baseline', '--report', r1, '--root', BASELINE_ROOT, '--commit', '9ca7ac63fe04f8a89b4522ef1c63ebc9bc447b9a', '--out', path.join(dir, 'y.json')]);
    expect(wrongCommit.status).toBe(2);
    expect(wrongCommit.stderr).toMatch(/approved pre-Phase-1 commit/);
  });

  it('a report that starts with a UTF-8 BOM is still read', () => {
    const rep = write('bom.json', `\ufeff${JSON.stringify(report({ [`${ROOT}/src/__tests__/a.test.ts`]: [pass('s', 'ok')] }))}`);
    const out = run(['gate', '--report', rep, '--root', ROOT]);
    expect(out.status).toBe(0);
  });

  it('gate: exit 1 on a failed or skipped test, exit 0 when it all passed', () => {
    const good = write('gate-good.json', report({ [`${ROOT}/src/__tests__/a.test.ts`]: [pass('s', 'ok')] }));
    const bad = write('gate-bad.json', report({ [`${ROOT}/src/__tests__/a.test.ts`]: [pass('s', 'ok'), skip('s', 'later')] }));
    expect(run(['gate', '--report', good, '--root', ROOT, '--require-passed', 's > ok']).status).toBe(0);
    const failed = run(['gate', '--report', bad, '--root', ROOT]);
    expect(failed.status).toBe(1);
    expect(failed.stdout).toMatch(/skipped/);
    expect(run(['gate', '--report', bad, '--root', ROOT, '--allow-skipped']).status).toBe(0);
    expect(run(['gate', '--report', path.join(dir, 'nope.json'), '--root', ROOT]).status).toBe(2);
  });
});
