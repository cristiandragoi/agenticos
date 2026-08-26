# Phase 2D — Real Execution Bridge — Checkpoint

## State at start (2026-08-20 ~21:11 UTC+2)

- Branch: `argus-deploy` (uncommitted Phase 2C work preserved; no destructive git ops used).
- Packaged app running: backend PID 56760 owns port 4000, `environment: production`.
- Supervisor: PAUSED, cycle 0. 5 real Human Gates OPEN (2 SHOPIFY_AUTH + 3 OUTBOUND_APPROVAL).
- No external actions performed. START not pressed. Real gates not resolved.
- Roaming ARGUS (Phase 2C): `argv-c6d17702-` @ L5.

## Confirmed root cause (from read-only audit)

`RevenueMissionSupervisor.runSupervisorCycle()` calls `CapabilityDispatcher.dispatch()`,
which only writes routing/task/run records (never invokes an adapter). The scheduler
wrapper (`scheduleDispatcher.ts`) then writes a synthetic "cycle completed" result with
HARDCODED `provider: prov-deepseek` / `model: deepseek-v4-flash` (agent_instance_id=null).

The real execution path already exists and is proven to work:
`dispatchCanonicalTask()` → `executeHermesTask`/`executeCodexTask` → `hermesService.runHermesCore`
→ `llmChat` → `GatewayRouter.chat` → real provider. It is used by the revenue ENGINES
(digitalProductEngine / germanSmeEngine) but NOT by the supervisor cycle.

## Plan

- Phase 1: bridge capability selection → `dispatchCanonicalTask` real execution.
- Phase 2: action resolver mapping supervisor branches → real Revenue Operator actions.
- Phase 3: gate resumption queues real next action or blocks truthfully (no fake completion).
- Phase 4: fair branch selection + idempotency/duplicate prevention.
- Phase 5: truthful provider/executor metadata (remove hardcoded labels).
- Phase 6: bounded real calls only (≤1 Hermes + ≤1 CodeX acceptance).
- Phase 7: UI truthfulness.
- Phase 8: automated tests.
- Phase 9: isolated-fixture real acceptance (1 Hermes + 1 CodeX).
- Phase 10: ARGUS Phase 2D contract + Roaming verification (no supervisor activation).
- Phase 11: build + safe deployment.

## Backups

`docs/backups/phase2d-20260820-211151/` — pre-edit copies of:
revenueEngine.ts, revenueSupervisor.ts, digitalProductEngine.ts, germanSmeEngine.ts,
operatorService.ts, scheduleDispatcher.ts, capabilityDispatcher.ts,
RevenueOperatorPage.tsx, revenueOperatorClient.ts, dataStore.tsx.
