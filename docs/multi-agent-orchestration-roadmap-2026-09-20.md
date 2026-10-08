# Multi-Agent Orchestration: State of the Art and Roadmap Analysis

Repository: D:\AgenticOS
Date: 2026-09-20
Re-verified: 2026-09-30 against commit 8f7463a (branch hermes-rescue-20260908). Section
2b is a local-evidence re-verification and supersedes Section 2 rows where they disagree;
Section 1 and the Sources block are unchanged by it. Re-verified again 2026-10-01 at the
same commit (uncommitted working tree): Section 2c supersedes Section 2b rows where they
disagree, and Section 1 plus the Sources block remain unchanged. Re-verified a third time
2026-10-01 07:08 UTC (same commit, same uncommitted working tree, later session): Section 2d
supersedes Section 2c rows where they disagree, and Section 1 plus the Sources block remain
unchanged by it. Re-verified a fourth time 2026-10-01 07:25 UTC (same commit, same uncommitted
working tree, which was being edited while the check ran): Section 2e supersedes Section 2d rows
where they disagree, and Section 1 plus the Sources block remain unchanged by it. Re-verified a
fifth time 2026-10-01 09:38 UTC (same commit, same branch, same uncommitted working tree, which had
grown to 870 `git status` entries and was again being edited while the check ran): Section 2f
supersedes Section 2e rows where they disagree, and Section 1 plus the Sources block remain
unchanged by it. Section 2f is the first pass to read the live database rather than the source tree.
Re-verified a sixth time 2026-10-07 18:18 UTC (commit `f39dc9e`, branch `wip-secure-20261007`, running build `3f20c479` which is 18 commits behind the tree): Section 2g is a local-evidence re-verification and supersedes Section 2f rows where they disagree, and Section 1 plus the Sources block remain unchanged by it. Section 2g is the first pass to read the running build's own identity artifact and the voice runtime's append-only trace log.
Re-verified a seventh time 2026-10-07 21:15 UTC (commit `554fe21`, branch `wip-secure-20261007`, HEAD moving inside the pass and the running build 47 commits behind): Section 2h is a local-evidence re-verification and supersedes Section 2g rows where they disagree, and Section 1 plus the Sources block remain unchanged by it. Section 2h is the first pass to check the booted process's liveness, to read the side stores the earlier passes used, and to trace the security subprogram's commits against the deployed bundle.
Scope: external state of the art (cited) + AgenticOS local position (repo evidence) + sequenced roadmap with effort / time-to-revenue / dependencies / first action.

Evidence grading used below: `[n]` = cited source (ledger, Sources block at end). `†` = vendor- or self-reported figure, not independently measured. `repo:` = claim verified against files in this repository.

---

## 1. State of the art, condensed

**1.1 The topology question is settled; the adaptivity question is not.** The 2026 surveys converge on a three-topology taxonomy — centralized (supervisor/orchestrator), decentralized (peer/swarm), hierarchical (layered delegation) — each with an optional dynamic-adaptive control axis, and production practice adds the graph-based state machine as a fourth, deterministic shape.[7][1][18] A vendor research report over 350+ papers and 120 enterprise deployments reports the production split as supervisor 38%, pipeline 26%, hierarchical 22%, swarm 14%†.[8] The consistent engineering reading: supervisor first, hierarchical only when the single coordinator becomes a bottleneck, swarm only when convergence is provable.[8][1]

**1.2 The protocol layer ossified in 2025-2026.** MCP (agent-to-tool) and A2A (agent-to-agent) are complementary, not competing: MCP defines how agents reach tools and data, A2A defines peer discovery, delegation, negotiation and task lifecycle across ownership boundaries.[1][3] A2A shipped a 1.0 specification with signed Agent Cards, is hosted by the Linux Foundation, reports 150+ supporting organizations and native integration into Azure AI Foundry / Copilot Studio and Amazon Bedrock AgentCore, and has a payments extension (AP2) with 60+ backers.[3] The necessary skeptic's correction: "supported by" is not "in production"; the durable advice is MCP first, A2A only when agent boundaries become real deployment, ownership or trust constraints.[17]

**1.3 Framework consolidation, three families.** Graph-based (LangGraph, AutoGen v0.4), role-based (CrewAI, OpenAI Agents SDK), durable-execution (Temporal, Inngest, Mastra, Letta); the family choice is upstream of the framework choice and should follow the maturity stage — task automation, then multisystem processes, then function-level transformation.[9][7] Framework adoption in production is reported as LangGraph 41%, AutoGen 28%, CrewAI 19%, Claude Agent SDK 12%†.[8] Counterweight from the primary vendor literature: the most successful implementations use simple composable patterns and deliberately shed abstraction layers in production, because frameworks obscure prompts and responses and make debugging harder.[5]

**1.4 Reliability, not capability, is the binding constraint.** MAST is the reference failure taxonomy: 14 failure modes in 3 categories (system design, inter-agent misalignment, task verification), derived from 150+ hand-annotated traces and then scaled to 1642 annotated traces across 7 frameworks; the authors' own conclusion is that protocol-level fixes are insufficient for inter-agent misalignment, which needs better contextual/social reasoning, and that weak verification mechanisms are a major contributor to failure.[2] Downstream work citing failure rates up to 86.7% attributes them to error propagation through dependency chains, where the step that manifests the error is often not the step that introduced it.[10] Structured comparison: independent peer-to-peer agents amplify errors ~17.2x versus ~4.4x under centralized coordination.[18] MAS-vs-single-agent first-principles work finds that MAS solve tasks SAS cannot, but that the accuracy gap narrows as base models improve, MAS cost/latency stays high, and on simple tasks MAS can *underperform* a single agent through overthinking.[12] Fault-injection study: stronger foundation models do not uniformly improve robustness.[11] Mitigation with measured effect: adding a runtime supervisor agent over agent/agent-tool/agent-memory interaction points cut token cost 35% and variance 63% versus baseline on GAIA Level 2.[19]

**1.5 Observability is the unmet requirement, specifically for orchestration phases.** OpenTelemetry's GenAI semantic conventions cover LLM invocation and tool execution but leave five agent orchestration phases — planning, reasoning, safety monitoring, inter-agent delegation, memory management — without span-level representation; the AgentTelemetry benchmark reports fault-detection rate 1.000 with a nine-span-kind taxonomy versus 0.429 for vanilla OTel/OTel+GenAI, and finds 84/112 failed SWE-bench Lite runs were reasoning loops that vanilla OTel cannot see.[6]

**1.6 Context engineering is the discipline that replaced prompt engineering.** Compaction, tool-result clearing, external/persistent memory, and sub-agent context isolation are now first-party API features, and the failure they address is "context rot" — recall degrading as the window fills.[13][14] Isolation is the highest-leverage lever because it prevents the mess rather than repairing it after the window fills; compaction is lossy and preserves errors as faithfully as facts, so it is a last resort.[14][13]

**1.7 Evaluation must measure consistency, not peak capability.** SWE-bench grades a verifiable artifact, GAIA grades long-horizon tool chaining, τ-bench grades policy adherence across multi-turn tool use and reports pass^k — success across *all* k trials — where state-of-the-art function-calling agents fall below 25% at pass^8 in retail while single-run scores sit in the low-to-mid 60s.[16] Gaia2 extends this to asynchronous environments with an explicit agent-to-agent collaboration split; no frontier model dominates (GPT-5 high: 42% pass@1) and weaker models benefit most from A2A-style collaboration, which is itself a finding about where interop pays.[15] τ-bench has since moved to multimodal and full-duplex voice evaluation.[20]

**1.8 The enterprise reality check.** Gartner is cited projecting that 40% of agentic AI projects will be canceled by end of 2027, with a September 2025 Gartner survey of 360 IT application leaders finding only 13% strongly agreeing they had the right governance in place; the four cited causes are process, data and technical debt plus cultural resistance, none of which a framework fixes.[9] Executive confidence is reported to have fallen from 43% to 22% in a year, and 88% of current deployments are reported to still require human-in-the-loop oversight†.[8]

---

## 2. AgenticOS local position (repo evidence)

| Dimension | Local state | Evidence |
|---|---|---|
| Topology | Centralized supervisor with a deterministic front door: `turnRouter` → `controlIntent` → entity resolvers → `groundedTurnBridge` → `semanticGoalParser` (`splitCompoundGoal` on "and"/"then"/"also") → `universalExecutionController` → executors, with LLM fallthrough in `supervisorLoop` + `domains/hermes` | `CURRENT_ARCHITECTURE.md` §2, §3C, §4 |
| Framework posture | No external orchestration framework: no LangGraph, CrewAI, AutoGen, OpenAI Agents SDK, DSPy in root or server `package.json`; orchestration is hand-rolled | `package.json`, `server/package.json` |
| Protocol layer | MCP only, and it is architecturally sound: MCP server is a thin STDIO client of the backend service, every mutating decision (approval, submission, cancellation) resolves against canonical backend state, approvals/expiry are authoritative server-side (`mcp_prepared_tasks`) | `server/src/services/mcpBridge/mcpBridgeService.ts`, `server/src/routers/mcpBridge.ts` |
| A2A | Absent — zero protocol references in `src/`, `server/src/`, `electron/` | grep, 2026-09-20 |
| Observability | Local logs (`server.log`), Jest/e2e traces; no OpenTelemetry dependency, no `span_kind`/`trace_id` instrumentation of planning, delegation, memory or verification phases | grep for `opentelemetry`, `span_kind`, `trace_id` |
| Evaluation | `evaluationRouter` + `evalCli` exist; no repeated-trial reliability metric (pass^k-style) present | `server/src/routers/evaluation.ts`, `server/src/evalCli.ts` |
| Revenue surfaces (where time-to-revenue is measured) | Revenue operator + supervisor, leads store, Stripe, Shopify channel verification, FreeCash monitor routines | `server/src/routers/revenue*.ts`, `docs/revenue-engine-*.md`, `docs/shopify-channel-verification-2026-09-20.md`, `docs/free-cash-monitor-routine/` |

