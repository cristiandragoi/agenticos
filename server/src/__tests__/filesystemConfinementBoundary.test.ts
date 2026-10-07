import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { filesystemExecutor } from '../domains/jarvis/execution/executors/filesystemExecutor.js';
import {
  setDedicatedWorkspaceRoot,
  assertConfinedWorkspacePath,
  ConfinementError,
} from '../domains/localWorker/workspaceConfinement.js';

describe('SEC-05: Filesystem Confinement Boundary', () => {
  let testWorkspace: string;
  let outsideDir: string;

  beforeEach(async () => {
    const runId = randomUUID().slice(0, 8);
    testWorkspace = path.join(os.tmpdir(), `agenticos-test-conf-ws-${runId}`);
    outsideDir = path.join(os.tmpdir(), `agenticos-test-conf-out-${runId}`);

    await fs.mkdir(testWorkspace, { recursive: true });
    await fs.mkdir(outsideDir, { recursive: true });

    setDedicatedWorkspaceRoot(testWorkspace);
  });

  afterEach(async () => {
    setDedicatedWorkspaceRoot(null);
    try {
      if (fsSync.existsSync(testWorkspace)) {
        await fs.rm(testWorkspace, { recursive: true, force: true });
      }
    } catch {}
    try {
      if (fsSync.existsSync(outsideDir)) {
        await fs.rm(outsideDir, { recursive: true, force: true });
      }
    } catch {}
  });

  describe('assertConfinedWorkspacePath', () => {
    it('allows valid paths within workspace', async () => {
      const target = path.join(testWorkspace, 'allowed.txt');
      const resolved = await assertConfinedWorkspacePath(target, { workspaceRoot: testWorkspace });
      expect(resolved.toLowerCase()).toBe(path.resolve(target).toLowerCase());
    });

    it('rejects .. relative directory traversal escaping workspace', async () => {
      const escaping = path.join(testWorkspace, '..', 'escaped.txt');
      await expect(
        assertConfinedWorkspacePath(escaping, { workspaceRoot: testWorkspace }),
      ).rejects.toThrow(/CONFINEMENT_VIOLATION/);
    });

    it('rejects multi-level .. traversal', async () => {
      const escaping = path.join(testWorkspace, 'subdir', '..', '..', 'escaped.txt');
      await expect(
        assertConfinedWorkspacePath(escaping, { workspaceRoot: testWorkspace }),
      ).rejects.toThrow(/CONFINEMENT_VIOLATION/);
    });

    it('rejects UNC paths', async () => {
      await expect(
        assertConfinedWorkspacePath('\\\\127.0.0.1\\c$\\escaped.txt', { workspaceRoot: testWorkspace }),
      ).rejects.toThrow(/CONFINEMENT_VIOLATION.*UNC path/i);

      await expect(
        assertConfinedWorkspacePath('//remoteserver/share/data.txt', { workspaceRoot: testWorkspace }),
      ).rejects.toThrow(/CONFINEMENT_VIOLATION.*UNC path/i);
    });

    it('rejects drive-letter hops', async () => {
      const rootDrive = path.parse(testWorkspace).root.toUpperCase();
      const otherDrive = rootDrive.startsWith('C') ? 'D:\\outside.txt' : 'C:\\outside.txt';

      await expect(
        assertConfinedWorkspacePath(otherDrive, { workspaceRoot: testWorkspace }),
      ).rejects.toThrow(/CONFINEMENT_VIOLATION/);
    });

    it('rejects symlink and junction escapes', async () => {
      const junctionDir = path.join(testWorkspace, 'external_link');
      try {
        // Create NTFS junction or symlink on Windows
        await fs.symlink(outsideDir, junctionDir, 'junction');
      } catch (err) {
        // Fallback for environments without symlink privileges
        return;
      }

      const escapedTarget = path.join(junctionDir, 'leak.txt');
      await expect(
        assertConfinedWorkspacePath(escapedTarget, { workspaceRoot: testWorkspace, forWrite: true }),
      ).rejects.toThrow(/CONFINEMENT_VIOLATION/);
    });

    it('rejects sensitive system files', async () => {
      const gitDir = path.join(testWorkspace, '.git', 'config');
      await expect(
        assertConfinedWorkspacePath(gitDir, { workspaceRoot: testWorkspace }),
      ).rejects.toThrow(/CONFINEMENT_VIOLATION.*sensitive/i);

      const envFile = path.join(testWorkspace, '.env');
      await expect(
        assertConfinedWorkspacePath(envFile, { workspaceRoot: testWorkspace }),
      ).rejects.toThrow(/CONFINEMENT_VIOLATION.*sensitive/i);
    });
  });

  describe('filesystemExecutor.writeFile', () => {
    it('writes successfully within workspace', async () => {
      const target = path.join(testWorkspace, 'test.txt');
      const res = await filesystemExecutor.writeFile(target, 'hello confined world', { workspaceRoot: testWorkspace });
      expect(res.success).toBe(true);
      expect(fsSync.existsSync(target)).toBe(true);
      expect(await fs.readFile(target, 'utf8')).toBe('hello confined world');
    });

    it('fails closed with CONFINEMENT_VIOLATION on traversal escape', async () => {
      const target = path.join(testWorkspace, '..', 'evil.txt');
      await expect(
        filesystemExecutor.writeFile(target, 'pwn', { workspaceRoot: testWorkspace }),
      ).rejects.toThrow(/CONFINEMENT_VIOLATION/);
    });

    it('fails closed with CONFINEMENT_VIOLATION on outside absolute path', async () => {
      const target = path.join(outsideDir, 'evil.txt');
      await expect(
        filesystemExecutor.writeFile(target, 'pwn', { workspaceRoot: testWorkspace }),
      ).rejects.toThrow(/CONFINEMENT_VIOLATION/);
    });

    it('fails closed with CONFINEMENT_VIOLATION on UNC path', async () => {
      await expect(
        filesystemExecutor.writeFile('\\\\10.0.0.1\\c$\\pwn.txt', 'data', { workspaceRoot: testWorkspace }),
      ).rejects.toThrow(/CONFINEMENT_VIOLATION/);
    });
  });

  describe('filesystemExecutor.createFolder', () => {
    it('creates folders successfully within workspace', async () => {
      const target = path.join(testWorkspace, 'sub', 'nested');
      const res = await filesystemExecutor.createFolder(target, { workspaceRoot: testWorkspace });
      expect(res.success).toBe(true);
      expect(fsSync.existsSync(target)).toBe(true);
    });

    it('fails closed with CONFINEMENT_VIOLATION on outside path', async () => {
      const target = path.join(outsideDir, 'newfolder');
      await expect(
        filesystemExecutor.createFolder(target, { workspaceRoot: testWorkspace }),
      ).rejects.toThrow(/CONFINEMENT_VIOLATION/);
    });
  });

  describe('filesystemExecutor.deletePath', () => {
    it('deletes files within workspace', async () => {
      const target = path.join(testWorkspace, 'delete_me.txt');
      await fs.writeFile(target, 'bye');
      const res = await filesystemExecutor.deletePath(target, { workspaceRoot: testWorkspace });
      expect(res.success).toBe(true);
      expect(fsSync.existsSync(target)).toBe(false);
    });

    it('refuses deletion of workspace root itself', async () => {
      await expect(
        filesystemExecutor.deletePath(testWorkspace, { workspaceRoot: testWorkspace }),
      ).rejects.toThrow(/Refusing to delete the workspace root directory itself/);
    });

    it('fails closed with CONFINEMENT_VIOLATION on outside path', async () => {
      const target = path.join(outsideDir, 'secret.txt');
      await expect(
        filesystemExecutor.deletePath(target, { workspaceRoot: testWorkspace }),
      ).rejects.toThrow(/CONFINEMENT_VIOLATION/);
    });
  });

  describe('filesystemExecutor.executeStep', () => {
    it('returns CONFINEMENT_VIOLATION code for outside write action', async () => {
      const step = {
        id: 's1',
        action: 'write',
        parameters: {
          path: path.join(outsideDir, 'leak.txt'),
          content: 'bad data',
        },
      };
      const context = {
        workspacePath: testWorkspace,
      } as any;

      const res = await filesystemExecutor.executeStep(step as any, context);
      expect(res.success).toBe(false);
      expect(res.error).toContain('CONFINEMENT_VIOLATION');
      expect((res as any).code).toBe('CONFINEMENT_VIOLATION');
    });

    it('returns CONFINEMENT_VIOLATION code for outside delete action', async () => {
      const step = {
        id: 's2',
        action: 'delete',
        parameters: {
          path: path.join(outsideDir, 'victim.txt'),
        },
      };
      const context = {
        workspacePath: testWorkspace,
      } as any;

      const res = await filesystemExecutor.executeStep(step as any, context);
      expect(res.success).toBe(false);
      expect(res.error).toContain('CONFINEMENT_VIOLATION');
      expect((res as any).code).toBe('CONFINEMENT_VIOLATION');
    });
  });
});
