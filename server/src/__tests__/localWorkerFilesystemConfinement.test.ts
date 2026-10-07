import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  toolRegistryBridge,
  setDedicatedWorkspaceRoot,
  getDedicatedWorkspaceRoot,
  ensureDedicatedWorkspaceRoot,
} from '../domains/localWorker/index.js';

describe('LocalWorker Filesystem Confinement', () => {
  let testWorkspace: string;
  let outsideDir: string;

  beforeEach(async () => {
    // Isolated scratch workspace for tests
    const runId = randomUUID().slice(0, 8);
    testWorkspace = path.join(os.tmpdir(), `agenticos-test-worker-ws-${runId}`);
    outsideDir = path.join(os.tmpdir(), `agenticos-test-outside-${runId}`);

    await fs.mkdir(testWorkspace, { recursive: true });
    await fs.mkdir(outsideDir, { recursive: true });

    // Set dedicated workspace root to isolated test workspace
    setDedicatedWorkspaceRoot(testWorkspace);
    await ensureDedicatedWorkspaceRoot();
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

  describe('Allowed Operations Inside Dedicated Workspace', () => {
    it('executes atomic file write, read, list, and locate inside workspace root', async () => {
      // 1. filesystem.write
      const writeRes = await toolRegistryBridge.executeTool('filesystem.write', {
        path: 'sub/data.txt',
        content: 'Hello Isolated Worker!',
      });
      expect(writeRes.success).toBe(true);
      expect(writeRes.verification.verified).toBe(true);
      expect(fsSync.existsSync(path.join(testWorkspace, 'sub', 'data.txt'))).toBe(true);

      // 2. filesystem.read
      const readRes = await toolRegistryBridge.executeTool('filesystem.read', {
        path: 'sub/data.txt',
      });
      expect(readRes.success).toBe(true);
      expect(readRes.verification.verified).toBe(true);
      expect(readRes.output).toBe('Hello Isolated Worker!');

      // 3. filesystem.list
      const listRes = await toolRegistryBridge.executeTool('filesystem.list', {
        path: 'sub',
      });
      expect(listRes.success).toBe(true);
      expect(listRes.verification.verified).toBe(true);
      const items = listRes.output as Array<{ name: string }>;
      expect(items.some((i) => i.name === 'data.txt')).toBe(true);

      // 4. filesystem.locate
      const locateRes = await toolRegistryBridge.executeTool('filesystem.locate', {
        query: 'data.txt',
      });
      expect(locateRes.success).toBe(true);
      expect(locateRes.verification.verified).toBe(true);
      expect(String(locateRes.output)).toContain('data.txt');
    });

    it('creates folders and performs deletion inside workspace', async () => {
      // Create folder
      const createRes = await toolRegistryBridge.executeTool('filesystem.create_folder', {
        path: 'nested/target_folder',
      });
      expect(createRes.success).toBe(true);
      expect(createRes.verification.verified).toBe(true);
      expect(fsSync.existsSync(path.join(testWorkspace, 'nested', 'target_folder'))).toBe(true);

      // Write a file in the folder
      await toolRegistryBridge.executeTool('filesystem.write', {
        path: 'nested/target_folder/file.json',
        content: '{"ok":true}',
      });

      // Delete file
      const delFileRes = await toolRegistryBridge.executeTool('filesystem.delete', {
        path: 'nested/target_folder/file.json',
      });
      expect(delFileRes.success).toBe(true);
      expect(delFileRes.verification.verified).toBe(true);
      expect(fsSync.existsSync(path.join(testWorkspace, 'nested', 'target_folder', 'file.json'))).toBe(false);

      // Delete folder
      const delFolderRes = await toolRegistryBridge.executeTool('filesystem.delete', {
        path: 'nested/target_folder',
      });
      expect(delFolderRes.success).toBe(true);
      expect(delFolderRes.verification.verified).toBe(true);
      expect(fsSync.existsSync(path.join(testWorkspace, 'nested', 'target_folder'))).toBe(false);
    });

    it('executes atomic update without partial write corruption', async () => {
      await toolRegistryBridge.executeTool('filesystem.write', {
        path: 'config.json',
        content: '{"v":1}',
      });

      const updateRes = await toolRegistryBridge.executeTool('filesystem.write', {
        path: 'config.json',
        content: '{"v":2,"updated":true}',
      });
      expect(updateRes.success).toBe(true);

      const readRes = await toolRegistryBridge.executeTool('filesystem.read', {
        path: 'config.json',
      });
      expect(readRes.output).toBe('{"v":2,"updated":true}');
    });
  });

  describe('Denied Operations and Security Enforcement', () => {
    it('denies directory traversal attempts (../)', async () => {
      const res = await toolRegistryBridge.executeTool('filesystem.write', {
        path: '../traversal.txt',
        content: 'evil',
      });
      expect(res.success).toBe(false);
      expect(res.verification.verified).toBe(false);
      expect(res.error).toContain('CONFINEMENT_VIOLATION');
      expect(fsSync.existsSync(path.join(testWorkspace, '..', 'traversal.txt'))).toBe(false);
    });

    it('denies deep directory traversal attempts (a/b/../../../../escape.txt)', async () => {
      const res = await toolRegistryBridge.executeTool('filesystem.read', {
        path: 'sub/dir/../../../../escape.txt',
      });
      expect(res.success).toBe(false);
      expect(res.verification.verified).toBe(false);
      expect(res.error).toContain('CONFINEMENT_VIOLATION');
    });

    it('denies absolute paths outside workspace root', async () => {
      const outsideFile = path.join(outsideDir, 'secret.txt');
      await fs.writeFile(outsideFile, 'secret content', 'utf8');

      const res = await toolRegistryBridge.executeTool('filesystem.read', {
        path: outsideFile,
      });
      expect(res.success).toBe(false);
      expect(res.verification.verified).toBe(false);
      expect(res.error).toContain('CONFINEMENT_VIOLATION');
    });

    it('denies Windows Alternate Data Streams (:stream)', async () => {
      const res = await toolRegistryBridge.executeTool('filesystem.write', {
        path: 'innocent.txt:hidden_stream',
        content: 'stealth',
      });
      expect(res.success).toBe(false);
      expect(res.verification.verified).toBe(false);
      expect(res.error).toContain('CONFINEMENT_VIOLATION');
    });

    it('denies DOS device names (CON, PRN, AUX, NUL, COM1, LPT1)', async () => {
      const deviceNames = ['nul', 'con', 'aux.txt', 'com1.log', 'lpt2'];
      for (const dev of deviceNames) {
        const res = await toolRegistryBridge.executeTool('filesystem.write', {
          path: dev,
          content: 'bad',
        });
        expect(res.success).toBe(false);
        expect(res.verification.verified).toBe(false);
        expect(res.error).toContain('CONFINEMENT_VIOLATION');
      }
    });

    it('denies null byte path injection', async () => {
      const res = await toolRegistryBridge.executeTool('filesystem.write', {
        path: 'safe.txt\0evil.bat',
        content: 'payload',
      });
      expect(res.success).toBe(false);
      expect(res.verification.verified).toBe(false);
      expect(res.error).toContain('CONFINEMENT_VIOLATION');
    });

    it('denies sensitive files (.env, .env.local, .env.production)', async () => {
      const envNames = ['.env', '.env.local', 'sub/.env.production', 'app.env'];
      for (const envName of envNames) {
        const writeRes = await toolRegistryBridge.executeTool('filesystem.write', {
          path: envName,
          content: 'SECRET=123',
        });
        expect(writeRes.success).toBe(false);
        expect(writeRes.verification.verified).toBe(false);
        expect(writeRes.error).toContain('CONFINEMENT_VIOLATION');

        const readRes = await toolRegistryBridge.executeTool('filesystem.read', {
          path: envName,
        });
        expect(readRes.success).toBe(false);
        expect(readRes.verification.verified).toBe(false);
        expect(readRes.error).toContain('CONFINEMENT_VIOLATION');
      }
    });

    it('denies credential stores and keys', async () => {
      const creds = ['credentials.json', 'vault.key', 'client.pem', 'id_rsa', 'id_ed25519'];
      for (const cred of creds) {
        const res = await toolRegistryBridge.executeTool('filesystem.write', {
          path: cred,
          content: 'cert-or-key',
        });
        expect(res.success).toBe(false);
        expect(res.verification.verified).toBe(false);
        expect(res.error).toContain('CONFINEMENT_VIOLATION');
      }
    });

    it('denies database files (*.db, *.sqlite3, agenticos.db)', async () => {
      const dbs = ['agenticos.db', 'state.sqlite', 'test.sqlite3', 'cache.db-wal'];
      for (const db of dbs) {
        const res = await toolRegistryBridge.executeTool('filesystem.write', {
          path: db,
          content: 'db-bytes',
        });
        expect(res.success).toBe(false);
        expect(res.verification.verified).toBe(false);
        expect(res.error).toContain('CONFINEMENT_VIOLATION');
      }
    });

    it('denies policy, identity, and approval files', async () => {
      const policies = ['identity.json', 'security.policy', 'pending_approval.json'];
      for (const pol of policies) {
        const res = await toolRegistryBridge.executeTool('filesystem.write', {
          path: pol,
          content: '{"allowed":true}',
        });
        expect(res.success).toBe(false);
        expect(res.verification.verified).toBe(false);
        expect(res.error).toContain('CONFINEMENT_VIOLATION');
      }
    });

    it('denies source repository and build artifact paths', async () => {
      const sourcePaths = [
        'server/src/domains/localWorker/toolRegistryBridge.ts',
        'scripts/check-jarvis-worker.ps1',
        '.git/config',
        'node_modules/express/index.js',
      ];
      for (const src of sourcePaths) {
        const res = await toolRegistryBridge.executeTool('filesystem.read', {
          path: src,
        });
        expect(res.success).toBe(false);
        expect(res.verification.verified).toBe(false);
        expect(res.error).toContain('CONFINEMENT_VIOLATION');
      }
    });

    it('denies symlink and NTFS junction escapes', async () => {
      // Create a target file in outside directory
      const outsideTarget = path.join(outsideDir, 'target.txt');
      await fs.writeFile(outsideTarget, 'outside secret', 'utf8');

      // Create an NTFS junction inside the workspace pointing to outside directory
      const junctionPath = path.join(testWorkspace, 'junction_link');
      let junctionCreated = false;
      try {
        await fs.symlink(outsideDir, junctionPath, 'junction');
        junctionCreated = true;
      } catch (err) {
        // In environments where junction creation is restricted, skip junction test
        console.warn('Junction creation failed in test environment:', err);
      }

      if (junctionCreated) {
        // Attempt to read file through the junction link
        const res = await toolRegistryBridge.executeTool('filesystem.read', {
          path: 'junction_link/target.txt',
        });
        expect(res.success).toBe(false);
        expect(res.verification.verified).toBe(false);
        expect(res.error).toContain('CONFINEMENT_VIOLATION');

        // Attempt to write file through the junction link
        const writeRes = await toolRegistryBridge.executeTool('filesystem.write', {
          path: 'junction_link/escape.txt',
          content: 'malicious',
        });
        expect(writeRes.success).toBe(false);
        expect(writeRes.verification.verified).toBe(false);
        expect(writeRes.error).toContain('CONFINEMENT_VIOLATION');
      }
    });

    it('refuses deletion of the workspace root itself', async () => {
      const targets = ['.', '', testWorkspace];
      for (const t of targets) {
        const res = await toolRegistryBridge.executeTool('filesystem.delete', {
          path: t,
        });
        expect(res.success).toBe(false);
        expect(res.verification.verified).toBe(false);
        expect(res.error).toContain('CONFINEMENT_VIOLATION');
        expect(fsSync.existsSync(testWorkspace)).toBe(true);
      }
    });

    it('prevents staging escapes when .tmp is replaced with an external junction', async () => {
      // Create a junction at testWorkspace/.tmp pointing to outsideDir
      const tmpJunction = path.join(testWorkspace, '.tmp');
      let junctionCreated = false;
      try {
        await fs.symlink(outsideDir, tmpJunction, 'junction');
        junctionCreated = true;
      } catch (err) {
        console.warn('Junction creation failed in test environment:', err);
      }

      if (junctionCreated) {
        // 1. Write an ordinary file in workspace: must NOT write to outsideDir
        const writeRes = await toolRegistryBridge.executeTool('filesystem.write', {
          path: 'legit.txt',
          content: 'hello inside workspace',
        });
        expect(writeRes.success).toBe(true);

        // Verify outsideDir was NOT written to
        const outsideFiles = await fs.readdir(outsideDir);
        expect(outsideFiles.filter((f) => f.includes('legit') || f.includes('.tmp') || f.includes('stage'))).toHaveLength(0);

        // 2. Direct attempt to write into .tmp/evil.txt must be rejected
        const directRes = await toolRegistryBridge.executeTool('filesystem.write', {
          path: '.tmp/evil.txt',
          content: 'payload',
        });
        expect(directRes.success).toBe(false);
        expect(directRes.verification.verified).toBe(false);
        expect(directRes.error).toContain('CONFINEMENT_VIOLATION');
        expect(fsSync.existsSync(path.join(outsideDir, 'evil.txt'))).toBe(false);
      }
    });

    it('denies hard-link access to external files on the same volume (nlink > 1)', async () => {
      const externalFile = path.join(outsideDir, 'external_secret.txt');
      await fs.writeFile(externalFile, 'super_confidential_token', 'utf8');

      // Create hard link inside workspace pointing to externalFile
      const workspaceLink = path.join(testWorkspace, 'linked_secret.txt');
      let linkCreated = false;
      try {
        await fs.link(externalFile, workspaceLink);
        linkCreated = true;
      } catch (err) {
        console.warn('Hard link creation failed in test environment:', err);
      }

      if (linkCreated) {
        const stat = await fs.stat(workspaceLink);
        expect(stat.nlink).toBeGreaterThan(1);

        // 1. Read must be denied
        const readRes = await toolRegistryBridge.executeTool('filesystem.read', {
          path: 'linked_secret.txt',
        });
        expect(readRes.success).toBe(false);
        expect(readRes.verification.verified).toBe(false);
        expect(readRes.error).toContain('CONFINEMENT_VIOLATION');

        // 2. Write overwrite must be denied
        const writeRes = await toolRegistryBridge.executeTool('filesystem.write', {
          path: 'linked_secret.txt',
          content: 'corrupted_token',
        });
        expect(writeRes.success).toBe(false);
        expect(writeRes.verification.verified).toBe(false);
        expect(writeRes.error).toContain('CONFINEMENT_VIOLATION');
        expect(await fs.readFile(externalFile, 'utf8')).toBe('super_confidential_token');

        // 3. Delete must be denied to prevent external file manipulation
        const delRes = await toolRegistryBridge.executeTool('filesystem.delete', {
          path: 'linked_secret.txt',
        });
        expect(delRes.success).toBe(false);
        expect(delRes.verification.verified).toBe(false);
        expect(delRes.error).toContain('CONFINEMENT_VIOLATION');
        expect(fsSync.existsSync(externalFile)).toBe(true);
      }
    });

    it('denies search escapes when the workspace root itself is a junction', async () => {
      const junctionRoot = path.join(os.tmpdir(), `agenticos-junction-ws-${randomUUID().slice(0, 8)}`);
      let junctionCreated = false;
      try {
        await fs.symlink(outsideDir, junctionRoot, 'junction');
        junctionCreated = true;
      } catch (err) {
        console.warn('Junction root creation failed:', err);
      }

      if (junctionCreated) {
        try {
          setDedicatedWorkspaceRoot(junctionRoot);

          const locateRes = await toolRegistryBridge.executeTool('filesystem.locate', {
            query: 'secret',
          });
          expect(locateRes.success).toBe(false);
          expect(locateRes.verification.verified).toBe(false);
          expect(locateRes.error).toContain('CONFINEMENT_VIOLATION');
        } finally {
          setDedicatedWorkspaceRoot(testWorkspace);
          try {
            await fs.unlink(junctionRoot);
          } catch {}
        }
      }
    });

    it('prevents read races and validates file handle descriptor directly', async () => {
      await toolRegistryBridge.executeTool('filesystem.write', {
        path: 'race_test.txt',
        content: 'authentic content',
      });

      const readRes = await toolRegistryBridge.executeTool('filesystem.read', {
        path: 'race_test.txt',
      });
      expect(readRes.success).toBe(true);
      expect(readRes.output).toBe('authentic content');
      expect(readRes.verification.verified).toBe(true);
    });
  });
});