**Read of the local position.** AgenticOS already sits on the architecture the external literature recommends for its stage (centralized supervisor + deterministic control flow + MCP for tool access), and its MCP bridge avoids the most common MCP failure — letting the client assert authority.[5][8][17] Its three real gaps against the 2026 state of the art are, in impact order: (1) no phase-level telemetry, so failures in planning/delegation/verification are invisible by construction[6][2]; (2) no consistency metric, so "it worked when I tried it" remains the acceptance standard[16]; (3) no context budget or isolation strategy, so long voice sessions degrade by context rot[13][14]. Dependency-heavy multi-step revenue/monitoring workflows also have no compensating-action (saga) semantics, which is the failure class that dominates reported production incidents.[8]

---
 
## 2b. Re-verification 2026-09-30 (control-plane era) — supersedes Section 2 rows where they disagree

Between 2026-09-20 and 2026-09-30 the repository gained the `controlPlane` domain
(first commits 2026-09-27, latest committed 2026-09-28 `8f7463a`; every file below is
additionally uncommitted-modified as of 2026-09-30). 30 TypeScript files, 11,625 lines
total. Commands used: `ls server/src/domains/controlPlane/*.ts | wc -l`,
`wc -l server/src/domains/controlPlane/*.ts`, `grep -rniE "<pattern>" server/src/`.
All rows below are local tool output; no external citation applies.

| Dimension | Verdict at 2026-09-30 | Evidence |
|---|---|---|
| Topology | Supervisor **plus a worker pool**: `ControlPlaneTurnHandler` (1,628 lines) drives UNDERSTAND → ACKNOWLEDGE → durable GoalRun → Argus preflight → PLAN → discover capabilities → EXECUTE → observe real state → independent verification → claim guard, with recovery, alternative-strategy retry, and engineering self-heal | `ControlPlaneTurnHandler.ts:1-36` |
| Named agents | Four workers with distinct authority, not prompt personas: Hermes (diagnostic supervisor), Codex (primary engineering worker), Argus (preflight inspector + independent reviewer), AntiGravity (IDE adapter); `resolvePreferredWorker()` prefers AntiGravity for substantial repairs, Codex fallback | `EngineeringWorkerRegistry.ts:19-24`, `:823-833` |
| Independent verification | Present, 16 verified surfaces (internal, taskbar, process, executable, start_menu, app_user_model_id, desktop, browser, filesystem, shell, camera, location, desktop_observe, browser_observe, screenshot, learned); header explicitly refuses to equate "tool reported success" with "task completed" | `UniversalVerifier.ts:1-8`, `:62-104` (788 lines) |
| Claim guard | Present, 7 claim types gated on real system evidence (CHECKING, OPENING, DELEGATING, EXECUTING, COMPLETED, VERIFIED, PERCEIVED) | `ActionClaimGuard.ts:1-47` (274 lines) |
| Durable state | `goal_runs` (JSON `timeline`) + `repair_knowledge` tables; active goals restored as `RECOVERABLE` after backend restart; statuses include `FAILED_EXHAUSTED`, `CANCELLED` | `controlPlane/schema.ts:3-26`, `GoalLifecycle.ts:287-314`, `types.ts:90-96` |
| Worker-level telemetry | Partial: `engineering_worker_sessions` + `engineering_execution_events` persist a 22-value `EngineeringEventType` stream (COMMAND_STARTED/OUTPUT/FAILED, TEST_PASSED/FAILED, BUILD_*, DEPLOY_*, ARGUS_VERIFYING, …) with heartbeat snapshots; events carry `goalId`/`runId`/`taskId`, so worker→goal correlation exists at the record level | `EngineeringWorkerRegistry.ts:39-77, 274-299, 493` |
| Phase-level spans | Still absent: `grep -rniE "spanKind\|span_kind\|phase.*(start\|end).*event" server/src/` → 0; `trace_id\|traceId` in `controlPlane/` → 0; parent-span field → 0; `durationMs` appears only in `AutonomousCapabilityCertificationRunner.ts` (9 matches). The stream is worker-scoped, not planning/delegation/memory-phase scoped | 0 matches |
| OpenTelemetry | Still absent: `grep -rniE "opentelemetry\|otlp\|traceparent\|span_kind" src/ server/src/ electron/` → 0 | 0 matches |
| A2A | Still absent: `grep -rniE "\ba2a\b" src/ server/src/ electron/` → 0 | 0 matches |
| External orchestration framework | Still absent: `grep -niE "langgraph\|langchain\|crewai\|autogen\|agents-sdk\|dspy\|llamaindex\|temporal\|inngest\|mastra\|letta" package.json server/package.json` → 0 | 0 matches |
| MCP | Unchanged and present | `services/mcpBridge/mcpBridgeService.ts`, `routers/mcpBridge.ts`, 30 matches in `server/src/` |
| Consistency metric | Still absent: `grep -rniE "pass\^\|pass_k\|passk" src/ server/src/` → 1 match, false positive (`bypass_kyc`, `jarvisNext/operator/executionPolicy.ts:43`) | 1 FP |
| Saga / compensating actions | Partly answered for engineering work (durable GoalRun + `RECOVERABLE` restore + self-heal re-runs the original goal); unanswered for revenue/monitoring: `grep -rniE "goalLifecycle\|ControlPlaneTurnHandler" routers/revenue.ts routers/revenueEngine.ts` → 0, i.e. money-touching routines do not run through the goal lifecycle | 0 matches |

**Effect on the roadmap order.** Gaps 1 (phase-level telemetry) and 2 (consistency
metric) survive unchanged, and gap 1 gets sharper: the worker pool adds a topology to
observe. The saga gap is now split — covered inside the goal lifecycle, uncovered for
the revenue/monitoring workflows that touch money. The gap the control plane itself
introduces is cross-worker traceability: four worker identities, one event table,
`goalId` correlation but no parent-span hierarchy and no per-phase duration, so
"which worker's step produced this failure, and how long did each phase take" is still
not answerable from stored data alone.

---

## 2c. Re-verification 2026-10-01 (worker fleet and team runtime) — supersedes Section 2b rows where they disagree

Same commit as Section 2b (`8f7463a`, 2026-09-28) and the same uncommitted working tree.
The Section 2b rows were re-run and still hold, but Section 2b under-counted the worker
fleet and omitted three orchestration subsystems that already existed when it was written.
Commands used: `wc -l`, `ls`, `grep -rniE "<pattern>" <dir>`, `git status --porcelain`,
`find <dirs> -type f -newermt "2026-09-30 20:56"`. All rows below are local tool output;
no external citation applies.

| Dimension | Verdict at 2026-10-01 | Evidence |
|---|---|---|
| Section 2b rows re-run | Unchanged: control plane still 30 files / 11,625 lines; `opentelemetry\|otlp\|traceparent\|span_kind\|spanKind` in `src/ server/src/ electron/` → 0; `\ba2a\b` → 0; framework list in `package.json` + `server/package.json` → 0; `pass\^\|pass_k\|passk` → 1 (same `bypass_kyc` false positive); MCP references in `server/src/` → 30 | grep counts; `wc -l server/src/domains/controlPlane/*.ts` |
| Worker fleet — supersedes "Four workers with distinct authority" | Seven adapters, not four: codex, deepseekHarness, hermes, magnitude, agentTeams + the `hermesCapability` registry + `index.ts` — 7 files, 1,371 lines; `agentTeams\|agent_teams` across `server/src/` → 153 matches | `wc -l server/src/domains/workerAdapters/*.ts`; `ls server/src/domains/workerAdapters/` |
| Team runtime — omitted from Section 2b | A second coordination path, LLM-planned rather than deterministic: `CoordinatorService.generateTeamSheet` designs the team, `teamRunner` executes the sequence, `verificationAdjudicator` adjudicates, `recovery` + `repairRouting` handle failure; durable state in `teams`, `team_runs`, `agent_team_handoffs`, `agent_team_artifacts`, `verification_reports` | `server/src/domains/teams/` (3 files, 587 lines), `server/src/services/agentTeams/` (5 files, 1,094 lines), `server/src/db/schema.ts:591-660` |
| Artifact-level verification | Handoffs persist `artifacts` as `{path, checksum, checksumAlgorithm, size, producedBy}`; `agent_team_artifacts` enforces a unique `(runId, path, checksum)` index plus a `verified_at` stamp; `verification_reports` stores per-check results and a `verifier_id` | `server/src/db/schema.ts:618-660` |
| Repair budget | One cycle by design: `teamRuns.repairCount` default 0, commented "Max 1 repair cycle"; `team_runs.status` ∈ pending/running/paused/completed/failed; HTTP surface is preview/start/pause/resume/events/handoffs/artifacts/reports | `server/src/db/schema.ts:601-616`, `server/src/routers/teams.ts` |
| Local worker subsystem — omitted from Section 2b | Separate planner/manager/tool-bridge runtime with its own abort-controller lifecycle and store: 6 files, 1,511 lines | `server/src/domains/localWorker/` |
| Workspace isolation | Present for coding runs: `git worktree add` into a disposable worktree outside the repo, detached-safe (added by branch), cleanup never touches the parent; 234 `worktree` references across `server/src/` | `server/src/domains/codingRuntime/gitWorktree.ts` (198 lines) |
| Phase telemetry across the fleet | Still zero: `trace_id\|traceId\|span_kind\|spanKind\|otlp` → 0 in `workerAdapters/`, `domains/teams/`, `services/agentTeams/`, `localWorker/`, `codingRuntime/`; `durationMs` in `services/agentTeams/` + `domains/teams/` → 2 | 0 / 2 matches |
| MCP protocol surface | The wire-level MCP server is not in this repository: `tools/list\|tools/call` in `server/src/` → 0, and `modelcontextprotocol` in either `package.json` → 0. What lives here is the backend-authority bridge, which reuses `projectsStore`, `projectTaskService`, `executionRunService`, `verificationService`, `workerAdapters` and `actionClassifier` rather than duplicating them | 0 matches; header of `services/mcpBridge/mcpBridgeService.ts` |
| Consistency metric | Still absent: `pass\^\|pass_k\|passk` → 0 in `server/src/routers/evaluation.ts` (106 lines) | 0 matches |
| Test surface | 209 test files in `server/src/__tests__/`, 27 orchestration-scoped (team, delegation, worker, control plane, goal, verification) | `ls server/src/__tests__/ \| grep -icE "team\|deleg\|worker\|controlPlane\|goal\|verif\|orchestr"` |

