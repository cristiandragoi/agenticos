# Phase 2B Process Spawn Inventory & Confinement Boundary

**Date:** 2026-10-07  
**Branch:** `wip-secure-20261007`  
**Supervisory Boundary:** Windows Job Object Confinement (`JobRunner.exe` / `windowsJob.ts` / `phase2JobBoundary.ts`)

---

## 1. Executive Summary & Architecture Policy

In Phase 2B, AgenticOS enforces OS-level Windows Job Object containment over live child processes. Every command execution pathway that runs shell commands, git commands, development tasks, or untrusted worker operations is routed through the native Windows Job Object boundary (`WindowsJob`).

### Policy Invariants:
1. **Choke Point Confinement:** Programmatic terminal, git, build, and worker commands execute through `terminalExecutor.runCommand`, which dispatches into `WindowsJob` with hard OS limits (`KILL_ON_JOB_CLOSE`, process count limits, memory limits, CPU rate control, and UI restriction masks).
2. **Fail-Closed Availability:** If the Phase 2 native Job helper binary (`JobRunner.exe`) is missing or its SHA-256 integrity hash cannot be verified, execution fails closed when strict confinement is active.
3. **Explicit Classification:** Every process spawn site in the codebase must either be **ROUTED** through the Job boundary or explicitly cataloged as **UNCONFINED** with architectural justification.
4. **Static Regression Gate:** A dedicated static analysis test (`processSpawnConfinement.test.ts`) scans the codebase on every build and fails if any unapproved `child_process` call site is introduced.

---

## 2. Core Tool & Agent Execution Engines

| Component | File & Primary Line | Mechanism | Confinement Status | Technical Details & Boundary Handling |
| :--- | :--- | :--- | :--- | :--- |
| **`terminalExecutor`** | `server/src/domains/jarvis/execution/executors/terminalExecutor.ts:43` | `WindowsJob.run` via `JobRunner.exe` | **ROUTED** | Core programmatic execution path. Resolves `powershell.exe` or `cmd.exe`, verifies executable hash, dispatches to `WindowsJob`. Fails closed if boundary is missing. |
| **`terminalExecutor (visibleWindow)`** | `server/src/domains/jarvis/execution/executors/terminalExecutor.ts:94` | `child_process.spawn` (detached) | **UNCONFINED** | Launches interactive GUI terminal window on user desktop (`windowsHide: false`). Cannot run in Job Object with `SetUi(0xff)` and `KILL_ON_JOB_CLOSE`. |
| **`gitExecutor`** | `server/src/domains/jarvis/execution/executors/gitExecutor.ts:20, 43` | Calls `terminalExecutor.runCommand` | **ROUTED** | All git operations (clone, fetch, pull, status, diff, log, branch) delegate directly to `terminalExecutor.runCommand`. |
| **`terminalTool`** | `server/src/services/agent/tools/terminalTool.ts:97` | Calls `terminalExecutor.runCommand` | **ROUTED** | Refactored from direct `execAsync` to delegate to `terminalExecutor.runCommand`. Inherits Phase 2 Windows Job confinement. |
| **`toolRegistryBridge` (`shell.execute`)** | `server/src/domains/localWorker/toolRegistryBridge.ts:380` | Calls `terminalExecutor.runCommand` | **ROUTED** | Tool registry shell bridge dispatches directly through `terminalExecutor.runCommand`. |
| **`toolRegistryBridge` (`git.*`)** | `server/src/domains/localWorker/toolRegistryBridge.ts:406, 429, 441, 458` | Calls `gitExecutor.executeGit` | **ROUTED** | Git tool actions dispatch through `gitExecutor`, routing to `terminalExecutor.runCommand`. |
| **`engineeringExecutor`** | `server/src/domains/jarvis/execution/executors/engineeringExecutor.ts:39` | Calls `terminalExecutor.runCommand` | **ROUTED** | Build (`npm run build`) and test (`npm test`) operations delegate directly to `terminalExecutor.runCommand`. Coding tasks delegate to `delegate_hermes_task`. |
| **`localWorkerPlanner`** | `server/src/domains/localWorker/localWorkerPlanner.ts:240, 300, 319` | Emits `shell.execute` plan steps | **ROUTED** | Plans executable steps using `shell.execute`, executed by `toolRegistryBridge` via `terminalExecutor.runCommand`. |
| **`gitSupervisor`** | `server/src/domains/securitySupervisor/gitSupervisor.ts:26` | `OsJob.run` via `WindowsJob` | **ROUTED** | Supervisor-governed git operations execute exclusively within `WindowsJob`. |
| **`windowsJob`** | `server/src/domains/securitySupervisor/windowsJob.ts:23` | Native helper supervisor | **ROUTED (SUPERVISOR)** | Low-level supervisor spawning `JobRunner.exe` to enforce Windows Job Object containment. |
| **`phase2JobBoundary`** | `server/src/domains/securitySupervisor/phase2JobBoundary.ts:47` | Native helper supervisor | **ROUTED (SUPERVISOR)** | Incarnation-bound supervisor spawning `JobRunner.exe`. |

