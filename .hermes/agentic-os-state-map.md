# Agentic OS — Current State Map (June 23, 2026)

## Repo root
`C:\Users\Cris\.gemini\antigravity\scratch\agenticos`

## Stack
- **Frontend:** React 19 + Vite 5 + Electron (vite-plugin-electron)
- **Frontend port:** 5173 (Vite dev server)
- **Backend:** Express + ts-node (server/src/index.ts)
- **Backend port:** 4000
- **Proxy:** Vite proxies /api → localhost:4000
- **State:** useContext (dataStore) + useReducer (appStore)
- **CSS:** Custom design system in index.css, CSS variables, no Tailwind
- **UI libs:** lucide-react, @dnd-kit/core+sortable, react-router-dom v7, gsap

## Key files this session will touch
- `src/pages/RunsBoard.tsx` — kanban runs + composer
- `src/pages/ControlRoom.tsx` — health metrics + event log
- `src/pages/ProvidersBoard.tsx` — provider registry columns
- `src/pages/ModelsPage.tsx` — LLM provider grid
- `src/pages/AgentsGallery.tsx` — agent entity grid
- `src/pages/DesktopBoard.tsx` — home with agent tiles
- `src/components/drawers/JarvisDrawer.tsx` — voice-first chat drawer
- `src/components/drawers/HermesDrawer.tsx` — command/voice drawer
- `src/store/dataStore.tsx` — fetches from API server
- `src/store/appStore.tsx` — reducer for drawer/chat/jarvis
- `src/types/index.ts` — domain model types
- `src/mocks/data.ts` — frontend mock data (agents, providers, runs)
- `server/src/data.ts` — server seed data
- `server/src/index.ts` — backend entry, routers
- `server/src/routers/runs.ts` — runs CRUD API
- `server/src/routers/providers.ts` — providers API
- `server/src/routers/agents.ts` — agents API
- `src/index.css` — CSS variables, design system