**Effect on the roadmap.** Gap 1 (phase-level telemetry) widens rather than narrows: the
fleet is seven workers over two coordination runtimes plus a planning worker and an
isolated coding runtime, and none of them emit phase spans, so "which worker, which phase,
how long" stays unanswerable from stored data. What Section 2b read as one verification
surface is now three — control plane, team adjudicator, artifact checksums — which raises
the value of gap 2 rather than closing it: the verdict machinery exists and is persisted,
but it is never run N times on the same task, so no consistency number exists. Gap 3
(context budget) is untouched. The team tables are the closest thing in the repository to
the artifact-verification storage the literature asks for, which makes the missing repeated
trial the cheapest of the three gaps to address.

---

## 2d. Re-verification 2026-10-01 07:08 UTC (turn ownership and perception runtime) — supersedes Section 2c rows where they disagree

Same commit (`8f7463a`, 2026-09-28) and the same uncommitted working tree as Section 2c.
Every Section 2c row was re-run: most still hold, two no longer match the tree, one is not
reproducible as written, and a subsystem the earlier pass did not list is now present.
Commands used: `ls | wc -l`, `wc -l`, `grep -rniE "<pattern>" <dir>`, `git status --porcelain`,
`find server/src src electron -type f -newermt "2026-09-30 20:56"`. All rows below are local
tool output; no external citation applies.

| Dimension | Verdict at 2026-10-01 (2d) | Evidence |
|---|---|---|
| Section 2c rows re-run, still clean | controlPlane 30 files / 11,625 lines; `opentelemetry\|otlp\|traceparent\|span_kind\|spanKind` across `src/ server/src/ electron/` → 0; `\ba2a\b` → 0; framework list in `package.json` + `server/package.json` → 0; `pass\^\|pass_k\|passk` → 1 (same `bypass_kyc` false positive); workerAdapters 7 files / 1,371 lines | grep counts; `wc -l` |
| Test surface — supersedes Section 2c's "209 test files" | 211 files in `server/src/__tests__/`; the orchestration-scoped subset is still 27 | `ls server/src/__tests__/ \| wc -l`; `ls server/src/__tests__/ \| grep -icE "team\|deleg\|worker\|controlPlane\|goal\|verif\|orchestr"` |
| Worker-fleet reference count — supersedes Section 2c's "153 matches" | `agentTeams\|agent_teams` across `server/src/` → 155 (uncommitted tree drift) | grep count |
| MCP surface count — Section 2c's "30 matches" is not reproducible as written | pattern-dependent: `mcpBridge\|modelcontextprotocol` → 49; `mcpBridge\|modelcontextprotocol\|mcp_` → 63. The earlier row did not state its pattern, so only the presence claim is reusable | grep counts |
| Turn ownership + operation lifecycle — not in Section 2c | Each dispatched capability registers `conversationId, turnId, operationId, originTurnId, capability` and must end in exactly one of SUCCESS / FAILED / CANCELLED; before any external side effect or publication the operation is re-checked against the conversation's active turn and a stale or cancelled one is refused. `AsyncLocalStorage` carries turn identity to executors whose signatures have no turn, so a superseded turn cannot launch an application, type into a window, or publish. Fail-safe direction is refuse-only: no identity means "cannot prove staleness" and is allowed | `domains/jarvis/perception/turnOwnership.ts:1-25`, `perceptionOperation.ts:1-24`; `domains/jarvis/perception/` 4 files / 1,121 lines |
| Perception runtime — not in Section 2c | `services/perception/` 4 files / 1,446 lines (camera, desktop, foreground-screen reader, location); `foregroundScreenReader.ts` reads the active foreground window only, never launches or focuses anything, and returns an explicit terminal failure instead of fabricating when it has no evidence | `wc -l server/src/services/perception/*.ts`; `foregroundScreenReader.ts:1-30` |
| Regression coverage for the new subsystem | 5 new test files, 2,019 lines: `foregroundScreenRead` 748, `perceptionContinuity` 437, `turnOwnershipEnforcement` 359, `quietRecoveryRouting` 234, `voicePipelineRegression` 241 | `wc -l server/src/__tests__/<file>` |
| Phase telemetry in the new subsystem | Still zero: `trace_id\|traceId\|span_kind\|spanKind\|otlp\|durationMs` across `domains/jarvis/perception/`, `services/perception/`, `foregroundScreenIntent.ts`, `projectStateContext.ts` → 0; same pattern across `workerAdapters/ teams/ services/agentTeams/ localWorker/ codingRuntime/` → 0, `durationMs` in `teams/` + `services/agentTeams/` → 2 | 0 / 2 matches |
| Lifecycle outcome persistence | The operation registry is in-process: `perceptionOperation\|turnOwnership` referenced from `server/src/db/` and `domains/controlPlane/` → 0, so operation outcomes are not queryable after restart | 0 matches |
| Consistency metric | Still absent: `pass\^\|pass_k\|passk` in `routers/evaluation.ts` (106 lines) → 0 | 0 matches |

**Effect on the roadmap.** Gap 1 (phase-level telemetry) is unchanged in size and now covers
one more subsystem: turn ownership decides whether work may proceed and writes nothing, so the
most informative event in the system — a refused side effect — leaves no queryable record; the
new subsystem also has a named lifecycle (ACCEPTED/RUNNING/SUCCESS/FAILED/CANCELLED) that is an
obvious first span source but emits none. Gap 2 (consistency metric) is unchanged. The new
subsystem does move one long-standing item: cancellation/supersession now has an explicit,
fail-safe implementation for the turn and executor path, backed by 5 test files — but it is
turn-scoped and in-process, so it does not cover the engineering workers, the team runtime, or
the revenue and monitoring routines. Net: Option A keeps its size and gets a better-defined
first target; the second coordination runtime that Section 2c identified remains the one that
would benefit most from it.

---

## 2e. Re-verification 2026-10-01 07:25 UTC (turn-ownership gating reaches the control plane) — supersedes Section 2d rows where they disagree

Same commit (`8f7463a`, 2026-09-28), same branch (`hermes-rescue-20260908`), same uncommitted
working tree, which now holds 868 `git status --porcelain` entries. Section 2d was written 17
minutes before this snapshot and its rows are already stale, because the tree was being edited
while the check ran: 22 files under `server/src/` + `src/` were modified in the 30 minutes before
the snapshot, the newest at 07:24 UTC (one minute earlier), including
`perceptionOperation.ts`, `turnOwnership.ts`, `ControlPlaneExecutor.ts`, `backgroundOwnership.test.ts`
and `selfHealHiddenTabRecovery.test.ts`. Commands used: `date -u`, `git rev-parse HEAD`,
`wc -l`, `ls | wc -l`, `grep -rniE "<pattern>" <dir>`, `find <dirs> -type f -newermt`.
All rows below are local tool output; no external citation applies.

