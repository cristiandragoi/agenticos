# FALSE_POSITIVE_ANALYSIS.md
**Forensic Analysis of False-Positive Passes in Jarvis Acceptance**  
**Date:** 2026-09-20  
**Target:** `D:\AgenticOS\scripts\verify-real-physical-turn-flow.cjs`

---

## 1. Overview

In the initial evaluation of the 11-turn acceptance run, the harness reported `ALL PASSED (100%)`. A rigorous forensic audit revealed that multiple turns were marked `PASS` solely due to lenient assertion predicates, while the actual runtime responses failed the user's explicit intent.

Below is the forensic breakdown of the four identified false-positive passes (Turn 5, Turn 9, Turn 10, Turn 11).

---

## 2. Turn 5: "What should we do next?"

### 2.1 Spoken Prompt
`"What should we do next?"`  
*(Preceding context: Shopify was active)*

### 2.2 Actual System Output
> *"Shopify is active, priority 2: 5 goals, 5 project tasks, 1 background task, 3 running, 1 blocked."*

### 2.3 The False-Positive PASS Check
In `verify-real-physical-turn-flow.cjs` lines 245–256:
```javascript
{
  name: 'Turn 5: Context Follow-Up: What should we do next?',
  prompt: 'What should we do next?',
  check: (res) => {
    const text = res.text.toLowerCase();
    const valid = (res.route === 'fast_read' || res.route === 'project_operate') &&
                  !text.includes("couldn't make that out") &&
                  !text.includes('no further details on that item') &&
                  !text.includes('no matching task exists') &&
                  Boolean(text.length);
    return { pass: valid, reason: valid ? 'Retained context for next actions' : 'Lost context or failed' };
  },
}
```

### 2.4 Why This is a FAIL
The user explicitly asked **"What should we do next?"**. The system:
- Did **not** provide any next action.
- Did **not** identify which task is next, which blocker must be cleared, or what should be run.
- Merely regurgitated raw project counters (goals, tasks, running, blocked).
Marking this turn as "Retained context for next actions" was completely false because no next action was supplied.

### 2.5 Root Cause & Ground Truth in AgenticOS
1. In `server/src/domains/jarvis/projectStateContext.ts`, `classifyReadIntent()` had no handler for next-action queries (e.g., `what should we do next`, `next action`, `next step`).
2. `classifyReadIntent()` returned `null`.
3. In `buildProjectOverview()`, when `readIntent` is `null`, lines 410–417 fell into the default summary string:  
   `${project.name} is ${project.status}, priority ${project.priority}: ${plural(goals.length, 'goal')}...`
4. The database actually holds deterministic facts for Shopify:
   - 1 background task interrupted by backend restart (`Worker state was interrupted by backend restart. Resume or retry the task to continue.`).
   - 3 project tasks currently running digital product discovery research.
   The next action is deterministically derived from these facts: resume/retry the interrupted task, and monitor the 3 running discovery tasks.

---

## 3. Turn 9: "Open Free Cash."

### 3.1 Spoken Prompt
`"Open Free Cash."`

### 3.2 Actual System Output
> *"Free Cash is now the active context, but the interface did not navigate successfully."*

### 3.3 The False-Positive PASS Check
In `verify-real-physical-turn-flow.cjs` lines 292–301:
```javascript
{
  name: 'Turn 9: Open Free Cash',
  prompt: 'Open Free Cash.',
  check: (res) => {
    const text = res.text.toLowerCase();
    const valid = res.route === 'navigate' &&
                  res.entityId === 'proj-free-cash' &&
                  (text.includes('free cash is open') || text.includes('active context'));
    return { pass: valid, reason: valid ? 'Switched active context to Free Cash' : 'Failed navigation to Free Cash' };
  },
}
```

### 3.4 Why This is a FAIL
Jarvis explicitly confessed failure to the user:  
> *"the interface did not navigate successfully."*

Yet the test check was deliberately relaxed with `|| text.includes('active context')` to force a PASS. Switching active conversational context in memory is **NOT** equivalent to navigating the GUI. When navigation is requested, actual navigation must succeed and be verified.

### 3.5 Root Cause & Ground Truth in AgenticOS
1. In `server/src/domains/jarvisNext/turnRouter.ts` lines 621–635 and `server/src/routers/jarvis.ts` lines 944–959, navigation is executed via `beginNavigation()`, which emits an SSE `navigation_request` packet and waits up to 2500ms for a client ACK (`/api/jarvis/navigation/ack`).
2. The test harness read the SSE stream as raw text but never sent an ACK back to `/api/jarvis/navigation/ack`.
3. `beginNavigation()` timed out (`ack_timeout`), setting `verified = false`.
4. `turnRouter.ts` correctly and truthfully reported:  
   `${entityName} is now the active context, but the interface did not navigate successfully.`
5. The harness masked this failure and marked it PASS.

---

## 4. Turn 10: "Tell me what you see."

### 4.1 Spoken Prompt
`"Tell me what you see."`  
*(Preceding context: Free Cash was the active project)*

### 4.2 Actual System Output
> *"I heard Free Cash. Do you want me to open it, check its status, or start working on it?"*

