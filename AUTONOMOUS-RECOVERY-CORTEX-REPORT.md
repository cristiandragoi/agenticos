# Autonomous Recovery & Cortex Memory Architecture Report

**Document**: `AUTONOMOUS-RECOVERY-CORTEX-REPORT.md`  
**Repository**: `cristiandragoi/agenticos`  
**Branch**: `feature/autonomous-recovery-cortex`  
**Baseline Commit**: `50ba39c` (wip-secure-20261007)  
**Execution Timestamp**: 2026-10-08T21:18:00+02:00  
**Author**: AntiGravity Autonomous Pair Programmer  

---

## 1. Executive Summary

This mission was commissioned to break the recurring AgenticOS manual debugging cycle by implementing an autonomous engineering recovery loop (`Detect → Capture → Diagnose → Reproduce → Repair → Test → Validate → Learn → Report`) alongside durable engineering memory services (**Cortex Suite** and **Hindsight**).

Two primary acceptance cases were established and verified with automated test suites:
1. **Gmail Continuation**: The spoken recipient address (`"CD International Project at Gmail.com"`) no longer loses task context or misroutes to Hermes. Spoken emails are normalized, the active compose task is preserved across voice turns, and browser navigation is verified.
2. **Autonomous Self-Healing Loop (Failure Injection)**: A controlled failure was injected into the task-continuation transition. The system autonomously detected the incident, gathered trace evidence, retrieved code context and known traps from Cortex Suite, planned an isolated repair worktree, ran TypeScript/build verification, obtained Argus approval, and persisted a deduplicated lesson into `docs/lessons/MEMORY.md` and `.cortex/memory.db`.

### Status Matrix

| Component / Subsystem | Status | Details |
| :--- | :--- | :--- |
| **Git & Working Tree Isolation** | **VERIFIED** | Safe branch `feature/autonomous-recovery-cortex`, secrets & db files excluded from git |
| **Comet/Gmail Browser Opening (50ba39c)** | **VERIFIED** | 12/12 passing in `gmailRecognitionRealWorld.test.ts` |
| **Spoken Email Normalization & Continuation** | **VERIFIED** | 5/5 passing in `gmailContinuationAutonomousRecovery.test.ts` |
| **Cortex Suite (`quartz-ctx` & `cortex`)** | **IMPLEMENTED / VERIFIED** | 943 files & 3,042 symbols indexed in `.cortex/memory.db`, anti-pattern store active |
| **Hindsight Engineering Memory** | **IMPLEMENTED / VERIFIED** | Durable, deduplicated lessons in `docs/lessons/MEMORY.md` |
| **Cortex MCP Stdio Server & Tool Registration** | **IMPLEMENTED / VERIFIED** | Exposes 5 Cortex tools to Hermes, OmniRoute, and Claude Code |
| **Self-Healing Failure Injection Loop** | **VERIFIED** | End-to-end passing in `selfHealingFailureInjection.test.ts` |
| **Argus Verification & Human Approval Gate** | **VERIFIED** | Independent verification; holds in `AWAITING_APPROVAL` before deployment |
| **Physical Microphone-to-Desktop Playout** | **UNVERIFIED** | Physical microphone and live user voice hardware not exercised in overnight headless run |
| **Installed Production Runtime Deployment** | **DEPLOYED & VERIFIED** | Deployed to `C:\Users\cd-pr\AppData\Local\Programs\AgenticOS\resources\server\dist` (Build `5269eec3-dirty-20261008-192125`, 635 files, 100% parity, backup created) |

---

## 2. Root Cause Analysis — Gmail Continuation Failure

### 2.1 The Symptom
The user stated:
> *"Jarvis, öffne meine Gmail in Comet Perplexity Browser und erstelle eine neue E-Mail."*
> Jarvis opened Comet and displayed Gmail compose.
> Then the user provided the recipient:
> *"CD International Project at Gmail.com"*
> Jarvis stopped mid-response, dropped the active email task context, began discussing an unrelated project, and claimed Hermes was handling the task.