| Dimension | Verdict at 2026-10-01 (2e) | Evidence |
|---|---|---|
| Section 2d rows re-run, still clean | `opentelemetry\|otlp\|traceparent\|span_kind\|spanKind` across `src/ server/src/ electron/` → 0; `\ba2a\b` → 0; framework list in `package.json` + `server/package.json` → 0; `pass\^\|pass_k\|passk` across `src/ server/src/` → 1 (same `bypass_kyc` false positive); workerAdapters 7 files / 1,371 lines; `agentTeams\|agent_teams` across `server/src/` → 155; `mcpBridge\|modelcontextprotocol` → 49; orchestration-scoped test subset 27; `pass\^\|pass_k\|passk` in `routers/evaluation.ts` (106 lines) → 0 | grep counts; `wc -l`; `ls server/src/__tests__/ \| wc -l` |
| Control-plane size — supersedes Section 2d's "30 files / 11,625 lines" | 30 files / 11,654 lines; `ControlPlaneTurnHandler.ts` is still 1,628 and `UniversalVerifier.ts` still 788, so the +29 lines are elsewhere in the domain | `wc -l server/src/domains/controlPlane/*.ts` |
| Test surface — supersedes Section 2d's "211 files" | 212 files in `server/src/__tests__/`; the orchestration-scoped subset is unchanged at 27 | `ls \| wc -l`; `grep -icE "team\|deleg\|worker\|controlPlane\|goal\|verif\|orchestr"` |
| Turn-ownership reach — supersedes Section 2d's scope claim that it is "turn-scoped and in-process" and does not cover the engineering workers | `assertSideEffectOwnership` now has 18 references in 5 files: the definition (`perception/turnOwnership.ts:99`) plus gates at `controlPlane/ControlPlaneExecutor.ts:222`, `jarvis/execution/executors/browserExecutor.ts:87,1716`, `desktopExecutor.ts:396,545,604,738,794,869,1001`, `terminalExecutor.ts:50`, and `services/browser/browserOperator.ts:575`. The gate is no longer confined to the Jarvis turn/executor path: a capability dispatched through the control-plane executor (the path that drives the worker fleet) is refused when its originating turn is stale, and `browserOperator` gates independently of `browserExecutor` | `grep -rn "assertSideEffectOwnership" server/src/` → 18 |
| Perception runtime — supersedes Section 2d's "4 files / 1,121 lines" | Same 4 files, 1,372 lines: `perceptionOperation.ts` 585, `perceptionIntent.ts` 401, `perceptionFocus.ts` 248, `turnOwnership.ts` 138 — two of the four were still being written during this check | `wc -l server/src/domains/jarvis/perception/*.ts` |
| Phase telemetry across the fleet — supersedes Section 2d's "0, `durationMs` → 2" | 8 `durationMs` matches, not 2: `workerAdapters/magnitudeAdapter.ts:126`, `teams/coordinatorService.ts:108,208`, `localWorker/toolRegistryBridge.ts:395,397`, `codingRuntime/codexRuntimeAdapter.ts:107,135`, `codingRuntime/service.ts:218`. `trace_id\|traceId\|span_kind\|spanKind\|otlp` → 0 in all those directories, and no parent-span field anywhere | grep |
| Operation-outcome persistence — supersedes Section 2d's "0" | 1 match across `db/` + `controlPlane/`: `ControlPlaneExecutor.ts:19` imports the ownership gate. The gate is now called outside the Jarvis domain, but the registry is still in-process — nothing in `server/src/db/` references `perceptionOperation\|turnOwnership`, so operation outcomes remain unqueryable after restart | grep counts |
| Guarding behavior — direction unchanged, reach wider | `assertSideEffectOwnership` is a pre-side-effect gate (called before navigation, launch, kill, foreground-focus, desktop automation, terminal and control-plane execution), not a post-hoc log; fail-safe remains refuse-only-when-identity-proves-staleness | `ControlPlaneExecutor.ts:222`; `turnOwnership.ts:99` |
| Regression coverage for the subsystem — supersedes Section 2d's "5 files / 2,019 lines" | 7 files / 2,510 lines: `foregroundScreenRead` 748, `perceptionContinuity` 437, `turnOwnershipEnforcement` 377 (was 359), `backgroundOwnership` 334 (new), `voicePipelineRegression` 241, `quietRecoveryRouting` 234, `selfHealHiddenTabRecovery` 139 (new) | `wc -l server/src/__tests__/<file>` |

**Effect on the roadmap.** Gap 1 (phase-level telemetry) is unchanged in size and gains a sharper
example: turn ownership is now consulted by the control-plane executor, the code path that
dispatches the worker fleet, yet a refusal still writes nothing queryable — the moment the second
coordination runtime most needs a record is the moment it produces none. Gap 2 (consistency
metric) is untouched. The item that moved is cancellation/supersession: it was already
turn-scoped and in-process, and it now covers the control plane and the browser operator as well
as the chat executors, which raises the cost of the alternative (duplicating the gate per runtime)
and lowers the cost of Option A, because the per-operation lifecycle that needs a span now exists
in one place for two runtimes. The caveat this pass adds is about the artifact rather than the
system: three re-verification passes inside 20 minutes produced three different sets of numbers,
so any row in this document is only valid with its snapshot time and commit quoted, and Section 2e
rows should be read as perishable rather than as current state.

---

## 2f. Re-verification 2026-10-01 09:38 UTC (live data layer; two subsystems Section 2e omitted) — supersedes Section 2e rows where they disagree

Same commit (`8f7463a`, 2026-09-28), same branch (`hermes-rescue-20260908`), same uncommitted
working tree, now at 870 `git status --porcelain` entries (Section 2e: 868). The Section 2e commands
were re-run and hold except where noted, and this pass adds an evidence class no earlier pass used:
read-only queries against the live canonical database —
`C:/Users/cd-pr/AppData/Roaming/agenticos/data/agentic-os.db` (211 MB, WAL, being written during the
check; `$APPDATA/agenticos/data`, the `AGENTICOS_DATA_DIR` default resolved at
`server/src/db/index.ts:19-36`. The two in-repo `database.sqlite` files are 0 bytes and are not the
live database.) Commands: `wc -l`, `ls | wc -l`, `grep -rniE "<pattern>" <dirs>`,
`git status --porcelain`, `find <dirs> -type f -newermt "2026-10-01 07:25"`, `stat -c '%n %y %w'`,
and `node -e` with `better-sqlite3` opened `{readonly:true}` (queries only; no writes). All rows
below are local tool output; no external citation applies.

| Dimension | Verdict at 2026-10-01 (2f) | Evidence |
|---|---|---|
| Section 2e rows re-run, still clean | `opentelemetry\|otlp\|traceparent\|span_kind\|spanKind` across `src/ server/src/ electron/` → 0; `\ba2a\b` → 0; framework list in `package.json` + `server/package.json` → 0; `pass\^\|pass_k\|passk` across `src/ server/src/` → 1 (same `bypass_kyc` false positive); controlPlane 30 files / 11,654 lines; workerAdapters 7 files / 1,371 lines; `agentTeams\|agent_teams` → 155; `mcpBridge\|modelcontextprotocol` → 49; test files 212; orchestration-scoped subset 27; `assertSideEffectOwnership` → 18; `durationMs` across the five fleet dirs → 8 | grep counts; `wc -l` |
| Perception runtime — supersedes Section 2e's "4 files / 1,372 lines" | 4 files / 1,387 lines: `perceptionOperation.ts` 600 (was 585), `perceptionIntent.ts` 401, `perceptionFocus.ts` 248, `turnOwnership.ts` 138 | `wc -l server/src/domains/jarvis/perception/*.ts` |
| Regression coverage — supersedes Section 2e's "7 files / 2,510 lines" | 7 files / 2,573 lines: `foregroundScreenRead` 748, `perceptionContinuity` 437, `backgroundOwnership` 394 (was 334), `turnOwnershipEnforcement` 377, `voicePipelineRegression` 241, `quietRecoveryRouting` 234, `selfHealHiddenTabRecovery` 142 (was 139) | `wc -l server/src/__tests__/<file>` |
| **Canonical turn execution service — omitted by Sections 2d and 2e** | `domains/jarvis/canonicalTurnExecutionService.ts`, 903 lines, untracked, created 2026-10-01 09:13:36 CEST — 12 minutes before the Section 2e snapshot, which did not list it. It is the single execution service for desktop UI, voice and Telegram, and it is live: 5 call sites plus one test across 7 files. `routers/jarvis.ts:2943-2978` calls it as the "Authoritative Ingress Gate" with fall-through to `intentRouter` on error; `ControlPlaneTurnHandler.ts:165-199` routes turns through it; `adapters/telegramAdapter.ts:664-672` and `jarvis/orchestrator.ts:171` import it | `stat -c '%w'`; `grep -rn` → 7 files |
| **Self-heal runtime — omitted by Sections 2b-2e** | `domains/selfHeal/`, 20 files / 4,943 lines: `SelfHealSupervisor` 1,015, `IncidentReconciler` 365, `SnapshotManager` 333, `TraceCollector` 298, `RepairDiagnostician` 266, `RepairTestRunner` 240, `RepairVerifier` 192, `RepairMemory` 159, `schema` 144, `FailureDetector` 132, `DeploymentGate` 108, `RepairPlanner` 97, `RepairExecutor` 93, plus index, incidentLifecycle, types, two run-scripts and acceptance tests. Wired, not dormant: `/api/self-heal` mounted and `selfHealSupervisor.initialize()` invoked (`index.ts:283-284, 425, 456-457`); `repair_incidents.goal_id` migrated at startup (`db/index.ts:240-244`) | `find`/`wc -l`; `grep -n selfHeal server/src/index.ts` |
| Other untracked subsystems no section lists | `jarvisV2/` 13 files / 2,389 lines (`/api/jarvis-v2` mounted, `index.ts:335-336`); `services/browser/` 6 / 6,281; `services/revenueOperator/browser/` 21 / 5,649; `adapters/` 9 / 2,437 (telegram, freecashMonitor, paidlikes); `workflows/lead-research/` 14 / 1,019; `services/prerequisites/` 3 / 605; `services/navigation/` 1 / 222; `jarvis/` `actionRuntime`, `dialogueState`, `entityResolver`, `behavioralHealth` | `find`/`wc -l`; `git status --porcelain` |
| **Team runtime has never executed** | Live DB: `teams` 0, `team_runs` 0, `agent_team_handoffs` 0, `agent_team_artifacts` 0, `verification_reports` 0 rows. Section 2c called this second coordination runtime the one that would benefit most from Options A and B; at the data layer it has no runs at all | readonly `select count(*)` per table |
| Coding runtime has never executed | `coding_runs` 0 rows, against Section 2c's "workspace isolation present for coding runs" — the code exists, no run has been recorded | readonly count |
| Live coordination is the goal lifecycle | `goal_runs` 1,064 (COMPLETED 965, RECOVERABLE 90, FAILED_EXHAUSTED 9); `engineering_worker_sessions` 93; `engineering_execution_events` 5,309 rows over a mix of FILE_READ 1,759, COMMAND_STARTED 979, COMMAND_OUTPUT 950, FILE_SEARCH 620, FILE_EDITED 372, WORKER_ACCEPTED 162, COMMAND_FAILED 162, WORKER_DONE 107, REPOSITORY_OPENED 100, BUILD_STARTED 83. Columns carry `task_id`, `goal_id`, `worker_id`, `run_id`, `timestamp`, `event_type`: worker→goal correlation exists at row level, phase semantics do not | readonly counts and `group by` |
| Self-heal volume versus closure | `repair_incidents` 338, `repair_evidence` 250,214, `repair_diagnoses` 87 (confirmed 72, needs_more_evidence 14, inconclusive 1), `repair_knowledge` 989, **`repair_attempts` 0**. Incident status distribution: SUPERSEDED 185, STALE 109, DIAGNOSING 27, WAITING_EXTERNAL 17; 311 of 338 carry a `resolved_at`; 66 diagnoses are flagged `requires_human_approval`. No incident has been detected today (latest 2026-09-30T18:27:50Z) yet evidence rows were still being written at 2026-10-01T09:18:23Z | readonly counts, `group by status`, `max(timestamp)` |
| **Phase telemetry absent at the data layer, not only in the source** | 0 of 110 live tables match `trace` or `span` in their name; no `trace_id`, `span_kind` or parent-span column exists anywhere in the schema the runtime actually writes to | readonly `sqlite_master` query |
| Operation/turn-ownership registry still in-process | No `operation`, `ownership`, `turn` or `perception` table among the 110; the conversational tables are `conversations` 733, `conversation_messages` 8,569, `jarvis_conversation_languages`, `coding_runs` 0, `active_operational_goals` 3 | readonly `sqlite_master` query |

