/**
 * WorkspaceIndexer V1 tests (P13/P14):
 * - deterministic fixture tree (nested, dup terms, exact/text cases, ignored
 *   dir, binary, oversized, spaces-in-path, changed/deleted scenario)
 * - initial + incremental indexing (new/changed/deleted/skipped)
 * - EXACT / TEXT / AUTO retrieval + provenance
 * - budgets / truncation
 * - workspace boundary + ignore rules
 * - failure/cancellation behavior
 * - project scoping + cross-workspace isolation
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  indexWorkspace, searchWorkspace, clearWorkspaceIndex, getIndexStatus,
  exactSearchWorkspace, textSearchWorkspace, normalizeWorkspaceId,
  WI_MAX_SNIPPET_CHARS,
} from '../services/workspaceIndexer.js';
import { projectsStore } from '../services/projectsStore.js';

let fixtureRoot = '';
const createdProjectIds: string[] = [];

function writeFixtureFile(rel: string, content: string): string {
  const abs = path.join(fixtureRoot, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
  return abs;
}

beforeAll(() => {
  fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-index-fixture-'));
  // Nested source tree with duplicate terms
  writeFixtureFile('src/index.ts', 'export function renderThing() {\n  return "duplicate-term";\n}\n');
  writeFixtureFile('src/utils/helpers.ts', 'export const helper = () => "duplicate-term";\n');
  writeFixtureFile('src/unique-token-file.ts', 'const uniqueTokenHere = 42;\n');
  writeFixtureFile('docs/notes.md', '# Notes\n\nWe decided the term "duplicate-term" stays.\n');
  writeFixtureFile('config/app.yaml', 'name: agenticos\nmode: local\n');
  writeFixtureFile('folder with spaces/file spaced.txt', 'spaced file content uniqueTokenHere\n');
  // Ignored
  writeFixtureFile('node_modules/pkg/index.js', 'ignored node_modules content\n');
  writeFixtureFile('dist/out.js', 'ignored dist content\n');
  writeFixtureFile('.env', 'SECRET_KEY=should-not-be-indexed\n');
  writeFixtureFile('secret.pem', 'PRIVATE KEY MATERIAL\n');
  // Binary (NUL bytes)
  writeFixtureFile('assets/blob.bin', Buffer.concat([Buffer.from('data'), Buffer.from([0, 1, 2, 0]), Buffer.from('more')]));
  // Oversized (> cap) — write directly with fs
  const bigAbs = path.join(fixtureRoot, 'big.txt');
  fs.writeFileSync(bigAbs, 'x'.repeat(600 * 1024), 'utf-8');
});

afterAll(() => {
  try { fs.rmSync(fixtureRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  for (const id of createdProjectIds) {
    try { projectsStore.deleteProject(id); } catch { /* ignore */ }
  }
  try { clearWorkspaceIndex({ rootOverride: fixtureRoot }); } catch { /* ignore */ }
});

afterEach(() => {
  // Reset the fixture workspace index between tests where needed.
});

function fixtureWorkspaceId(): string {
  return normalizeWorkspaceId(fixtureRoot);
}

describe('WorkspaceIndexer V1 — indexing', () => {
  it('initial index: indexes text files, skips ignored/binary/oversized', () => {
    clearWorkspaceIndex({ rootOverride: fixtureRoot });
    const stats = indexWorkspace({ rootOverride: fixtureRoot });

    expect(stats.error).toBeUndefined();
    expect(stats.filesIndexed).toBe(6); // exactly the 6 text fixture files
    expect(stats.filesTotal).toBe(stats.filesIndexed);
    // Rejected = .env + secret.pem + blob.bin + big.txt (oversized)
    expect(stats.filesRejected).toBeGreaterThanOrEqual(4);
    // Oversized/binary are NOT in the index
    expect(getIndexStatus({ rootOverride: fixtureRoot }).filesTotal).toBe(stats.filesIndexed);
  });

  it('incremental refresh: unchanged skipped, changed updated, deleted removed, new added', () => {
    clearWorkspaceIndex({ rootOverride: fixtureRoot });
    const first = indexWorkspace({ rootOverride: fixtureRoot });

    // No-change refresh
    const noChange = indexWorkspace({ rootOverride: fixtureRoot });
    expect(noChange.filesSkipped).toBe(first.filesIndexed);
    expect(noChange.filesIndexed).toBe(0);
    expect(noChange.filesUpdated).toBe(0);
    expect(noChange.filesDeleted).toBe(0);

    // Change a file
    writeFixtureFile('src/index.ts', 'export function renderThing() {\n  return "changed-content";\n}\n');
    // Add a new file
    writeFixtureFile('src/newfile.ts', 'export const brandNew = "fresh";\n');

    const refresh = indexWorkspace({ rootOverride: fixtureRoot });
    expect(refresh.filesUpdated).toBe(1);
    expect(refresh.filesIndexed).toBe(1);
    expect(refresh.filesSkipped).toBe(first.filesIndexed - 1);
    expect(refresh.filesTotal).toBe(first.filesIndexed + 1);

    // Delete a file
    fs.rmSync(path.join(fixtureRoot, 'src', 'newfile.ts'), { force: true });
    const afterDelete = indexWorkspace({ rootOverride: fixtureRoot });
    expect(afterDelete.filesDeleted).toBe(1);
    expect(afterDelete.filesTotal).toBe(first.filesIndexed);

    // Restore original content for later tests
    writeFixtureFile('src/index.ts', 'export function renderThing() {\n  return "duplicate-term";\n}\n');
  });

  it('index stats are truthful (filesScanned/Indexed/Skipped/Rejected/Duration)', () => {
    const stats = indexWorkspace({ rootOverride: fixtureRoot });
    expect(stats.durationMs).toBeGreaterThanOrEqual(0);
    expect(stats.filesScanned).toBeGreaterThan(0);
    expect(stats.startedAt).toBeTruthy();
    expect(stats.completedAt).toBeTruthy();
    expect(typeof stats.filesScanned).toBe('number');
  });
});

