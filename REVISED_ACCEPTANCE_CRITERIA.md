# REVISED_ACCEPTANCE_CRITERIA.md
**Truthful Acceptance Standards & Verification Contracts for Jarvis**  
**Date:** 2026-09-20  
**Repository:** `D:\AgenticOS`

---

## 1. Core Acceptance Principles

The primary failure of previous acceptance test suites was treating technical invariants (non-empty strings, valid HTTP 200 codes, entity resolution) as proof of user intent fulfillment. 

Under the revised criteria:
1. **A technically valid route is NOT sufficient.**
2. **A non-empty answer is NOT sufficient.**
3. **An entity match is NOT sufficient.**
4. **Updating `activeProject` in memory is NOT equivalent to GUI navigation.**
5. **A response that fulfills only a subset of requested sub-goals is a FAIL.**
6. **A generic clarification prompt when the system already holds sufficient context is a FAIL.**
7. **`ALL PASSED` may only be reported when the user's complete request is actually fulfilled.**

---

## 2. Goal-Completeness Verification Contract

For every turn—especially compound or coordinated requests—the acceptance harness must record and evaluate four distinct goal sets:

```typescript
interface GoalCompletenessRecord {
  REQUESTED_GOALS: string[];
  EXECUTED_GOALS: string[];
  SATISFIED_GOALS: string[];
  FAILED_GOALS: string[];
}
```

### 2.1 Rule of Completeness
Every item in `REQUESTED_GOALS` must appear in `SATISFIED_GOALS`, or appear in `FAILED_GOALS` with an explicit, grounded explanation presented in the spoken text.

#### Example:
Command: `"Jarvis, open Shopify and tell me the status, blockers and what we should do next."`

```yaml
REQUESTED_GOALS:
  - OPEN_PROJECT: Shopify
  - GET_STATUS: Shopify
  - GET_BLOCKERS: Shopify
  - GET_NEXT_ACTIONS: Shopify

EXECUTED_GOALS:
  - OPEN_PROJECT: Shopify
  - GET_STATUS: Shopify
  - GET_BLOCKERS: Shopify
  - GET_NEXT_ACTIONS: Shopify

SATISFIED_GOALS:
  - OPEN_PROJECT: Shopify
  - GET_STATUS: Shopify
  - GET_BLOCKERS: Shopify
  - GET_NEXT_ACTIONS: Shopify

FAILED_GOALS: []

VERDICT: PASS
```

If `SATISFIED_GOALS` contains only `[OPEN_PROJECT, GET_STATUS]`, the verdict is **FAIL**.

---

## 3. UI Navigation vs. Contextual State Contract

Active project conversational focus and Electron GUI navigation are separate operational concepts.

The harness must track four independent flags for any navigation turn:

```typescript
interface NavigationVerificationRecord {
  CONTEXT_SWITCH_SUCCESS: boolean;       // Backend focus updated to target project
  UI_NAVIGATION_REQUESTED: boolean;       // beginNavigation() emitted navigation_request
  UI_NAVIGATION_ACKNOWLEDGED: boolean;    // Client emitted POST /api/jarvis/navigation/ack
  UI_NAVIGATION_VERIFIED: boolean;        // Route confirmed matching actualRoute
}
```

### 3.1 Strict Failure Invariant
If Jarvis generates any message indicating navigation failure, such as:
> *"the interface did not navigate successfully"*  
> *"could not open that view"*  
> *"no AgenticOS view I can open"*

The navigation test **MUST FAIL**, regardless of whether `entityId` matched or `CONTEXT_SWITCH_SUCCESS` was `true`.

---

## 4. Next-Action Semantics Contract

Queries regarding next actions:
- `"What should we do next?"`
- `"What do we do next?"`
- `"What is next?"`
- `"What needs to be done next?"`
- `"Next step?"`

### 4.1 Requirement
The response must contain **grounded next action(s)**, not merely project statistics or counters.

### 4.2 Authoritative Derivation Hierarchy
Next actions must be deterministically retrieved from AgenticOS state in this priority order:
1. **Unblocking Action:** If any task has a blocker recorded, the priority next action is to unblock that specific task (e.g., provide required API credentials, resolve service dependency, resume interrupted task).
2. **Interrupted / Resumable Action:** If a task was interrupted by a restart or failure, the next action is to resume or retry that task.
3. **Queued Work Execution:** If queued background tasks exist, the next action is to dispatch or execute the leading queued task.
4. **Open Project Tasks:** If unstarted project tasks exist, the next action is to begin the leading eligible task.
5. **Completed State:** If all tasks are completed, the next action is to define new project goals or initiate a Revenue Operator mission.

Responses that simply output counters (e.g., *"5 goals, 5 tasks, 3 running"*) **FAIL**.

---

## 5. Grounded Inspection ("Tell me what you see") Contract

When an active project or entity is established in conversation context, queries such as:
- `"Tell me what you see."`
- `"What do you see?"`
- `"Show me what is happening."`
- `"What's going on here?"`
- `"Tell me about this."`
- `"What is here?"`

### 5.1 Requirement
The system must:
1. Resolve the query against the current active entity.
2. Retrieve and speak a grounded snapshot of the active entity's state (goals, tasks, background tasks, status).
3. **Never** ask the user to clarify or choose the entity again (e.g., *"I heard Free Cash. Do you want me to open it, check its status...?"*).

---

## 6. Separation of Verification Suites

Acceptance testing must be split into two separate, truthfully named suites:

### 6.1 Suite A: Semantic & Routing Acceptance
- **File:** `D:\AgenticOS\scripts\verify-semantic-stream-turn-flow.cjs`
- **Scope:** Sequential multi-turn dialogue, context inheritance, goal completeness, project intelligence, next-action retrieval, navigation transactions, and emergency stop over the production HTTP/SSE streaming interface.
- **Reporting:** `SEMANTIC / ROUTING ACCEPTANCE: X / Y PASSED (Z%)`

### 6.2 Suite B: Real Physical Microphone Acceptance
- **File:** `D:\AgenticOS\scripts\verify-physical-microphone-live.cjs`
- **Scope:** Physical Windows audio capture → VAD RMS measurement → WebM audio creation → `/api/voice/transcribe` upload → `whisper_worker.py` CUDA transcription → confidence score calculation → raw transcript extraction.
- **Reporting:** `REAL PHYSICAL MICROPHONE ACCEPTANCE: X / Y PASSED (Z%)`

### 6.3 Prohibition
The pass rates of Suite A and Suite B **MUST NOT** be blended into an aggregate percentage. They exercise distinct physical and transport layers and must be evaluated independently.
