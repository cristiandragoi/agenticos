# REVENUE OPERATOR PHASE 2C — ARGUS TASK CONTRACT

Contract version: 2.0
Created: 2026-08-20 (HERMES ORCHESTRATION)
Workspace: `B:\AgenticOS`
Baseline branch: `argus-deploy`
Contract ID: `argus-revenue-phase2c-`
Goal ID: `goal-revenue-phase2c-`

## 0. OBJECTIVES & CAPABILITIES

Phase 2C completes the capability-aware executor routing, live packaged Electron single-shell runtime, and autonomous scheduler-driven Revenue Mission Supervisor for `mission-616808fe-`.

### 1. CAPABILITY-AWARE DISPATCH & EXECUTOR/PROVIDER SEPARATION
- Preflight mismatch on restricted inspectors (`rt-codex`) triggers `CAPABILITY_MISMATCH` and auto-redispatches to compatible process-enabled executors (`rt-hermes` / `rt-jarvis`).
- Independent model selection: `prov-deepseek` / `deepseek-v4-flash` is selected decoupled from host runtime selection.
- Tasks, runs, outputs, and evidence are canonically persisted in SQLite tables (`project_tasks`, `execution_runs`, `execution_results`).

### 2. REAL SCHEDULER-DRIVEN SUPERVISOR CONTINUATION & ROUTINES
- Supervisor runs via canonical cron schedule `schedule-revenue-supervisor-tick` (`*/5 * * * *`).
- Daily Briefing Routine `routine-revenue-daily-briefing` generates persistent briefing artifacts with deduplication idempotency keys.
- Weekly Briefing Routine `routine-revenue-weekly-briefing` generates persistent performance reports.
- Multi-cycle continuation advances non-gated experiment branches.

### 3. CONTROL STATE PERSISTENCE & SEMANTICS
- `START`: Idempotent activation, persists `ACTIVE` state to SQLite.
- `PAUSE`: Blocks new supervisor cycles while preserving in-progress tasks.
- `RESUME`: Continues execution from persisted state.
- `STOP`: Halts future ticks, preserves all historical tasks and runs, survives server restarts.

### 4. EVENT-DRIVEN HUMAN GATE AUTO-RESUMPTION
- Human Gate isolation: open gates pause only the affected branch (`WAITING_FOR_GATE`).
- Canonical `resolveHumanGate` emits `human_gate_resolved` event, waking the supervisor and dispatching continuation tasks automatically.

### 5. PACKAGED ELECTRON SINGLE-SHELL RUNTIME
- Live packaged executable verification: single `BrowserWindow` ID is preserved across `/codex` navigation.
- Single unified `<AppShell />` landmark.

## 6. ACCEPTANCE CRITERIA
1. `file-exists: docs/argus-contracts/revenue-operator-phase2c.md` (L1)
2. `command: node scripts/verify-capability-routing.cjs` (L4)
3. `command: node scripts/verify-natural-scheduler.cjs` (L5)
4. `command: node scripts/verify-gate-autoresume.cjs` (L5)
5. `command: node scripts/verify-briefing-deduplication.cjs` (L5)
6. `command: node scripts/verify-supervisor-controls.cjs` (L5)
7. `command: node scripts/verify-codex-dom-click.cjs` (L5)
8. `command: node scripts/revenue-operator-verify.cjs` (L5)