**Effect on the roadmap.** Two of the three standing gaps are now confirmed at the data layer rather
than inferred from the source tree: there is no span or trace storage in a 110-table database, and
the incidents the system writes are closed by supersession or staleness (185 + 109) with zero
recorded repair attempts, so no repair in this system has a measured outcome. That second finding is
the same defect as gap 2 (no consistency metric) in a subsystem that already has incident identity,
component, failure domain, status transitions and a lifecycle — which means Options A and B both have
a better first target than Section 2e proposed: the self-heal pipeline already produces the events a
span would carry, and its 338 incidents are a ready-made task set for a pass^k measurement. It also
demotes the team runtime: with 0 runs it cannot be where telemetry pays off first, and Section 2c's
"closest thing to artifact-verification storage" is true of the schema and not of the practice. The
live split of 1,064 goal runs against 5,309 worker events is where coordination cost actually sits,
and therefore where the first four-fifths of Option A's value is. The Section 2e artifact caveat
applies and cuts harder: five passes in thirteen hours produced five different sets of numbers, the
tree was modified under this check as well (`perceptionOperation.ts`, `browserOperator.ts` and two
test files after 09:25 CEST), and every row above is valid only with its snapshot time and commit.

---

## 2g. Re-verification 2026-10-07 18:18 UTC (repo committed; turn lifecycle persisted; running build 18 commits behind) — supersedes Section 2f rows where they disagree

Commit identity moved: HEAD is now `f39dc9e` (2026-10-07 19:44 +0200) on branch `wip-secure-20261007`, 27 commits ahead of the `8f7463a` that Sections 2b-2f are pinned to, and `git status --porcelain` holds 154 entries where Sections 2e/2f recorded 868/870 — the working tree those sections described has since been largely committed. This pass re-ran the earlier commands and adds two evidence classes no earlier pass used: the running build's own identity artifact, and the voice runtime's append-only trace log as a second store. Commands: `date -u`, `git rev-parse HEAD`, `git branch --show-current`, `git log --oneline <sha>..HEAD`, `git status --porcelain | wc -l`, `wc -l`, `ls | wc -l`, `grep -rniE "<pattern>" <dirs>`, `find <dirs> -type f -newermt`, `stat -c`, `cat <build-identity.json>`, `grep -rl <name> <deployed dist> | wc -l`, and `node` with `better-sqlite3` opened `{readonly:true}` (queries only; no writes) against `C:/Users/cd-pr/AppData/Roaming/agenticos/data/agentic-os.db` (420,700,160 bytes, was 211 MB at Section 2f). All rows below are local tool output; no external citation applies.