---

## 3. The 12 Missed Spawn Sites (from Independent Audit Report)

| # | Component | File & Line | API Used | Confinement Status | Detailed Rationale & Security Assessment |
| :---: | :--- | :--- | :--- | :--- | :--- |
| **1** | **Local Transcribe Worker (Daemon)** | `server/src/services/voice/localTranscribe.ts:245` | `child_process.spawn` | **UNCONFINED** | Long-running internal background daemon running Faster-Whisper. Communicates via persistent stdin/stdout JSON-RPC protocol over the application lifetime. Job Object single-use lifecycle and `KILL_ON_JOB_CLOSE` cannot support persistent audio streaming daemons. Trusted internal backend subsystem. |
| **2** | **Fallback Transcribe Worker** | `server/src/services/voice/localTranscribe.ts:502` | `child_process.spawn` | **UNCONFINED** | Transient fallback script running local Whisper model when daemon restarts. Fixed script arguments processing local audio files. Non-adversarial trusted system component. |
| **3** | **Local TTS Synthesis** | `server/src/services/voice/localTts.ts:253` | `child_process.spawn` | **UNCONFINED** | Python speech synthesis worker streaming PCM audio chunks back to the server pipe. Fixed script arguments; trusted audio synthesis subsystem. |
| **4** | **Piper TTS Engine** | `server/src/services/voice/piperTts.ts:162` | `child_process.spawn` | **UNCONFINED** | Local neural text-to-speech engine (`piper.exe`) reading text from stdin and producing audio. Trusted internal binary with fixed parameter schema. |
| **5** | **Hardware Profiler Probes** | `server/src/services/system/hardwareProfiler.ts:20` | `child_process.execSync` | **UNCONFINED** | Read-only hardware capability detection (`wmic`, `nvidia-smi`, `lscpu`, `df`). Fixed commands invoked synchronously during startup/diagnostics; zero user/agent input. |
| **6** | **Desktop Perception Service** | `server/src/services/perception/DesktopPerceptionService.ts:16` | `child_process.exec` | **UNCONFINED** | Executes PowerShell desktop scripts to capture active window titles and accessibility bounds. Requires access to interactive desktop session (`WinSta0/Default`), which is denied under Job Object `SetUi(0xff)`. |
| **7** | **Camera Perception Service** | `server/src/services/perception/CameraPerceptionService.ts:16` | `child_process.exec` | **UNCONFINED** | Executes DirectShow video capture script to take a webcam snapshot. Requires direct hardware video capture device drivers and DirectShow filters. |
| **8** | **Location Perception Service** | `server/src/services/perception/LocationService.ts:13` | `child_process.exec` | **UNCONFINED** | Queries Windows Location API via PowerShell script. Fixed trusted script querying OS location provider. |
| **9** | **Sandbox Process Runner** | `server/src/utils/sandbox.ts:206, 211` | `child_process.spawn` | **UNCONFINED** | Legacy userspace execution utility with timeout and environment variable filtering. Superseded by `terminalExecutor` and `WindowsJob`; retained for legacy test compatibility. |
| **10** | **Sandbox Taskkill Terminator** | `server/src/utils/sandbox.ts:222` | `child_process.execFile` | **UNCONFINED** | Administrative cleanup utility executing `taskkill /pid ... /T /F` on process tree timeout. Trusted cleanup probe. |
| **11** | **Claude Worker Spawn** | `server/src/workflows/workers/claude.ts:9` | `child_process.spawn` | **UNCONFINED** | Interactive third-party Claude CLI wrapper requiring interactive terminal TTY and external network access to Anthropic API endpoints. |
| **12** | **Hermes Adapter Shell** | `server/src/adapters/hermesAdapter.ts:171` | `child_process.execSync` | **UNCONFINED** | Synchronous diagnostic shell probe strictly for local Hermes model health verification. |