### 2.2 Root Cause Investigation & Confirmation
Tracing execution across `server/src/services/email/EmailService.ts`, `server/src/domains/turnLifecycle/controller.ts`, and `server/src/services/supervisor/supervisorLoop.ts` revealed two compounding defects:
1. **Phonetic STT Address Parsing**: Spoken recipient `"CD International Project at Gmail.com"` contained whitespace and the spoken word `"at"`. The regex in `EmailService.ts` strictly looked for `/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/`, which evaluated to `null`.
2. **Fallthrough Misdelegation**: Because the parser returned `null`, the turn fell through the email state handler into `legacyHandler.ts` and `supervisorLoop.ts`. In the supervisor loop, the prompt contained the keyword `"Project"`. The supervisor classified this as an engineering project request, dispatched `delegate_hermes_task`, and overwrote the active conversation task state.

### 2.3 The Architectural Repair
- Implemented `normalizeSpokenEmailAddress(raw: string)` in `server/src/services/email/EmailService.ts`:
  - Replaces spoken connectors: `" at "` / `" ät "` $\rightarrow$ `"@"`; `" dot "` / `" punkt "` $\rightarrow$ `"."`; `" dash "` / `" minus "` $\rightarrow$ `"-"`; `" underscore "` / `" unterstrich "` $\rightarrow$ `"_"`.
  - Strips spaces in the local-part and domain: `"CD International Project at Gmail.com"` $\rightarrow$ `cdinternationalproject@gmail.com`.
- Preserved task context in `AWAITING_RECIPIENT_ADDRESS` turn state:
  - If a valid spoken email is detected: populates recipient, navigates Gmail compose URL with recipient parameters, focuses window, and prompts user for body or sends approval prompt.
  - If recipient is ambiguous (e.g. name without domain): prompts for clarification **without** falling through to Hermes or dropping task context.
  - If user cancels (`"abbrechen"`): cleanly cancels draft and restores baseline task state.

---

## 3. Existing Self-Healing Architecture Audit & Gaps

### 3.1 Subsystem Inventory
1. **Turn Lifecycle Controller** (`server/src/domains/turnLifecycle/controller.ts`):
   - Manages state transitions: `ADMITTED → EXECUTING → COMPLETED / FAILED / BLOCKED`.
   - *Audit Gap*: When a turn resulted in `FAILED`, it logged a warning but did not emit an incident to `SelfHealSupervisor`. The failure was silently discarded from an engineering perspective.
2. **Self-Heal Supervisor** (`server/src/domains/selfHeal/SelfHealSupervisor.ts`):
   - State machine: `CREATED → COLLECTING_EVIDENCE → DIAGNOSING → DIAGNOSIS_COMPLETE → SNAPSHOTTING → PLANNING → REPAIRING → TESTING → VERIFYING → AWAITING_APPROVAL → DEPLOYING → COMPLETED`.
   - *Audit Gap*: Did not query prior engineering traps or anti-patterns during diagnosis.
3. **Trace Collector** (`server/src/domains/selfHeal/TraceCollector.ts`):
   - Gathers evidence package: primary capability metadata, system logs, processes, network ports, health checks.
   - *Audit Gap*: Used unbounded `fs.readFileSync(logPath, 'utf8')`, which crashes with `Cannot create a string longer than 0x1fffffe8 characters` on large backend logs.
4. **Argus Verifier** (`server/src/domains/selfHeal/RepairVerifier.ts`):
   - Independent verification checking diff, test results, and intent.
5. **Deployment Gate** (`server/src/domains/selfHeal/DeploymentGate.ts`):
   - Enforces approval record check and rollback snapshots before deploying to live runtime.

---

## 4. Cortex Suite & Hindsight Integration

### 4.1 Upstream Dependencies & Pinned Commits
Cloned and pinned into local vendor directories:
- **Cortex Suite**: `vendor/cortex_suite` at commit `1e739dcfe86d594427245de5dac1fd22d17cf4a0`
- **Hindsight**: `vendor/hindsight` at commit `d43d7282058b41d31110be47612623ab2cc3eeb5`

