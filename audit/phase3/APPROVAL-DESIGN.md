# AgenticOS Phase 3 Step 1 — Trusted Human Approval Architecture & Design Specification

**Document Version:** 1.0.0  
**Status:** DRAFT SPECIFICATION (AUDIT & DESIGN ONLY — ZERO PRODUCTION CODE MODIFICATIONS)  
**Branch:** `wip-secure-20261007`  
**Execution Context:** Autonomous Engineering Execution (Hermes / Antigravity)  

---

## 1. Architectural Overview & Security Invariants

The goal of Phase 3 is to establish an **unforgeable, out-of-process human approval boundary** for AgenticOS. An autonomous LLM, prompt injection, compromised worker, or local HTTP client must never be able to mint, replay, or bypass authorizations for privileged actions.

```
       ┌─────────────────────────────────────────────────────────────┐
       │                TRUSTED HUMAN OPERATOR                       │
       │           (Interactive Session / Secure Desktop)            │
       └─────────────────────────────┬───────────────────────────────┘
                                     │ Interactive
                                     │ Confirmation (CredUI / Secure UI)
                                     ▼
       ┌─────────────────────────────────────────────────────────────┐
       │             OUT-OF-PROCESS APPROVAL ISSUER                  │
       │  - Dedicated OS Identity / Isolated Supervisor Process      │
       │  - Non-Exportable CNG P-256 Key (ExportPolicy = None)       │
       │  - Zero access by LLM, renderer, worker, or HTTP client     │
       │  - Independent canonicalization & preview recomputation     │
       └─────────────────────────────┬───────────────────────────────┘
                                     │ Signed Approval Envelope
                                     │ (ECDSA P-256 / SHA256)
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  AGENTICOS SUPERVISOR / JOB BOUNDARY (FAIL-CLOSED VERIFIER)              │
│                                                                          │
│   ┌──────────────────────────────────────────────────────────────────┐   │
│   │                    ApprovalVerifier (In-Job)                     │   │
│   │  - Possesses ONLY Public Key (Zero Private Key Material)         │   │
│   │  - Validates Canonical JSON, Signature, and Timestamps           │   │
│   │  - Binds to Phase 1 Runtime Identity (Incarnation & Boot Token)   │   │
│   │  - Atomic Single-Use SQLite Nonce Consumption (Anti-Replay)      │   │
│   │  - Burns Nonce on Dispatch (No Refund on Failure)                │   │
│   └──────────────────────────────────┬───────────────────────────────┘   │
│                                      │ Verified Approval Verified        │
│                                      ▼                                   │
│   ┌──────────────────────────────────────────────────────────────────┐   │
│   │                    GATED PRIVILEGED DISPATCH                     │   │
│   │  - TerminalExecutor (WindowsJob child process launch)            │   │
│   │  - ApprovedGitSupervisor (Mutating Git operations)               │   │
│   │  - FilesystemExecutor (Writes outside project workspace)         │   │
│   │  - DesktopExecutor (Interactive application launch)              │   │
│   │  - Worker Dispatch (Claude, Hermes, Codex CLI processes)         │   │
│   └──────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────┘
```

### Core Security Invariants
1. **Asymmetric Isolation (No In-Process Private Key):** The private signing key exists exclusively within the out-of-process issuer under OS-level protection (Windows CNG with `ExportPolicy = None`). The AgenticOS server and job boundary hold **only the public key**. Compromise of the server, worker, or node runtime cannot expose the signing key.
2. **Phase 1 Runtime Identity Binding:** Every approval is cryptographically bound to the current runtime incarnation (`runtimeIncarnation`, `bootTimestamp`, `supervisorPid`). Approvals minted for a previous process run cannot be replayed after a restart.
3. **Single-Use Atomic Nonce (Zero Replay):** The verifier issues a cryptographically random 64-character nonce with a strict $\le 60$-second deadline. Consumption occurs inside an atomic SQLite transaction (`consumed = 1 WHERE nonce = ? AND consumed = 0 AND revoked = 0`). Any duplicate submission fails immediately.
4. **Context Immutability & Dual Check:** Binding encompasses exact hashes of arguments, resource scopes, and human preview text. The verifier verifies binding immediately prior to execution and rechecks context after execution preparation to eliminate Time-of-Check to Time-of-Use (TOCTOU) substitution.
5. **Fail-Closed Default:** If the issuer is unreachable, public key is missing, signature is invalid, nonce is consumed/expired, or binding differs by a single byte, execution is rejected unconditionally. No environment variable, debug flag, or caller parameter can bypass this check in production.
6. **No Self-Approval:** The LLM, model gateway, and API clients are strictly consumers of approvals, never issuers. Approvals cannot be resolved via plain JSON booleans (`{ approved: true }`).

