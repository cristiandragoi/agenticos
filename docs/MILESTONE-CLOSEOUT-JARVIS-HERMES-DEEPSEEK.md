# AgenticOS — Jarvis Milestone + Hermes/DeepSeek Runtime: Closeout

Status: COMPLETE — verified against the production build (file:// renderer + server/dist backend)
Date: 2026-08-10
Branch: stabilize-runtime

## Commits

| Hash | Summary |
|---|---|
| `18a0e78` | Fix duplicate-key warning: collision-safe transcript IDs + store dedup |
| `34ff98e` | Jarvis conversation/routing reliability + Hermes DeepSeek runtime wiring (milestone commit, 21 files) |
| `90988af` | Fix production Electron file:// API fetch failures (6 files) |

## What was delivered

### Jarvis (milestone)
- One shared server-side conversation-context object (`conversationContext.ts`) used by BOTH the stream and non-stream paths: bounded recent turns, current goal, workspace root, active/recent task, provider/capability truth, approval mode.
- `intentRouter.ts` classifier: deictic/follow-up/continuation resolution (154/154); "Can you change that?" → investigate; "Continue." → investigates prior subject.
- Investigate + clarification branches persist the USER message so follow-ups resolve contextually (the root cause of earlier 1b/2b failures).
- Explicit orchestrator dispatch for every route; streaming/non-streaming parity enforced (jarvisParity 15/15).
- Input ownership: voice/STT can no longer overwrite typed composer text (manual-edit + mic-off generation guards; 9/9 tests). Manual input owns the composer; STT preview is separate state.
- Sticky-composer stale-closure fix: imperative handle reads the LATEST conversationId, so follow-up turns reuse the conversation instead of auto-creating new ones (4/4 guard test). This was the last live blocker.

### Hermes/DeepSeek runtime wiring (Phase 5A/5B)
- Gateway registers `DeepSeek` (api.deepseek.com/v1, key from DEEPSEEK_API_KEY env, model deepseek-v4-flash) as provider name `DeepSeek` matching `mapCatalogToGatewayId('prov-deepseek')`.
- `prov-deepseek` catalog includes `deepseek-v4-flash`; legacy `deepseek-chat` fallback entries scoped to `deepseek-v4-flash` where the Hermes routing path uses them.
- TEST ROUTING compares the MAPPED gateway id so configured `prov-deepseek` resolves PASS (no false FALLBACK).
- `agent-hermes` assignment: providerId=prov-deepseek, modelId=deepseek-v4-flash, routingMode=preferred, enabled=true.

### Production-mode fixes (`90988af`)
The production build loads `dist/index.html` via `file://`, which has no HTTP origin: relative `/api` fetches resolved to `file:///api/...` and failed with "Failed to fetch". This trapped the whole app shell in the backend-error gate (lifecycle health poll), then silently broke Jarvis chat, the Model Selector, and the memory panel. Fixed with a file-aware API base (`http://localhost:4600/api` under file://) in: backendLifecycleStore, dataStore, JarvisChat, JarvisStudio, AgentRuntimeSelector, HermesContextPanel.

## Verification (production build)

- Backend: server/dist, EXTERNAL lifecycle mode, `node dist/index.js` on :4600.
- Renderer: `dist/index.html` via Electron loadFile.
- **Six-conversation Jarvis acceptance: GREEN** — all 8 typed turns INTENDED===SUBMITTED; conversation reuse confirmed (T1/T2 same conv); routing targets: chat-interface→investigate, "Can you change that?"→investigate (contextual), "Continue."→investigate, "Jarvis, say hello."→DIRECT, "Why does it keep saying file not found?"→investigate, "Is Hermes finished?"→worker_status, "What is the transcript panel?"→direct; 0 console alerts (no duplicate keys / tool markup / Empty-src).
- **Hermes Studio Model Selector: GREEN** — mode=preferred, provider=prov-deepseek (DeepSeek), model=deepseek-v4-flash (DeepSeek V4 Flash), "Not configured" absent, TEST ROUTING present.
- Tests: server Jarvis suites 190/190; frontend affected 88/88; frontend tsc PASS; server tsc PASS; production build exit 0.
- Runtime log confirms gateway selection: provider=DeepSeek, model=deepseek-v4-flash, requestAgentId=agent-hermes, routingMode=preferred.

## Known pre-existing failures (NOT regressions; environmental)

- revenue.test.ts / scoring.test.ts: OpenAI SDK refuses to construct a client outside Node ("dangerouslyAllowBrowser" guard) at import time.
- doctor.test.ts: uses `jest` globals (undefined in vitest).
- codexGoalSse.test.ts ×2, teamExecution.integration, teamProductionPath.regression, teamSheetGeneration, jarvisTrace ×2, restart: proven failing at clean baseline HEAD.

## Known production-mode gaps (out of scope for this milestone; future hardening)

The same file:// relative-fetch defect class remains in OTHER feature components not exercised by this milestone's acceptance:
- CodeX surface: CodeXChat.tsx, CurrentActionCard.tsx, DiagnosticsDrawer.tsx, RunSettings.tsx, StudioBoard.tsx, StudioChat.tsx, StudioEmptyState.tsx, CodexPipeline (relative /api/chat/agents/goal...)
- src/command/jarvisPipeline.ts (pipeline run, voice/speak)
- src/api/revenueClient.ts (revenue metrics/intelligence)
- src/hooks/useChatManager.ts (pipeline/welders, kanban cards)
These work in dev (Vite http origin) but will fail under file:// in production. A follow-up hardening pass could centralize an `apiFetch` helper and sweep all callers.

## How to run production

```bash
cd /b/AgenticOS/server && npm run build && node dist/index.js   # backend on :4600
cd /b/AgenticOS && npm run build                                # renderer -> dist/
cd /b/AgenticOS && AGENTICOS_BACKEND_MODE=EXTERNAL ./node_modules/.bin/electron .  # app
```

## Rollback notes

- `34ff98e` is the milestone; `90988af` is the production fix. Both are single commits on `stabilize-runtime`.
- Runtime data (`server/data/*`, `.agentic/`, `dist-electron/`) is intentionally not committed; `server/data/providers.json` re-derives from `server/src/data.ts` on next seed and the DeepSeek catalog change is already in the committed source.
- No API keys in code, config, or Git. DeepSeek key comes from `DEEPSEEK_API_KEY` env; OpenCode key lives in its credential store; OpenRouter credential retained as unused fallback.