| Dimension | Verdict at 2026-10-07 (2g) | Evidence |
|---|---|---|
| Commit and branch | `f39dc9e` (2026-10-07 19:44 +0200), branch `wip-secure-20261007`; 27 commits since `8f7463a`; 154 dirty entries and the tree was still being edited during this check | `git rev-parse HEAD`; `git branch --show-current`; `git log --oneline 8f7463a..HEAD \| wc -l`; `git status --porcelain \| wc -l` |
| **Running build is not the tree** — no earlier section checked this | The code actually running is build `3f20c479-dirty-20261006-111926`, git SHA `3f20c479`, packaged, 609 files, dist `C:/Users/cd-pr/AppData/Local/Programs/AgenticOS/resources/server/dist`, booted 2026-10-07T10:44:11Z (pid 20976); the tree builds `f39dc9ea-dirty-20261007-180540` at 623 files. 18 commits are undeployed, so every capability claim in this document must now name which of the two builds it describes | last row of `runtime_boot_identity` (readonly); `server/src/build-identity.json`; deployed `dist/build-identity.json`; `git log --oneline 3f20c479..HEAD \| wc -l` |
| Phase telemetry — supersedes Section 2f's "absent at the data layer, not only in the source" | Still no spans, but the turn path now persists a **stage timeline**: `turn_lifecycle` 1,288 rows and `turn_lifecycle_events` 9,744 rows. Event stages: EXECUTE 1,345, RECEIVED 1,288, VERIFY 1,231, RESPONSE 1,231, OUTCOME 1,231, DONE 1,223, TTS 1,213, UNDERSTAND 440, POLICY 440, GOAL_ACCEPTED 69, SUPERSEDED 33; each row carries `at` plus `detail_json`, so per-phase timestamps are queryable. Span identity is what is still missing: `trace_id\|traceId\|span_kind\|spanKind\|otlp\|opentelemetry` across `src/ server/src/ electron/` gives 3 matches, none instrumentation (`operationalEvidence.ts:22` an optional `executionTraceId` field, `browserPolicyEnforcer.ts:617,626` a `btrace-` UUID), and 0 of 126 tables match `trace` or `span` in their name | readonly counts and `group by stage`; `pragma_table_info`; grep counts; `sqlite_master` |
| Turn/operation registry persistence — supersedes Sections 2d/2e's "in-process, not queryable after restart" and Section 2f's "no operation, ownership, turn or perception table" | **Closed for the conversational path.** `domains/turnLifecycle/` 13 files / 1,941 lines, router mounted at `/api/turn-lifecycle`; `turn_lifecycle` columns include `request_id, source, conversation_id, external_turn_id, stt_confidence, build_id, received_at, stage, goal_json, postcondition_json, policy_json, snapshot_json, receipt_json, verification_json, outcome, outcome_reason, spoken, handler, superseded_by, completed_at, updated_at`; outcomes VERIFIED 1,028, FAILED 183, EXECUTED_UNVERIFIED 20, null 57; 32 turns carry `superseded_by`; 1,231 rows carry both `verification_json` and `receipt_json`. Sources: voice_livekit 1,085, typed_chat 196, voice_text_injection 7. Busiest recorded trace: RECEIVED then UNDERSTAND, POLICY, EXECUTE, VERIFY, OUTCOME, RESPONSE, TTS, DONE | readonly counts and `group by`; `pragma_table_info`; `server/src/index.ts:347`; `ls server/src/domains/turnLifecycle/` |
| Second store, not a database — the append-only runtime trace | `jarvis-runtime-trace.log` 8,825,873 bytes / 127,062 lines, 84 distinct event kinds, last write 2026-10-07T11:20:13Z. It is a de facto phase trace for the voice pipeline (COMMIT_TURN_BEGIN, STT_START and STT_FINAL, TTS_READY, PLAYOUT_STARTED, FIRST_AUDIO, PLAYOUT_ABORT, MIC_STATE_TRANSITION, AUDIO_LEVEL) and it is not queryable, not in SQLite, and carries no span linkage. Writer: `domains/jarvisNext/jarvisNextAgent.ts:56` | `stat -c`; `wc -l`; `grep -oE` piped to `sort \| uniq -c`; `grep -rn` |
| Two clocks | The conversational path is live — `turn_lifecycle` newest `updated_at` 2026-10-07T11:20:07Z, `conversation_messages` newest 2026-10-07T11:20:07Z, `repair_evidence` newest 2026-10-07T11:19:11Z. The engineering worker fleet is not — `engineering_execution_events` newest 2026-10-04T10:22:59Z, `goal_runs` newest 2026-10-06T18:55:58Z. A database-only check at goal or worker level describes a system that stopped three days ago | readonly `max(...)` per store |
| Control plane — supersedes Section 2e's "30 files / 11,654 lines" | 54 files / 20,958 lines, and it grew structure, not only code: `controlPlane/adapters` 10 files / 3,673, `computerUse` 7 / 2,010, `taskGraph` 11 / 1,547, `browser` 6 / 1,123, `artifacts` 2 / 186 | `wc -l server/src/domains/controlPlane/*.ts`; per-subdirectory `find` and `wc -l` |
| Worker fleet — unchanged | `workerAdapters/` still 7 files / 1,371 lines; `services/agentTeams/` still 5 / 1,094; `domains/teams/` still 3 / 587 | `wc -l` |
| Local worker subsystem — supersedes Section 2c's "6 files / 1,511 lines" | 9 files / 2,165 lines | `wc -l server/src/domains/localWorker/*.ts` |
| Self-heal — supersedes Section 2f's "20 files / 4,943 lines" | 21 files / 5,165 lines | `wc -l server/src/domains/selfHeal/*.ts` |
| Subsystems no earlier section lists | `jarvisNext/` 16 files / 8,456 lines (the voice runtime and the second store's writer); `repositoryResearch/` 11 / 781; `magnitude/` 2 / 696; `securitySupervisor/` 5 / 274; `codex/` 1 / 216; `turnLifecycle/` 13 / 1,941 | `find` and `wc -l`; `ls server/src/domains/` |
| `securitySupervisor` is committed but NOT running | 5 tracked files (commits `4e35867`, `cc2e4aa`, `853e220`) and 0 references anywhere in the deployed dist, so on the running build the Windows Job Object boundary does not exist. A deployment gap with a one-line cause, not a missing capability | `git ls-files`; `grep -rl securitySupervisor <deployed dist> \| wc -l` gives 0 |
| Deployed subsystems, for contrast | `turnLifecycle` 17 references, `selfHeal` 28, `jarvisNext` 19, `repositoryResearch` 10, `taskGraph` 7, `turn_lifecycle` 3 in the deployed dist | `grep -rl <name> <dist> \| wc -l` |
| A2A and external framework — unchanged | `\ba2a\b` across `src/ server/src/ electron/` gives 0; the framework list over `package.json` plus `server/package.json` gives 0 | grep counts |
| Consistency metric — unchanged, and now with a measured zero | `pass\^`, `pass_k`, `passk` across `src/ server/src/` gives 1 (the same `bypass_kyc` false positive); `repair_attempts` holds **0 rows** against `repair_incidents` 344, `repair_diagnoses` 88, `repair_knowledge` 998 and `repair_evidence` 451,481. Incident statuses: SUPERSEDED 186, STALE 114, DIAGNOSING 27, WAITING_EXTERNAL 17. No repair here has a recorded attempt, so none has a measured outcome | grep count; readonly `select count(*)` per table and `group by status` |
| Context budget — still absent from production source | `contextBudget`, `context_budget`, `compaction`, `autoCompact`, `tokenBudget` in `server/src/` excluding tests gives 0; the 310 `budget` tokens are repair, recovery and advertising budgets (`RepairBudget`, `RECOVERY_BUDGET_EXHAUSTED`, `advertisingBudget`), not context windows; `contextWindow` or `maxContext` in `server/src/` non-test gives 28; `compaction` across `server/src/` and `src/` gives 23, all inside one Python test and two Jest files | grep counts |
| Team runtime — Section 2f's demotion stands | `teams` 0, `team_runs` 0, `agent_team_handoffs` 0, `agent_team_artifacts` 0, `verification_reports` 0 rows; `coding_runs` 0 | readonly counts |
| Live coordination volume | `goal_runs` 1,163 (COMPLETED 1,007, RECOVERABLE 115, FAILED_EXHAUSTED 31, CANCELLED 10) against `engineering_worker_sessions` 106 and `engineering_execution_events` 5,383; the goal lifecycle remains where coordination cost actually sits. `FAILED_EXHAUSTED` has more than tripled since Section 2f (9 to 31) and `CANCELLED` is new | readonly counts and `group by status` |
| New persistence surfaces | 126 tables, up from 110, and the new ones are orchestration state: `turn_lifecycle`, `turn_lifecycle_events`, `task_graph_journal` (48 rows), `runtime_boot_identity` (129 rows), seven `repository_research_*` tables, `controlled_file_receipts`, `maintenance_change_sets`, `provider_circuit_breakers`, `agent_prompt_versions`, four `evaluation_*` tables, `knowledge_edges`, `memory_candidates`, and `recovery_chains` with `recovery_chain_events` and `recovery_handoffs` | `sqlite_master` name list |
| Ownership gate reach — supersedes Section 2f's 18 | 20 references | `grep -rn "assertSideEffectOwnership" server/src/ \| wc -l` |
| Test surface — supersedes Section 2f's "212 files, 27 orchestration-scoped" | 276 files in `server/src/__tests__/`, of which 34 are orchestration-scoped | `ls server/src/__tests__/ \| wc -l`; `grep -icE "team\|deleg\|worker\|controlPlane\|goal\|verif\|orchestr"` |
| `durationMs` across the five fleet directories — unchanged | 8, in `workerAdapters/magnitudeAdapter.ts`, `teams/coordinatorService.ts`, `localWorker/toolRegistryBridge.ts`, `codingRuntime/codexRuntimeAdapter.ts` and `codingRuntime/service.ts`; `turnLifecycle/` adds 0 | grep count |

**Effect on the roadmap.** Gap 1 (phase-level telemetry) is materially narrowed and still open, and the narrowing is specific: the conversational turn path now writes a persisted, timestamped stage timeline (1,288 turns over 9,744 stage events) with an explicit outcome, a policy record and a receipt, so "which phase failed on this turn" is answerable from stored data for `voice_livekit` and `typed_chat` turns. What stays unanswerable is span identity (no `trace_id`, no `span_kind`, no parent span anywhere in the tree, 0 of 126 tables named for trace or span), coverage of the other two runtimes (1,163 goal runs and 5,383 worker events carry no stage timeline at all), and the voice pipeline's own phase detail, which exists only in an 8.8 MB append-only text log with 84 event kinds and no linkage to the turn record it describes. The cheapest first step is therefore no longer "add a spans table": it is to give `turn_lifecycle_events` a `trace_id` and a parent linkage, extend the same emitter to the goal lifecycle and the worker fleet, and let the append-only voice log feed the same record. Gap 2 (consistency metric) is unchanged in size and stronger as a finding: 344 incidents, 88 diagnoses, 998 knowledge rows and 451,481 evidence rows coexist with **zero** `repair_attempts`, so the subsystem holding the most complete incident lifecycle in the repository has never recorded a repair outcome to measure. Gap 3 (context budget) is untouched. Two rows change the frame rather than the gap list: the running build is 18 commits behind HEAD, with `securitySupervisor` committed and undeployed, so any capability claim in this document must say which build it describes; and the engineering fleet has produced no event since 2026-10-04 while the voice path ran to 2026-10-07, so the two halves of this system are instrumented in different directions and separated by two clocks.

---

## 2h. Re-verification 2026-10-07 21:15 UTC (HEAD moved twice inside the pass; the security subprogram is wired through the tree and absent from the running build; the booted process has exited) — supersedes Section 2g rows where they disagree

Commit identity moved again, and moved twice inside this single pass: `git rev-parse --short HEAD`
returned `c1484d9` at 21:12 UTC and `554fe21` at 21:15 UTC, with the newest commit authored
2026-10-07T23:13:20+02:00 — two minutes before the snapshot — and `git status --porcelain` going
167 → 169 entries. Section 2g is pinned to `f39dc9e`, which is now 20 commits behind HEAD; the
`8f7463a` that Sections 2b-2f are pinned to is 47 behind. Branch is still `wip-secure-20261007`.
Commands: `date -u`, `git rev-parse --short HEAD`, `git merge-base --is-ancestor`,
`git log -1 --format`, `git log --oneline <sha>..HEAD | wc -l`, `git status --porcelain | wc -l`,
`git log --format="%h %cI %s" -S "<string>" -- <file>`, `git ls-files`, `ls | wc -l`, `wc -l`,
`grep -rniE "<pattern>" <dirs>`, `grep -rl <name> <deployed dist> | wc -l`, `stat -c`, `ls -la
--time-style=full-iso`, `find <dir> -type f -newermt`, `cat <build-identity.json>`,
`tasklist`, `netstat -ano`, and `node` with `better-sqlite3` opened `{readonly:true}` (queries only;
no writes) against `C:/Users/cd-pr/AppData/Roaming/agenticos/data/agentic-os.db` (420,700,160 bytes,
unchanged from Section 2g). All rows below are local tool output; no external citation applies.

| Dimension | Verdict at 2026-10-07 (2h) | Evidence |
|---|---|---|
| Commit and branch | `554fe21` (2026-10-07T23:13:20+02:00), branch `wip-secure-20261007`; 20 commits since Section 2g's `f39dc9e`, 47 since `8f7463a`; HEAD changed twice inside this pass (`f39dc9e` → `c1484d9` at 21:12Z → `554fe21` at 21:15Z) and the newest commit landed two minutes before the snapshot, so every row here is pinned to a HEAD that was still moving; 169 dirty entries (2g: 154) | `git rev-parse --short HEAD`; `git log -1 --format`; `git merge-base --is-ancestor c1484d9 HEAD` (true); `git log --oneline f39dc9e..HEAD \| wc -l`; `git status --porcelain \| wc -l` |
| Running build — identity re-read, and the process that recorded it is gone | Deployed build `3f20c479-dirty-20261006-111926` plus three `controlled-file-*` patch suffixes (git SHA `3f20c479`, authored 2026-10-04T21:52:35+02:00), packaged, dist `C:/Users/cd-pr/AppData/Local/Programs/AgenticOS/resources/server/dist`, booted 2026-10-07T10:44:11Z as pid 20976. Pid 20976 is gone, `runtime_boot_identity`'s newest of 129 rows is still the 10:44:11Z one, no image matching `AgenticOS` or `electron` appears in `tasklist` (only `node.exe` helper processes), and `netstat -ano` shows no listener on the application's ports — so the identity this document cites as "the running build" belongs to a process that has exited and was not recorded restarting. Undeployed commits against HEAD: **47** (Section 2g: 18). The deployed `dist` holds 610 files against its own declared `filesCount` 609, which is not an anomaly: `build-identity.json` is excluded from that count by `EXCLUDED_FILE_NAMES` (`server/src/services/buildIdentity.ts:29`), and no file in the bundle is newer than the boot | `cat <deployed dist>/build-identity.json`; last row of `runtime_boot_identity` (readonly); `tasklist`; `netstat -ano`; `find <dist> -type f \| wc -l` → 610; `find <dist> -type f -newermt "2026-10-07 12:44:11" \| wc -l` → 0; `git log --oneline 3f20c479..HEAD` |
| The tree's own build identity is also behind HEAD | `server/src/build-identity.json` is `f0ae9f33-dirty-20261007-190953`, 623 files, built from `f0ae9f33` at 2026-10-07T19:09:53Z — 16 commits behind HEAD at the first snapshot and further behind at the last. Section 2g quoted `f39dc9ea-dirty-20261007-180540` at the same 623 files, so the repo's own build artifact has not tracked the commits either | `cat server/src/build-identity.json`; `git log --oneline f0ae9f33..HEAD \| wc -l` |
| **Security subprogram is wired throughout the tree and absent from every deployed bundle** — supersedes Section 2g's `securitySupervisor` row | `domains/securitySupervisor/` is now 6 tracked files / 755 lines (2g: 5 / 274), adding `approvalIssuer.ts` (`OutOfProcessApprovalIssuer`, `IHumanPresenceProvider`, `IssuerManifestConfig`) and growing `approvalVerifier.ts` to 11,409 bytes; `phase2JobBoundary.ts` contributes `IncarnationJobs`, `ContainedJob` and `PROC_THREAD_ATTRIBUTE_JOB_LIST` behind a `JobLimits` / `JobPlan` / `JobEvidence` contract. It is imported by **21 modules in the tree** — `jarvis/execution/executors/{terminal,desktop,filesystem,git}Executor.ts`, `localWorker/toolRegistryBridge.ts` (`evidenceSource: 'securitySupervisor.approvalGate'`), `controlPlane/AgenticOsGitService.ts` — and the deployed dist contains **none** of its symbols (`OutOfProcessApprovalIssuer` 0, `IncarnationJobs` 0, `PROC_THREAD_ATTRIBUTE_JOB_LIST` 0, `approvalVerifier` 0, `windowsJob` 0, `phase2JobBoundary` 0). Cause in one line: the deployed SHA is from 2026-10-04, while the boundary reached `terminalExecutor` at `41e5696` (2026-10-07T16:37:01+02:00), `toolRegistryBridge` at `02013eb` (22:42:14) and `desktopExecutor` at `fcd2adc` (22:55:14). On the running build the terminal, desktop, filesystem and git executors execute with no approval verification and no Windows Job boundary; on the tree build they do not. This is the sharpest instance in the document of a row that must name its build | `ls -la server/src/domains/securitySupervisor/`; `git ls-files server/src/domains/securitySupervisor/` → 6; `grep -rln securitySupervisor server/src --include="*.ts" \| grep -v domains/securitySupervisor \| wc -l` → 21; `grep -rl <symbol> <dist> \| wc -l` → 0 each; `git log -S "securitySupervisor/windowsJob" -- .../terminalExecutor.ts`; `git log -1 --format=%cI 3f20c479` |
| **Two of the side stores the earlier passes used no longer exist** | `desktop-runtime.json` (the runtime-state file Section 2h's 2026-10-01 draft read for `backendHealthy` / `pid`) and `selfheal-audit.jsonl` (the append-only audit stream that draft counted at 4,780 lines) are both absent from `C:/Users/cd-pr/AppData/Roaming/agenticos/data/`. The only surviving side store is `jarvis-runtime-trace.log`, byte-identical to Section 2g at 8,825,873 bytes with its last write still 2026-10-07T11:20:13Z. `workspace-selection.json` carries mtime 2026-10-07T10:44:15Z, five seconds after the recorded boot, and is consistent with the deployed process having written it once at startup | `ls -la --time-style=full-iso <data dir>`; `stat -c '%s %y'` on the trace log; `read_file` on `desktop-runtime.json` → not found |
| **Something still writes to the data directory** — not identified by this pass | `active-project.json` was rewritten at 2026-10-07T21:10:43Z, five minutes before the snapshot, while no `AgenticOS` or `electron` image is present in `tasklist`; `agentic-os.db-shm` was touched at 21:12:37Z with `agentic-os.db-wal` still 0 bytes and the database file itself unchanged at 15:59:42 local. A touched `-shm` beside an empty `-wal` is consistent with a reader opening the store, but this pass did not identify the process holding it and does not assert one | `ls -la --time-style=full-iso`; `tasklist`; `stat -c` |
| Control plane — supersedes Section 2g's "54 files / 20,958 lines" | 54 files / 21,052 lines (+94 at the top level); the subdirectories are unchanged from 2g: `adapters` 10 / 3,673, `computerUse` 7 / 2,010, `taskGraph` 11 / 1,547, `browser` 6 / 1,123, `artifacts` 2 / 186 | `wc -l server/src/domains/controlPlane/*.ts`; per-subdirectory `wc -l` |
| Domain sizes that moved since 2f/2g | `localWorker/` 9 / 2,372 (2g: 9 / 2,165); `domains/jarvis/perception/` 5 files / 1,772 lines, the fifth file being `targetContentExtractor.ts`, which Sections 2d/2e/2f/2g all predate (2f recorded 4 / 1,387); `services/perception/` 4 / 1,513 (2f: 1,446) | `wc -l server/src/domains/localWorker/*.ts`; `ls server/src/domains/jarvis/perception/`; `wc -l` |
| Domain sizes unchanged since 2g | `workerAdapters/` 7 / 1,371; `domains/teams/` 3 / 587; `services/agentTeams/` 5 / 1,094; `turnLifecycle/` 13 / 1,941; `selfHeal/` 21 / 5,165; `jarvisNext/` 16 / 8,456; `services/browser/` 6 / 6,281; `repositoryResearch/` 11 / 781; `magnitude/` 2 / 696; `codex/` 1 / 216 | `wc -l`; `ls` |
| Test surface — supersedes Section 2g's "276 files, 34 orchestration-scoped" | 282 files in `server/src/__tests__/`, of which 34 are orchestration-scoped (unchanged) | `ls server/src/__tests__/ \| wc -l`; `grep -icE "team\|deleg\|worker\|controlPlane\|goal\|verif\|orchestr"` |
| Standing gap markers, re-run | `\ba2a\b` across `src/ server/src/ electron/` → 0; the framework list over `package.json` plus `server/package.json` → 0; `opentelemetry\|otlp\|traceparent\|span_kind\|spanKind` across the same three roots → 0; `pass\^\|pass_k\|passk` across `src/ server/src/` → 1, the same `bypass_kyc` false positive, now at `server/src/domains/jarvisNext/operator/executionPolicy.ts:43`; `contextBudget\|context_budget\|autoCompact\|tokenBudget` in non-test `server/src/` → 0; `assertSideEffectOwnership` → 20; `durationMs` across the five fleet directories → 8, in the same five files, with `localWorker/toolRegistryBridge.ts` line numbers moved to 553 and 555 | grep counts |
| Data layer — every Section 2g count re-runs **identically**, ten hours later | `turn_lifecycle` 1,288 and `turn_lifecycle_events` 9,744 rows with the same stage distribution (EXECUTE 1,345, RECEIVED 1,288, VERIFY 1,231, RESPONSE 1,231, OUTCOME 1,231, DONE 1,223, TTS 1,213, UNDERSTAND 440, POLICY 440, GOAL_ACCEPTED 69, SUPERSEDED 33); outcomes VERIFIED 1,028, FAILED 183, EXECUTED_UNVERIFIED 20, null 57; sources voice_livekit 1,085, typed_chat 196, voice_text_injection 7; `repair_incidents` 344 with **`repair_attempts` 0**, `repair_diagnoses` 88, `repair_knowledge` 998, `repair_evidence` 451,481; `goal_runs` 1,163 (COMPLETED 1,007, RECOVERABLE 115, FAILED_EXHAUSTED 31, CANCELLED 10); `engineering_worker_sessions` 106 and `engineering_execution_events` 5,383; 126 tables, **0** matching `trace` or `span` in their name | readonly `select count(*)` and `group by`; `sqlite_master` name list |
| Two clocks becomes a stopped clock — supersedes Section 2g's "Two clocks" | Newest `turn_lifecycle.updated_at` and `turn_lifecycle_events.at` 2026-10-07T11:20:07.124Z; `conversation_messages` 11,293 rows, newest 2026-10-07T11:20:07.128Z; `jarvis-runtime-trace.log` unchanged at 8,825,873 bytes, last write 11:20:13Z; `repair_evidence` newest 11:19:11.912Z; `repair_incidents` newest `detected_at` 2026-10-03T15:22:03.790Z; `engineering_execution_events` newest 2026-10-04T10:22:59.411Z; `goal_runs` newest 2026-10-06T18:55:58.601Z. At Section 2g's snapshot the voice path was three hours cold and a process was still identifiable; at this one it is ten hours cold with no identifiable process, so the earlier sentence "the voice path ran to 2026-10-07" describes work that has since ended | readonly `max(<time column>)` per table; `stat -c`; `tasklist` |
| Turn registry still has no span identity | `turn_lifecycle` columns unchanged and span-free: `request_id, dedupe_key, source, conversation_id, context_key, external_turn_id, text, normalized_text, stt_confidence, audio_ref, build_id, received_at, stage, goal_json, postcondition_json, policy_json, snapshot_json, receipt_json, verification_json, outcome, outcome_reason, response_text, spoken, handler, superseded_by, attached_json, error, completed_at, updated_at`. `turn_lifecycle_events` is `id, request_id, stage, at, detail_json` — per-phase timestamps with no `trace_id`, no `parent_span` and no `duration_ms` column, which is precisely the shape Section 2g's "cheapest first step" proposes to change | `pragma table_info` |
| Team and coding runtimes — unchanged | `teams` 0, `team_runs` 0, `agent_team_handoffs` 0, `agent_team_artifacts` 0, `verification_reports` 0, `coding_runs` 0 | readonly counts |
| Live tables the earlier passes named without counts | `conversation_messages` 11,293 (2f: 8,569), `conversations` 1,139, `active_operational_goals` 3, `task_graph_journal` 48, `recovery_chains` 6, `runtime_boot_identity` 129 | readonly counts |

**Effect on the roadmap.** The gap list does not change; the frame around it does, and on two axes.
First, the deployment axis widened again and the newest work is entirely inside it: the deployed build
was 18 commits behind at Section 2g and is 47 behind now, and the whole security subprogram —
approval verification gating the terminal, desktop, filesystem and git executors, plus the Windows Job
boundary — is wired into 21 tree modules and present in none of them in the bundle that was actually
booting. Section 2g called this "a deployment gap with a one-line cause"; this pass supplies the line
(deployed SHA 2026-10-04, security work 2026-10-07) and shows it is no longer one subsystem but the
newest and largest body of work in the repository. Second, the observation itself is fragile: HEAD
moved twice inside this pass, the tree's own build artifact is 16 commits stale, the booted process has
exited without a successor boot row, and two of the side stores the earlier passes relied on
(`desktop-runtime.json`, `selfheal-audit.jsonl`) no longer exist. A document that reports on a system
which commits, builds and stops while the report is being written can only be a set of instants, and
the rows above are only valid with their snapshot time, their commit and the identity of the build that
was running.

Consequence for the recommended order, which differs from Section 2g's. Gap 1 (phase-level telemetry)
and gap 2 (consistency metric) re-run at exactly their Section 2g size — the turn stage timeline is
present and still span-free, and 344 incidents, 88 diagnoses, 998 knowledge rows and 451,481 evidence
rows still coexist with zero `repair_attempts`; gap 3 (context budget) is untouched. But starting
Option A against the tree build while the running build diverges from it by 47 commits would produce a
telemetry row emitted by one build and a capability row observed on another, and the security rows
above are already exactly that failure. So the first action is no longer Option A's instrumentation: it
is deployment and identity reconciliation — bring the installed bundle to a named commit, or record in
every row which of the two builds it describes — because nothing measured until then can be attributed.
The instrumented store that Option A would extend is also the one thing that did not move: `turn_lifecycle`
and `turn_lifecycle_events` hold the same 1,288 / 9,744 rows as they did ten hours ago, and the emitter
has been idle the whole time, so the "cheapest first step" Section 2g named is still available and still
untested.

---

## 3. Roadmap

Sequencing principle taken from the literature: instrumentation and verification before autonomy, autonomy before interop.[2][6][9][17]

### Option A — Phase-level telemetry for the orchestrator
- Expected effort: 3-5 engineering days. One spans table (`trace_id`, `span_kind`, `agent`, `parent_span`, `started_at`, `duration_ms`, `status`, `error_class`, `token_counts`) plus emit points in `turnRouter`, `semanticGoalParser`, `universalExecutionController`, `supervisorLoop`.
- Time-to-revenue: none directly; immediate reduction in debug time on the revenue routines, which is the current bottleneck on unattended operation.
- Dependencies: existing turn/trace IDs; SQLite (already present); no restructuring.
- First concrete action: instrument the single status-query path end to end, then replay one historically failed turn and confirm the failing phase is identified from spans alone.[6][2][19]

### Option B — Reliability harness (pass^k on canonical tasks)
- Expected effort: 4-6 days on top of the existing eval router/CLI.
- Time-to-revenue: gates the move from human-in-the-loop to unattended execution of the revenue and monitoring routines — the precondition for revenue at all.
- Dependencies: 10-20 canonical tasks with deterministic graders (DB-state assertions, not judge models).
- First concrete action: pick 10 real turns (voice status query, open project, run task, revenue status, FreeCash monitor run) and record pass@1 alongside pass^8 for each.[16][15][7]

### Option C — Context budget + sub-agent isolation for the Jarvis loop
- Expected effort: 5-8 days (budget accounting, compaction trigger, tool-result clearing, worker isolation for browser/scrape work).
- Time-to-revenue: direct cost and latency reduction on every long voice session; also protects answer quality as sessions lengthen.
- Dependencies: per-turn token accounting through the Hermes gateway; a summarization pass; explicit per-turn token target treated as a defect threshold.
- First concrete action: measure tokens/turn and composition over a 20-turn voice session, set the budget, then isolate the heaviest recurring subtask into its own window returning a summary.[13][14][4]

### Option D — Make the MCP bridge the single capability surface
- Expected effort: 6-10 days.
- Time-to-revenue: indirect but compounding — each new provider or executor becomes one adapter instead of bespoke glue, and the backend-authority approval model applies uniformly.
- Dependencies: keep the existing backend-authority design; export current executors (shell, browser, project/task store, revenue) as MCP tool manifests; version tool descriptions deliberately, since bad tool descriptions are a documented failure driver.
- First concrete action: enumerate executors as MCP tool manifests and diff against what `mcpBridge` already exposes; convert the largest uncovered executor.[1][5][4]

### Option E — A2A / cross-runtime interop
- Expected effort: 2-4 weeks if and when a genuinely independent peer runtime exists (e.g. the Codex/Claude delegations promoted from CLI subprocesses to owned peers with their own tools and trust boundary).
- Time-to-revenue: negative near-term — no revenue path in a single-operator, single-runtime topology.
- Dependencies: signed agent cards, task lifecycle, an actual second owner/trust domain.
- First concrete action: none. Record the trigger condition instead: adopt when a second owned runtime or third-party agent must be delegated to without sharing internal memory.[3][17][15]

### Option F — Compensating actions (saga) for revenue and monitoring workflows
- Expected effort: 5-7 days for the top two workflows.
- Time-to-revenue: directly protective — partial execution is reported as the largest single failure class in production agent deployments†, and these are the workflows that touch money and external channels.
- Dependencies: step checkpoints in the existing SQLite store; idempotency keys on external calls (Stripe, Shopify, provider APIs).
- First concrete action: add one compensating action + dry-run replay to a single multi-step revenue routine.[8][13]

### Option G — Governance and kill-switch policy per workflow
- Expected effort: 2-3 days.
- Time-to-revenue: none directly; this is the item the enterprise literature says most teams fail, and the one that keeps the other options from being rolled back after an incident.
- Dependencies: the telemetry from Option A (you cannot gate what you cannot observe).
- First concrete action: classify every existing workflow as reversible / irreversible, and require explicit approval only on irreversible steps — human-in-the-loop on 88% of steps is the current interim state, not a target.[9][8]

**Recommended order: A → F → B → C → D; defer E until a second owned runtime exists.** Amended at the 2026-09-30 re-verification (Section 2b): telemetry still comes first, but B (consistency metric) now precedes F for the revenue/monitoring workflows, because the control plane already covers the engineering half of the saga gap while nothing yet gates unattended money-touching runs. The literature's own ordering supports it: verification and observability before autonomy, autonomy before interop.[2][9][17]

---

## 4. Sources

[1] https://arxiv.org/html/2601.13671v1
[2] https://arxiv.org/pdf/2503.13657v3
[3] https://www.linuxfoundation.org/press/a2a-protocol-surpasses-150-organizations-lands-in-major-cloud-platforms-and-sees-enterprise-production-use-in-first-year
[4] https://www.anthropic.com/engineering/built-multi-agent-research-system
[5] https://www.anthropic.com/engineering/building-effective-agents
[6] https://2026.aiwareconf.org/details/aiware-2026-benchmark---dataset-track/10/AgentTelemetry-A-Fault-Detection-Benchmark-and-Toolkit-for-LLM-Agent-Observability
[7] https://ideas.repec.org/a/gam/jftint/v18y2026i6p326-d1967830.html
[8] https://usetransactional.com/research/multi-agent-orchestration-production-2026
[9] https://wetheflywheel.com/en/guides/best-agent-orchestration-frameworks-2026
[10] https://arxiv.org/pdf/2602.23701.pdf
[11] https://arxiv.org/html/2602.19843v1
[12] https://arxiv.org/pdf/2505.18286v1
[13] https://www.tmls.nyc/research/context-engineering
[14] https://marktechpost.com/2026/09/12/context-engineering-inside-the-harness-4-mechanisms-that-beat-context-overflow-and-goal-loss-on-long-horizon-tasks
[15] https://proceedings.iclr.cc/paper_files/paper/2026/file/c26a67e0470774df98c12480ec5d2d7b-Paper-Conference.pdf
[16] https://dreaming.press/posts/swe-bench-vs-tau-bench-vs-gaia.html
[17] https://www.glukhov.org/ai-systems/comparisons/a2a-protocol-2026-adoption
[18] https://ejaset.com/index.php/journal/article/download/463/326
[19] https://arxiv.org/pdf/2510.26585
[20] https://github.com/sierra-research/tau2-bench
