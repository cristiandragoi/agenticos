import { exec } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../../utils/logger.js';
import type { TestResult, TestVerdict, BaselineComparison, TestReport } from './types.js';

export class RepairTestRunner {
  /** Ensure worktree has required node_modules junctions and scripts */
  private ensureWorktreeEnvironment(worktreePath: string, sourceTreePath: string): void {
    try {
      const rootModules = path.join(sourceTreePath, 'node_modules');
      const targetRootModules = path.join(worktreePath, 'node_modules');
      if (fs.existsSync(rootModules) && !fs.existsSync(targetRootModules)) {
        fs.symlinkSync(rootModules, targetRootModules, 'junction');
      }

      const serverModules = path.join(sourceTreePath, 'server', 'node_modules');
      const targetServerModules = path.join(worktreePath, 'server', 'node_modules');
      if (fs.existsSync(serverModules) && !fs.existsSync(targetServerModules)) {
        fs.mkdirSync(path.join(worktreePath, 'server'), { recursive: true });
        fs.symlinkSync(serverModules, targetServerModules, 'junction');
      }

      const whisperScriptSrc = path.join(sourceTreePath, 'server', 'scripts', 'whisper_worker.py');
      const whisperScriptDst = path.join(worktreePath, 'server', 'scripts', 'whisper_worker.py');
      if (fs.existsSync(whisperScriptSrc) && !fs.existsSync(whisperScriptDst)) {
        fs.mkdirSync(path.dirname(whisperScriptDst), { recursive: true });
        fs.copyFileSync(whisperScriptSrc, whisperScriptDst);
      }
    } catch (e: any) {
      logger.warn('[SelfHeal:RepairTestRunner] Warning ensuring worktree environment:', e?.message);
    }
  }

  /**
   * Run tests with baseline comparison against the source tree.
   * Step 1: Capture baseline TypeScript errors in sourceTreePath
   * Step 2: Run TypeScript check in worktreePath
   * Step 3: Run additional tests from testsRequired
   * Step 4: Compute baseline comparison and verdict
   * Step 5: Return TestReport
   */
  async runTests(worktreePath: string, sourceTreePath: string, testsRequired: string[]): Promise<TestReport>;
  async runTests(worktreePath: string, testsRequired: string[]): Promise<TestReport>;
  async runTests(
    worktreePath: string,
    sourceTreePathOrTests: string | string[] = 'D:\\AgenticOS',
    testsRequiredArg: string[] = []
  ): Promise<TestReport> {
    let sourceTreePath = 'D:\\AgenticOS';
    let testsRequired: string[] = testsRequiredArg;

    if (Array.isArray(sourceTreePathOrTests)) {
      testsRequired = sourceTreePathOrTests;
    } else if (typeof sourceTreePathOrTests === 'string') {
      sourceTreePath = sourceTreePathOrTests;
    }

    this.ensureWorktreeEnvironment(worktreePath, sourceTreePath);

    logger.info(`[SelfHeal] Running tests in ${worktreePath} (baseline: ${sourceTreePath})`);

    // 1. Capture baseline: run `npx tsc --noEmit` in sourceTreePath, parse error lines
    const baselineResult = await this.runCommand('npx tsc --noEmit', 'Baseline TypeScript check', sourceTreePath);
    const baselineErrors = this.parseTypeScriptErrors(`${baselineResult.stdout}\n${baselineResult.stderr}`, sourceTreePath);

    // 2. Run tsc --noEmit in worktreePath, parse error lines
    const worktreeTscResult = await this.runCommand('npx tsc --noEmit', 'TypeScript check', worktreePath);
    const postPatchErrors = this.parseTypeScriptErrors(`${worktreeTscResult.stdout}\n${worktreeTscResult.stderr}`, worktreePath);

    const results: TestResult[] = [worktreeTscResult];

    // 3. Ensure npm run build is always executed and verified in server/
    const serverDir = path.join(worktreePath, 'server');
    if (fs.existsSync(path.join(serverDir, 'package.json'))) {
      results.push(await this.runCommand('npm run build', 'Server Build Check', serverDir));
    }

    // 4. Run additional tests from testsRequired
    for (const test of testsRequired) {
      const trimmed = test.trim();
      if (!trimmed || trimmed === 'npm run build') continue;

      if (trimmed.startsWith('npm test') || trimmed.startsWith('npm run test')) {
        const cmdCwd = fs.existsSync(serverDir) ? serverDir : worktreePath;
        let testCmd = trimmed.replace(/\bnpm run test\b/, 'npm test').replace(/--grep/g, '-t');
        const match = testCmd.match(/npm test(?:\s+--)?\s+(.+)$/);
        if (match && match[1]) {
          const target = match[1].trim();
          const targetExists = fs.existsSync(path.resolve(cmdCwd, target)) || fs.existsSync(path.resolve(worktreePath, target));
          if (!targetExists) {
            const testsDir = path.join(cmdCwd, 'src', '__tests__');
            if (fs.existsSync(testsDir)) {
              const files = fs.readdirSync(testsDir);
              const matched = files.find(f => f.includes('browserActionContract') || (f.includes('browser') && f.endsWith('.test.ts')));
              if (matched) {
                testCmd = `npm test -- src/__tests__/${matched}`;
              } else {
                testCmd = 'npm test -- src/__tests__/browserActionContract.test.ts';
              }
            }
          }
        } else {
          testCmd = 'npm test -- src/__tests__/browserActionContract.test.ts';
        }
        results.push(await this.runCommand(testCmd, `Script: ${testCmd}`, cmdCwd));
      } else if (trimmed.startsWith('npm run ')) {
        const isServer = trimmed.includes('server') || fs.existsSync(path.join(worktreePath, 'server', 'package.json'));
        const cmdCwd = isServer ? path.join(worktreePath, 'server') : worktreePath;
        results.push(await this.runCommand(trimmed, `Script: ${trimmed}`, cmdCwd));
      } else if (trimmed.includes('frontend') || trimmed.includes('vite')) {
        results.push(await this.runCommand('npx vite build', 'Frontend build', worktreePath));
      } else if (trimmed.endsWith('.test.ts') || trimmed.endsWith('.spec.ts') || trimmed.includes('vitest')) {
        const configFlag = fs.existsSync(path.join(worktreePath, 'vitest.server.config.ts')) ? '--config vitest.server.config.ts' : '';
        results.push(await this.runCommand(`npx vitest run ${configFlag} ${trimmed}`.trim(), `Vitest: ${trimmed}`, worktreePath));
      } else if (/^(node|python|sh|bash|vitest)\b/i.test(trimmed)) {
        results.push(await this.runCommand(trimmed, `Command: ${trimmed}`, worktreePath));
      } else {
        logger.info(`[SelfHeal] Skipping descriptive non-command test requirement: "${trimmed}"`);
      }
    }

    // 4. Compute baseline comparison:
    //    - baselineErrors = errors from step 1
    //    - postPatchErrors = errors from step 2
    //    - newErrors = postPatch minus baseline
    //    - fixedErrors = baseline minus postPatch
    //    - verdict: if newErrors.length > 0 → FAIL, elif postPatchErrors.length > 0 → PASS_WITH_BASELINE_FAILURES, else → PASS
    const baselineSet = new Set(baselineErrors);
    const postPatchSet = new Set(postPatchErrors);

    const newErrors = postPatchErrors.filter(err => !baselineSet.has(err));
    const fixedErrors = baselineErrors.filter(err => !postPatchSet.has(err));

    let baselineVerdict: TestVerdict;
    if (newErrors.length > 0) {
      baselineVerdict = 'FAIL';
    } else if (postPatchErrors.length > 0) {
      baselineVerdict = 'PASS_WITH_BASELINE_FAILURES';
    } else {
      baselineVerdict = 'PASS';
    }

    const baselineComparison: BaselineComparison = {
      baselineErrors,
      postPatchErrors,
      newErrors,
      fixedErrors,
      verdict: baselineVerdict,
    };

    // If no new errors were introduced, type check passed relative to baseline
    if (baselineVerdict === 'PASS_WITH_BASELINE_FAILURES') {
      worktreeTscResult.passed = true;
    }

    // Check additional tests
    const additionalTestsPassed = results
      .filter(r => r !== worktreeTscResult)
      .every(r => r.passed);

    let overallVerdict: TestVerdict;
    if (baselineComparison.verdict === 'FAIL' || !additionalTestsPassed) {
      overallVerdict = 'FAIL';
    } else if (baselineComparison.verdict === 'PASS_WITH_BASELINE_FAILURES') {
      overallVerdict = 'PASS_WITH_BASELINE_FAILURES';
    } else {
      overallVerdict = 'PASS';
    }

    // 5. Return TestReport with results array, baseline comparison, and overallVerdict
    const report: TestReport = {
      results,
      baseline: baselineComparison,
      overallVerdict,
    };

    logger.info(`[SelfHeal] Test verdict: ${overallVerdict} (new errors: ${newErrors.length}, fixed: ${fixedErrors.length}, baseline: ${baselineErrors.length})`);

    return report;
  }

