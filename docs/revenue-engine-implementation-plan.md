# Revenue Engine Implementation Plan

## Phased Implementation Sequence

### Phase 1: Data Model & Primitives (Backend)
- **Database Extension**: Add a `revenue_opportunities` table to `server/src/db/schema.ts` to represent the core business entity. Include columns for `status` (draft, researching, needs_approval, generating, ready, published), `research_data` (JSON), `score` (Integer), and `kpi_targets` (JSON).
- **Metrics Table**: Add a `revenue_metrics` table for tracking post-publish yield.
- **API Routes**: Create `server/src/routers/revenue.ts` for CRUD operations, scoring triggers, and state machine transitions (e.g., `POST /api/revenue/:id/approve`).

### Phase 2: Core Visual Integration (Frontend)
- **Pipeline Overhaul**: Refactor `src/pages/PipelineBoard.tsx` to fetch aggregate opportunity counts from the backend and map them onto the 7 Revenue Engine stages.
- **Kanban Repurposing**: Update `KanbanBoardPage.tsx` to load cards directly from the `revenue_opportunities` table, visually mapping columns to the opportunity status enum.
- **Approvals Inbox**: Add an action-oriented widget to `ControlRoom.tsx` that queries for `status = 'needs_approval'` opportunities and surfaces "Approve/Reject" buttons directly to the operator.

### Phase 3: Agentic Execution Wiring
- **Research to Opportunity**: Wire `ResearchBoard.tsx` so that when Athena completes research, the findings automatically seed a new `revenue_opportunities` record.
- **Generation Trigger**: When a human clicks "Approve" in the Control Room, trigger a backend job that queues an OmniRoute generation task (via `runStore`), linking the resulting content back to the opportunity.
- **Staging & Publishing**: Push the final generated payload to `HermesStudio.tsx`, treating Hermes as the final "Publish Queue" checkpoint before external delivery.

---

## Milestone 2: Smallest Possible Start

To begin real implementation without over-architecting, Milestone 2 should focus exclusively on bringing the "Revenue Opportunity" concept to life inside the UI.

**The Minimum Path:**
1. **Schema**: Add the `revenue_opportunities` table to Drizzle schema.
2. **API**: Create a simple `GET` and `POST` route for opportunities.
3. **UI Integration**: Update the existing `KanbanBoardPage.tsx` to fetch and display these opportunities as cards instead of generic system tasks.

*Why this path?* It establishes the primary business object in the database and provides immediate visual feedback to operators in the Kanban view. Once visible, the routing (Research → Score → Approve) can be layered on iteratively.