---

## 2. Cryptographic Approval Schema & Binding

### 2.1 Canonical Payload Specification

All signed envelopes follow strict canonical JSON serialization:
- Object keys sorted lexicographically by ASCII ordinal.
- No whitespace outside strings.
- Numbers must be finite safe integers.
- Strings escaped identically across C# and Node.js runtimes.
- Rejection of unicode bidirectional override characters (`\u202a-\u202e`, `\u2066-\u2069`) and control characters.

```typescript
export interface ApprovalBinding {
  /** Execution context tracking */
  goalId: string;
  graphId: string;
  nodeId: string;
  workerId: string;
  operation: 'SHELL_EXEC' | 'GIT_MUTATE' | 'FS_WRITE' | 'APP_LAUNCH' | 'WORKER_DISPATCH' | string;
  attempt: number;
  tool: string;

  /** Cryptographic digests of parameters */
  scopeHash: string;     // SHA-256(canonical(scope))
  argumentHash: string;  // SHA-256(canonical(args))
  previewHash: string;   // SHA-256(canonical(previewText))

  /** Phase 1 Runtime Identity binding */
  runtimeIncarnation: string; // Unique boot UUID from Phase 1
  bootTimestamp: number;      // Epoch ms of server boot
}

export interface ApprovalPayload extends ApprovalBinding {
  version: 1;
  issuer: 'agenticos-interactive-issuer';
  nonce: string;              // 64-character hex random nonce from verifier challenge
  issuedAt: number;           // Epoch ms
  expiresAt: number;          // Epoch ms (issuedAt + <=60000)
  secondConfirmation: true;   // Mandates two-step operator confirmation
}

export interface SignedApprovalEnvelope {
  algorithm: 'ES256';         // ECDSA using P-256 and SHA-256
  payload: ApprovalPayload;
  canonicalPayload: string;   // Exact serialized UTF-8 string signed
  signature: string;          // Base64-encoded IEEE P1363 signature (64 bytes -> 88 chars / 86 chars + '==')
}
```

### 2.2 Binding Hashes Calculation

1. **`scopeHash`**: Represents the constrained environment of the action.
   - For Terminal / Shell: `{ cwd: string, shell: 'powershell' | 'cmd', jobBoundary: true }`
   - For Git: `{ repository: string, executable: string, executableSha256: string }`
   - For Filesystem: `{ targetPath: string, isDirectory: boolean, parentSha256: string }`
   - For Desktop: `{ executablePath: string, processName: string, windowTitle: string }`
2. **`argumentHash`**: Canonical JSON digest of the exact parameters passed to the tool (command string, file contents, flags).
3. **`previewHash`**: Canonical JSON digest of the human-readable summary string presented to the operator. Prevents displaying a benign action while executing a malicious payload.

---

## 3. Out-of-Process Approval Issuer Specification

### 3.1 Process & Identity Model
- **Process Isolation:** The issuer runs as a distinct native executable (`ApprovalIssuer.exe` or dedicated background service) under an isolated non-administrator Windows user account (e.g., `AgenticOS-ApprovalOperator`).
- **File System Permissions:**
  - Located at `C:\ProgramData\AgenticOS-ApprovalIssuer\ApprovalIssuer.exe`.
  - Owned by `SYSTEM` (S-1-5-18) or `Administrators` (S-1-5-32-544).
  - Manifest file `issuer.json` is protected with inheritance disabled; untrusted identities have no write/delete/traverse permissions.
