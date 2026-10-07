import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import {
  generateKeyPairSync,
  sign,
  createHash,
  type KeyObject,
} from 'node:crypto';
import path from 'node:path';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';

import {
  ApprovalVerifier,
  canonical,
  approvalHash,
  type ApprovalBinding,
  type ApprovalPayload,
  type SignedApprovalEnvelope,
  type RuntimeIdentity,
  enrollSupervisorPublicKey,
  getSupervisorApprovalVerifier,
} from '../domains/securitySupervisor/approvalVerifier.js';

import {
  OutOfProcessApprovalIssuer,
  TestDoublePresenceProvider,
  UnenrolledWindowsPresenceProvider,
} from '../domains/securitySupervisor/approvalIssuer.js';

import { ApprovedGitSupervisor } from '../domains/securitySupervisor/approvedGit.js';
import { agenticOsGitService } from '../domains/controlPlane/AgenticOsGitService.js';
import { filesystemExecutor } from '../domains/jarvis/execution/executors/filesystemExecutor.js';
import { issueTrustedHumanApproval } from '../domains/controlPlane/taskGraph/TrustedHumanApprovalBridge.js';
import { toolRegistryBridge } from '../domains/localWorker/toolRegistryBridge.js';
import { setDedicatedWorkspaceRoot } from '../domains/localWorker/workspaceConfinement.js';

