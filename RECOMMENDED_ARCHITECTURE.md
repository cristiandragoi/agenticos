# Recommended Architecture: Consolidated Jarvis Core

## 1. Architectural Strategy: Consolidate Orchestration (Option B)

Based on forensic findings:
- **Option A (Keep Current Architecture)** is rejected because the existing routing, confidence thresholds, entity resolution, and context layers are fragmented across competing classes.
- **Option C (Full Rebuild)** is rejected because the underlying infrastructure—faster-whisper CUDA worker, SQLite database, audio transport, Playwright browser operator, and Electron UI—is functional, robust, and performs well when fed correct inputs.

We adopt **Option B: Consolidate Orchestration**: Keep the proven infrastructure and replace the tangled routing and intent layers with a single, linear, authoritative pipeline.

---

## 2. Target Linear Pipeline Architecture

```
Physical Microphone
    ↓
AudioService (Frontend useVoiceIO with Pre-roll Buffer & Ducking)
    ↓
SpeechService (faster-whisper with Logprob-Calibrated Confidence)
    ↓
Single Turn Orchestrator (Correlated by Turn ID)
    ├─ ControlIntentService (Immediate Stop / Pause / Barge-in)
    ├─ Normalization & WakeWordService (Deterministic Prefix Strip)
    ├─ SemanticUnderstandingService (Multi-clause Goal Extraction)
    ├─ ContextResolver (Session & Active Project DB Inheritance)
    ├─ CapabilityRouter (Direct Deterministic vs Complex Execution)
    ↓
Execution & Intelligence Layer
    ├─ Deterministic ProjectIntelligenceService (SQL Snapshots)
    ├─ Action Executors (Navigation, Browser, Shell)
    └─ Fallback LLM Reasoner (Hermes - ONLY for Ambiguous Dialogue)
    ↓
ResponseSynthesizer (Attributable Source Tagged Speech & Markdown)
    ↓
Audio Playback / TTS & GUI Client Update
```

---

## 3. Core Component Responsibilities & Contract Interfaces

### A. SpeechService (`whisper_worker.py` + `localTranscribe.ts`)
- **Responsibility**: Transcribe audio PCM to text and calculate normalized confidence.
- **Rule**:
  ```python
  # Logprob normalization calibrated to conversational speech:
  # avg_logprob of -0.3 -> 0.95, -0.7 -> 0.85, -1.2 -> 0.65, -2.0 -> 0.25
  normalized_confidence = 1.0 / (1.0 + math.exp(-2.5 * (avg_logprob + 1.1)))
  speech_confidence = round(normalized_confidence * (1.0 - max_no_speech), 4)
  ```
- **Attribution Tag**: `speech.whisper`

### B. UnderstandingService & Goal Planner (`semanticGoalParser.ts`)
- **Responsibility**: Parse compound goals (`"open Free Cash and tell me what needs to be done"`), extract intent types (`OPEN_PROJECT`, `GET_STATUS`, `GET_BLOCKERS`, `GET_NEXT_ACTIONS`), and link pronouns/continuations to the primary entity.
- **Rule**:
  Compound goals maintain an execution chain where subsequent inspection steps inherit `targetEntity` from prior navigation steps.
- **Attribution Tag**: `understanding.compoundPlanner`

### C. ContextResolver (`conversationState.ts`)
- **Responsibility**: Maintain single source of truth for active project, active opportunity, and conversation entity stack.
- **Rule**:
  When a user opens a project, `activeProjectId` is updated immediately in DB and in-memory session. Follow-up commands (`"status"`, `"what is blocked"`, `"continue"`) automatically resolve against `activeProjectId`.
- **Attribution Tag**: `context.sessionResolver`

### D. ProjectIntelligenceService (`projectStateContext.ts`)
- **Responsibility**: Query SQLite database directly and generate complete, deterministic snapshots (`getProjectSnapshot(id)`).
- **Rule**:
  Zero hallucination. Status, tasks, stages, and blockers are read directly from `agentic-os.db`.
- **Attribution Tag**: `intelligence.projectDb`

### E. Attributable Response Formatter (`responseSynthesizer.ts`)
- **Responsibility**: Assemble spoken and visual text from execution outputs and tag every response with its exact generating subsystem.
- **Rule**:
  Every response payload sent to the client includes `{ source: 'subsystem.id', spokenText, displayText }`.
  No generic canned messages without diagnostic logging.

---

## 4. Implementation Phasing

1. **Step 1 (Confidence & Transcription)**: Calibrate `whisper_worker.py` confidence math and adjust UEC hard rejection threshold.
2. **Step 2 (Entity Resolution Precedence)**: Register `ProjectEntityProvider` before `RevenueOperatorEntityProvider` in `server/src/index.ts`.
3. **Step 3 (Compound Intent Support)**: Update `semanticGoalParser.ts` to support multi-clause intent chaining and step output synthesis in `universalExecutionController.ts`.
4. **Step 4 (Context Inheritance)**: Update `turnRouter.ts` so `operator_status` and related read intents inherit `activeProjectId`.
5. **Step 5 (Build & Deployment)**: Compile and deploy server artifacts to `C:\Users\cd-pr\AppData\Local\Programs\AgenticOS`.
6. **Step 6 (Verification)**: Live acceptance testing with physical microphone on real installed GUI.
