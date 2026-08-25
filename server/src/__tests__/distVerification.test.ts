import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeDistFingerprint } from '../services/buildIdentity.js';

const SCRIPTS = path.resolve(__dirname, '../../../scripts');
const DIFF_SCRIPT = path.join(SCRIPTS, 'diff-packaged-dist.cjs');
const FP_SCRIPT = path.join(SCRIPTS, 'compute-dist-fingerprint.cjs');

let tmpA: string;
let tmpB: string;
beforeEach(() => {
  tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'agenticos-dv-a-'));
  tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'agenticos-dv-b-'));
});
afterEach(() => {
  fs.rmSync(tmpA, { recursive: true, force: true });
  fs.rmSync(tmpB, { recursive: true, force: true });
});

function writeFile(root: string, rel: string, content: string): void {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

describe('compute-dist-fingerprint.cjs', () => {
  it('produces the same fingerprint as the TypeScript runtime module', () => {
    writeFile(tmpA, 'index.js', 'const a = 1;');
    writeFile(tmpA, 'routers/health.js', 'export {}');
    const fromTs = computeDistFingerprint(tmpA).fingerprint;
    const fromCjs = JSON.parse(execFileSync('node', [FP_SCRIPT, tmpA], { encoding: 'utf8' }));
    expect(fromCjs.fingerprint).toBe(fromTs);
    expect(fromCjs.algorithm).toBe('content-sha256-v1');
    expect(fromCjs.filesCount).toBe(2);
  });
});

describe('diff-packaged-dist.cjs', () => {
  it('E. reports IDENTICAL for matching trees (exit 0)', () => {
    writeFile(tmpA, 'index.js', 'same');
    writeFile(tmpA, 'r/a.js', 'x');
    writeFile(tmpB, 'index.js', 'same');
    writeFile(tmpB, 'r/a.js', 'x');
    const out = execFileSync('node', [DIFF_SCRIPT, tmpA, tmpB], { encoding: 'utf8' });
    expect(out).toContain('IDENTICAL');
  });

  it('F. reports STALE for deliberately different trees (exit 1)', () => {
    writeFile(tmpA, 'index.js', 'same');
    writeFile(tmpA, 'only-repo.js', 'x');
    writeFile(tmpB, 'index.js', 'DIFFERENT');
    writeFile(tmpB, 'only-packaged.js', 'y');
    let stderr = '';
    let stdout = '';
    let status: number | null = null;
    try {
      execFileSync('node', [DIFF_SCRIPT, tmpA, tmpB], { encoding: 'utf8' });
    } catch (e: any) {
      status = e.status ?? null;
      stdout = String(e.stdout || '');
      stderr = String(e.stderr || '');
    }
    expect(status).toBe(1);
    expect(stdout).toContain('STALE');
    expect(stdout).toContain('only-repo.js'); // missing from packaged
    expect(stdout).toContain('only-packaged.js'); // extra in packaged
    expect(stdout).toContain('index.js'); // differing
  });
});