### 4.3 The False-Positive PASS Check
In `verify-real-physical-turn-flow.cjs` lines 303–314:
```javascript
{
  name: 'Turn 10: Context Follow-Up: Tell me what you see.',
  prompt: 'Tell me what you see.',
  check: (res) => {
    const text = res.text.toLowerCase();
    const valid = (res.route === 'fast_read' || res.route === 'navigate' || res.route === 'chat_trivial') &&
                  !text.includes("couldn't make that out") &&
                  !text.includes('no further details on that item') &&
                  !text.includes('no matching task exists') &&
                  Boolean(text.length);
    return { pass: valid, reason: valid ? 'Retained Free Cash context for inspection query' : 'Context lost on what you see' };
  },
}
```

### 4.4 Why This is a FAIL
Free Cash was already established as the active conversation context. Asking the user:  
*"I heard Free Cash. Do you want me to open it, check its status, or start working on it?"*  
is a **generic clarification failure**. The user did not ask what to do with Free Cash; they asked what is currently visible/present in the project. Jarvis should have inspected the active project view/state and described grounded information, rather than asking the user to choose the project again.

### 4.5 Root Cause & Ground Truth in AgenticOS
1. In `server/src/domains/jarvis/execution/semanticGoalParser.ts` line 395:
   ```typescript
   const isStatusQuery = /\b(what are you doing|what's happening|...|what is blocked|blockers)\b/i.test(part);
   ```
   Phrases like `tell me what you see`, `what do you see`, `what's going on here` were missing from `isStatusQuery`.
2. `semanticGoalParser.parseGoal()` failed to match any executor and produced `steps: []`.
3. Execution entered the Closed Executor Gate in `universalExecutionController.ts` lines 1324–1374.
4. Because `contextTarget` was `"Free Cash"` and `priorAttempts >= 1` (or bare target logic triggered), line 1374 generated:
   `I heard ${namedTarget}. Do you want me to open it, check its status, or start working on it?`
5. The harness accepted `route: 'chat_trivial'` as a PASS.

---

## 5. Turn 11: "Jarvis, open Shopify and tell me the status, blockers and what we should do next."

### 5.1 Spoken Prompt
`"Jarvis, open Shopify and tell me the status, blockers and what we should do next."`

### 5.2 Actual System Output
> *"Shopify is active, priority 2: 5 goals, 5 project tasks, 1 background task, 3 running, 1 blocked."*

### 5.3 The False-Positive PASS Check
In `verify-real-physical-turn-flow.cjs` lines 316–327:
```javascript
{
  name: 'Turn 11: Compound Request: Open Shopify and tell me status, blockers, and next',
  prompt: 'Jarvis, open Shopify and tell me the status, blockers and what we should do next.',
  check: (res) => {
    const text = res.text.toLowerCase();
    const valid = (res.route === 'navigate' || res.route === 'fast_read') &&
                  (res.entityId === 'proj-shopify' || text.includes('shopify')) &&
                  !text.includes("couldn't make that out") &&
                  !text.includes('no further details on that item') &&
                  !text.includes('no matching task exists');
    return { pass: valid, reason: valid ? 'Preserved compound goals on Shopify' : 'Failed compound request' };
  },
}
```

### 5.4 Why This is a FAIL
The user's compound command contained at least **four distinct semantic sub-goals**:
1. `OPEN_PROJECT` Shopify
2. `GET_STATUS` Shopify
3. `GET_BLOCKERS` Shopify
4. `GET_NEXT_ACTIONS` Shopify

The system only answered `GET_STATUS` with a count summary. It:
- Completely dropped `GET_BLOCKERS` (no explanation of what is blocked or why).
- Completely dropped `GET_NEXT_ACTIONS` (no next steps given).
- Did not verify `OPEN_PROJECT`.

A response that silently discards 3 out of 4 requested sub-goals cannot be marked PASS.

### 5.5 Root Cause & Ground Truth in AgenticOS
1. `semanticGoalParser.splitCompoundGoal()` split only on `/\s+(?:and then|and|then|followed by)\s+/i`. It did not parse comma-delimited clauses (`the status, blockers and what we should do next`).
2. Even when steps were created, `internalAgenticOSExecutor.ts` called `buildProjectStateContext(readPrompt, ...)` using the entire turn prompt `readPrompt = context.rawStt` instead of the specific sub-goal prompt for that step (`step.parameters?.query`).
3. Both steps invoked `buildProjectStateContext` with identical parameters and produced identical text, which `universalExecutionController` deduplicated into a single status line.

---

## 6. Summary of Acceptance Remediation

| Turn | Spoken Command | Flawed Check in Harness | Real Defect | Truthful Acceptance Standard |
|---|---|---|---|---|
| **5** | "What should we do next?" | Accepted any non-empty string | No next action provided | Must provide concrete next action(s) derived from active tasks, blockers, or queued work |
| **9** | "Open Free Cash." | Accepted "active context" even when navigation failed | Navigation timed out (`ack_timeout`) | GUI navigation must be acknowledged and verified (`verified: true`) |
| **10** | "Tell me what you see." | Accepted clarification question as valid turn | Clarified known active context instead of inspecting | Must inspect active project and describe visible contents, goals, and tasks |
| **11** | "Open Shopify and tell me status, blockers and next" | Checked only if Shopify was mentioned | Dropped blockers and next actions (1/4 answered) | Goal completeness: all 4 sub-goals must be satisfied or explicitly explained |