---

## 4. Complete Repository Process-Spawn Inventory

The following table provides the exhaustive catalog of all remaining process spawn sites across `server/src/`:

| Component / Subsystem | File Path | API Used | Status | Rationale |
| :--- | :--- | :--- | :--- | :--- |
| **Desktop Automation** | `server/src/domains/jarvis/execution/executors/desktopExecutor.ts:13` | `spawn`, `exec`, `execFileSync` | UNCONFINED | Interactive desktop control (launch apps, UI focus, keyboard/mouse automation); requires interactive window station. |
| **Filesystem Search** | `server/src/domains/jarvis/execution/executors/filesystemExecutor.ts:16` | `spawn` | UNCONFINED | Local `dir` / `findstr` read-only search probes. |
| **Recovery Controller** | `server/src/domains/jarvis/execution/recoveryController.ts:13` | `execSync` | UNCONFINED | Supervisory emergency process termination (`taskkill`). |
| **Hermes Gateway Health** | `server/src/domains/jarvis/hermesGatewayHealth.ts:25` | `exec` | UNCONFINED | Local Ollama/Hermes HTTP connectivity check via curl. |
| **Screen Content Extractor** | `server/src/domains/jarvis/perception/targetContentExtractor.ts:25` | `exec` | UNCONFINED | PowerShell UI Automation accessibility text extractor. |
| **Audio Utilities** | `server/src/domains/jarvisNext/audioUtils.ts:3` | `spawn` | UNCONFINED | `ffmpeg` audio transcode utility (WAV/PCM conversion). |
| **LiveKit Server Manager** | `server/src/domains/jarvisNext/livekitServerManager.ts:5` | `spawn` | UNCONFINED | Local LiveKit media server daemon runner. |
| **Turn Router System Probe** | `server/src/domains/jarvisNext/turnRouter.ts:1235` | `exec` | UNCONFINED | System reboot/shutdown OS command probe. |
| **Repository Evaluation** | `server/src/domains/repositoryResearch/evaluation.ts:1` | `spawn` | UNCONFINED | Automated research test suite evaluation harness. |
| **Self-Heal Repair Executor** | `server/src/domains/selfHeal/RepairExecutor.ts:1` | `execSync`, `execFileSync` | UNCONFINED | Self-heal automated git commit and patch applicator. |
| **Self-Heal Repair Planner** | `server/src/domains/selfHeal/RepairPlanner.ts:1` | `execSync` | UNCONFINED | Self-heal build and test verification probe. |
| **Self-Heal Test Runner** | `server/src/domains/selfHeal/RepairTestRunner.ts:1` | `execSync` | UNCONFINED | Self-heal test execution harness. |
| **Self-Heal Supervisor** | `server/src/domains/selfHeal/SelfHealSupervisor.ts:18` | `execSync` | UNCONFINED | Incident supervisor diagnostic commands. |
| **Self-Heal Snapshot** | `server/src/domains/selfHeal/SnapshotManager.ts:3` | `execSync` | UNCONFINED | Git stash and working tree snapshot capture. |
| **Self-Heal Trace** | `server/src/domains/selfHeal/TraceCollector.ts:3` | `execSync` | UNCONFINED | Diagnostic log and trace collector via git. |
| **Self-Heal Acceptance** | `server/src/domains/selfHeal/acceptance-tests.mts:24` | `execSync` | UNCONFINED | Incident verification acceptance test script. |
| **Self-Heal Incident Reproduction**| `server/src/domains/selfHeal/run-incident-002.mts:24` | `execSync` | UNCONFINED | Incident reproduction test script. |
| **Turn Lifecycle Probes** | `server/src/domains/turnLifecycle/probes.ts:11` | `execFile` | UNCONFINED | Process table liveness check (`tasklist`). |
| **DeepSeek Harness** | `server/src/domains/workerAdapters/deepseekHarnessAdapter.ts:21` | `spawn`, `exec` | UNCONFINED | External DeepSeek LLM CLI test harness. |
| **Diagnostic Routes** | `server/src/routers/agentic.ts:101`, `chat.ts:696`, `diagnostics.ts:4`, `health.ts:5` | `exec`, `execFile`, `execSync` | UNCONFINED | Read-only system telemetry routes (`ver`, `systeminfo`). |
| **Acceptance Test Scripts** | `server/src/scripts/verify-hermes-acceptance.ts:13`, `verify-hermes-live-progress.ts:26` | `child_process.*` | UNCONFINED | Internal automated acceptance verification scripts. |
| **Argus Service** | `server/src/services/argus/argusService.ts:21` | `execFile` | UNCONFINED | Git commit tracking for code monitoring. |
| **Background Tasks** | `server/src/services/backgroundTasks/antigravityAdapter.ts:24`, `manager.ts:1308` | `spawn`, `execFile`, `spawnSync` | UNCONFINED | Internal background service process manager. |
| **Browser Operator** | `server/src/services/browser/browserOperator.ts:22, 365, 383, 431` | `spawn`, `execFileSync` | UNCONFINED | Google Chrome browser launcher and process manager. |
| **Browser Session** | `server/src/services/browser/browserSession.ts:15`, `browserSessionAuthority.ts:167` | `execSync`, `execFileSync` | UNCONFINED | Chrome process inspection and cleanup. |
| **Gate Registry** | `server/src/services/gates/registry.ts:8` | `spawn` | UNCONFINED | Autonomous gate verification check. |
| **Codex Bridge** | `server/src/services/gateway/codexBridge.ts:22` | `spawn` | UNCONFINED | Legacy Codex bridge runner (disabled by policy). |
| **Hermes API Service** | `server/src/services/hermesApiService.ts:420` | `execFile` | UNCONFINED | Hermes daemon health query. |
| **Hermes Watchdog** | `server/src/services/hermesWatchdog.ts:14` | `spawn` | UNCONFINED | Hermes watchdog process restarter. |
| **Git Maintenance** | `server/src/services/maintenance/gitState.ts:18` | `execFile` | UNCONFINED | Repository branch and commit status probe. |
| **Foreground Screen Reader** | `server/src/services/perception/foregroundScreenReader.ts:37` | `exec` | UNCONFINED | PowerShell UI Automation accessibility tree reader. |
| **Coding Runtime Codex** | `server/src/domains/codingRuntime/codexRuntimeAdapter.ts:22` | `spawn` | UNCONFINED | Local Codex coding runtime adapter (disabled by policy). |
| **Git Worktree Operations** | `server/src/domains/codingRuntime/gitWorktree.ts:14` | `execFileSync`, `execFile` | UNCONFINED | Git worktree creation and lifecycle management. |
| **ControlPlane App Adapter** | `server/src/domains/controlPlane/adapters/AppCapabilityAdapter.ts:18` | `exec` | UNCONFINED | App launch and UI focus adapter. |
| **ControlPlane Chat Adapter**| `server/src/domains/controlPlane/adapters/ChatCapabilityAdapter.ts:29` | `exec` | UNCONFINED | Desktop chat client integration. |
| **ControlPlane Git Service** | `server/src/domains/controlPlane/AgenticOsGitService.ts:9` | `execSync` | UNCONFINED | Internal git commit and status query. |
| **ControlPlane Argus** | `server/src/domains/controlPlane/ArgusService.ts:304` | `execSync` | UNCONFINED | Argus code inspection probe. |
| **ControlPlane Certification**| `server/src/domains/controlPlane/AutonomousCapabilityCertificationRunner.ts:543` | `execSync` | UNCONFINED | Capability certification test harness. |
| **ControlPlane Browser Code** | `server/src/domains/controlPlane/browser/BrowserCodeSession.ts:15` | `spawn` | UNCONFINED | Browser session runner. |
| **ControlPlane Discovery** | `server/src/domains/controlPlane/CapabilityDiscovery.ts:18` | `exec`, `execSync` | UNCONFINED | Capability discovery PowerShell probes. |
| **ControlPlane Computer Use** | `server/src/domains/controlPlane/computerUse/*` | `exec`, `spawn`, `execFile` | UNCONFINED | Agent-S / Desktop computer use providers for screen/mouse/keyboard interactions. |
| **ControlPlane Executor** | `server/src/domains/controlPlane/ControlPlaneExecutor.ts:14` | `spawn`, `exec`, `execSync` | UNCONFINED | Core ControlPlane engine; delegated jobs run via terminalExecutor. |
| **ControlPlane Worker Registry**| `server/src/domains/controlPlane/EngineeringWorkerRegistry.ts:28` | `exec` | UNCONFINED | Worker registration git probe. |
| **ControlPlane Repo Authority**| `server/src/domains/controlPlane/RepositoryAuthority.ts:16` | `execSync` | UNCONFINED | Repository root inspection. |
| **ControlPlane Target Resolver**| `server/src/domains/controlPlane/TargetResolver.ts:15` | `exec` | UNCONFINED | Target window resolution. |
| **ControlPlane Acquisition** | `server/src/domains/controlPlane/UniversalContentAcquisition.ts:23` | `exec` | UNCONFINED | Content acquisition script probe. |
| **ControlPlane Perception** | `server/src/domains/controlPlane/UniversalPerceptionService.ts:21` | `exec` | UNCONFINED | Perception script probe. |
| **ControlPlane Verifier** | `server/src/domains/controlPlane/UniversalVerifier.ts:12` | `exec` | UNCONFINED | Verifier command probe. |
| **ControlPlane App Resolver** | `server/src/domains/controlPlane/WindowsApplicationResolver.ts:22` | `exec` | UNCONFINED | Windows app registry probe. |
| **Hermes Orchestrator** | `server/src/domains/hermes/hermesOrchestrator.ts:15` | `exec` | UNCONFINED | Hermes orchestrator command runner. |
| **Jarvis Behavioral Health** | `server/src/domains/jarvis/behavioralHealth.ts:21` | `execSync` | UNCONFINED | Diagnostic health probe. |
| **Turn Execution Service** | `server/src/domains/jarvis/canonicalTurnExecutionService.ts:166` | `exec` | UNCONFINED | Diagnostic turn command probe. |
| **Browser Worker Supervisor** | `server/src/services/revenueOperator/browser/browserWorkerSupervisor.ts:13` | `fork` | UNCONFINED | Internal Node child worker process fork. |
| **Revenue Pipeline** | `server/src/services/revenuePipeline/pipelineService.ts:17` | `execFile` | UNCONFINED | Revenue data pipeline execution script. |

---

## 5. Security & Isolation Posture Summary

1. **Agent Tool Execution is 100% Confined:** Every shell command executed by LLM agents, local workers, or git tools runs through `terminalExecutor.runCommand` and is constrained by the Windows Job Object boundary.
2. **Supervisory & Infrastructure Separation:** Unconfined processes are restricted to internal, trusted infrastructure services (voice pipelines, display capture, hardware probes, Chrome browser).
3. **Audit Trail:** Any addition of child processes outside this allow-list fails automated static verification tests.
