# Agentic OS — Backend Architecture

> Version 9.0 · Express/Node · TypeScript (ESM)

---

## Overview

The backend is a Node.js/Express server providing a REST + SSE API for the Agentic OS frontend shell. It runs on `localhost:4000` in development and is designed as a modular adapter-first runtime host.

```
┌──────────────────────────────────────────────────────────┐
│  Frontend (React/Vite)          localhost:5173           │
│  DataProvider → apiClient → fetch → localhost:4000/api   │
└──────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────┐
│  Backend (Express/Node)         localhost:4000           │
│                                                          │
│  Middleware Stack:                                       │
│    attachRequestId → cors → json → authMiddleware →      │
│    routers → notFound → errorHandler                     │
│                                                          │
│  Routers (12):                                           │
│    health, agents, providers, runtimes, runs,            │
│    chat (+ SSE), memory, boards, tools,                  │
│    sync (+ SSE), loops, video (+ SSE)                    │
│                                                          │
│  Services:                                               │
│    runStore, runtimeRegistry, loopEngine                 │
│                                                          │
│  Adapters (RuntimeAdapter interface):                    │
│    HermesAdapter, JarvisAdapter, VideoAdapter            │
└──────────────────────────────────────────────────────────┘
```

---

## Directory Structure

```
server/
├── src/
│   ├── index.ts              # Entrypoint — router composition + bootstrap
│   ├── data.ts               # Seed catalog (agents, providers, tools, boards…)
│   ├── types.ts              # All domain types + UI state types
│   │
│   ├── adapters/
│   │   ├── hermesAdapter.ts  # RuntimeAdapter for Hermes (chat/task/workflow)
│   │   ├── jarvisAdapter.ts  # RuntimeAdapter for Jarvis (task/workflow/deploy)
│   │   └── videoAdapter.ts   # RuntimeAdapter for Video-Agent pipeline
│   │
│   ├── middleware/
│   │   ├── auth.ts           # Bearer token auth (dev bypass, prod enforce)
│   │   └── errors.ts         # errorHandler + notFound (standard error envelope)
│   │
│   ├── routers/
│   │   ├── health.ts         # GET /api/health
│   │   ├── agents.ts         # GET /api/agents, /api/agents/:id
│   │   ├── providers.ts      # GET /api/providers, /api/providers/:id
│   │   ├── runtimes.ts       # GET /api/runtimes, /api/runtimes/:id
│   │   ├── runs.ts           # GET|POST /api/runs, GET /:id, DELETE /:id/cancel
│   │   ├── chat.ts           # POST /api/chat/message, /chat/resolve, SSE /chat/stream/:runId
│   │   ├── memory.ts         # GET /api/memory/scopes, /memory/entries
│   │   ├── boards.ts         # GET /api/boards, /boards/:id
│   │   ├── tools.ts          # GET /api/tools
│   │   ├── sync.ts           # POST /api/sync/queue|now|retry, SSE /sync/status
│   │   ├── loops.ts          # GET|POST /api/loops, POST /:id/run, GET /:id/status
│   │   └── video.ts          # GET|POST /api/video/jobs, GET /jobs/:id, SSE /video/stream/:id
│   │
│   ├── services/
│   │   ├── runStore.ts       # In-memory RunRecord store (EventEmitter)
│   │   ├── runtimeRegistry.ts # Registry of RuntimeAdapter instances
│   │   └── loopEngine.ts     # Multi-step loop executor (topo sort, concurrency limit)
│   │
│   └── utils/
│       └── requestId.ts      # Attach UUID to req.id per request
│
└── data/                     # JSON persistence files (gitignored in prod)
```

---

## Route Catalog

### System

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Status, uptime, environment. Always public. |

### Entities (Read-Only Catalog)

| Method | Path | Response |
|--------|------|----------|
| GET | `/api/agents` | `AgentDefinition[]` |
| GET | `/api/agents/:id` | `AgentDefinition` |
| GET | `/api/providers` | `ProviderDefinition[]` |
| GET | `/api/providers/:id` | `ProviderDefinition` |
| GET | `/api/runtimes` | `Runtime[]` |
| GET | `/api/runtimes/:id` | `Runtime` |
| GET | `/api/boards` | `Board[]` |
| GET | `/api/tools` | `ToolDefinition[]` |

### Runs

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/runs` | List runs. Query: `?agentId=`, `?status=` |
| GET | `/api/runs/:id` | Get single run |
| POST | `/api/runs` | Create and invoke a run. Body: `{ agentId, prompt, mode? }` |
| DELETE | `/api/runs/:id/cancel` | Cancel a running run |

### Chat + SSE

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/chat/message` | Send message. Body: `{ agentId, message, sessionId? }`. Returns `{ runId }`. |
| POST | `/api/chat/resolve` | Resolve agent intent. Body: `{ message }`. Returns `{ agentId, confidence }`. |
| GET | `/api/chat/stream/:runId` | **SSE stream** for a run. Events: `chat_chunk`, `run_status`, `video_stage` |

#### SSE Event Schema — `/api/chat/stream/:runId`

