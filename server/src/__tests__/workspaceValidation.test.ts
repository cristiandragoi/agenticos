import { afterAll, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { detectGitRepository } from '../utils/workspaceValidation.js';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-validation-'));

function makeDir(relative: string): string {
  const dir = path.join(tmpRoot, relative);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

afterAll(() => {
  // Best-effort cleanup; temp files may be transiently locked on Windows.
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // ignore — the OS temp dir will be swept eventually
  }
});

describe('detectGitRepository', () => {
  it('rejects a path that does not exist', () => {
    const res = detectGitRepository(path.join(tmpRoot, 'missing-dir'));
    expect(res.isValid).toBe(false);
    expect(res.targetPath).toBe(path.normalize(path.resolve(path.join(tmpRoot, 'missing-dir'))));
    expect(res.gitRoot).toBeNull();
    expect(res.errorMessage).toBe('The specified path does not exist.');
  });

  it('rejects a path that is a file, not a directory', () => {
    const file = path.join(tmpRoot, 'plain-file.txt');
    fs.writeFileSync(file, 'x');
    const res = detectGitRepository(file);
    expect(res.isValid).toBe(false);
    expect(res.gitRoot).toBeNull();
    expect(res.errorMessage).toBe('The specified path is not a directory.');
  });

  it('accepts a directory that is itself a git repository', () => {
    const repo = makeDir('repo');
    fs.mkdirSync(path.join(repo, '.git'));
    const res = detectGitRepository(repo);
    expect(res.isValid).toBe(true);
    expect(res.gitRoot).toBe(repo);
    expect(res.errorMessage).toBeNull();
  });

  it('walks up to the enclosing git root for a nested directory', () => {
    const repo = makeDir('nested-repo');
    fs.mkdirSync(path.join(repo, '.git'));
    const nested = makeDir(path.join('nested-repo', 'a', 'b', 'c'));
    const res = detectGitRepository(nested);
    expect(res.isValid).toBe(true);
    expect(res.gitRoot).toBe(repo);
    expect(res.errorMessage).toBeNull();
  });

  it('rejects a directory tree without any git repository', () => {
    const plain = makeDir('plain-dir');
    const res = detectGitRepository(plain);
    expect(res.isValid).toBe(false);
    expect(res.gitRoot).toBeNull();
    expect(res.errorMessage).toBe('No Git repository found in this folder tree.');
  });

  it('resolves relative paths against the process cwd', () => {
    const res = detectGitRepository('.');
    // The repo under test is itself a git repository, so '.' must resolve.
    expect(res.isValid).toBe(true);
    expect(res.gitRoot).not.toBeNull();
  });
});