- **Key Storage:**
  - Microsoft Cryptography Next Generation (CNG) private key with:
    - Algorithm: `ECDsaP256`
    - Key container: `AgenticOS-Approval-Key`
    - `ExportPolicy: CngExportPolicies.None` (Private key can never be exported or dumped from memory).

### 3.2 Operator Presentation & Human Challenge
1. **Interactive Session Check:** Rejects requests if `Environment.UserInteractive == false` or `Process.GetCurrentProcess().SessionId == 0` (preventing headless or background automation abuse).
2. **Dual-Confirmation Flow:**
   - **Step 1:** Displays canonical summary (Tool, Operation, Scope, Arguments, Preview) on a Windows Secure Desktop prompt via `CredUIPromptForWindowsCredentials` with flag `CREDUIWIN_SECURE_PROMPT (0x1000)`.
   - **Step 2:** Operator authenticates with credentials. The issuer unpacks the buffer via `CredUnPackAuthenticationBuffer`, logs on via `LogonUser`, and verifies that the resulting token SID strictly matches `manifest.operatorSid`.
   - **Step 3 (Second Confirmation):** For any privileged action (`secondConfirmationRequired: true`), prompts a second confirmation showing the exact request SHA-256 hash.
3. **Signing:** If authentication succeeds and elapsed time is within deadline, signs `canonicalPayload` using `ECDsaCng.SignData()` and writes the `SignedApprovalEnvelope` to standard output.

---

## 4. In-Job Fail-Closed Verifier Specification

### 4.1 Verifier Architecture (`ApprovalVerifier`)
Located inside `server/src/domains/securitySupervisor/approvalVerifier.ts`:

```typescript
export class ApprovalVerifier {
  constructor(
    private db: Database.Database,
    private getPublicKey: () => KeyObject | undefined,
    private getRuntimeIdentity: () => { incarnation: string; bootTimestamp: number }
  ) {
    this.ensureSchema();
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS supervisor_approval_nonces (
        nonce TEXT PRIMARY KEY,
        binding TEXT NOT NULL,
        deadline INTEGER NOT NULL,
        runtime_incarnation TEXT NOT NULL,
        consumed INTEGER NOT NULL DEFAULT 0,
        revoked INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_approval_nonce_lookup 
        ON supervisor_approval_nonces(nonce, consumed, revoked, deadline);
    `);
  }

  /**
   * Challenges an action by issuing a single-use nonce tied to the binding and current runtime incarnation.
   */
  public challenge(binding: ApprovalBinding, now = Date.now()): { nonce: string; expiresAt: number } {
    const runtime = this.getRuntimeIdentity();
    const nonce = randomBytes(32).toString('hex');
    const expiresAt = now + 60000; // 60 seconds hard cap

    this.db.prepare(`
      INSERT INTO supervisor_approval_nonces (nonce, binding, deadline, runtime_incarnation, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(nonce, canonical(binding), expiresAt, runtime.incarnation, now);

    return { nonce, expiresAt };
  }

  /**
   * Verifies digital signature, checks runtime identity, and atomically consumes nonce.
   * Throws on ANY anomaly (fails closed).
   */
  public consume(
    payload: ApprovalPayload,
    signature: string,
    expected: ApprovalBinding,
    now = Date.now()
  ): void {
    const runtime = this.getRuntimeIdentity();

    // 1. Validate Phase 1 Runtime Identity
    if (payload.runtimeIncarnation !== runtime.incarnation || payload.bootTimestamp !== runtime.bootTimestamp) {
      throw new Error('APPROVAL_RUNTIME_INCARNATION_MISMATCH');
    }

    // 2. Validate Binding Match
    const { version, issuer, nonce, issuedAt, expiresAt, secondConfirmation, ...binding } = payload;
    if (canonical(binding) !== canonical(expected)) {
      throw new Error('APPROVAL_BINDING_MISMATCH');
    }

    // 3. Validate Timing and Expiry
    if (version !== 1 || issuer !== 'agenticos-interactive-issuer' || secondConfirmation !== true ||
        issuedAt > now || expiresAt <= now || expiresAt <= issuedAt || (expiresAt - issuedAt) > 60000) {
      throw new Error('APPROVAL_INVALID_OR_EXPIRED');
    }

    // 4. Validate Asymmetric Signature (Public Key Only)
    const publicKey = this.getPublicKey();
    if (!publicKey || publicKey.type !== 'public') {
      throw new Error('APPROVAL_KEY_UNAVAILABLE');
    }

    const isValid = verify('sha256', Buffer.from(canonical(payload)), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64'));
    if (!isValid) {
      throw new Error('APPROVAL_SIGNATURE_INVALID');
    }

    // 5. Atomic Nonce Consumption (Anti-Replay)
    this.db.transaction(() => {
      const row = this.db.prepare(`
        SELECT * FROM supervisor_approval_nonces WHERE nonce = ?
      `).get(nonce) as any;

      if (!row) throw new Error('APPROVAL_NONCE_NOT_FOUND');
      if (row.consumed === 1) throw new Error('APPROVAL_REPLAY');
      if (row.revoked === 1) throw new Error('APPROVAL_REVOKED');
      if (row.deadline <= now) throw new Error('APPROVAL_EXPIRED');
      if (row.binding !== canonical(expected)) throw new Error('APPROVAL_BINDING_MISMATCH');
      if (row.runtime_incarnation !== runtime.incarnation) throw new Error('APPROVAL_RUNTIME_INCARNATION_MISMATCH');

      const update = this.db.prepare(`
        UPDATE supervisor_approval_nonces 
        SET consumed = 1 
        WHERE nonce = ? AND consumed = 0 AND revoked = 0
      `).run(nonce);

      if (update.changes !== 1) {
        throw new Error('APPROVAL_REPLAY');
      }
    })();
  }
}
```

---

## 5. Integration Plan with Privileged Subsystems

### 5.1 Terminal / Shell Execution (`terminalExecutor.ts`)
- **Current State:** Programmatic PowerShell/cmd commands run inside Windows Job boundary without approval.
- **Phase 3 Integration:**
  - Add optional `approval?: { payload: ApprovalPayload; signature: string }` parameter to `TerminalExecutor.runCommand`.
  - In production mode (`AGENTICOS_UNCONFINED_TEST_ONLY` not set):
    - Check if command contains mutating, external, or system-altering operations.
    - If required, invoke `approvalVerifier.consume(approval.payload, approval.signature, expectedBinding)`.
    - Fail closed with `APPROVAL_REQUIRED` if approval is absent or invalid.

### 5.2 Mutating Git Operations (`ApprovedGitSupervisor.ts` & `gitExecutor.ts`)
- **Current State:** `gitExecutor` runs raw commands via `terminalExecutor` with zero approval; `ApprovedGitSupervisor` is disconnected.
- **Phase 3 Integration:**
  - Route mutating Git commands (`commit`, `push`, `reset`, `checkout`, `merge`) exclusively through `ApprovedGitSupervisor.execute()`.
  - Non-mutating commands (`status`, `diff`, `log`, `rev-parse`) execute under read-only verification without interactive prompt.

### 5.3 Filesystem Writes (`filesystemExecutor.ts` & `toolRegistryBridge.ts`)
- **Current State:** Arbitrary file writes permitted anywhere on the host filesystem without approval.
- **Phase 3 Integration:**
  - Define workspace boundary root `D:\AgenticOS` and temporary scratch directory.
  - Any write, delete, or directory creation targeting paths **outside** the workspace boundary requires verified human approval.
  - Fails closed with `APPROVAL_OUTSIDE_WORKSPACE_REQUIRED`.

### 5.4 Application Launch (`desktopExecutor.ts`)
- **Current State:** Launches desktop executables directly in user session.
- **Phase 3 Integration:**
  - Bind `openApplication` to require approval before calling `spawn()` or `powershell Start-Process`.
  - Fails closed with `APPROVAL_APP_LAUNCH_REQUIRED`.

---

## 6. Comprehensive Test Suite Specification

The following 45 tests must be implemented in Phase 3 Step 2 to verify all aspects of the approval system:

### Section A: Canonical Serialization & Cryptographic Verification (6 tests)
1. `canonical_serializes_deterministic_json`: Verifies keys are sorted identically and whitespace is normalized.
2. `canonical_rejects_non_finite_numbers`: Throws on `NaN` and `Infinity`.
3. `canonical_rejects_bidi_override_characters`: Throws on unicode control codes `\u202a-\u202e` and `\u2066-\u2069`.
4. `verifier_accepts_valid_ecdsa_p256_signature`: Successfully verifies a valid signature matching the enrolled public key.
5. `verifier_rejects_tampered_payload_fields`: Verifies that altering any field (`expiresAt`, `tool`, `operation`) invalidates signature.
6. `verifier_rejects_untrusted_signing_key`: Rejects valid signature produced by a different, unenrolled key pair.

### Section B: Out-of-Process Issuer Boundary & Policy (8 tests)
7. `issuer_refuses_launch_without_rooted_manifest`: Exits with error code 1 when manifest path is relative or missing.
8. `issuer_refuses_manifest_with_untrusted_owner`: Exits if manifest is owned by an untrusted SID (non-SYSTEM / non-Admin).
9. `issuer_refuses_manifest_with_write_permissions`: Exits if normal user SIDs have write/modify permissions.
10. `issuer_refuses_in_non_interactive_session`: Exits if `SessionId == 0` or running as headless service.
11. `issuer_validates_argument_and_scope_hashes`: Rejects signing if argument/scope digests do not match canonical objects.
12. `issuer_enforces_maximum_sixty_second_lifetime`: Refuses requests where `expiresAt - issuedAt > 60000`.
13. `issuer_enforces_second_confirmation_flag`: Rejects issuance if `secondConfirmation` is false.
14. `issuer_key_cannot_be_exported_as_private_blob`: Asserts that `CngKey.Export(EccPrivateBlob)` throws `CryptographicException`.

### Section C: In-Job Fail-Closed Verifier & Replay Protection (10 tests)
15. `verifier_consumes_valid_nonce_exactly_once`: First consumption succeeds; immediate second consumption throws `APPROVAL_REPLAY`.
16. `verifier_burns_nonce_on_failed_dispatch`: If dispatch fails after consumption, the nonce remains consumed and cannot be reused.
17. `verifier_persists_consumed_nonce_across_db_reopen`: Closes SQLite connection, reopens, asserts nonce is still rejected as replay.
18. `verifier_rejects_expired_approval`: Rejects when `now >= expiresAt`.
19. `verifier_rejects_premature_approval`: Rejects when `issuedAt > now`.
20. `verifier_rejects_revoked_nonce`: Explicit `verifier.revoke(nonce)` causes subsequent consumption to fail with `APPROVAL_REVOKED`.
21. `verifier_rejects_cross_goal_nonce_substitution`: Substituting a valid nonce from Goal A into Goal B throws `APPROVAL_BINDING_MISMATCH`.
22. `verifier_handles_database_failure_closed`: Simulated database disk error or closure throws `APPROVAL_SERVICE_UNAVAILABLE`.
23. `verifier_refuses_private_key_object`: Instantiating verifier with private key throws `APPROVAL_KEY_UNAVAILABLE`.
24. `verifier_enforces_atomic_transaction_under_concurrency`: Concurrent attempts to consume same nonce allow exactly 1 success and N-1 `APPROVAL_REPLAY`.

### Section D: Phase 1 Runtime Identity & Across-Boot Invalidation (5 tests)
25. `verifier_binds_to_runtime_incarnation`: Normal verification succeeds when payload matches supervisor incarnation.
26. `verifier_rejects_stale_runtime_incarnation`: Payload with older incarnation UUID throws `APPROVAL_RUNTIME_INCARNATION_MISMATCH`.
27. `verifier_rejects_stale_boot_timestamp`: Payload with mismatched boot timestamp throws `APPROVAL_RUNTIME_INCARNATION_MISMATCH`.
28. `reboot_invalidates_all_unconsumed_challenges`: Simulated supervisor reboot causes previous boot's nonces to be rejected.
29. `runtime_identity_tamper_fails_closed`: Modifying runtime identity getter mid-execution throws error.

### Section E: Privileged Subsystem Integration Tests (8 tests)
30. `terminal_executor_requires_approval_by_default`: Calling `terminalExecutor.runCommand` without approval fails closed.
31. `terminal_executor_executes_with_valid_approval`: Calling with valid signed envelope launches child inside Job boundary.
32. `git_executor_rejects_commit_without_approval`: `executeGit('commit')` fails closed without approval.
33. `approved_git_supervisor_executes_within_job_boundary`: Valid approval executes git inside Windows Job Object.
34. `filesystem_executor_allows_workspace_writes_without_prompt`: Writes inside workspace succeed.
35. `filesystem_executor_rejects_external_writes_without_approval`: Writes to `C:\Users\...` fail closed without approval.
36. `desktop_executor_rejects_app_launch_without_approval`: `openApplication` fails closed without approval.
37. `worker_dispatch_lane_rejects_unapproved_process`: `/api/dispatch` fails closed without approval.

### Section F: Adversarial & Prompt Injection Simulations (8 tests)
38. `adversary_cannot_forge_signature_with_mock_json`: LLM outputting `{ approved: true, signature: "..." }` fails signature verification.
39. `adversary_cannot_modify_command_after_signing`: Modifying command string between signing and dispatch throws `APPROVAL_BINDING_MISMATCH`.
40. `adversary_cannot_expand_file_scope_after_signing`: Changing target directory from `D:\AgenticOS` to `C:\` throws `APPROVAL_BINDING_MISMATCH`.
41. `adversary_cannot_bypass_via_auto_approve_flag`: Setting `autoApprove: true` in request body is ignored by verifier.
42. `adversary_cannot_reuse_historical_hmac_secret`: Passing legacy HMAC proof throws `TOOL_APPROVAL_HUMAN_AUTHENTICATION_UNAVAILABLE`.
43. `adversary_cannot_extract_private_key_via_memory_dump`: In-job process inspection reveals zero private key handles.
44. `adversary_cannot_reset_consumed_nonce_via_api`: API endpoints do not expose direct update access to `supervisor_approval_nonces`.
45. `adversary_unauthenticated_api_call_rejected`: Calling `/api/projects/execute` without bearer token returns 401/503.

---

## 7. Implementation Checklist for Phase 3 Step 2

- [ ] Export `ToolRegistry` class in `services/agent/toolRegistry.ts` to fix `toolAuthorizationBoundary.test.ts`.
- [ ] Harden `middleware/auth.ts` to fail closed across all environments when unauthenticated.
- [ ] Remove public bypasses in `server/src/index.ts` for mutating endpoints (`/api/dispatch`, `/api/integrations/`).
- [ ] Connect `ApprovalVerifier` to authoritative `deploymentIdentity.ts` runtime incarnation.
- [ ] Wire `ApprovedGitSupervisor` into live Git execution paths.
- [ ] Enforce approval checks in `terminalExecutor.ts`, `filesystemExecutor.ts`, and `desktopExecutor.ts`.
- [ ] Implement the 45 specified test cases in `src/__tests__/approvalPhase3.test.ts`.
