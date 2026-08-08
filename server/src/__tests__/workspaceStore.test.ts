/**
 * Canonical workspace store — contract tests (workspace/file-reliability milestone).
 *
 * Covers §1 (one canonical root), §4 (path resolution + double-prefix guard),
 * §5 (file search fallback), §7 (truthful not-found), §9 (creation-time
 * capture on background tasks).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'node:path';
import os from 'node:os';

vi.setConfig({ hookTimeout: 60000, testTimeout: 30000 });

let tmpDir: string;
let repoDir: string;

function makeFixtureRepo(): string {
  const repo = path.join(tmpDir, 'repo');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'server/src/domains/jarvis'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'src/components/jarvis'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'src/pages'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'node_modules/junk'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'server/src/domains/jarvis/intentRouter.ts'), 'export const intentRouter = {};\n');
  fs.writeFileSync(path.join(repo, 'src/components/jarvis/JarvisChat.tsx'), 'export const JarvisChat = null;\n');
  fs.writeFileSync(path.join(repo, 'src/pages/CodeXStudio.tsx'), 'export const CodeXStudio = null;\n');
  fs.writeFileSync(path.join(repo, 'src/pages/index.ts'), 'export {};\n');
  fs.writeFileSync(path.join(repo, 'server/index.ts'), 'export {};\n');
  // Decoy with the same name inside node_modules — must be skipped.
  fs.writeFileSync(path.join(repo, 'node_modules/junk/intentRouter.ts'), 'decoy');
  return repo;
}

async function freshWorkspaceStore() {
  vi.resetModules();
  return await import('../services/workspaceStore.js');
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsstore-'));
  repoDir = makeFixtureRepo();
  process.env.AGENT_TEAMS_DB_PATH = path.join(tmpDir, 'test.db');
  delete process.env.AGENTICOS_WORKSPACE;
});

afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  delete process.env.AGENT_TEAMS_DB_PATH;
});

describe('§1 canonical workspace root', () => {
  it('returns the persisted user selection', async () => {
    const selectionFile = path.join(tmpDir, 'workspace-selection.json');
    fs.writeFileSync(selectionFile, JSON.stringify({ workspaceRoot: repoDir, selectedAt: new Date().toISOString(), source: 'user-selection' }));
    const ws = await freshWorkspaceStore();
    expect(ws.getWorkspaceRoot()).toBe(repoDir);
  });

  it('setWorkspaceRoot persists and becomes canonical', async () => {
    const ws = await freshWorkspaceStore();
    const result = ws.setWorkspaceRoot(repoDir);
    expect(result.ok).toBe(true);
    expect(result.workspaceRoot).toBe(repoDir);
    // Persisted for the next process (fresh module import).
    const ws2 = await freshWorkspaceStore();
    expect(ws2.getWorkspaceRoot()).toBe(repoDir);
  });

  it('rejects a nonexistent directory truthfully', async () => {
    const ws = await freshWorkspaceStore();
    const result = ws.setWorkspaceRoot(path.join(tmpDir, 'does-not-exist'));
    expect(result.ok).toBe(false);
    expect(result.error).toContain('does not exist');
  });
});

describe('§4 path resolution contract', () => {
  it('anchors relative paths at the workspace root', async () => {
    const ws = await freshWorkspaceStore();
    const resolved = ws.resolveWorkspacePath('server/src/domains/jarvis/intentRouter.ts', repoDir);
    expect(resolved).toBe(path.join(repoDir, 'server/src/domains/jarvis/intentRouter.ts'));
  });

  it('normalizes mixed Windows separators', async () => {
    const ws = await freshWorkspaceStore();
    const resolved = ws.resolveWorkspacePath('server\\src/domains\\jarvis/intentRouter.ts', repoDir);
    expect(resolved).toBe(path.join(repoDir, 'server', 'src', 'domains', 'jarvis', 'intentRouter.ts'));
  });

  it('keeps absolute paths inside the repo canonical', async () => {
    const ws = await freshWorkspaceStore();
    const abs = path.join(repoDir, 'server/index.ts');
    expect(ws.resolveWorkspacePath(abs, repoDir)).toBe(path.normalize(abs));
  });

  it('prevents accidental double-prefixes (§4)', async () => {
    const ws = await freshWorkspaceStore();
    const doubled = `${repoDir}${path.sep}${repoDir}${path.sep}server${path.sep}index.ts`;
    const resolved = ws.resolveWorkspacePath(doubled, repoDir);
    expect(resolved.toLowerCase()).toBe(path.join(repoDir, 'server', 'index.ts').toLowerCase());
    // And never contains the root twice.
    const occurrences = resolved.toLowerCase().split(repoDir.toLowerCase()).length - 1;
    expect(occurrences).toBe(1);
  });
});

describe('§5 file existence resolution before delegation', () => {
  it('resolves the exact relative path', async () => {
    const ws = await freshWorkspaceStore();
    const result = ws.resolveFileReference('server/src/domains/jarvis/intentRouter.ts', repoDir);
    expect(result.status).toBe('found');
    if (result.status === 'found') {
      expect(result.relativePath.replace(/\\/g, '/')).toBe('server/src/domains/jarvis/intentRouter.ts');
    }
  });

  it('resolves a bare filename via repository search', async () => {
    const ws = await freshWorkspaceStore();
    const result = ws.resolveFileReference('intentRouter.ts', repoDir);
    expect(result.status).toBe('found');
    if (result.status === 'found') {
      expect(result.relativePath.replace(/\\/g, '/')).toBe('server/src/domains/jarvis/intentRouter.ts');
    }
  });

  it('resolves an extensionless natural-language name (look at JarvisChat)', async () => {
    const ws = await freshWorkspaceStore();
    const result = ws.resolveFileReference('JarvisChat', repoDir);
    expect(result.status).toBe('found');
    if (result.status === 'found') {
      expect(result.relativePath.replace(/\\/g, '/')).toBe('src/components/jarvis/JarvisChat.tsx');
    }
  });

  it('reports ambiguity when multiple files match', async () => {
    const ws = await freshWorkspaceStore();
    const result = ws.resolveFileReference('index.ts', repoDir);
    expect(result.status).toBe('ambiguous');
    if (result.status === 'ambiguous') {
      expect(result.matches.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('never reports a decoy inside node_modules', async () => {
    const ws = await freshWorkspaceStore();
    const search = ws.searchWorkspaceFiles('intentRouter.ts', repoDir);
    expect(search.matches.some((m: string) => m.includes('node_modules'))).toBe(false);
  });
});

describe('§7 truthful file-not-found', () => {
  it('reports repository + every search attempted', async () => {
    const ws = await freshWorkspaceStore();
    const result = ws.resolveFileReference('definitely-not-here.ts', repoDir);
    expect(result.status).toBe('not_found');
    if (result.status === 'not_found') {
      expect(result.report).toContain('File not found in selected repository.');
      expect(result.report).toContain(repoDir);
      expect(result.report).toContain('Search attempted');
      expect(result.report).toContain('exact path');
      expect(result.report).toContain('repository filename search');
      expect(result.report).not.toContain('No file found');
    }
  });

  it('with no repository selected, says so — never guesses', async () => {
    const ws = await freshWorkspaceStore();
    const result = ws.resolveFileReference('intentRouter.ts', '');
    expect(result.status).toBe('not_found');
    if (result.status === 'not_found') {
      expect(result.report).toContain('no repository is currently selected');
    }
  });
});

describe('§9 background tasks capture the root at creation', () => {
  it('a new task carries the canonical root; later selections do not redirect it', async () => {
    // Canonical selection points at the fixture repo.
    fs.writeFileSync(path.join(tmpDir, 'workspace-selection.json'), JSON.stringify({ workspaceRoot: repoDir, selectedAt: new Date().toISOString(), source: 'user-selection' }));
    vi.resetModules();
    const { backgroundTaskManager } = await import('../services/backgroundTasks/manager.js');
    const { backgroundTaskRepo } = await import('../services/backgroundTasks/store.js');

    const created = backgroundTaskManager.createTask({
      title: 'Inspect intentRouter',
      objective: 'Inspect server/src/domains/jarvis/intentRouter.ts',
      originalRequest: 'Inspect server/src/domains/jarvis/intentRouter.ts',
      route: 'hermes',
      selectedAgent: 'Hermes',
      worker: 'hermes',
    });
    expect(created.error).toBeUndefined();
    expect(created.task?.workspaceRoot).toBe(repoDir);

    // The root survives persistence (read straight back from the DB row).
    const reloaded = backgroundTaskRepo.getTask(created.task!.taskId);
    expect(reloaded?.workspaceRoot).toBe(repoDir);

    // User changes repository AFTER task creation — the task keeps its root.
    const otherRepo = path.join(tmpDir, 'other-repo');
    fs.mkdirSync(path.join(otherRepo, '.git'), { recursive: true });
    const ws = await freshWorkspaceStore();
    ws.setWorkspaceRoot(otherRepo);
    const still = backgroundTaskRepo.getTask(created.task!.taskId);
    expect(still?.workspaceRoot).toBe(repoDir);
  });

  it('an explicit workspaceRoot input wins over the canonical default', async () => {
    vi.resetModules();
    const { backgroundTaskManager } = await import('../services/backgroundTasks/manager.js');
    const created = backgroundTaskManager.createTask({
      title: 'Explicit root task',
      objective: 'x',
      originalRequest: 'x',
      route: 'codex',
      selectedAgent: 'CodeX',
      worker: 'codex',
      workspaceRoot: repoDir,
    });
    expect(created.task?.workspaceRoot).toBe(repoDir);
  });
});
