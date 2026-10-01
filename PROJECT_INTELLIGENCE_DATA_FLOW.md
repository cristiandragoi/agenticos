# Project Intelligence Data Flow Specification

## 1. Executive Summary

Opening a project UI via navigation is fundamentally distinct from Jarvis possessing actionable project intelligence.

In the previous implementation:
1. Jarvis successfully triggered client-side navigation (`executeNavigate` -> UI opens project).
2. However, Jarvis failed to retrieve deterministic project facts (stages, progress, completed tasks, active tasks, blocked tasks, blockers, next steps).
3. Follow-up queries were routed to an ungrounded LLM or an unhandled opportunity snapshot, resulting in the fallback message:
   *"I checked the system state, but have no further details on that item."*

This document defines the authoritative data flow for retrieving deterministic project facts directly from the AgenticOS SQLite database and formatting them for instant spoken and visual responses.

---

## 2. Authoritative Data Storage Topology

All project facts reside in SQLite at `C:\Users\cd-pr\AppData\Roaming\AgenticOS\data\agentic-os.db`.

```
=============================================================================
                          agentic-os.db (SQLite)
=============================================================================
  TABLE: projects
  - id (e.g. 'proj-free-cash', 'proj-shopify', 'proj-tiktok-shop')
  - name ('Free Cash', 'Shopify', 'TikTok Shop')
  - description
  - status ('active', 'planning', 'blocked', 'completed')
  - priority (1, 2, 3)
  - created_at, updated_at
-----------------------------------------------------------------------------
  TABLE: project_tasks
  - id
  - project_id (foreign key -> projects.id)
  - title
  - description
  - status ('pending', 'in_progress', 'completed', 'blocked')
  - stage ('discovery', 'setup', 'automation', 'scaling')
  - blocker_reason (text describing why task is blocked)
  - order_index
-----------------------------------------------------------------------------
  TABLE: background_tasks
  - id
  - project_id
  - task_type
  - status ('running', 'completed', 'failed')
  - output
-----------------------------------------------------------------------------
  TABLE: revenue_opportunities
  - id (e.g. 'opp-45086c0d-')
  - title ('Free Cash')
  - status ('active', 'evaluating')
  - projected_revenue
  - blockers
=============================================================================
```

---

## 3. Deterministic Snapshot API: `getProjectSnapshot(projectId)`

To eliminate hallucination and guarantee instant, reliable answers, Jarvis must query the database deterministically using a single canonical method:

```typescript
export interface ProjectSnapshot {
  project: {
    id: string;
    name: string;
    status: string;
    description?: string;
    priority?: number;
  };
  metrics: {
    totalTasks: number;
    completedTasks: number;
    activeTasks: number;
    blockedTasks: number;
    percentComplete: number;
  };
  stages: {
    currentStage: string;
    completedStages: string[];
    upcomingStages: string[];
  };
  tasks: {
    completed: Array<{ id: string; title: string }>;
    active: Array<{ id: string; title: string; assignedWorker?: string }>;
    blocked: Array<{ id: string; title: string; reason: string }>;
    nextActions: Array<{ id: string; title: string; priority: number }>;
  };
  insights: {
    blockersSummary: string[];
    recommendedNextStep: string;
    revenueInsight?: string;
  };
}
```

### Deterministic SQL Query Pipeline:
```sql
-- 1. Fetch Project Record
SELECT id, name, status, description, priority FROM projects WHERE id = :projectId;

-- 2. Fetch Project Tasks Grouped by Status & Stage
SELECT id, title, status, stage, blocker_reason, order_index
FROM project_tasks
WHERE project_id = :projectId
ORDER BY order_index ASC;

-- 3. Fetch Active Background Tasks / Executions
SELECT id, task_type, status, output
FROM background_tasks
WHERE project_id = :projectId AND status IN ('running', 'pending');
```

---

## 4. Spoken Response Synthesis Logic

When the user asks about status, blockers, or next steps, Jarvis must format the deterministic snapshot into concise, natural spoken responses without requiring external LLM hallucination:

### A. General Status Query ("Tell me the status of Free Cash")
> *"Free Cash is currently active and 45% complete. 4 tasks are finished, 2 are in progress, and 1 task is blocked."*

### B. Blockers Query ("What is blocked in Shopify?")
> *"In Shopify, the task 'Configure Stripe Webhook' is blocked waiting for API production credentials."*

### C. Next Actions Query ("What should we do next?")
> *"The immediate next step for Free Cash is 'Run payout verification workflow', followed by 'Sync ledger entries'."*

### D. Compound Query ("Open Shopify and tell me the status and blockers")
> *"Opened Shopify. The project is currently active with 8 tasks completed and 2 active. One task is blocked: 'Stripe API production key missing'."*

---

## 5. Bridging React UI State to Jarvis

Currently, certain operational details in the UI (such as active tabs or real-time streaming terminal logs) reside only in React state.

To ensure Jarvis has full situational awareness:
1. Any state transition in the GUI (e.g. user manually switches project tabs, or an automation starts) triggers a lightweight write to the local session cache / DB.
2. The active project ID is persisted in both `agentic-os.db` (session table) and `active-project.json` atomically.
3. Jarvis always reads `activeProjectId` from the shared session context rather than relying on ungrounded conversation history.
