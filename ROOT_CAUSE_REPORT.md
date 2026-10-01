# Forensic Root Cause Report: Jarvis Live Runtime Failures

This forensic report documents the fundamental and secondary root causes of live voice and project intelligence failures in AgenticOS / Jarvis, ranked by severity from **P0** (Fundamental Blocker) to **P3** (Cleanup/Optimization).

---

## Ranked Findings Summary

| ID | Priority | Subsystem | Description | Primary Affected Symptoms |
|---|---|---|---|---|
| **RC-1** | **P0** | Speech-to-Text / Confidence | Flawed Log-Probability Confidence Metric & Overly Strict Hard Gating | Spurious "I couldn't make that out. Could you say it again?" |
| **RC-2** | **P0** | Entity Resolution | Provider Registration Order Inversion & Missing Direct Opportunity Answer | Opening project fails to retrieve status; returns empty system state |
| **RC-3** | **P0** | Goal Parsing / Planning | Compound Intent Truncation & Overly Restrictive Continuation Whitelisting | "Open Free Cash and tell me what needs to be done" only navigates; drops intelligence |
| **RC-4** | **P1** | Context / Conversation State | Broken Active Project Scoping in Read Intent Routing | Follow-up queries ("Tell me the status", "What is blocked?") lose active project |
| **RC-5** | **P1** | Architecture / Front-Door | Fragmented Multi-Gateway Routing with Competing Fallback Handlers | Inconsistent responses, race conditions between UEC, GroundedBridge, and Hermes |
| **RC-6** | **P2** | Audio / AudioWorklet | Buffer Boundary Truncation & Lack of Acoustic Echo Suppression | Barge-in instability under speaker playback, occasional clipped initial consonant |
| **RC-7** | **P3** | Deployment / Build | Artifact Drift Between Source Dist and App Packaged Resources | Stale compiled bundles causing desynchronization if deploy script is omitted |

---

## Detailed Findings

---

### Finding RC-1 (Priority: P0)
**Flawed Log-Probability Confidence Metric & Overly Strict Hard Gating**

- **Observed Symptom**:
  Jarvis frequently responds: *"I couldn't make that out. Could you say it again?"* even when the user speaks clearly into a physical microphone and Whisper transcribes the words accurately.
- **Exact File(s)**:
  - `server/scripts/whisper_worker.py` (lines 102–106)
  - `server/src/domains/jarvis/execution/universalExecutionController.ts` (lines 1034–1158, 1420–1435)
  - `server/src/domains/jarvisNext/turnRouter.ts` (lines 985–990)
- **Relevant Line References**:
  - `whisper_worker.py`:
    ```python
    prob_from_logprob = max(0.0, min(1.0, math.exp(max(-5.0, avg_logprob))))
    speech_confidence = round(prob_from_logprob * (1.0 - max_no_speech), 4)
    ```
  - `universalExecutionController.ts`:
    ```typescript
    if ((sttConfidence < 0.40 || !isPlausibleSpeech) && !continuationUsed) {
        ...
        return { spokenText: "I couldn't make that out. Could you say it again?" };
    }
    ```
  - `turnRouter.ts`:
    ```typescript
    const isHighConfidence = confidence >= 0.7;
    ```
- **Runtime Evidence**:
  Benchmark tests on clean real voice recordings (`benchmark_clean.py`) yield:
  - Clean sentence average logprob: `-0.5425`
  - Computed `prob_from_logprob`: `math.exp(-0.5425) = 0.5813`
  - Real voice with slight room reverberation: `avg_logprob = -0.9500`
  - Computed `prob_from_logprob`: `math.exp(-0.9500) = 0.3867`
  Because `0.3867 < 0.40`, UEC immediately triggers the hard rejection gate and emits *"I couldn't make that out. Could you say it again?"*. Furthermore, even with clean speech (0.5813), `turnRouter.ts` requires `>= 0.70` for high-confidence fallthrough, treating clear speech as unverified.