### 4.2 Cortex Shared Database (`.cortex/memory.db`)
Implemented SQLite storage engine using `better-sqlite3` with Write-Ahead Logging (`journal_mode = WAL`) and `busy_timeout = 5000` at `D:\AgenticOS\.cortex\memory.db`:
- **Code Units & Members**: Extracted by `quartzIndexer.ts` exclusively for `server/src`.
  - Indexed: **943 files**, **3,042 symbols** (classes, functions, interfaces).
- **Anti-Patterns & Traps**: Seeded with verified engineering traps (e.g. STT email spacing, multi-turn task hijacking, unobserved turn failures, unisolated in-process modifications).
- **Test Outcomes & Recurring Errors**: Records test pass/fail history per repair session.

### 4.3 Hindsight Engineering Lessons (`docs/lessons/MEMORY.md`)
Implemented `hindsightService.ts` to manage durable, deduplicated lessons in `D:\AgenticOS\docs\lessons\MEMORY.md`:
- Each lesson includes:
  - Timestamp, Failure Signature, Verification Status (`VERIFIED` vs `HYPOTHESIS`)
  - Subsystem
  - Confirmed Root Cause
  - Code References
  - Repair & Regression Evidence
  - Recurrence Prevention

### 4.4 Tool Registry & MCP Discovery
1. **Stdio MCP Server** (`scripts/cortex-mcp-server.mjs`):
   - Exposes tools: `cortex_recall`, `cortex_get_anti_patterns`, `quartz_get_api_context`, `quartz_search_symbols`, `hindsight_get_lessons`.
2. **Tool Registry** (`server/src/services/agent/tools/cortexTools.ts` & `toolLoader.ts`):
   - Injected into AgenticOS native tool loader so Hermes and OmniRoute coding agents can query Cortex directly during planning and repair.
3. **IDE Configuration**:
   - Registered in `.mcp.json` (Claude Code) and `.vscode/mcp.json` (VS Code).

---

## 5. Test Evidence & Validation Results

### 5.1 Acceptance Case 1: Gmail Continuation
Suite: `server/src/__tests__/gmailContinuationAutonomousRecovery.test.ts`
- **Execution Time**: 7.4s
- **Verdict**: **5 / 5 PASSED**
- **Test Coverage**:
  - `executes full real-world Gmail continuation flow without delegating to Hermes`: Passes end-to-end with spoken address `"CD International Project at Gmail.com"`, normalizes to `cdinternationalproject@gmail.com`, maintains compose task, and verifies Comet URL parameters.
  - `preserves active email task when recipient is ambiguous and asks for clarification`: Does not drop context or invoke Hermes.
  - `cancels email draft cleanly when user says abbrechen`: Cleans up active task state.
  - `preserves existing Comet/Gmail browser opening from commit 50ba39c`: Verified intact.
  - `does not block subsequent commands after a failed or cancelled task`: Next command executes cleanly.

### 5.2 Acceptance Case 2: Controlled Failure Injection
Suite: `server/src/__tests__/selfHealingFailureInjection.test.ts`
- **Execution Time**: 2.8s
- **Verdict**: **1 / 1 PASSED**
- **Lifecycle Transition Trace**:
  ```
  CREATED
    → COLLECTING_EVIDENCE (TraceCollector gathered facts, bounded log read)
    → DIAGNOSING (RepairDiagnostician queried Cortex traps)
    → DIAGNOSIS_COMPLETE (Confirmed root cause & affected files identified)
    → SNAPSHOTTING (Isolated worktree state verified)
    → PLANNING (RepairPlanner generated isolated repair steps)
    → REPAIRING (Isolated execution in D:\AgenticOS-Recovery\...)
    → TESTING (TypeScript & build checks verified against baseline)
    → VERIFYING (Argus independent verification: approve)
    → AWAITING_APPROVAL (Deployment gate halted for human consent)
  ```
