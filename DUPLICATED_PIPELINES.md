# Duplicated and Competing Pipelines Analysis

This document provides a forensic audit of redundant, conflicting, and overlapping logic across the AgenticOS / Jarvis codebase.

---

## 1. Overview of Identified Pipeline Conflicts

In the current live implementation, a single spoken utterance crosses multiple competing architectural layers, each attempting to independently:
1. Strip wake words
2. Intercept STOP / control intents
3. Gate on confidence
4. Resolve entities (projects, tasks)
5. Generate fallbacks / clarification responses

Because there is no single authoritative pipeline, control bounces between `TurnRouter`, `UniversalExecutionController`, `GroundedTurnBridge`, and `SupervisorLoop`, leading to unpredictable race conditions and contradictory user-facing messages.

---

## 2. Redundancy Matrix

| Architectural Function | Primary Implementation | Duplicate / Competing Implementation 1 | Duplicate / Competing Implementation 2 | Conflict Risk |
|---|---|---|---|---|
| **Wake Word Processing** | `server/src/domains/jarvis/voice/wakeWord.ts` | `turnRouter.ts` (lines 350–380) | `universalExecutionController.ts` (regex strips) | Inconsistent prefix stripping; downstream gets unexpected tokens |
| **STOP / Control Intent** | `server/src/domains/jarvisNext/controlIntent.ts` | `useVoiceIO.ts` (client-side regex) | `universalExecutionController.ts` (`isControlCommand`) | Race between frontend aborting TTS and backend handling turn |
| **Confidence Gating** | `turnRouter.ts` (`confidence >= 0.7`) | `universalExecutionController.ts` (`sttConfidence < 0.40`) | `whisper_worker.py` (avg_logprob math) | Premature rejection with conflicting threshold values |
| **Entity Resolution** | `EntityResolverRegistry` (Resolvers dir) | `semanticGoalParser.ts` (local regex extractor) | `projectStateContext.ts` (direct SQL lookups) | Target mismatch (e.g. `opp-` vs `proj-`) |
| **Project Context State** | Database (`agentic-os.db`) | Local file (`active-project.json`) | Frontend Zustand store (`useAppStore.ts`) | Out-of-sync active project pointers |
| **Clarification / Fallback** | `turnRouter.ts` (lines 805–815) | `universalExecutionController.ts` (lines 1150–1160, 1420–1435) | `supervisorLoop.ts` (`empty_supervisor_response`) | Spurious canned messages: "I couldn't make that out..." vs "I checked the system state..." |
| **Execution Dispatch** | `TurnRouter.routeTurn()` | `UniversalExecutionController.handleUserTurn()` | `GroundedTurnBridge.handleGroundedTurn()` | Unclear ownership of multi-step vs direct read requests |

---

## 3. Deep Dive into Specific Pipeline Conflicts

### A. Duplicate STOP / Barge-In Logic
- **Location 1**: `src/features/voice/useVoiceIO.ts` has a local keyword checker that triggers `window.speechSynthesis.cancel()` if words like `"stop"`, `"quiet"` are transcribed.
- **Location 2**: `server/src/domains/jarvisNext/controlIntent.ts` checks for control commands and returns `{ isControl: true, action: 'STOP' }`.
- **Location 3**: `server/src/domains/jarvis/execution/universalExecutionController.ts` checks if the goal starts with `"stop"`.
- **Consequence**: When the user says `"Stop"`, the frontend may immediately cancel audio playback, but the backend still routes the turn to the supervisor loop or planner, generating a new LLM execution turn in the background that re-triggers speech.

### B. Duplicate Wake-Word Logic
- **Location 1**: `wakeWord.ts` defines `stripWakeWord(text)` using patterns for `"jarvis"`, `"hey jarvis"`.
- **Location 2**: `turnRouter.ts` implements custom regex matching for `"jarvis"` and trims it before calling `classifyReadIntent`.
- **Location 3**: `semanticGoalParser.ts` does another pass of `text.replace(/^jarvis\s+/i, '')`.
- **Consequence**: Subordinate clauses in compound sentences (e.g., *"Jarvis open Free Cash and Jarvis tell me status"*) fail because secondary occurrences of the wake word are treated as entity names or search keywords.

### C. Competing Entity Providers
- **Location 1**: `ProjectEntityProvider` looks up records in the `projects` table.
- **Location 2**: `RevenueOperatorEntityProvider` looks up records in the `revenue_opportunities` table.
- **Conflict**: Because `RevenueOperatorEntityProvider` is registered first in `server/src/index.ts`, when a user says *"Free Cash"*, the entity resolver returns the opportunity `opp-45086c0d-` instead of the project `proj-free-cash`. As a result, project-specific task inspection and status queries fail completely.

### D. Duplicate Clarification & Fallback Text Generation
- When confidence is low or intent is unparsed:
  - `universalExecutionController.ts` emits:
    - `"I couldn't make that out. Could you say it again?"` (line 1158)
    - `"I'm not sure which action to take. Could you rephrase that?"` (line 1435)
  - `turnRouter.ts` emits:
    - `"I checked the system state, but have no further details on that item."` (line 811)
  - `supervisorLoop.ts` emits:
    - `"Supervisor execution timed out or returned no output."`
- **Consequence**: Developers and users cannot determine which component failed, making root cause analysis impossible without deep tracing.

---

## 4. Consolidation Roadmap

To resolve these conflicts, we must enforce a **Single Authoritative Pipeline**:

```
Microphone Capture (useVoiceIO)
   ↓
Whisper Worker (Normalized Logprob Confidence)
   ↓
Turn Router (Unified Front Door)
   ├─ 1. Control Intent (Single Stop/Pause Handler)
   ├─ 2. Single Wake-Word Normalizer
   ├─ 3. Single Entity Resolver (Project > Opportunity Precedence)
   ├─ 4. Single Semantic Understanding & Goal Planner
   └─ 5. Authoritative Context Resolver (Session DB Context)
   ↓
Execution Layer (Deterministic Project Intelligence)
   ↓
Single Attributable Response Generator (Tagged with Component ID)
```