- **Root Cause**:
  `faster-whisper`'s `avg_logprob` represents the average natural log of token probabilities. In normal, confident decoding of conversational speech, `avg_logprob` typically falls between `-0.3` and `-1.2`. Using `math.exp(avg_logprob)` maps normal confident speech into the low range `[0.30, 0.74]`. Multiplying this by `(1.0 - no_speech_prob)` drives typical, completely accurate audio below the arbitrary `0.40` rejection threshold.
- **Why Previous Tests Did Not Reveal It**:
  Unit tests consistently supplied mock input with hardcoded `confidence: 0.95` or `confidence: 1.0` in synthetic payloads, bypassing the real math in `whisper_worker.py`.
- **Recommended Fix**:
  1. Recalibrate `speech_confidence` in `whisper_worker.py` using sigmoid or piecewise linear mapping suitable for logprob scale (e.g. `avg_logprob >= -0.8` maps to `> 0.85`, `-1.2` maps to `> 0.65`).
  2. Lower the emergency rejection gate in UEC to `0.20` or verify token plausibility rather than an arbitrary mathematical cutoff.
  3. Ensure all confidence gates check both raw logprob and word count.

---

### Finding RC-2 (Priority: P0)
**Entity Resolver Registration Order Inversion & Missing Direct Opportunity Answer**

- **Observed Symptom**:
  Saying *"Jarvis, open Free Cash and tell me what needs to be done"* or *"open Free Cash"* leads to a state where Jarvis opens the project UI, but cannot answer questions about it, eventually producing: *"I checked the system state, but have no further details on that item."*
- **Exact File(s)**:
  - `server/src/index.ts` (lines 149–165)
  - `server/src/domains/jarvisNext/resolvers/revenueOpportunityEntityProvider.ts`
  - `server/src/domains/jarvisNext/resolvers/projectEntityProvider.ts`
  - `server/src/domains/jarvisNext/projectStateContext.ts` (lines 235–260)
  - `server/src/domains/jarvisNext/turnRouter.ts` (lines 805–815)
- **Relevant Line References**:
  - `server/src/index.ts`:
    ```typescript
    // In server/src/index.ts:
    entityResolvers.register(revenueOperatorEntityProvider);
    entityResolvers.register(projectEntityProvider); // REGISTERED SECOND!
    ```
  - `server/src/domains/jarvisNext/projectStateContext.ts`:
    ```typescript
    // Evidence pack generator only builds directAnswer if entity is a Project:
    if (entity.type === 'project') {
       evidencePack.directAnswer = formatProjectSnapshot(...);
    } // If entity is revenue_opportunity, directAnswer is undefined!
    ```
  - `server/src/domains/jarvisNext/turnRouter.ts`:
    ```typescript
    if (!r.text || r.text.trim() === '') {
       finalSpokenText = 'I checked the system state, but have no further details on that item.';
    }
    ```
- **Runtime Evidence**:
  SQLite database inspection reveals both `proj-free-cash` (in table `projects`) and `opp-45086c0d-` (in table `revenue_opportunities`) are named "Free Cash". Because `RevenueOperatorEntityProvider` is queried before `ProjectEntityProvider`, the query *"Free Cash"* resolves to `opp-45086c0d-`. When `buildEvidencePack` runs in `projectStateContext.ts`, it finds an opportunity entity, which lacks the `directAnswer` formatter. The turn completes with an empty text string, hitting line 811 of `turnRouter.ts` which emits *"I checked the system state, but have no further details on that item."*.
- **Root Cause**:
  Provider precedence was inverted, and opportunity entities lacked deterministic snapshot generation, leaving them as "half-resolved" items.
- **Why Previous Tests Did Not Reveal It**:
  Unit tests mocked entity resolution to directly return `ProjectEntity` or tested project queries with artificial project IDs (e.g. `proj-test-1`).
- **Recommended Fix**:
  1. In `server/src/index.ts`, register `ProjectEntityProvider` BEFORE `RevenueOperatorEntityProvider`.
  2. Implement rich snapshot formatting for `revenue_opportunity` entities inside `projectStateContext.ts` so opportunity entities also supply deterministic status, stages, blockers, and next steps.

---