```
event: chat_chunk
data: { "chunk": "word " }

event: run_status
data: { "status": "completed" | "failed" }

event: video_stage
data: { "stage": "scripting" | "rendering" | ..., "status": "running" | "completed" }
```

### Memory

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/memory/scopes` | `MemoryScope[]` |
| GET | `/api/memory/scopes/:id` | `MemoryScope` |
| GET | `/api/memory/entries` | `MemoryEntry[]`. Query: `?scopeId=` |

### Obsidian Sync

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sync/status` | **SSE stream** of sync state: `{ pendingCount, failedCount, lastSyncedTime }` |
| POST | `/api/sync/queue` | Queue a `MemoryEntry`. Body: `{ memoryEntry: MemoryEntry }` |
| POST | `/api/sync/now` | Flush queue → write `.md` files. Body: `{ config: ObsidianConfig }` |
| POST | `/api/sync/retry` | Retry failed sync jobs. Body: `{ config: ObsidianConfig }` |
| GET | `/api/sync/jobs` | List `SyncJob[]` |

#### Obsidian Markdown Format

```markdown
---
id: mem-001
kind: note
source: run/run-abc123
date: 2026-06-18T00:00:00Z
---
# Entry Title
Entry content here.
```

### Loop Engine

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/loops` | `LoopDefinition[]` |
| GET | `/api/loops/:id` | `LoopDefinition` |
| POST | `/api/loops` | Create loop. Body: `{ name, description?, steps: LoopStep[] }` |
| POST | `/api/loops/:id/run` | Execute loop async. Returns `202`. |
| GET | `/api/loops/:id/status` | `{ definition, currentRun }` |
| GET | `/api/loops/runs/all` | `LoopRun[]` |

### Video-Agent Pipeline

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/video/jobs` | `VideoJobRecord[]` |
| GET | `/api/video/jobs/:id` | `VideoJobRecord` |
| POST | `/api/video/jobs` | Create job. Body: `{ prompt, format, targetDurationSeconds? }` |
| GET | `/api/video/stream/:id` | **SSE stream** of stage events |

#### Video SSE Event Schema

```
event: video_stage
data: { "stage": "scripting" | "asset-gathering" | "rendering" | "review" | "publish", "status": "running" | "completed", "jobId": "vj-...", "artifactId"?: "art-video-..." }
```

---

## RuntimeAdapter Interface

All runtime execution goes through the `RuntimeAdapter` contract. Register adapters in `index.ts` via `runtimeRegistry.register(...)`.

```typescript
interface RuntimeAdapter {
  id: string;
  label: string;
  health(): Promise<RuntimeHealth>;
  listAgents(): Promise<AgentDefinition[]>;
  invoke(input: AgentInvocation): Promise<InvocationAck>;
  stream(input: AgentInvocation): AsyncIterable<RuntimeEvent>;
  cancel(runId: string): Promise<void>;
  getRun(runId: string): Promise<RunRecord>;
  listTools(agentId?: string): Promise<ToolDefinition[]>;
  listMemoryScopes(agentId?: string): Promise<MemoryScope[]>;
}
```

**To add a new runtime:** create `src/adapters/<name>Adapter.ts`, implement `RuntimeAdapter`, and call `runtimeRegistry.register(new MyAdapter())` in `index.ts`.

---

## Error Envelope

All errors follow this format:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Human-readable description",
    "requestId": "uuid-per-request"
  }
}
```

Standard error codes: `NOT_FOUND`, `INVALID_INPUT`, `UNAUTHORIZED`, `FORBIDDEN`, `CONFLICT`, `INTERNAL_ERROR`.

---

## Auth Model

| Env | Behavior |
|-----|----------|
| `NODE_ENV !== 'production'` | All requests pass through. Warning logged if no token set. |
| `NODE_ENV === 'production'` | `Authorization: Bearer <AGENTOS_API_TOKEN>` required on all routes except `/api/health`. |

Set `AGENTOS_API_TOKEN` in environment to enable token enforcement in production.

---

## Video Render Engine Seam

In `videoAdapter.ts`, the rendering stage contains a clearly marked hook for real render integration:

```typescript
// Real render hook seam — insert actual API call here when env key present:
// if (currentStage === 'rendering' && process.env.REMOTION_OUTPUT_DIR) {
//   await spawnRemotion(job);    // Option A: Remotion
// }
// if (currentStage === 'rendering' && process.env.CREATOMATE_API_KEY) {
//   await postCreatomate(job);   // Option B: Creatomate
// }
// if (currentStage === 'rendering' && process.env.FFMPEG_PATH) {
//   await spawnFFmpeg(job);      // Option C: FFmpeg subprocess
// }
```

---

## Loop Engine

`loopEngine.ts` executes `LoopDefinition` objects as follows:

1. **Topological sort** — steps are sorted by `dependsOn[]` into serial waves
2. **Concurrent waves** — steps within the same wave fire in parallel (capped at `CONCURRENCY_LIMIT = 4`)
3. **Output propagation** — if a step sets `outputKey`, its output is passed as context to all dependent steps
4. **Adapter delegation** — each step is dispatched via `runtimeRegistry.getAdapter(agent.runtimeId)`

To change concurrency limit, update `CONCURRENCY_LIMIT` in `loopEngine.ts`.
