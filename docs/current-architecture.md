# Current Architecture: Agentic OS

## Stack Overview
- **Frontend**: React 18, Vite, Electron (optional wrapper). Full-stack TypeScript.
- **Backend**: Node.js, Express, Drizzle ORM, better-sqlite3.
- **Styling**: Vanilla CSS + Tailwind classes.
- **Persistence**: SQLite (local).

## Codex & OmniRoute Integration
- **CodeX Assistant**: (`src/pages/CodexDashboard.tsx`). Acts as a primary interactive coding interface.
- **OmniRoute**: (`server/src/services/llmGateway.ts`). A unified LLM router and gateway that transparently routes requests to external providers (OpenAI, DeepSeek) or local models (Ollama) with automatic offline fallback.

## Agents, Skills, and Tasks
- **Agents**: Defined primarily as static metadata via `server/src/data.ts`. They represent personas/roles (e.g., Jarvis, Athena, CodeX, Hermes).
- **Skills**: Parametric tool definitions (`src/shared/types/skill.ts`) mapped to agents.
- **Scheduler**: (`server/src/services/scheduler/scheduler.ts`) A cron-based system that queues runs based on time triggers.
- **Runs**: Handled by `runStore.ts`. Represents stateful execution traces of tasks.

## Database Schema
Defined in `server/src/db/schema.ts`:
- `tasks`: Core unit of work.
- `schedules`: Time-based triggers.
- `runs`: Executions of tasks.
- `run_steps`: Individual agent/tool operations inside a run.
- `skills`: Registered agent capabilities.
*Note: The schema is currently generalized for abstract "tasks" and lacks domain-specific tables for revenue, KPIs, or experiments.*

## Existing Screens
- **Pipeline (`PipelineBoard.tsx`)**: High-level visual map of agent handoffs (Ingestion → Planning → Execution → Delivery). Currently static.
- **Boards (`KanbanBoardPage.tsx`)**: High-level operational queue for tasks.
- **Control Room (`ControlRoom.tsx`)**: System health, active nodes, and terminal logs.
- **Research (`ResearchBoard.tsx`)**: Canvas for web research and evidence gathering.
- **Hermes Studio (`HermesStudio.tsx`)**: Delivery terminal to review and stage agent outputs.
- **Runs (`RunsBoard.tsx`)**: Execution tracing.
- **Skills (`Skills.tsx`)**: Capability configuration.
- **Ornith (`OrnithDashboard.tsx`)**: An alternative agent interface prioritizing voice and local LLM takeover features.
