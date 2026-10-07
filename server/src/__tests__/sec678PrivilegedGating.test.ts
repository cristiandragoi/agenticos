/**
 * sec678PrivilegedGating.test.ts
 *
 * Verifies Phase 3 SEC-06, SEC-07, and SEC-08 fail-closed approval gating:
 * - SEC-06: gitExecutor mutating operations fail closed without verified approval
 * - SEC-07: desktopExecutor.openApplication, filesystemExecutor.openFile, revealInExplorer fail closed
 * - SEC-08: Child process spawn environment sanitization strips sensitive provider API keys
 * - Telegram sendPhoto fails closed without verified approval
 * - revenueSupervisor 60s control / trigger fails closed without verified approval
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

import {
  ApprovalVerifier,
  approvalHash,
  type ApprovalBinding,
  enrollSupervisorPublicKey,
  resetSupervisorVerifierInstance,
  setRuntimeDeploymentIdentity,
  type RuntimeIdentity,
} from '../domains/securitySupervisor/approvalVerifier.js';
import {
  OutOfProcessApprovalIssuer,
  TestDoublePresenceProvider,
} from '../domains/securitySupervisor/approvalIssuer.js';
import { gitExecutor } from '../domains/jarvis/execution/executors/gitExecutor.js';
import { desktopExecutor } from '../domains/jarvis/execution/executors/desktopExecutor.js';
import { filesystemExecutor } from '../domains/jarvis/execution/executors/filesystemExecutor.js';
import { sanitizeChildEnv } from '../domains/jarvis/execution/executors/terminalExecutor.js';
import { telegramAdapter } from '../adapters/telegramAdapter.js';
import { revenueSupervisor } from '../services/revenueOperator/revenueSupervisor.js';
import { setDedicatedWorkspaceRoot } from '../domains/localWorker/workspaceConfinement.js';

describe('SEC-06, SEC-07, SEC-08 Privileged Gating Suite', () => {
  let db: Database.Database;
  let verifier: ApprovalVerifier;
  let ecKeys: { publicKey: KeyObject; privateKey: KeyObject };
  let presence: TestDoublePresenceProvider;
  let issuer: OutOfProcessApprovalIssuer;
  let runtimeIdentity: RuntimeIdentity;
  let tempDir: string;
  let now: number;

  beforeEach(() => {
    now = Date.now();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenticos-sec678-'));
    setDedicatedWorkspaceRoot(tempDir);
    db = new Database(':memory:');
    ecKeys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    runtimeIdentity = {
      incarnation: 'sec678-test-incarnation',
      bootTimestamp: now - 5000,
    };
    verifier = new ApprovalVerifier(
      db,
      () => ecKeys.publicKey,
      () => runtimeIdentity,
    );
    enrollSupervisorPublicKey(ecKeys.publicKey);
    resetSupervisorVerifierInstance(verifier);
    setRuntimeDeploymentIdentity(runtimeIdentity);

    presence = new TestDoublePresenceProvider(true);
    issuer = new OutOfProcessApprovalIssuer(ecKeys.privateKey, presence);

    // Ensure tests exercise fail-closed security gating by clearing bypass
    delete process.env.AGENTICOS_AUTH_TEST_BYPASS;
  });

  afterEach(() => {
    resetSupervisorVerifierInstance(null);
    setDedicatedWorkspaceRoot(null);
    if (db.open) db.close();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // =========================================================================
  // SEC-06: Git Mutating Operations Require Out-of-Process Approval
  // =========================================================================
  describe('SEC-06: Git Execution Gating', () => {
    it('1. gitExecutor allows read-only git status without approval envelope', async () => {
      // Mock terminalExecutor.runCommand to avoid spawning
      const runSpy = vi.spyOn((gitExecutor as any).terminalExecutor ?? { runCommand: vi.fn() }, 'runCommand')
        .mockResolvedValueOnce({
          command: 'git status',
          cwd: tempDir,
          shell: 'powershell',
          exitCode: 0,
          stdout: 'nothing to commit, working tree clean',
          stderr: '',
          durationMs: 5,
          timedOut: false,
        });

      const res = await gitExecutor.executeGit('git status', tempDir);
      // git status is read-only so it should not be blocked by APPROVAL_REQUIRED
      expect(res.error).not.toBe('APPROVAL_REQUIRED');
      runSpy.mockRestore();
    });

    it('2. gitExecutor blocks mutating git push without approval', async () => {
      const res = await gitExecutor.executeGit('git push origin main', tempDir);
      expect(res.success).toBe(false);
      expect(res.error).toBe('APPROVAL_REQUIRED');
    });

    it('3. gitExecutor blocks mutating git commit without approval', async () => {
      const res = await gitExecutor.executeGit('git commit -m "feat: secret"', tempDir);
      expect(res.success).toBe(false);
      expect(res.error).toBe('APPROVAL_REQUIRED');
    });

    it('4. gitExecutor blocks mutating git checkout without approval', async () => {
      const res = await gitExecutor.executeGit('git checkout -b feature', tempDir);
      expect(res.success).toBe(false);
      expect(res.error).toBe('APPROVAL_REQUIRED');
    });

    it('5. gitExecutor executes mutating git with valid out-of-process approval', async () => {
      const command = 'git commit -m "feat: authorized"';
      const binding: ApprovalBinding = {
        goalId: 'git-execution',
        graphId: 'git',
        nodeId: 'executeGit',
        workerId: 'GitExecutor',
        operation: 'GIT_MUTATE',
        attempt: 1,
        tool: 'git.execute',
        scopeHash: approvalHash({ cwd: tempDir }),
        argumentHash: approvalHash({ command }),
        previewHash: approvalHash(`Execute ${command} in ${tempDir}`),
        runtimeIncarnation: runtimeIdentity.incarnation,
        bootTimestamp: runtimeIdentity.bootTimestamp,
      };

      const challenge = verifier.challenge(binding, now);
      const envelope = await issuer.issueApproval(binding, challenge, { now });

      const res = await gitExecutor.executeGit(command, tempDir, { approval: envelope });
      // Approval consumed successfully; not rejected with APPROVAL_REQUIRED
      expect(res.error).not.toBe('APPROVAL_REQUIRED');
      expect(res.error).not.toBe('APPROVAL_VERIFICATION_FAILED');
    });
  });

  // =========================================================================
  // SEC-07: Desktop App Launch & File Open/Reveal Require Approval
  // =========================================================================
  describe('SEC-07: Desktop & File Launch Gating', () => {
    it('6. desktopExecutor.openApplication fails closed without approval', async () => {
      const res = await desktopExecutor.openApplication('notepad');
      expect(res.success).toBe(false);
      expect(res.error).toContain('APPROVAL_REQUIRED');
    });

    it('7. desktopExecutor.openApplication consumes valid out-of-process envelope', async () => {
      const appInput = 'notepad';
      const binding: ApprovalBinding = {
        goalId: 'desktop-launch',
        graphId: 'desktop',
        nodeId: 'openApplication',
        workerId: 'desktopExecutor',
        operation: 'DESKTOP_LAUNCH',
        attempt: 1,
        tool: 'desktop.open_app',
        scopeHash: approvalHash({ app: appInput }),
        argumentHash: approvalHash({ app: appInput }),
        previewHash: approvalHash(`Launch desktop application ${appInput}`),
        runtimeIncarnation: runtimeIdentity.incarnation,
        bootTimestamp: runtimeIdentity.bootTimestamp,
      };

      const challenge = verifier.challenge(binding, now);
      const envelope = await issuer.issueApproval(binding, challenge, { now });

      const res = await desktopExecutor.openApplication(appInput, { approval: envelope });
      // Approval check passed, not blocked by APPROVAL_REQUIRED
      expect(res.error).not.toContain('APPROVAL_REQUIRED');
      expect(res.error).not.toContain('APPROVAL_VERIFICATION_FAILED');
    });

    it('8. filesystemExecutor.openFile fails closed without approval', async () => {
      const targetFile = path.join(tempDir, 'sample.txt');
      fs.writeFileSync(targetFile, 'data');
      const res = await filesystemExecutor.openFile(targetFile);
      expect(res.success).toBe(false);
      expect(res.error).toContain('APPROVAL_REQUIRED');
    });

    it('9. filesystemExecutor.openFile consumes valid out-of-process envelope', async () => {
      const targetFile = path.join(tempDir, 'sample.txt');
      fs.writeFileSync(targetFile, 'data');
      const resolved = path.resolve(targetFile);

      const binding: ApprovalBinding = {
        goalId: 'filesystem-open',
        graphId: 'filesystem',
        nodeId: 'openFile',
        workerId: 'filesystemExecutor',
        operation: 'FILESYSTEM_OPEN',
        attempt: 1,
        tool: 'filesystem.open',
        scopeHash: approvalHash({ path: resolved }),
        argumentHash: approvalHash({ path: resolved }),
        previewHash: approvalHash(`Open file ${resolved}`),
        runtimeIncarnation: runtimeIdentity.incarnation,
        bootTimestamp: runtimeIdentity.bootTimestamp,
      };

      const challenge = verifier.challenge(binding, now);
      const envelope = await issuer.issueApproval(binding, challenge, { now });

      const res = await filesystemExecutor.openFile(targetFile, { approval: envelope });
      expect(res.success).toBe(true);
      expect(res.error).toBeUndefined();
    });

    it('10. filesystemExecutor.revealInExplorer fails closed without approval', async () => {
      const targetFile = path.join(tempDir, 'sample.txt');
      fs.writeFileSync(targetFile, 'data');
      const res = await filesystemExecutor.revealInExplorer(targetFile);
      expect(res.success).toBe(false);
      expect(res.error).toContain('APPROVAL_REQUIRED');
    });
  });

  // =========================================================================
  // SEC-08: Child Process Environment Sanitization (Provider API Keys Stripped)
  // =========================================================================
  describe('SEC-08: Child Process Environment Sanitization', () => {
    it('11. sanitizeChildEnv strips ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, and other tokens', () => {
      const raw = {
        PATH: 'C:\\Windows\\System32',
        SystemRoot: 'C:\\Windows',
        OPENAI_API_KEY: 'sk-secret-12345',
        ANTHROPIC_API_KEY: 'sk-ant-secret-67890',
        GEMINI_API_KEY: 'AIzaSy-secret-11111',
        GOOGLE_API_KEY: 'AIzaSy-secret-22222',
        DEEPSEEK_API_KEY: 'sk-deepseek-33333',
        GROQ_API_KEY: 'gsk_secret_44444',
        AGENTOS_API_TOKEN: 'token-55555',
        CUSTOM_SECRET: 'super-secret',
        CUSTOM_API_KEY: 'secret-key',
        BENIGN_VAR: 'hello-world',
      };

      const sanitized = sanitizeChildEnv(raw);
      expect(sanitized.PATH).toBe('C:\\Windows\\System32');
      expect(sanitized.SystemRoot).toBe('C:\\Windows');
      expect(sanitized.BENIGN_VAR).toBe('hello-world');

      expect(sanitized.OPENAI_API_KEY).toBeUndefined();
      expect(sanitized.ANTHROPIC_API_KEY).toBeUndefined();
      expect(sanitized.GEMINI_API_KEY).toBeUndefined();
      expect(sanitized.GOOGLE_API_KEY).toBeUndefined();
      expect(sanitized.DEEPSEEK_API_KEY).toBeUndefined();
      expect(sanitized.GROQ_API_KEY).toBeUndefined();
      expect(sanitized.AGENTOS_API_TOKEN).toBeUndefined();
      expect(sanitized.CUSTOM_SECRET).toBeUndefined();
      expect(sanitized.CUSTOM_API_KEY).toBeUndefined();
    });
  });

  // =========================================================================
  // Telegram sendPhoto & RevenueSupervisor Gating
  // =========================================================================
  describe('Telegram & RevenueSupervisor Gating', () => {
    it('12. telegramAdapter.sendPhoto fails closed without approval', async () => {
      const targetPhoto = path.join(tempDir, 'photo.png');
      fs.writeFileSync(targetPhoto, 'fake-png-bytes');
      (telegramAdapter as any).botToken = 'mock-bot-token';

      const res = await telegramAdapter.sendPhoto('12345', targetPhoto);
      expect(res.success).toBe(false);
      expect(res.error).toContain('APPROVAL_REQUIRED');
    });

    it('13. revenueSupervisor starts in PAUSED state and rejects unapproved START', () => {
      const res = revenueSupervisor.setControlState('START', 'mission-1');
      expect(res.success).toBe(false);
      expect(res.error).toContain('APPROVAL_REQUIRED');
    });
  });
});
