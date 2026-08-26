# Overnight Repair — Failures Log

## Phase 0 — none

## Phase 1/1b/2/3/4 — fixed (see changes.md)

## Phase 5 — FOUND + FIXED
- **Hermes api_server event schema mismatch** (root cause of lossy tool events + stuck
  "queued" status). `handleUpstreamEvent` read `ev.tool_name`/`ev.args`, but the api_server
  emits `ev.tool`/`ev.preview`; `reasoning.available`/`subagent.*` were unhandled; and
  `run.started` is never emitted so status stayed "queued" even while actively running.
  FIXED (see changes.md). Verified by 7 unit tests + live planning run (completed).
- **orchestrator.ts TS2322/TS2304** (GoalRecord type + null narrowing) — blocked `tsc`.
  FIXED (type import + guard). tsc --noEmit now exit 0.
- **read_file misclassified as file.changed** — loose `/file/i` regex in toolKind. FIXED.

## OPEN / GENUINE EXTERNAL BLOCKER
- **CodeX CLI usage limit** — `codex exec` returns "You've hit your usage limit ...
  try again at Aug 25th, 2026 1:16 AM" (provider openai, model gpt-5.6-sol).
  Verified directly (exit 1). This is the root cause of the prior Phase 5
  "Connection error." during delegation. Blocks: Phase 5 CodeX leg, Phase 8
  decisive Jarvis→Hermes→CodeX test, Phase 11/16 CodeX re-verification.
  NOT repairable in code — requires user credit top-up/Pro upgrade, or time (Aug 25).
- provider/model on Hermes run record shows profile alias "backend-engineer" in the
  RUN record, but the TASK metadata now persists the resolved truth
  (provider=custom, model=deepseek-v4-flash). Cosmetic-only; defer to Phase 11.

## Pre-existing (NOT introduced)
- `codexParseBudget`, `codexApprovalState` (4), `codexGoalSse` (2): parse-failure/read-only
  fallback path; root cause isLocalPlanningProvider not detected for createGoal(...,'ollama').
- Full-suite baseline: ~43 server + 24 frontend failures (CodeX*/Jarvis*/gateway/runtime).