### Finding RC-3 (Priority: P0)
**Compound Intent Truncation & Overly Restrictive Continuation Whitelisting**

- **Observed Symptom**:
  When given compound commands like *"Jarvis, open Shopify and tell me the status, blockers and what we should do next"*, Jarvis only opens Shopify and speaks *"Opened Shopify."*, completely ignoring the queries about status, blockers, and next actions.
- **Exact File(s)**:
  - `server/src/domains/jarvis/execution/semanticGoalParser.ts` (lines 30–95, 540–585)
  - `server/src/domains/jarvis/execution/universalExecutionController.ts` (lines 1580–1600)
  - `server/src/domains/jarvisNext/turnRouter.ts` (lines 1275–1290)
- **Relevant Line References**:
  - `semanticGoalParser.ts`:
    ```typescript
    const parts = splitCompoundGoal(goal); // Splits on " and "
    // Part 1: "open shopify" -> confidence 0.95
    // Part 2: "tell me what needs to be done" -> fails isStatusQuery regex, hasContinuationReference fails
    // Combined plan confidence < 0.70 -> plan rejected or falls back to single-step navigation!
    ```
  - `universalExecutionController.ts`:
    ```typescript
    // In multi-step execution loop:
    finalText = lastExecResult.output; // ONLY takes output from last step, or ignores multi-step aggregated speech!
    ```
- **Runtime Evidence**:
  Tracing `splitCompoundGoal()` with input `"open Free Cash and tell me what needs to be done"`:
  - `parts[0]`: `"open Free Cash"` (matches `open` pattern, valid target).
  - `parts[1]`: `"tell me what needs to be done"` (does not match exact whitelist of `isStatusQuery`: `["what are you doing", "current status"]`; `hasContinuationReference` tests for `it|its|project insight`, excluding `"done"` or `"what needs to be done"`).
  - Part 2 is assigned score `0.0`. The planner drops Part 2 or fails the composite plan, reverting to navigation only.
  - When navigation executes, it emits *"Opened Free Cash."* and finishes.
- **Root Cause**:
  Intent parsing used rigid phrase whitelists instead of semantic goal classification. The planner lacked support for chaining navigation + inspection goals, and output generation failed to aggregate speech from multiple executed steps.
- **Why Previous Tests Did Not Reveal It**:
  Previous tests tested atomic commands separately (`"open Shopify"` in one test, `"show status"` in another test). Compound clauses were either not tested or asserted only that navigation succeeded.
- **Recommended Fix**:
  1. Broaden goal recognition in `semanticGoalParser.ts` to recognize intent types: `INSPECT_STATUS`, `INSPECT_BLOCKERS`, `INSPECT_NEXT_STEPS` for phrasing like `"what needs to be done"`, `"what should we do next"`, `"what's blocked"`.
  2. In compound goal splitting, allow the second goal to inherit the target entity established by the first goal (`targetEntity = step1.target`).
  3. In `universalExecutionController.ts`, synthesize output from ALL executed steps into a cohesive response.

---

### Finding RC-4 (Priority: P1)
**Broken Active Project Scoping in Read Intent Routing**

- **Observed Symptom**:
  After successfully opening a project, saying follow-up commands like *"Tell me the status"*, *"What is blocked?"*, or *"What should we do next?"* fails to reference the active project. Jarvis either asks for clarification or emits *"I checked the system state, but have no further details on that item."*
- **Exact File(s)**:
  - `server/src/domains/jarvisNext/turnRouter.ts` (lines 1110–1125)
  - `C:\Users\cd-pr\AppData\Roaming\AgenticOS\data\active-project.json`
- **Relevant Line References**:
  - `turnRouter.ts`:
    ```typescript
    const isProjectScopedIntent = [
       'project_blocked',
       'project_running',
       'project_contents',
       'project_priority'
    ].includes(readIntent.type) || isProjectOperateTurn;
    // Notice: 'operator_status' (which "tell me the status" produces) is NOT in this array!
    ```