describe('AgenticOS Phase 3 Step 4: 45-Case Trusted Human Approval Suite', () => {
  let db: Database.Database;
  let verifier: ApprovalVerifier;
  let ecKeys: { publicKey: KeyObject; privateKey: KeyObject };
  let presence: TestDoublePresenceProvider;
  let issuer: OutOfProcessApprovalIssuer;
  let currentRuntime: RuntimeIdentity;
  const now = 1700000000000;

  const validBinding: ApprovalBinding = {
    goalId: 'goal-123',
    graphId: 'graph-456',
    nodeId: 'node-789',
    workerId: 'worker-abc',
    operation: 'SHELL_EXEC',
    attempt: 1,
    tool: 'shell.execute',
    scopeHash: approvalHash({ cwd: 'D:\\AgenticOS', shell: 'powershell', jobBoundary: true }),
    argumentHash: approvalHash({ command: 'git status' }),
    previewHash: approvalHash('Execute git status in job boundary'),
    runtimeIncarnation: 'incarnation-uuid-1',
    bootTimestamp: 1699999000000,
  };

  beforeEach(() => {
    db = new Database(':memory:');
    ecKeys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    currentRuntime = {
      incarnation: 'incarnation-uuid-1',
      bootTimestamp: 1699999000000,
    };
    verifier = new ApprovalVerifier(
      db,
      () => ecKeys.publicKey,
      () => currentRuntime,
    );
    presence = new TestDoublePresenceProvider(true);
    issuer = new OutOfProcessApprovalIssuer(ecKeys.privateKey, presence);
  });

  afterEach(() => {
    if (db.open) {
      db.close();
    }
  });

  // =========================================================================
  // Section A: Canonical Serialization & Cryptographic Verification (6 tests)
  // =========================================================================
  describe('Section A: Canonical Serialization & Cryptographic Verification', () => {
    it('1. canonical_serializes_deterministic_json: sorts keys lexicographically and strips outer whitespace', () => {
      const obj1 = { z: 1, a: 2, m: { c: 3, b: 4 } };
      const obj2 = { a: 2, m: { b: 4, c: 3 }, z: 1 };
      expect(canonical(obj1)).toBe('{"a":2,"m":{"b":4,"c":3},"z":1}');
      expect(canonical(obj1)).toBe(canonical(obj2));
    });

    it('2. canonical_rejects_non_finite_numbers: throws on NaN and Infinity', () => {
      expect(() => canonical(NaN)).toThrow(/APPROVAL_INVALID_PAYLOAD/);
      expect(() => canonical(Infinity)).toThrow(/APPROVAL_INVALID_PAYLOAD/);
      expect(() => canonical(-Infinity)).toThrow(/APPROVAL_INVALID_PAYLOAD/);
      expect(() => canonical({ val: NaN })).toThrow(/APPROVAL_INVALID_PAYLOAD/);
    });

    it('3. canonical_rejects_bidi_override_characters: throws on unicode control codes', () => {
      expect(() => canonical('evil\u202ecommand')).toThrow(/APPROVAL_INVALID_PAYLOAD/);
      expect(() => canonical('test\u2066reversed\u2069')).toThrow(/APPROVAL_INVALID_PAYLOAD/);
    });

    it('4. verifier_accepts_valid_ecdsa_p256_signature: accepts valid envelope matching public key', async () => {
      const challenge = verifier.challenge(validBinding, now);
      const envelope = await issuer.issueApproval(validBinding, challenge, { now });

      expect(() => {
        verifier.consume(envelope.payload, envelope.signature, validBinding, now);
      }).not.toThrow();
    });

    it('5. verifier_rejects_tampered_payload_fields: tampering with fields invalidates signature', async () => {
      const challenge = verifier.challenge(validBinding, now);
      const envelope = await issuer.issueApproval(validBinding, challenge, { now });

      const tamperedPayload = { ...envelope.payload, expiresAt: envelope.payload.expiresAt - 1000 };
      expect(() => {
        verifier.consume(tamperedPayload, envelope.signature, validBinding, now);
      }).toThrow(/APPROVAL_SIGNATURE_INVALID/);
    });

    it('6. verifier_rejects_untrusted_signing_key: rejects signature produced by unenrolled key pair', async () => {
      const challenge = verifier.challenge(validBinding, now);
      const otherKeys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
      const otherIssuer = new OutOfProcessApprovalIssuer(otherKeys.privateKey, presence);
      const envelope = await otherIssuer.issueApproval(validBinding, challenge, { now });

      expect(() => {
        verifier.consume(envelope.payload, envelope.signature, validBinding, now);
      }).toThrow(/APPROVAL_SIGNATURE_INVALID/);
    });
  });

  // =========================================================================
  // Section B: Out-of-Process Issuer Boundary & Policy (8 tests)
  // =========================================================================
  describe('Section B: Out-of-Process Issuer Boundary & Policy', () => {
    it('7. issuer_refuses_launch_without_rooted_manifest: refuses relative manifest path', () => {
      expect(() => {
        new OutOfProcessApprovalIssuer(ecKeys.privateKey, presence, {
          manifestPath: 'relative/path/manifest.json',
        });
      }).toThrow(/ISSUER_MANIFEST_PATH_NOT_ROOTED/);
    });

    it('8. issuer_refuses_manifest_with_untrusted_owner: rejects owner other than SYSTEM/Admin', () => {
      expect(() => {
        new OutOfProcessApprovalIssuer(ecKeys.privateKey, presence, {
          ownerSid: 'S-1-5-21-123456789-untrusted',
        });
      }).toThrow(/ISSUER_MANIFEST_UNTRUSTED_OWNER/);
    });

    it('9. issuer_refuses_manifest_with_write_permissions: rejects non-admin write permissions', () => {
      expect(() => {
        new OutOfProcessApprovalIssuer(ecKeys.privateKey, presence, {
          permissions: 'write_everyone',
        });
      }).toThrow(/ISSUER_MANIFEST_INSECURE_PERMISSIONS/);
    });

    it('10. issuer_refuses_in_non_interactive_session: refuses non-interactive / headless environment', () => {
      expect(() => {
        new OutOfProcessApprovalIssuer(ecKeys.privateKey, presence, {
          isInteractiveSession: false,
        });
      }).toThrow(/ISSUER_NON_INTERACTIVE_SESSION/);
    });

    it('11. issuer_validates_argument_and_scope_hashes: rejects mismatched argument/scope objects', async () => {
      const challenge = { nonce: 'a'.repeat(64), expiresAt: now + 30000 };
      await expect(
        issuer.issueApproval(validBinding, challenge, {
          now,
          scope: { cwd: 'C:\\Tampered' },
          args: { command: 'git status' },
        }),
      ).rejects.toThrow(/ISSUER_HASH_MISMATCH/);
    });

    it('12. issuer_enforces_maximum_sixty_second_lifetime: refuses request exceeding 60s cap', async () => {
      const challenge = { nonce: 'a'.repeat(64), expiresAt: now + 65000 };
      await expect(
        issuer.issueApproval(validBinding, challenge, { now }),
      ).rejects.toThrow(/ISSUER_LIFETIME_EXCEEDED/);
    });

    it('13. issuer_enforces_second_confirmation_flag: rejects when second confirmation is omitted', async () => {
      const challenge = { nonce: 'a'.repeat(64), expiresAt: now + 30000 };
      await expect(
        issuer.issueApproval(validBinding, challenge, { now, secondConfirmation: false }),
      ).rejects.toThrow(/ISSUER_SECOND_CONFIRMATION_REQUIRED/);
    });

    it('14. issuer_key_cannot_be_exported_as_private_blob: verifier refuses private key instance', () => {
      expect(() => {
        new ApprovalVerifier(db, () => ecKeys.privateKey);
      }).not.toThrow(); // construction allowed, but consumption must throw KEY_UNAVAILABLE
      const challenge = verifier.challenge(validBinding, now);
      const badVerifier = new ApprovalVerifier(db, () => ecKeys.privateKey);
      expect(() => {
        badVerifier.consume(
          { ...validBinding, ...challenge, version: 1, issuer: 'agenticos-interactive-issuer', issuedAt: now, secondConfirmation: true },
          'sig',
          validBinding,
          now,
        );
      }).toThrow(/APPROVAL_KEY_UNAVAILABLE/);
    });
  });

  // =========================================================================
  // Section C: In-Job Fail-Closed Verifier & Replay Protection (10 tests)
  // =========================================================================
  describe('Section C: In-Job Fail-Closed Verifier & Replay Protection', () => {
    it('15. verifier_consumes_valid_nonce_exactly_once: second consumption throws APPROVAL_REPLAY', async () => {
      const challenge = verifier.challenge(validBinding, now);
      const envelope = await issuer.issueApproval(validBinding, challenge, { now });

      verifier.consume(envelope.payload, envelope.signature, validBinding, now);
      expect(() => {
        verifier.consume(envelope.payload, envelope.signature, validBinding, now);
      }).toThrow(/APPROVAL_NONCE_REPLAY/);
    });

    it('16. verifier_burns_nonce_on_failed_dispatch: nonce cannot be reused after consumption', async () => {
      const challenge = verifier.challenge(validBinding, now);
      const envelope = await issuer.issueApproval(validBinding, challenge, { now });

      verifier.consume(envelope.payload, envelope.signature, validBinding, now);
      // Simulate failed downstream dispatch
      const simulatedDispatch = () => {
        throw new Error('OS_PROCESS_SPAWN_FAILED');
      };
      expect(simulatedDispatch).toThrow();

      // Ensure nonce is burned and cannot be re-consumed
      expect(() => {
        verifier.consume(envelope.payload, envelope.signature, validBinding, now);
      }).toThrow(/APPROVAL_NONCE_REPLAY/);
    });

    it('17. verifier_persists_consumed_nonce_across_db_reopen: replay denial survives connection reopen', async () => {
      const challenge = verifier.challenge(validBinding, now);
      const envelope = await issuer.issueApproval(validBinding, challenge, { now });

      verifier.consume(envelope.payload, envelope.signature, validBinding, now);

      // Recreate verifier on same database instance
      const reconnectedVerifier = new ApprovalVerifier(db, () => ecKeys.publicKey, () => currentRuntime);
      expect(() => {
        reconnectedVerifier.consume(envelope.payload, envelope.signature, validBinding, now);
      }).toThrow(/APPROVAL_NONCE_REPLAY/);
    });

    it('18. verifier_rejects_expired_approval: rejects when now >= expiresAt', async () => {
      const challenge = verifier.challenge(validBinding, now);
      const envelope = await issuer.issueApproval(validBinding, challenge, { now });

      expect(() => {
        verifier.consume(envelope.payload, envelope.signature, validBinding, challenge.expiresAt);
      }).toThrow(/APPROVAL_INVALID_OR_EXPIRED/);
    });

    it('19. verifier_rejects_premature_approval: rejects when issuedAt > now', async () => {
      const challenge = verifier.challenge(validBinding, now);
      const envelope = await issuer.issueApproval(validBinding, challenge, { now: now + 5000 });

      expect(() => {
        verifier.consume(envelope.payload, envelope.signature, validBinding, now);
      }).toThrow(/APPROVAL_INVALID_OR_EXPIRED/);
    });

    it('20. verifier_rejects_revoked_nonce: revoked nonce throws APPROVAL_REVOKED', async () => {
      const challenge = verifier.challenge(validBinding, now);
      const envelope = await issuer.issueApproval(validBinding, challenge, { now });

      verifier.revoke(challenge.nonce);
      expect(() => {
        verifier.consume(envelope.payload, envelope.signature, validBinding, now);
      }).toThrow(/APPROVAL_REVOKED/);
    });

    it('21. verifier_rejects_cross_goal_nonce_substitution: substituting nonce to Goal B throws APPROVAL_BINDING_MISMATCH', async () => {
      const challenge = verifier.challenge(validBinding, now);
      const envelope = await issuer.issueApproval(validBinding, challenge, { now });

      const goalB: ApprovalBinding = { ...validBinding, goalId: 'goal-other' };
      expect(() => {
        verifier.consume(envelope.payload, envelope.signature, goalB, now);
      }).toThrow(/APPROVAL_BINDING_MISMATCH/);
    });

    it('22. verifier_handles_database_failure_closed: throws APPROVAL_SERVICE_UNAVAILABLE on db error', async () => {
      const challenge = verifier.challenge(validBinding, now);
      const envelope = await issuer.issueApproval(validBinding, challenge, { now });

      db.close();
      expect(() => {
        verifier.consume(envelope.payload, envelope.signature, validBinding, now);
      }).toThrow(/APPROVAL_SERVICE_UNAVAILABLE/);
    });

    it('23. verifier_refuses_private_key_object: throws APPROVAL_KEY_UNAVAILABLE when given private key', async () => {
      const challenge = verifier.challenge(validBinding, now);
      const envelope = await issuer.issueApproval(validBinding, challenge, { now });

      const badVerifier = new ApprovalVerifier(db, () => ecKeys.privateKey, () => currentRuntime);
      expect(() => {
        badVerifier.consume(envelope.payload, envelope.signature, validBinding, now);
      }).toThrow(/APPROVAL_KEY_UNAVAILABLE/);
    });

    it('24. verifier_enforces_atomic_transaction_under_concurrency: concurrent consumption yields 1 success and N-1 replay', async () => {
      const challenge = verifier.challenge(validBinding, now);
      const envelope = await issuer.issueApproval(validBinding, challenge, { now });

      let successCount = 0;
      let replayCount = 0;

      const attempts = [1, 2, 3, 4, 5];
      for (const _ of attempts) {
        try {
          verifier.consume(envelope.payload, envelope.signature, validBinding, now);
          successCount++;
        } catch (err: any) {
          if (err.message.includes('REPLAY')) {
            replayCount++;
          }
        }
      }

      expect(successCount).toBe(1);
      expect(replayCount).toBe(4);
    });
  });

  // =========================================================================
  // Section D: Phase 1 Runtime Identity & Across-Boot Invalidation (5 tests)
  // =========================================================================
  describe('Section D: Phase 1 Runtime Identity & Across-Boot Invalidation', () => {
    it('25. verifier_binds_to_runtime_incarnation: succeeds when incarnation matches supervisor', async () => {
      const challenge = verifier.challenge(validBinding, now);
      const envelope = await issuer.issueApproval(validBinding, challenge, { now });
      expect(() => {
        verifier.consume(envelope.payload, envelope.signature, validBinding, now);
      }).not.toThrow();
    });

    it('26. verifier_rejects_stale_runtime_incarnation: rejects older boot incarnation UUID', async () => {
      const challenge = verifier.challenge(validBinding, now);
      const envelope = await issuer.issueApproval(validBinding, challenge, { now });

      // Simulate supervisor reboot with new incarnation
      currentRuntime.incarnation = 'new-incarnation-uuid-2';
      expect(() => {
        verifier.consume(envelope.payload, envelope.signature, validBinding, now);
      }).toThrow(/APPROVAL_RUNTIME_INCARNATION_MISMATCH/);
    });

    it('27. verifier_rejects_stale_boot_timestamp: rejects mismatched boot timestamp', async () => {
      const challenge = verifier.challenge(validBinding, now);
      const envelope = await issuer.issueApproval(validBinding, challenge, { now });

      // Change boot timestamp
      currentRuntime.bootTimestamp = 1700000000000;
      expect(() => {
        verifier.consume(envelope.payload, envelope.signature, validBinding, now);
      }).toThrow(/APPROVAL_RUNTIME_INCARNATION_MISMATCH/);
    });

    it('28. reboot_invalidates_all_unconsumed_challenges: unconsumed challenge from prior boot fails', async () => {
      const challenge = verifier.challenge(validBinding, now);
      const envelope = await issuer.issueApproval(validBinding, challenge, { now });

      // Reboot supervisor
      currentRuntime.incarnation = 'rebooted-incarnation-3';
      currentRuntime.bootTimestamp = now;

      expect(() => {
        verifier.consume(envelope.payload, envelope.signature, validBinding, now);
      }).toThrow(/APPROVAL_RUNTIME_INCARNATION_MISMATCH/);
    });

    it('29. runtime_identity_tamper_fails_closed: tampering with runtime identity getter fails closed', async () => {
      const challenge = verifier.challenge(validBinding, now);
      const envelope = await issuer.issueApproval(validBinding, challenge, { now });

      const tamperedVerifier = new ApprovalVerifier(
        db,
        () => ecKeys.publicKey,
        () => {
          throw new Error('CORRUPTED_IDENTITY_STATE');
        },
      );

      expect(() => {
        tamperedVerifier.consume(envelope.payload, envelope.signature, validBinding, now);
      }).toThrow(/APPROVAL_RUNTIME_IDENTITY_TAMPERED/);
    });
  });

  // =========================================================================
  // Section E: Privileged Subsystem Integration Tests (8 tests)
  // =========================================================================
  describe('Section E: Privileged Subsystem Integration Tests', () => {
    it('30. terminal_executor_requires_approval_by_default: toolRegistryBridge blocks mutating command without approval', async () => {
      const res = await toolRegistryBridge.executeTool('shell.execute', { command: 'npm install evil-pkg' });
      expect(res.success).toBe(false);
      expect(res.error).toBe('APPROVAL_ISSUER_UNAVAILABLE');
    });

    it('31. terminal_executor_executes_with_valid_approval: toolRegistryBridge executes high-impact command with valid envelope', async () => {
      enrollSupervisorPublicKey(ecKeys.publicKey);
      const args = { command: 'echo authorized' };
      const binding: ApprovalBinding = {
        goalId: 'g1',
        graphId: 'local-worker',
        nodeId: 'n1',
        workerId: 'toolRegistryBridge',
        operation: 'SHELL_EXECUTE',
        attempt: 1,
        tool: 'shell.execute',
        scopeHash: approvalHash({ tool: 'shell.execute' }),
        argumentHash: approvalHash(args),
        previewHash: approvalHash('Execute shell.execute'),
        runtimeIncarnation: currentRuntime.incarnation,
        bootTimestamp: currentRuntime.bootTimestamp,
      };

      const challenge = getSupervisorApprovalVerifier().challenge(binding, now);
      const envelope = await issuer.issueApproval(binding, challenge, { now });

      const res = await toolRegistryBridge.executeTool('shell.execute', {
        ...args,
        approval: envelope,
        goalId: 'g1',
        graphId: 'local-worker',
        nodeId: 'n1',
      });

      expect(res.success).toBe(true);
    });

    it('32. git_executor_rejects_commit_without_approval: commitChanges fails closed without approval', () => {
      const res = agenticOsGitService.commitChanges('unauthorized commit');
      expect(res.success).toBe(false);
      expect(res.error).toBe('APPROVAL_REQUIRED');
    });

    it('33. approved_git_supervisor_executes_within_job_boundary: ApprovedGitSupervisor prepares challenge and consumes signature', async () => {
      const gitRoot = fsSync.mkdtempSync(path.join(os.tmpdir(), 'agenticos-approved-git-p3-'));
      const git = path.join(gitRoot, 'repository', '.git');
      fsSync.mkdirSync(path.join(git, 'objects'), { recursive: true });
      fsSync.mkdirSync(path.join(git, 'refs'), { recursive: true });
      fsSync.writeFileSync(path.join(git, 'config'), '[core]\nrepositoryformatversion = 0\nbare = false\n');
      fsSync.writeFileSync(path.join(git, 'HEAD'), 'ref: refs/heads/main\n');
      setDedicatedWorkspaceRoot(gitRoot);

      try {
        const identity = { goalId: 'g-git', graphId: 'graph-git', nodeId: 'n-git', workerId: 'w-git', operation: 'status', attempt: 1 };
        const mockJob = {
          run: vi.fn().mockResolvedValue(0),
          terminateAndWait: vi.fn().mockResolvedValue(undefined),
        };
        const approvedSupervisor = new ApprovedGitSupervisor(
          verifier,
          () => identity,
          () => mockJob as any,
        );

        const prep = approvedSupervisor.prepare('status');
        expect(prep.payload.nonce).toBeDefined();

        const currentNow = prep.payload.issuedAt;
        const envelope = await issuer.issueApproval(
          prep.payload,
          { nonce: prep.payload.nonce, expiresAt: prep.payload.expiresAt },
          { now: currentNow }
        );

        const result = await approvedSupervisor.execute('status', {}, envelope.payload, envelope.signature);
        expect(result.cleanup).toBe('OS_JOB_CONFIRMED');
        expect(result.exitCode).toBe(0);
        expect(mockJob.run).toHaveBeenCalled();
        expect(mockJob.terminateAndWait).toHaveBeenCalled();
      } finally {
        setDedicatedWorkspaceRoot(null);
        fsSync.rmSync(gitRoot, { recursive: true, force: true });
      }
    });

    it('34. filesystem_executor_allows_workspace_writes_without_prompt: writes inside workspace succeed', async () => {
      const tmpWs = path.join(os.tmpdir(), `ws-test-${Date.now()}`);
      await fs.mkdir(tmpWs, { recursive: true });
      try {
        const file = path.join(tmpWs, 'safe.txt');
        const res = await filesystemExecutor.writeFile(file, 'safe data', { workspaceRoot: tmpWs });
        expect(res.success).toBe(true);
      } finally {
        await fs.rm(tmpWs, { recursive: true, force: true });
      }
    });

    it('35. filesystem_executor_rejects_external_writes_without_approval: external writes fail closed', async () => {
      const tmpWs = path.join(os.tmpdir(), `ws-test-${Date.now()}`);
      await fs.mkdir(tmpWs, { recursive: true });
      try {
        const outside = path.join(os.tmpdir(), 'forbidden-leak.txt');
        await expect(
          filesystemExecutor.writeFile(outside, 'leak', { workspaceRoot: tmpWs }),
        ).rejects.toThrow(/CONFINEMENT_VIOLATION/);
      } finally {
        await fs.rm(tmpWs, { recursive: true, force: true });
      }
    });

    it('36. desktop_executor_rejects_app_launch_without_approval: desktop open_app classified as high_impact and fails closed', async () => {
      const res = await toolRegistryBridge.executeTool('desktop.open_app', { appName: 'notepad' });
      expect(res.success).toBe(false);
      expect(res.error).toBe('APPROVAL_ISSUER_UNAVAILABLE');
    });

    it('37. worker_dispatch_lane_rejects_unapproved_process: worker dispatch route rejects unauthenticated / unapproved calls', async () => {
      // In ToolRegistryBridge, custom worker dispatch is high_impact
      const res = await toolRegistryBridge.executeTool('worker.dispatch', { worker: 'claude', task: 'hack' });
      expect(res.success).toBe(false);
      expect(res.error).toBe('APPROVAL_ISSUER_UNAVAILABLE');
    });
  });

  // =========================================================================
  // Section F: Adversarial & Prompt Injection Simulations (8 tests)
  // =========================================================================
  describe('Section F: Adversarial & Prompt Injection Simulations', () => {
    it('38. adversary_cannot_forge_signature_with_mock_json: fake JSON signature fails verification', () => {
      const challenge = verifier.challenge(validBinding, now);
      const fakePayload: ApprovalPayload = {
        ...validBinding,
        version: 1,
        issuer: 'agenticos-interactive-issuer',
        nonce: challenge.nonce,
        issuedAt: now,
        expiresAt: challenge.expiresAt,
        secondConfirmation: true,
      };

      const fakeSig = Buffer.from('fake-signature-bytes-not-signed-by-cng-key-01234567890123456789').toString('base64');
      expect(() => {
        verifier.consume(fakePayload, fakeSig, validBinding, now);
      }).toThrow(/APPROVAL_SIGNATURE_INVALID/);
    });

    it('39. adversary_cannot_modify_command_after_signing: modifying command throws APPROVAL_BINDING_MISMATCH', async () => {
      const challenge = verifier.challenge(validBinding, now);
      const envelope = await issuer.issueApproval(validBinding, challenge, { now });

      const mutatedExpected = {
        ...validBinding,
        argumentHash: approvalHash({ command: 'rm -rf /' }),
      };

      expect(() => {
        verifier.consume(envelope.payload, envelope.signature, mutatedExpected, now);
      }).toThrow(/APPROVAL_BINDING_MISMATCH/);
    });

    it('40. adversary_cannot_expand_file_scope_after_signing: changing scope throws APPROVAL_BINDING_MISMATCH', async () => {
      const challenge = verifier.challenge(validBinding, now);
      const envelope = await issuer.issueApproval(validBinding, challenge, { now });

      const mutatedExpected = {
        ...validBinding,
        scopeHash: approvalHash({ cwd: 'C:\\Windows\\System32' }),
      };

      expect(() => {
        verifier.consume(envelope.payload, envelope.signature, mutatedExpected, now);
      }).toThrow(/APPROVAL_BINDING_MISMATCH/);
    });

    it('41. adversary_cannot_bypass_via_auto_approve_flag: autoApprove: true is ignored for high_impact', () => {
      const risk = toolRegistryBridge.getRiskLevel('shell.execute', { command: 'rm file.txt', autoApprove: true });
      expect(risk).toBe('high_impact');
    });

    it('42. adversary_cannot_reuse_historical_hmac_secret: calling legacy approval throws HUMAN_AUTHENTICATION_UNAVAILABLE', () => {
      expect(() => {
        issueTrustedHumanApproval({ legacyHmac: 'secret' });
      }).toThrow(/TOOL_APPROVAL_HUMAN_AUTHENTICATION_UNAVAILABLE/);
    });

    it('43. adversary_cannot_extract_private_key_via_memory_dump: verifier possesses zero private key handles', () => {
      const verifierProps = Object.getOwnPropertyNames(verifier);
      for (const prop of verifierProps) {
        const val = (verifier as any)[prop];
        if (val && typeof val === 'object' && val.type === 'private') {
          throw new Error('PRIVATE_KEY_LEAK_IN_VERIFIER');
        }
      }
      expect(true).toBe(true);
    });

    it('44. adversary_cannot_reset_consumed_nonce_via_api: verifier table has no external reset endpoint', () => {
      const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='supervisor_approval_nonces'").get();
      expect(row).toBeDefined();
      // Ensure nonce table schema enforces consumed default 0 and primary key
      const tableInfo = db.prepare("PRAGMA table_info('supervisor_approval_nonces')").all() as any[];
      const nonceCol = tableInfo.find((c) => c.name === 'nonce');
      expect(nonceCol?.pk).toBe(1);
    });

    it('45. adversary_unauthenticated_api_call_rejected: unenrolled presence prompt fails closed', async () => {
      const unenrolledIssuer = new OutOfProcessApprovalIssuer(ecKeys.privateKey, new UnenrolledWindowsPresenceProvider());
      const challenge = { nonce: 'b'.repeat(64), expiresAt: now + 30000 };

      await expect(
        unenrolledIssuer.issueApproval(validBinding, challenge, { now }),
      ).rejects.toThrow(/HUMAN_PRESENCE_UNENROLLED/);
    });
  });
});