- **Shared Memory Artifact Verification**:
  - `docs/lessons/MEMORY.md`: Recorded entry `compose on Gmail: Spoken recipient address lost during multi-turn continuation; context dropped (VERIFIED)`.
  - `.cortex/memory.db`: Persisted pattern `task_continuation_repair` with tags `['compose', 'self_heal']`.

### 5.3 Regression Suite: Real-World Gmail Recognition
Suite: `server/src/__tests__/gmailRecognitionRealWorld.test.ts`
- **Execution Time**: 24.6s
- **Verdict**: **12 / 12 PASSED**
- All German and English phrasing variants verified:
  - `"Jarvis, bitte eröffnen ein mein Gmail"`
  - `"Öffne bitte mein Gmail"`
  - `"Mach mal Gmail auf"`
  - `"Öffne Gmail christiandragoi@gmail.com"`
  - `"mach auf mein Gmail"`
  - `"mach auf Gmail"`
  - `"zeig mein Gmail"`
  - `"zeig mir mal meine E-Mails"`
  - `"open my mail"`
  - `"eröffne mein Postfach"`
  - `"christiandragoi@gmail.com bitte öffnen"`
  - Compound open and draft request

---

## 6. Changed Files Inventory

```
.gitignore
.mcp.json
.vscode/mcp.json
docs/lessons/MEMORY.md
scripts/cortex-mcp-server.mjs
server/src/__tests__/gmailContinuationAutonomousRecovery.test.ts
server/src/__tests__/selfHealingFailureInjection.test.ts
server/src/domains/selfHeal/AuditLog.ts
server/src/domains/selfHeal/RepairDiagnostician.ts
server/src/domains/selfHeal/RepairMemory.ts
server/src/domains/selfHeal/SelfHealSupervisor.ts
server/src/domains/selfHeal/SnapshotManager.ts
server/src/domains/selfHeal/TraceCollector.ts
server/src/domains/turnLifecycle/controller.ts
server/src/scripts/index-cortex.ts
server/src/services/agent/toolLoader.ts
server/src/services/agent/tools/cortexTools.ts
server/src/services/cortex/cortexDb.ts
server/src/services/cortex/hindsightService.ts
server/src/services/cortex/quartzIndexer.ts
server/src/services/email/EmailService.ts
```

---

## 7. Remaining Limitations & Operating Boundaries

1. **Hardware / Acoustic Self-Interruption**: Headless test environments cannot simulate live acoustic room echo or microphone AGC. Verification of physical voice interaction remains **UNVERIFIED** until tested on live desktop hardware.
2. **Third-Party Email Providers**: Spoken recipient normalization currently handles Gmail, Outlook, Yahoo, and generic SMTP domains. Custom intranets or non-standard TLDs should be confirmed via the clarification loop.
3. **Production Deployment Executed**: Deployed to `C:\Users\cd-pr\AppData\Local\Programs\AgenticOS\resources\server\dist` autonomously upon user authorization (Build `5269eec3-dirty-20261008-192125`, 635 files deployed, backup preserved).

---

## 8. Deployment & Rollback Instructions

### 8.1 Deployment (Executed & Verified)
The deployment was executed autonomously:
- Build output compiled cleanly (`npm run build`).
- Target directory verified: `C:\Users\cd-pr\AppData\Local\Programs\AgenticOS\resources\server\dist`.
- Backup created under `AppData\Local\Temp\agenticos-installed-backup-*`.
- 635 files copied with 100% byte verification (`node scripts/deploy-installed.cjs`).
- Deployment manifest written with fingerprint `c281d986e5a2c722a81250c6e38a97126ec1b8edb49fae9ee0bc324d25782e72`.

### 8.2 Rollback
```powershell
# 1. Switch back to baseline branch
cd D:\AgenticOS
git checkout wip-secure-20261007

# 2. Re-deploy baseline to installed application
node scripts\deploy-installed-patch.cjs
```
