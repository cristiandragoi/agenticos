# CodeX Stabilization — checkpoint (3/3 production tasks PASS)

## Root cause (confirmed, not guessed)
The live failure was TWO compounding defects in `server/src/loops/codexLoop.ts`:
1. `maxTokens: 2048` truncated full-file `writeFile` JSON (~9183 chars ≈ 2048 tokens),
   so `parseToolCall` returned null.
2. The parse-failure path THREW `CODEX_TOOL_PARSE_FAILED` on the final attempt
   (goal → failed) WITHOUT trying the configured fallback provider — a parse
   failure was treated as a task failure, not a provider-attempt failure.
   Evidence: goal-64532735- failed after 3 parse attempts at ~9183 chars, no fallback.

## Fixes (server-only)
- `codexLoop.ts`:
  - Adaptive output budget: `maxTokens = isLocalPlanningProvider ? 2048 : 8192`
    (env `CODEX_MAX_TOKENS`).
  - `writeFile` `append` mode (minimal edits avoid full-file rewrites).
  - **Fallback-provider escalation on parse failure**: when the preferred provider
    emits tool-call-shaped malformed JSON, `break` (not throw) and re-call `llmChat`
    with `excludeProviders: [failedProvider]` so the gateway tries the next provider.
  - Plain-text (non-tool-call-shaped) responses still fail truthfully (throw) —
    no fabrication, and the write-task regression test stays green.
  - Fail-fast: when the fallback ALSO emits unparseable output, set
    `parseFailureCount = maxParseFailures` so the task terminates promptly.
- `toolCallParser.ts`: strip UTF-8 BOM; unwrap a single nested `tool_call` object
  in a generic wrapper (`{ "result": { "type":"tool_call", ... } }`).
- `llmGateway.ts` + `gateway/types.ts` + `gateway/router.ts`: `excludeProviders`
  threaded through to `GatewayRouter.chat`, filtered from the fallback order.

## Regression tests (all green)
- `codexParseFallback.test.ts` (2): fallback escalation → completes with truthful
  metadata; both malformed → truthful failure, no fabricated tool.
- `codexParserResilience.test.ts` (10): BOM / prose+JSON / fenced / nested wrapper.
- `codexToolCallFinalAnswer.test.ts` (15): synthetic-completion invariant.

## 3-task production reliability gate — 3/3 PASS (deepseek-chat)
- Task A (read+search+git)  bgtask-f57c37c34 → completed
- Task B (edit+test)       bgtask-929ff73fd → completed, created+ran vitest (PASS)
- Task C (multi-step)      bgtask-7f9a547cf → completed, append+ran vitest (3 PASS)
- No synthetic completion; provider/model = DeepSeek/deepseek-chat (truthful).

## Build/test status
- server `tsc --noEmit` clean; `npm run build` clean; server-only deploy hash-verified (295 files, 0 mismatches).
- Full server suite: 40 failed / 1031 passed / 10 skipped (baseline was 44 failed / 917 passed) — net-positive, no NEW failures introduced (remaining 40 are pre-existing: restart, magnitudeMigration, codexApprovalState read-only fallback dead code, codexParseBudget, codexGoalSse, codingRuntime, intentRouter, jarvis*, llmGatewayFallback).

## Runtime
- Production :4000 healthy, NODE_ENV=production, version 9.0.0.
- Revenue Supervisor PAUSED (mission-616808fe-, cycle 1).
- 0 non-terminal background tasks (no orphans).
- Gate scratch `src/__tests__/codexReliabilityGate.test.ts` removed; valid
  idempotency test preserved (fixed into the describe block) in
  `src/lib/domainNormalization.test.ts`.