- **Runtime Evidence**:
  When the user says *"Tell me the status"*, `classifyReadIntent` categorizes the query as `operator_status`. Because `operator_status` is omitted from `isProjectScopedIntent`, line 1114 evaluates to `false`. The router skips binding `activeProjectId` from the conversation context. Furthermore, `active-project.json` in user roaming storage contained a stale project ID (`proj-c3c279bf`) that did not exist in `agentic-os.db`.
- **Root Cause**:
  Incomplete intent mapping in `turnRouter.ts` prevented generic status queries from inheriting the currently active project context, coupled with out-of-sync disk-cached active project state.
- **Why Previous Tests Did Not Reveal It**:
  Tests passed the project name explicitly in every utterance (e.g. `"status of Free Cash"`), never exercising context inheritance across multi-turn conversational follow-ups.
- **Recommended Fix**:
  1. Include `operator_status`, `operator_blockers`, `operator_tasks`, `operator_next_actions` in the `projectScoped` intent check in `turnRouter.ts`.
  2. Fall back to `conversationState.activeProjectId` whenever a status or inspection query lacks an explicit entity.
  3. Validate and synchronize `active-project.json` against existing database records upon startup and project switch.

---

### Finding RC-5 (Priority: P1)
**Fragmented Multi-Gateway Routing with Competing Fallback Handlers**

- **Observed Symptom**:
  Different utterances take divergent execution paths, resulting in conflicting response styles, duplicate wake-word checks, and inconsistent fallback messages.
- **Exact File(s)**:
  - `server/src/domains/jarvisNext/turnRouter.ts`
  - `server/src/domains/jarvis/execution/universalExecutionController.ts`
  - `server/src/domains/jarvisNext/groundedTurnBridge.ts`
  - `server/src/domains/jarvisNext/supervisorLoop.ts`
- **Root Cause**:
  Responsibility is fragmented between `TurnRouter`, `UniversalExecutionController`, and `GroundedTurnBridge`. Each contains its own confidence checks, wake-word stripping, entity extraction, and fallback text generation. If one layer fails or yields partial output, another layer catches it and emits a generic canned response without knowing why the upstream failed.
- **Recommended Fix**:
  Consolidate orchestration into a unified pipeline: Single Turn Router -> Single Understanding Service -> Single Context Resolver -> Deterministic Project Intelligence -> Single Response Synthesizer.

---

### Finding RC-6 (Priority: P2)
**Audio Buffer Boundary Truncation & Lack of Acoustic Echo Suppression**

- **Observed Symptom**:
  Under real room microphone conditions, barge-in (interrupting Jarvis while he is speaking) can be sluggish, and short phrases occasionally lose their initial phoneme.
- **Exact File(s)**:
  - `src/features/voice/useVoiceIO.ts`
- **Root Cause**:
  `useVoiceIO.ts` relies on browser `AudioContext` and RMS silence tracking without an adaptive noise-floor estimator or hardware acoustic echo cancellation (AEC) synchronization. When Jarvis speaks through physical speakers, speaker sound leaks into the mic.
- **Recommended Fix**:
  1. Add 200ms pre-roll audio ring buffer to capture leading consonants before VAD threshold trigger.
  2. Implement local audio ducking / acoustic echo muting when TTS audio is actively playing.

---

### Finding RC-7 (Priority: P3)
**Artifact Drift Between Source Dist and App Packaged Resources**

- **Observed Symptom**:
  Changes made in `server/dist` or frontend code are not immediately reflected when running `AgenticOS.exe` from `AppData\Local\Programs\AgenticOS`.
- **Exact File(s)**:
  - `scripts/deploy-server-artifact.cjs`
  - `package.json`
- **Root Cause**:
  `AgenticOS.exe` executes from `C:\Users\cd-pr\AppData\Local\Programs\AgenticOS\resources\`. While `deploy-server-artifact.cjs` copies `server/dist` and `server/scripts`, it does not automatically bundle and copy frontend assets (`resources/app/dist`), causing code desynchronization if not invoked with full build flags.
- **Recommended Fix**:
  Ensure build scripts synchronize both frontend and backend distributions into the installed application directory during deployment.
