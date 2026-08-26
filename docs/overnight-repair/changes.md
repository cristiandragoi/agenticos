# Overnight Repair — Changes Log

## Phase 1 — CodeX tool runtime determinism
- NEW `server/src/loops/fileRead.ts` — `readFileWindowed` + `formatReadResult` (continuation metadata).
- NEW `server/src/__tests__/fileRead.test.ts` — 7 tests.
- `server/src/loops/codexLoop.ts` — readFile range + metadata; listDirectory continuation; runCommand empty-args; searchFiles; tool budget 40.
- `server/src/loops/toolCallParser.ts` — searchFiles enum + aliases.

## Phase 1b — CodeX sandbox fixes
- `server/src/utils/sandbox.ts` — npm/npx/tsc/jest .cmd shim via cmd.exe /c; rg excludes + 120s timeout; runCommand 120s timeout.

## Phase 2/4 — found + fixed
- (Phase 2) npm/npx spawn ENOENT — FIXED (.cmd shim).
- (Phase 2) searchFiles rg 30s timeout — FIXED (excludes + --no-follow + timeout).
- (Phase 2) --prefer-offline auto-injection broke `npx vitest` — FIXED (only for npm install-class).

## Phase 3 — CodeX restart recovery
- `services/backgroundTasks/adapters.ts` — attachCodexGoalListener + reconcileCodexTasksAfterRestart (idempotent).
- `services/backgroundTasks/manager.ts` — restoreAfterRestart calls reconcile.

## Phase 5 — Hermes api_server event-schema normalization
- `server/src/services/hermesApiService.ts` — handleUpstreamEvent fixed to the REAL
  api_server /v1/runs SSE schema; queued→running on first activity; new handlers;
  toolKind tightened.
- `server/src/domains/jarvis/orchestrator.ts` — GoalRecord type import + null narrowing.
- `server/src/__tests__/hermesApiService.test.ts` — +4 regression tests. 7/7 PASS.

## Phase 6 — Jarvis task-ingestion/delegation fix (this session)
- `server/src/services/backgroundTasks/taskControl.ts` — `classifyTaskControl` rewritten:
  control verb must ADJACENTLY govern "task" (`VERB_ADJ_TASK_RE`, rejects compounds via
  `(?![-\w])`); `TASK_REF_RE` now word-bounded/ID-shaped with a mandatory digit, covering
  `T-*`, `bgtask-*`, `pt-*`, `task-*`, `goal-*`, `run-*`, `er-*`, `exr-*`, `ver-*`;
  no-id mutating commands only honored when short (≤6 words).
- NEW `server/src/__tests__/taskControlClassification.test.ts` — 9 regression tests
  (new-task vs. lookup separation, no fabricated ids, multiline preservation).

## Scratch (this session, to review in Phase 12)
- `scripts/phase5b-delegate.mjs` — Phase 5 canonical-path test (PASS).
- `scripts/patch-taskcontrol-adjacency.mjs` — one-off surgical patch (safe to remove).
- `docs/overnight-repair/phase5b-delegation-raw.json`, `phase5-delegation-raw.json` — evidence.
