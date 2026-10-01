---
name: agenticos-runtime-verification
description: >-
  Enforces empirical runtime verification for AgenticOS before making claims.
  Use when validating fixes, checking server health, verifying builds, inspecting
  processes, or testing Jarvis and AgenticOS components.
---

# AgenticOS Runtime Verification

This skill prevents claims based solely on static source inspection and enforces verification against the actual running AgenticOS instance and loaded runtime artifacts.

## The Four States Model

Always distinguish between these four distinct layers:

1. **SOURCE STATE**:
   - Files currently on disk in git (`src/`, `server/src/`, `electron/`).
   - Represents intent, not necessarily what is executing or bundled.
2. **BUILD STATE**:
   - Transpiled and bundled outputs (`dist/`, `server/dist/`, Vite bundle chunks).
   - Can easily be stale if a build step was skipped or failed.
3. **RUNNING STATE**:
   - Active processes loaded in memory (Electron main process, Node HTTP server on port 4600, Vite dev server on port 5173/3000, Ollama daemon).
   - In Auto-Managed mode, Electron probes before spawning and may adopt a pre-existing Node instance running old code.
4. **PHYSICAL USER-OBSERVED STATE**:
   - Actual sound emitted from physical speakers into the room.
   - Physical microphone input captured from the room's ambient audio.
   - Windows visible on the user's desktop display.
   - Synthetic unit tests, mock audio buffers, and fake WebRTC streams ARE NOT physical tests.

---

## Operational Verification Protocol

Before declaring any component healthy, repaired, or working:

### 1. Inspect Current Workspace State
- Always check `git status` and `git diff` first.
- Preserve uncommitted user changes unless explicitly instructed.
- Confirm whether changes exist in source, dist, or both.

### 2. Identify Running Processes & Ports
- Never assume ports 4600 or 5173 are live without checking.
- Inspect active processes:
  ```powershell
  Get-NetTCPConnection -LocalPort 4600, 5173 -ErrorAction SilentlyContinue | Select-Object LocalAddress, LocalPort, OwningProcess, State
  Get-Process -Id <OwningProcess>
  ```
- Check process command line to identify whether the running instance is dev mode (`server/dist/index.js`), packaged executable (`AgenticOS.exe`), or an orphaned background worker.

### 2b. Sandbox any script that must not touch the live DB

`server/src/db/index.ts` resolves the database in this order:
`AGENT_TEAMS_DB_PATH` → `AGENTICOS_DATA_DIR` → packaged/roaming default.

- The agent shell session already exports `AGENT_TEAMS_DB_PATH` pointing at the live canonical DB,
  and it takes PRECEDENCE over `AGENTICOS_DATA_DIR`. Setting only `AGENTICOS_DATA_DIR=<sandbox>`
  does NOT sandbox anything — the script writes to live. Pin BOTH:
  `AGENTICOS_DATA_DIR=<sandbox> AGENT_TEAMS_DB_PATH=<sandbox>/agentic-os.db node scripts/<probe>.mjs`
- Copy `agentic-os.db` + `-wal` + `-shm` together; live rows can exist only in the `-wal`, so a
  main-file-only copy (or a main-file sha comparison) does not prove live state or isolation.
- Prove isolation empirically: read a volatile counter (e.g. `revenue_human_gates`) in live and in
  the sandbox before and after the run; the sandbox must move and live must not.
- If a probe leaked into live: back up db+wal+shm first, delete exactly the rows it created by id
  inside a transaction, then re-read both DBs (counts + ids) to prove the restore. Report the
  incident rather than silently repairing.
- Before claiming any HTTP-path result, confirm a listener exists: no `:4600` in `netstat -an` means
  the backend is down and only DB + `server/dist` code paths can be exercised.

### 3. Verify Live Endpoints
- Probe backend health directly via HTTP (do not rely on renderer UI icons alone):
  ```powershell
  Invoke-RestMethod -Uri "http://127.0.0.1:4600/api/health" -Method Get
  ```
- Inspect reported subsystem health:
  - `status: "ready"`
  - ModelGateway connectivity
  - Active LLM provider / model selection
  - STT/TTS engine readiness

### 4. Distinguish Source from Running Build
- If source was edited in `server/src/`, verify that `npm run build` or `tsc` was executed and that the active Node process was restarted or reloaded.
- Check file timestamps between `server/src/**/*.ts` and `server/dist/**/*.js`:
  ```powershell
  (Get-Item server/dist/index.js).LastWriteTime
  ```
- Compare runtime responses with code changes to guarantee the running instance is executing the new code.

### 5. Physical vs Synthetic Verification Rules
- **Microphone**: NEVER call simulated microphone injection or automated test feeding a physical microphone test. Physical tests require actual acoustic input from the user or microphone capture.
- **Audio Output (TTS / Audio Playback)**: NEVER claim audible playback succeeded unless physically observed, verified via audio device playback metrics, or confirmed by the user.
- **Missing Telemetry**: Remember: *Missing telemetry is not proof an event did not occur.* Telemetry loggers may be throttled, disabled, or failing independently of the underlying event.

### 6. Standard for PASS
A task or verification only reaches PASS when:
- Concrete evidence (logs, HTTP responses, process state, test assertions) confirms all acceptance criteria.
- The distinction between automated verification and physical verification is made explicit.
- Any unverified aspect is clearly documented.