describe('WorkspaceIndexer V1 — retrieval', () => {
  beforeAll(() => {
    clearWorkspaceIndex({ rootOverride: fixtureRoot });
    indexWorkspace({ rootOverride: fixtureRoot });
  });

  it('EXACT: literal substring with real line numbers', () => {
    const resp = searchWorkspace({ rootOverride: fixtureRoot, query: 'duplicate-term', mode: 'exact' });
    expect(resp.chosenMode).toBe('exact');
    expect(resp.error).toBeUndefined();
    expect(resp.total).toBeGreaterThanOrEqual(2);
    const paths = resp.results.map((r) => r.relPath);
    expect(paths).toContain('src/index.ts');
    expect(paths).toContain('src/utils/helpers.ts');
    const hit = resp.results.find((r) => r.relPath === 'src/index.ts');
    expect(hit?.line).toBe(2); // real line of "duplicate-term"
    expect(hit?.lineResolved).toBe(true);
    expect(hit?.snippet.length).toBeLessThanOrEqual(WI_MAX_SNIPPET_CHARS + 1);
  });

  it('EXACT: spaces in paths and files are searched', () => {
    const resp = searchWorkspace({ rootOverride: fixtureRoot, query: 'spaced file', mode: 'exact' });
    expect(resp.total).toBeGreaterThanOrEqual(1);
    expect(resp.results.some((r) => r.relPath.includes('folder with spaces'))).toBe(true);
  });

  it('TEXT: FTS5 ranked retrieval', () => {
    const resp = searchWorkspace({ rootOverride: fixtureRoot, query: 'duplicate-term', mode: 'text' });
    expect(resp.chosenMode).toBe('fts');
    expect(resp.total).toBeGreaterThanOrEqual(2);
    // FTS line resolution finds a real line where available
    const hit = resp.results.find((r) => r.relPath === 'src/index.ts');
    expect(hit?.line).toBe(2);
    expect(hit?.lineResolved).toBe(true);
    expect(typeof hit?.score).toBe('number');
  });

  it('TEXT: phrase query works', () => {
    const resp = searchWorkspace({ rootOverride: fixtureRoot, query: 'name agenticos', mode: 'text' });
    expect(resp.total).toBeGreaterThanOrEqual(1);
  });

  it('AUTO: single token → exact (cheapest); phrase → text', () => {
    const exact = searchWorkspace({ rootOverride: fixtureRoot, query: 'uniqueTokenHere', mode: 'auto' });
    expect(exact.chosenMode).toBe('exact');

    const text = searchWorkspace({ rootOverride: fixtureRoot, query: 'decided the term', mode: 'auto' });
    expect(text.chosenMode).toBe('fts');
  });

  it('ignored content is not searchable', () => {
    const resp = searchWorkspace({ rootOverride: fixtureRoot, query: 'ignored node_modules', mode: 'exact' });
    expect(resp.total).toBe(0);
    const dist = searchWorkspace({ rootOverride: fixtureRoot, query: 'ignored dist', mode: 'exact' });
    expect(dist.total).toBe(0);
  });

  it('secret files are not searchable', () => {
    const resp = searchWorkspace({ rootOverride: fixtureRoot, query: 'SECRET_KEY', mode: 'exact' });
    expect(resp.total).toBe(0);
  });

  it('budgets: limit + truncated flag are truthful', () => {
    // Write a file with many matches to exceed the limit
    const manyLines = Array.from({ length: 60 }, (_, i) => `line${i} budgetTerm${i % 3}`).join('\n');
    writeFixtureFile('src/many.txt', manyLines);
    indexWorkspace({ rootOverride: fixtureRoot });

    const resp = searchWorkspace({ rootOverride: fixtureRoot, query: 'budgetTerm', mode: 'exact', limit: 5 });
    expect(resp.results.length).toBeLessThanOrEqual(5);
    expect(resp.truncated).toBe(true); // more matches exist than returned

    fs.rmSync(path.join(fixtureRoot, 'src', 'many.txt'), { force: true });
    indexWorkspace({ rootOverride: fixtureRoot });
  });

  it('provenance: relPath + absPath inside root + workspaceId', () => {
    const resp = searchWorkspace({ rootOverride: fixtureRoot, query: 'helper', mode: 'exact' });
    for (const r of resp.results) {
      expect(r.relPath).not.toMatch(/^\.\./);
      expect(path.isAbsolute(r.absPath)).toBe(true);
      expect(r.absPath.startsWith(fixtureRoot)).toBe(true);
      expect(r.workspaceId).toBe(fixtureWorkspaceId());
    }
  });
});

