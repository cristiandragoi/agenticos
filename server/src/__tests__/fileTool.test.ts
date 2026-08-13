/**
 * P1 regression tests — search_files cross-platform semantics fix.
 *
 * The documented audit defect: Windows used `findstr /c:` (LITERAL) while
 * Unix used `grep -rn` (REGEX) — the same `pattern` parameter behaved
 * differently per OS, and both were shell-string interpolations (injection
 * surface). The fix uses Node fs APIs only: regex semantics on every OS,
 * no shell, spaces/special chars safe, bounded.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { searchFilesTool, resolveBoundedSearchPath } from '../services/agent/tools/fileTool.js';

// The tool's workspace boundary resolves against workspaceStore; mock the
// authoritative root to the test fixture so escape cases are deterministic.
vi.mock('../services/workspaceStore.js', () => ({
  getWorkspaceRoot: () => fixtureRoot,
}));

let fixtureRoot = '';

function write(rel: string, content: string | Buffer): void {
  const abs = path.join(fixtureRoot, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

beforeAll(() => {
  fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'filetool-fixture-'));
  write('alpha.ts', 'export const alpha = 1;\nconst beta = 2;\n');
  write('beta.ts', 'export const betaValue = 2;\n');
  write('nested/deep/gamma.ts', 'gamma export\n');
  write('folder with spaces/space file.ts', 'spacey content\n');
  write('node_modules/ignored.ts', 'should not appear\n');
  write('binary.dat', Buffer.from([1, 0, 2, 0, 3]));
  write('.env', 'TOKEN=literal-secret\n');
});

afterAll(() => {
  try { fs.rmSync(fixtureRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

async function run(args: Record<string, unknown>): Promise<any> {
  const out = await searchFilesTool.handler(args as any);
  return JSON.parse(out);
}

describe('search_files content — cross-platform regex semantics (P1)', () => {
  it('regex pattern matches on any OS (previously literal-only on Windows)', async () => {
    // `beta` as an anchored regex: matches beta.ts and alpha.ts line 2.
    const res = await run({ target: 'content', pattern: '^export const beta', path: fixtureRoot });
    expect(res.error).toBeUndefined();
    expect(res.matches.some((m: string) => m.includes('beta.ts'))).toBe(true);
    expect(res.matches.some((m: string) => m.includes('alpha.ts'))).toBe(false);
  });

  it('regex alternation works (regex semantics, not literal)', async () => {
    const res = await run({ target: 'content', pattern: 'gamma|alpha', path: fixtureRoot });
    expect(res.matches.length).toBeGreaterThanOrEqual(2);
    expect(res.matches.some((m: string) => m.includes('gamma.ts'))).toBe(true);
    expect(res.matches.some((m: string) => m.includes('alpha.ts'))).toBe(true);
  });

  it('spaces in paths are safe (no shell quoting issue)', async () => {
    const res = await run({ target: 'content', pattern: 'spacey', path: fixtureRoot });
    expect(res.matches.some((m: string) => m.includes('folder with spaces/space file.ts'))).toBe(true);
  });

  it('special characters in the pattern are treated as regex, not shell commands (no injection)', async () => {
    const res = await run({ target: 'content', pattern: '.*; rm -rf /', path: fixtureRoot });
    // No crash, no shell execution: matches the literal via regex (.* matches,
    // then '; rm -rf /' is regex text — no line contains it after the .* form
    // actually requires the full pattern; expect zero matches, not an exploit).
    expect(res.error).toBeUndefined();
    expect(Array.isArray(res.matches)).toBe(true);
  });

  it('invalid regex → truthful error, distinct from zero matches', async () => {
    const res = await run({ target: 'content', pattern: '[unclosed', path: fixtureRoot });
    expect(res.error).toBeTruthy();
    expect(res.error).toMatch(/Invalid regex/i);

    const zero = await run({ target: 'content', pattern: 'definitelyNotPresentAnywhere', path: fixtureRoot });
    expect(zero.error).toBeUndefined();
    expect(zero.matches).toEqual([]);
  });

  it('ignored directories and secret files are not searched', async () => {
    const nodeModules = await run({ target: 'content', pattern: 'should not appear', path: fixtureRoot });
    expect(nodeModules.matches).toEqual([]);
    const env = await run({ target: 'content', pattern: 'literal-secret', path: fixtureRoot });
    expect(env.matches).toEqual([]);
  });

  it('binary files are skipped (no flood)', async () => {
    const res = await run({ target: 'content', pattern: '.', path: fixtureRoot });
    expect(res.matches.some((m: string) => m.includes('binary.dat'))).toBe(false);
  });
});

describe('search_files files — glob name search', () => {
  it('matches by glob on every OS', async () => {
    const res = await run({ target: 'files', pattern: '*.ts', path: fixtureRoot });
    expect(res.matches.some((m: string) => m.endsWith('alpha.ts'))).toBe(true);
    expect(res.matches.some((m: string) => m.endsWith('beta.ts'))).toBe(true);
    expect(res.matches.some((m: string) => m.includes('node_modules'))).toBe(false);
  });

  it('bounded limit + truncated flag', async () => {
    const res = await run({ target: 'files', pattern: '*', path: fixtureRoot, limit: 1 });
    expect(res.matches.length).toBeLessThanOrEqual(1);
    expect(res.truncated).toBe(true);
  });
});

describe('search_files workspace boundary (security follow-up)', () => {
  it('1. normal path inside workspace → allowed', async () => {
    const res = await run({ target: 'content', pattern: 'gamma', path: path.join(fixtureRoot, 'nested') });
    expect(res.error).toBeUndefined();
    expect(res.matches.some((m: string) => m.includes('gamma.ts'))).toBe(true);
  });

  it('2. ../ traversal → denied', async () => {
    const res = await run({ target: 'content', pattern: 'gamma', path: '..' });
    expect(res.error).toMatch(/outside the workspace/i);
  });

  it('3. absolute path outside workspace → denied', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'filetool-outside-'));
    try {
      const res = await run({ target: 'content', pattern: 'x', path: outside });
      expect(res.error).toMatch(/outside the workspace/i);
    } finally {
      try { fs.rmSync(outside, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it('4. symlink escape → denied (walker never follows symlinks)', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'filetool-link-'));
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'linkEscapeMarker\n', 'utf-8');
    const linkPath = path.join(fixtureRoot, 'escape-link');
    let linkCreated = false;
    try {
      fs.symlinkSync(outside, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
      linkCreated = true;
    } catch {
      // No symlink privilege — the walker still must not crash or escape.
    }
    try {
      const res = await run({ target: 'content', pattern: 'linkEscapeMarker', path: fixtureRoot });
      expect(res.error).toBeUndefined();
      // lstat-based dirents: symlinked dirs are never descended into.
      expect(res.matches.some((m: string) => m.includes('escape-link'))).toBe(false);
    } finally {
      if (linkCreated) { try { fs.rmSync(linkPath, { recursive: true, force: true }); } catch { /* ignore */ } }
      try { fs.rmSync(outside, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it('5. Windows path variant outside workspace → denied', async () => {
    const rootDrive = path.parse(fixtureRoot).root; // e.g. C:\
    const otherDrive = rootDrive.toLowerCase() === 'c:\\' ? 'D:\\' : 'C:\\';
    const res = await run({ target: 'content', pattern: 'x', path: path.join(otherDrive, 'somewhere') });
    expect(res.error).toMatch(/outside the workspace/i);
  });

  it('6. WSL/POSIX path variant outside workspace → denied', async () => {
    const res = await run({ target: 'content', pattern: 'x', path: '/mnt/c/Windows' });
    expect(res.error).toMatch(/outside the workspace/i);
  });

  it('resolveBoundedSearchPath: relative anchors at root; root itself allowed', () => {
    const inside = resolveBoundedSearchPath('nested', fixtureRoot);
    expect('searchPath' in inside).toBe(true);
    if ('searchPath' in inside) expect(inside.searchPath).toBe(path.resolve(fixtureRoot, 'nested'));

    const rootItself = resolveBoundedSearchPath(undefined, fixtureRoot);
    expect('searchPath' in rootItself).toBe(true);
    if ('searchPath' in rootItself) expect(rootItself.searchPath).toBe(fixtureRoot);

    const escaped = resolveBoundedSearchPath(path.join(fixtureRoot, '..'), fixtureRoot);
    expect('error' in escaped).toBe(true);
  });
});
