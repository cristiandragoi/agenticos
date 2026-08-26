# ARGUS Contract — Revenue Operator Phase 2D (Real Execution Bridge)

- **Contract ID:** `argus-revenue-phase2d-`
- **Scope:** Connect the Revenue Mission Supervisor to the existing canonical real
  worker-execution path (Hermes / CodeX), replacing the record-only
  `CapabilityDispatcher.dispatch()` bridge with truthful real execution.
- **Safety:** Verification runs against an isolated throwaway DB fixture and an
  isolated workspace. It never activates the production supervisor, never
  resolves real Human Gates, never publishes, sends outreach, authenticates
  Shopify, or spends money.

## Requirements

1. **Real worker execution bridge** — the supervisor cycle reaches a real worker
   (executeHermesTask / executeCodexTask) via `dispatchCanonicalTask`, not a
   record-only dispatch.
2. **Capability-aware executor selection** — `executorSelection.selectExecutor`
   records CAPABILITY_MISMATCH and redispatches to a compatible worker without
   losing the canonical task.
3. **Provider/executor separation** — provider and model are recorded
   independently from the executor host, from the real worker response (never
   hardcoded labels).
4. **No synthetic completion** — a run is marked `completed` only after the
   worker produced a real result; `blocked`/`waiting_for_gate`/`no_work`/
   `failed` are reported truthfully.
5. **No orphaned runs** — timeouts and worker failures mark the run `failed`.
6. **Digital real execution** — discovery uses real Hermes; build uses real
   CodeX; validation/decision use canonical DB logic; the path stops at the
   Shopify Human Gate.
7. **SME real execution** — discovery/inspect/contact/offer use real Hermes;
   qualification uses canonical DB logic; the path stops at the OUTBOUND_APPROVAL
   Human Gate.
8. **Fair scheduling** — deterministic least-recently-selected selection; no
   starvation; persisted restart recovery.
9. **Idempotency** — `revenue_action_executions` dedupes by action/experiment key;
   repeated cycles do not rebuild or re-offer.
10. **Gate safety** — the five real Human Gates are untouched; gate resolution
    wakes a branch but blocks truthfully on missing integrations.
11. **Missing-integration blocking** — publish/send produce
    `BLOCKED_INTEGRATION_REQUIRED` (no fake execution, no external mutation).
12. **Phase 1 regression** — 11/11 Revenue Operator checks still pass.
13. **Phase 2C regression** — capability routing + packaged CodeX single-shell
    remain verified.