describe('WorkspaceIndexer V1 — boundary/security', () => {
  it('no workspace → truthful result, not fabricated evidence', () => {
    const resp = searchWorkspace({ rootOverride: path.join(os.tmpdir(), 'ws-index-does-not-exist-xyz') });
    expect(resp.error).toBeTruthy();
    expect(resp.total).toBe(0);
    expect(resp.results).toEqual([]);
  });

  it('empty query → truthful error', () => {
    const resp = searchWorkspace({ rootOverride: fixtureRoot, query: '   ' });
    expect(resp.error).toBeTruthy();
  });

  it('cancelled search returns truncated without fabricated results', () => {
    const controller = new AbortController();
    controller.abort();
    const resp = searchWorkspace({ rootOverride: fixtureRoot, query: 'duplicate-term', mode: 'exact', signal: controller.signal });
    expect(resp.truncated).toBe(true);
    expect(resp.error).toBeUndefined();
  });

  it('cross-workspace isolation: index rows are workspace-scoped', () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-index-other-'));
    try {
      fs.writeFileSync(path.join(other, 'other.ts'), 'otherWorkspaceUniqueTerm\n', 'utf-8');
      clearWorkspaceIndex({ rootOverride: fixtureRoot });
      indexWorkspace({ rootOverride: fixtureRoot });
      indexWorkspace({ rootOverride: other });

      const inOther = searchWorkspace({ rootOverride: other, query: 'otherWorkspaceUniqueTerm', mode: 'exact' });
      expect(inOther.total).toBe(1);

      const inFixture = searchWorkspace({ rootOverride: fixtureRoot, query: 'otherWorkspaceUniqueTerm', mode: 'exact' });
      expect(inFixture.total).toBe(0);
    } finally {
      try { fs.rmSync(other, { recursive: true, force: true }); } catch { /* ignore */ }
      try { clearWorkspaceIndex({ rootOverride: other }); } catch { /* ignore */ }
    }
  });
});

describe('WorkspaceIndexer V1 — project integration', () => {
  it('project association resolves workspace root authoritatively (no filename inference)', () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-index-proj-'));
    try {
      fs.writeFileSync(path.join(other, 'projFile.ts'), 'projectScopedUniqueTerm\n', 'utf-8');
      const projectId = `proj-wsidx-${Date.now()}`;
      projectsStore.createProject({ id: projectId, name: 'WS Index Project', workspacePath: other });
      createdProjectIds.push(projectId);

      const resp = searchWorkspace({ projectId, query: 'projectScopedUniqueTerm', mode: 'exact' });
      expect(resp.error).toBeUndefined();
      expect(resp.total).toBe(1);

      // A different project id (unknown) is a truthful error
      const unknown = searchWorkspace({ projectId: 'proj-does-not-exist-xyz', query: 'x' });
      expect(unknown.error).toBeTruthy();
    } finally {
      try { fs.rmSync(other, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});

describe('WorkspaceIndexer V1 — clear', () => {
  it('clear removes all indexed rows for the workspace', () => {
    indexWorkspace({ rootOverride: fixtureRoot });
    expect(getIndexStatus({ rootOverride: fixtureRoot }).filesTotal).toBeGreaterThan(0);
    const cleared = clearWorkspaceIndex({ rootOverride: fixtureRoot });
    expect(cleared.ok).toBe(true);
    expect(getIndexStatus({ rootOverride: fixtureRoot }).filesTotal).toBe(0);
  });
});
