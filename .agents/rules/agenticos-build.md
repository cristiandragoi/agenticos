---
trigger: always_on
glob:
description: AgenticOS desktop backend lifecycle ownership — read before touching Electron startup, backend process management, or connectivity UI.
---

# AgenticOS Backend Lifecycle (operational contract)

The desktop app must never leave the user with a silent dead backend.
Full design + troubleshooting: `docs/backend-lifecycle.md`.

## Ownership

- **Electron main process owns the backend lifecycle** (`electron/backendLifecycle.ts` + wiring in `electron/main.ts`). Never add ad-hoc backend spawning, health guesses, or restart logic elsewhere (renderer, Vite proxy, scripts).
- Renderer gets ONE source of truth: `src/diagnostics/backendLifecycleStore.ts` (Electron IPC authoritative; `/api/health` polling is browser-mode fallback only). Consume via `useBackendLifecycle()`.
- Jarvis/UniversalChatDock gate sends only on the authoritative `electron` source (`backendOffline === true`), never on transient `starting`/`reconnecting`.

## Modes

| Mode | Behavior |
|---|---|
| `AUTO_MANAGED` (default) | Electron probes `http://127.0.0.1:<port>/api/health`; adopts a healthy existing backend, else spawns `server/dist/index.js` (dev) via `process.execPath` + `ELECTRON_RUN_AS_NODE=1`. |
| `EXTERNAL` | Electron expects an independently managed backend; never spawns or kills it. Set `AGENTICOS_BACKEND_MODE=EXTERNAL` (legacy: `AGENTICOS_EXTERNAL_SERVERS=true`). |

## Invariants (do not break)

1. READY (`status: 'ready'`) only after a successful `/api/health` probe — never on spawn alone.
2. No duplicate backend processes: probe-before-spawn adoption is mandatory.
3. `FAILED` is terminal until explicit user Retry/Restart (no silent crash loops). Budget: 3 restarts (backoff 1s/3s/8s); crash-loop guard: 3 exits within 60s.
4. Manager-initiated kills (readiness timeout, recycle, shutdown) must not count as crashes (`discardNextExit`).
5. All captured backend logs pass through `redactSecrets()` before storage/display.
6. Port conflict (something else on 4600 failing health) → `FAILED` with an actionable reason, never kill the foreign process.
7. Graceful shutdown on quit: SIGTERM → 5s grace → SIGKILL, owned processes only.

## Tests

- Manager state machine: `electron/__tests__/backendLifecycle.test.ts` (node env, injected clock/probe/spawn).
- Renderer store/indicator/gating: `src/__tests__/BackendLifecycle.test.tsx`.
- Run: `npx vitest run electron/__tests__/backendLifecycle.test.ts src/__tests__/BackendLifecycle.test.tsx`.
