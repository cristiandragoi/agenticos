# Backend Lifecycle Ownership

**Milestone:** Backend Lifecycle Manager (operational reliability).
**Rule:** a normal AgenticOS launch must recover from "nothing listening on
:4000" automatically, and the user always has a truthful visible backend
connection state. No manual `node dist/index.js` in normal usage.

## The one state machine

`electron/backendLifecycle.ts` (Electron main process) owns ONE record of
backend truth:

```
mode:    AUTO_MANAGED | EXTERNAL
status:  starting → ready ⇄ reconnecting → failed
         (EXTERNAL additionally reports offline while waiting)

tracked: backendUrl, port, pid (owned only), owned, startedAt,
         lastHealthSuccessAt, lastHealthFailureAt, restartCount,
         lastError, readinessMs, recentLog (redacted)
```

**READY means `GET /api/health` returned success** — process existence is
never enough. The state is broadcast to every renderer window over IPC
(`backend-lifecycle:state`) and served via `backend-lifecycle:get-state`.

The renderer's single source of truth is
`src/diagnostics/backendLifecycleStore.ts` (+ `useBackendLifecycle()` hook):
Electron IPC when available, health-poll fallback in browser mode. **UI
components never derive connectivity from their own fetch failures** — the
titlebar chip, the diagnostics panel, AppShell startup/error screens, the
Jarvis offline gate, and the global chat dock all read the same store.

## Modes

### AUTO_MANAGED (default)

Electron owns backend startup/restart. At startup it:

1. probes `http://127.0.0.1:<port>/api/health`;
2. healthy → **adopts** the existing backend (never spawns a duplicate);
3. port occupied but NOT healthy → **FAILED** with a port-conflict diagnostic
   ("Port 4000 is occupied but AgenticOS health check failed") — it never
   blindly spawns a second backend;
4. port free → spawns the backend and polls health until READY (bounded
   readiness window, 60 s) or FAILED.

While running it monitors health every 5 s. An owned process that exits
unexpectedly → RECONNECTING → bounded restarts (3 attempts, backoff
1 s / 3 s / 8 s) → READY on recovery or FAILED when the budget is exhausted.
**Crash-loop protection:** 3 crashes within 60 s stop all auto-restarting →
FAILED with the recent redacted stderr and a Retry control. FAILED is terminal
until the user presses Retry/Restart.

### EXTERNAL

Electron expects an independently managed backend (the `dev-clean.ps1`
development workflow). It never spawns or kills the backend. It still monitors
health and reports truthfully: READY when the external backend answers,
`Offline — waiting for external backend` otherwise. The diagnostics "Restart
backend" control explains that Electron does not own the process.

### Mode resolution

| Setting | Mode |
|---|---|
| `AGENTICOS_BACKEND_MODE=AUTO_MANAGED` / `=EXTERNAL` | explicit override |
| `AGENTICOS_EXTERNAL_SERVERS=true` (legacy dev-clean flag) | EXTERNAL |
| nothing set | **AUTO_MANAGED** |

## Behavior by environment

| Environment | Behavior |
|---|---|
| **Production desktop** (`electron:build`) | AUTO_MANAGED. Paths resolve from Electron app resources (`process.execPath` runs the backend with `ELECTRON_RUN_AS_NODE=1`; entry `<appRoot>/server/dist/index.js`, cwd `<appRoot>/server`) — never from the shell working directory. electron-builder ships `server/dist`, `server/node_modules`, `server/.env`. |
| **Development, normal launch** (`electron .`) | AUTO_MANAGED unless overridden. Same code path; `APP_ROOT` is the repo root. |
| **Development, dev-clean.ps1** | EXTERNAL (sets `AGENTICOS_EXTERNAL_SERVERS=true`): script owns backend + Vite; Electron attaches. Development never fights manually started services. |

Port: `AGENTICOS_BACKEND_PORT` env → `PORT` from `server/.env` → 4000.
(The backend loads `.env` with `override: true`, so the file wins over shell
env — reading it keeps the probe target truthful.)

## Process paths (precise)

- Backend entry (dev and packaged): `<appRoot>/server/dist/index.js`
- Backend working directory: `<appRoot>/server`
- Backend executable: the Electron binary itself (`process.execPath`) with
  `ELECTRON_RUN_AS_NODE=1` — a packaged app ships no separate `node`.
- Electron launch path: `electron/main.ts` → built `dist-electron/main.js`
  (vite-plugin-electron), preload `dist-electron/preload.cjs`.
- Environment inherited by the child: Electron's full `process.env` +
  `ELECTRON_RUN_AS_NODE`.
- Logs: `.agentos/logs/backend-managed.log` (stdout/stderr, redacted,
  ring-limited) beside `.agentos/logs/electron-dev.log`.

## Startup, monitoring, shutdown

- **Startup:** window opens immediately; the renderer shows "Starting
  AgenticOS backend…" / "Reconnecting… · attempt N/3" from the lifecycle
  state until READY (ready gate), then normal Jarvis interaction.
- **Monitoring:** health probe every 5 s (2.5 s timeout). 3 consecutive
  failures recycle an owned-but-unresponsive process or re-spawn when the
  adopted backend disappeared. EXTERNAL mode never spawns.
- **Graceful shutdown:** on app quit, the owned backend receives SIGTERM
  (server closes the HTTP listener and exits), a brief grace window, then
  SIGKILL — no orphan listener on :4000. EXTERNAL backends are never touched.
- **Single instance:** `app.requestSingleInstanceLock()` (existing) +
  probe-before-spawn (this milestone) guarantee exactly one backend.

## UI surfaces

- Titlebar chip (`BackendStatusIndicator`): 🟢 Connected · :4000 / 🟡
  Starting…/Reconnecting · attempt N/3 / 🔴 Offline / 🔴 Failed. Click →
  Backend diagnostics: mode, status, port, PID (managed only), last health
  times, restart count, readiness duration, last error, recent redacted log,
  **Retry connection** / **Restart backend**.
- AppShell: startup screen while the backend is starting/reconnecting;
  truthful error screen (with reason + Retry/Restart) when FAILED/OFFLINE.
- Jarvis: when the backend is definitively down (offline/failed) the composer
  is gated with "AgenticOS backend is offline. Reconnecting now…" (or the
  failed-restore message) and sends are answered truthfully instead of being
  routed into Jarvis logic. Transient starting/reconnecting states keep the
  composer usable.

## Security

Backend stdout/stderr is redacted before it is stored or shown:
`key/token/secret/password/authorization = value` pairs, `Bearer <token>`,
`sk-…` keys, and JWTs become `[REDACTED]`.

## Troubleshooting

- **Backend failed (port conflict):** another process holds :4000. Stop it
  (or set `AGENTICOS_BACKEND_PORT`/`server/.env PORT`), then Retry.
- **Backend failed (crash loop):** open diagnostics → recent backend output
  shows the redacted tail; fix the cause, press Retry.
- **External mode stuck offline:** start the backend where it is managed
  (`cd server && node dist/index.js` or `dev-clean.ps1`); the UI flips to
  Connected automatically.