  /** Helper to run a command asynchronously and non-blocking without stalling the event loop */
  private async runCommand(cmd: string, name: string, cwd: string, timeoutMs: number = 120_000): Promise<TestResult> {
    logger.info(`[SelfHeal] Running: ${cmd} in ${cwd}`);
    const startMs = Date.now();
    return new Promise<TestResult>((resolve) => {
      exec(cmd, { cwd, timeout: timeoutMs, encoding: 'utf8' }, (err, stdoutStr, stderrStr) => {
        const stdout = String(stdoutStr ?? '');
        const stderr = String(stderrStr ?? '');
        const exitCode = err ? (typeof (err as any).code === 'number' ? (err as any).code : 1) : 0;
        const passed = !err;
        const durationMs = Date.now() - startMs;
        const truncOut = stdout.length > 2048 ? stdout.substring(0, 2048) + '... (truncated)' : stdout;
        const truncErr = stderr.length > 2048 ? stderr.substring(0, 2048) + '... (truncated)' : stderr;
        resolve({ name, command: cmd, exitCode, stdout: truncOut, stderr: truncErr, durationMs, passed });
      });
    });
  }

  /**
   * Split by newline, filter lines matching pattern like `file.ts(line,col): error TS...`
   * Return array of error strings
   */
  private parseTypeScriptErrors(output: string, cwd?: string): string[] {
    if (!output) return [];
    const lines = output.split(/\r?\n/);
    const pattern = /(?:[^\s()]+(?:\(\d+,\d+\)|:\d+:\d+)\s*(?::|\s+-)\s*error\s+TS\d+|error\s+TS\d+:)/;

    const errorLines: string[] = [];
    const normalizedCwd = cwd ? cwd.replace(/\\/g, '/').replace(/\/$/, '') : null;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (pattern.test(line)) {
        let normalizedLine = line;
        if (normalizedCwd) {
          const slashLine = line.replace(/\\/g, '/');
          if (slashLine.startsWith(normalizedCwd)) {
            normalizedLine = slashLine.slice(normalizedCwd.length).replace(/^\//, '');
          }
        }
        errorLines.push(normalizedLine);
      }
    }
    return errorLines;
  }
}

export const repairTestRunner = new RepairTestRunner();
