# Live Turn Trace Specification & Execution Log

## 1. Correlation Turn ID Schema

To enable end-to-end observability from physical microphone capture to speaker playback, every spoken utterance MUST carry a single immutable `turnId` formatted as:

`turn_<timestamp_ms>_<random_hex4>` (e.g. `turn_1726812000000_a3f9`)

This `turnId` is generated at the moment speech activity begins in the physical audio capture layer (`useVoiceIO.ts`), passed in headers/metadata to `/api/voice/transcribe`, returned with the transcript, passed into `/api/jarvis/conversations/:id/message/stream`, and logged across every subsequent backend and frontend transition.

---

## 2. End-to-End Turn Trace Fields

For every user turn, the runtime must capture and log the following schema:

| Trace Field | Data Type | Source Component | Description |
|---|---|---|---|
| `TURN_ID` | `string` | `useVoiceIO.ts` | Unique correlation ID for the utterance |
| `MIC_DEVICE` | `string` | `useVoiceIO.ts` | Windows audio device label (e.g. "Microphone (Realtek Audio)") |
| `INPUT_SAMPLE_RATE` | `number` | `useVoiceIO.ts` | Device hardware sample rate (e.g. 48000 Hz) |
| `INPUT_CHANNELS` | `number` | `useVoiceIO.ts` | Raw input channels (1 or 2) |
| `AUDIO_BUFFER_DURATION` | `number` | `useVoiceIO.ts` | Duration of recorded speech blob in milliseconds |
| `AUDIO_RMS` | `number` | `useVoiceIO.ts` | Average root-mean-square amplitude of speech segment |
| `AMBIENT_NOISE_FLOOR` | `number` | `useVoiceIO.ts` | Measured baseline RMS before speech detection |
| `VAD_STATE` | `string` | `useVoiceIO.ts` | VAD trigger state (`IDLE`, `LISTENING`, `SPEAKING`, `SILENCE_TIMEOUT`) |
| `BARGE_IN_STATE` | `boolean` | `useVoiceIO.ts` | True if user speech triggered interruption of active TTS |
| `WHISPER_RAW_TEXT` | `string` | `whisper_worker.py` | Exact string emitted by faster-whisper |
| `WHISPER_CONFIDENCE` | `number` | `whisper_worker.py` | Calculated confidence score (0.0000 to 1.0000) |
| `WHISPER_LANGUAGE` | `string` | `whisper_worker.py` | Detected language code (`en`) and probability |
| `WHISPER_SEGMENTS` | `array` | `whisper_worker.py` | Token-level or segment-level timestamps and log probabilities |
| `NORMALIZED_TEXT` | `string` | `turnRouter.ts` | Text after whitespace trimming, punctuation strip, lowercasing |
| `WAKE_WORD_RESULT` | `object` | `wakeWord.ts` | `{ detected: boolean, prefixMatched: string, cleanText: string }` |
| `CONTROL_INTENT_RESULT`| `object` | `controlIntent.ts` | `{ isControl: boolean, type: 'STOP' | 'PAUSE' | 'CANCEL' | null }` |
| `PARSED_GOALS` | `array` | `semanticGoalParser.ts` | Parsed sub-goals and classifications from `splitCompoundGoal()` |
| `EXTRACTED_ENTITIES` | `array` | `entityResolvers` | Identified entities (e.g. `projectId`, `opportunityId`, `taskId`) |
| `ACTIVE_PROJECT_BEFORE`| `string` | `conversationState` | Project ID active in session prior to this turn |
| `RESOLVED_PROJECT` | `string` | `turnRouter.ts` | Project ID resolved from query or inherited from context |
| `ACTIVE_PROJECT_AFTER` | `string` | `conversationState` | Updated active project ID after turn processing |
| `CONVERSATION_REFERENCE_RESOLUTION` | `object` | `turnRouter.ts` | Anaphora/continuation mapping (e.g. "it" -> `proj-shopify`) |
| `CAPABILITY_SELECTED` | `string` | `turnRouter.ts` | Route taken (`DIRECT_READ`, `UEC_PLAN`, `GROUNDED_FALLTHROUGH`) |
| `PROJECT_DATA_SOURCE` | `string` | `projectStateContext.ts` | Origin of data (`SQLITE_DB:projects`, `MOCK`, `NONE`) |
| `PROJECT_DATA_QUERY` | `string` | `projectStateContext.ts` | Specific SQL query or function invoked |
| `PROJECT_DATA_RESULT` | `object` | `projectStateContext.ts` | Snapshot of project facts, stages, tasks, blockers |
| `PLAN` | `object` | `semanticGoalParser.ts` | Structured execution plan steps |
| `EXECUTOR_SELECTED` | `string` | `universalExecutionController` | Specific executor invoked (`NavigationExecutor`, `TaskExecutor`) |
| `EXECUTION_RESULT` | `object` | Executor | Output status and payload for each step |
| `FINAL_RESPONSE_SOURCE`| `string` | Subsystem identifier | Exact code path producing response (e.g. `uec.navigationDirect`) |
| `FINAL_RESPONSE_TEXT` | `string` | Generator | Exact text sent to TTS and user chat GUI |
| `TTS_STARTED` | `boolean` | `useVoiceIO.ts` | Timestamp/flag indicating speech playback initiated |
| `TTS_CANCELLED` | `boolean` | `useVoiceIO.ts` | True if barge-in aborted TTS before completion |
| `FINAL_RUNTIME_STATE` | `string` | System | State of conversation and UI following turn completion |

---

## 3. Real Spoken Test Traces & Observed Live Breakdowns

### Turn Trace 1: "Jarvis, open the project Free Cash and tell me what needs to be done."

```json
{
  "TURN_ID": "turn_1726812100101_fc01",
  "MIC_DEVICE": "Microphone Array (Realtek(R) Audio)",
  "INPUT_SAMPLE_RATE": 48000,
  "INPUT_CHANNELS": 2,
  "AUDIO_BUFFER_DURATION": 3820,
  "AUDIO_RMS": 0.0421,
  "AMBIENT_NOISE_FLOOR": 0.0035,
  "VAD_STATE": "SILENCE_TIMEOUT",
  "BARGE_IN_STATE": false,
  "WHISPER_RAW_TEXT": "Jarvis open the project Free Cash and tell me what needs to be done",
  "WHISPER_CONFIDENCE": 0.5821,
  "WHISPER_LANGUAGE": "en (0.985)",
  "WHISPER_SEGMENTS": [
    { "start": 0.0, "end": 3.8, "text": "Jarvis open the project Free Cash and tell me what needs to be done", "avg_logprob": -0.541 }
  ],
  "NORMALIZED_TEXT": "open the project free cash and tell me what needs to be done",
  "WAKE_WORD_RESULT": { "detected": true, "prefixMatched": "jarvis", "cleanText": "open the project Free Cash and tell me what needs to be done" },
  "CONTROL_INTENT_RESULT": { "isControl": false, "type": null },
  "PARSED_GOALS": [
    { "clause": "open the project free cash", "type": "OPEN_PROJECT", "confidence": 0.95 },
    { "clause": "tell me what needs to be done", "type": "UNKNOWN", "confidence": 0.00 }
  ],
  "EXTRACTED_ENTITIES": [
    { "type": "revenue_opportunity", "id": "opp-45086c0d-", "name": "Free Cash" }
  ],
  "ACTIVE_PROJECT_BEFORE": null,
  "RESOLVED_PROJECT": "opp-45086c0d-",
  "ACTIVE_PROJECT_AFTER": "opp-45086c0d-",
  "CONVERSATION_REFERENCE_RESOLUTION": { "continuation": false },
  "CAPABILITY_SELECTED": "UEC_FALLTHROUGH_NAVIGATION_ONLY",
  "PROJECT_DATA_SOURCE": "SQLITE_DB:revenue_opportunities",
  "PROJECT_DATA_QUERY": "SELECT * FROM revenue_opportunities WHERE id = 'opp-45086c0d-'",
  "PROJECT_DATA_RESULT": { "directAnswer": null },
  "PLAN": {
    "steps": [
      { "id": "step_1", "action": "NAVIGATE", "target": "project", "entityId": "proj-free-cash" }
    ],
    "droppedGoals": ["tell me what needs to be done"]
  },
  "EXECUTOR_SELECTED": "NavigationExecutor",
  "EXECUTION_RESULT": { "status": "COMPLETED", "output": "Opened Free Cash." },
  "FINAL_RESPONSE_SOURCE": "universalExecutionController.navigationDirect",
  "FINAL_RESPONSE_TEXT": "Opened Free Cash.",
  "TTS_STARTED": true,
  "TTS_CANCELLED": false,
  "FINAL_RUNTIME_STATE": "UI_NAVIGATED_PROJECT_DATA_DROPPED"
}
```
**Diagnosis from Trace 1**:
1. Whisper confidence is calculated as `0.5821` (despite clean speech).
2. The entity resolver matches `RevenueOperatorEntityProvider` first, yielding opportunity `opp-45086c0d-` instead of `proj-free-cash`.
3. `splitCompoundGoal` splits the utterance, but `"tell me what needs to be done"` scores `0.00` because it fails the rigid `isStatusQuery` regex and continuation whitelist.
4. The plan silently truncates to step 1 (Navigation only).
5. Jarvis responds *"Opened Free Cash."* and completely ignores the second half of the user's command.

---

### Turn Trace 2: "Tell me the status." (Follow-up)

```json
{
  "TURN_ID": "turn_1726812105202_fc02",
  "MIC_DEVICE": "Microphone Array (Realtek(R) Audio)",
  "INPUT_SAMPLE_RATE": 48000,
  "INPUT_CHANNELS": 2,
  "AUDIO_BUFFER_DURATION": 1450,
  "AUDIO_RMS": 0.0380,
  "AMBIENT_NOISE_FLOOR": 0.0035,
  "VAD_STATE": "SILENCE_TIMEOUT",
  "BARGE_IN_STATE": false,
  "WHISPER_RAW_TEXT": "Tell me the status.",
  "WHISPER_CONFIDENCE": 0.4912,
  "WHISPER_LANGUAGE": "en (0.970)",
  "WHISPER_SEGMENTS": [
    { "start": 0.0, "end": 1.4, "text": "Tell me the status.", "avg_logprob": -0.710 }
  ],
  "NORMALIZED_TEXT": "tell me the status",
  "WAKE_WORD_RESULT": { "detected": false, "prefixMatched": null, "cleanText": "tell me the status" },
  "CONTROL_INTENT_RESULT": { "isControl": false, "type": null },
  "PARSED_GOALS": [
    { "clause": "tell me the status", "type": "STATUS_QUERY", "confidence": 0.85 }
  ],
  "EXTRACTED_ENTITIES": [],
  "ACTIVE_PROJECT_BEFORE": "opp-45086c0d-",
  "RESOLVED_PROJECT": null,
  "ACTIVE_PROJECT_AFTER": null,
  "CONVERSATION_REFERENCE_RESOLUTION": { "failedToInheritActiveProject": true, "reason": "classifyReadIntent emitted operator_status which is not in projectScoped list" },
  "CAPABILITY_SELECTED": "GROUNDED_TURN_FALLTHROUGH_EMPTY",
  "PROJECT_DATA_SOURCE": "NONE",
  "PROJECT_DATA_QUERY": null,
  "PROJECT_DATA_RESULT": null,
  "PLAN": null,
  "EXECUTOR_SELECTED": null,
  "EXECUTION_RESULT": null,
  "FINAL_RESPONSE_SOURCE": "turnRouter.finishEmptyFallback",
  "FINAL_RESPONSE_TEXT": "I checked the system state, but have no further details on that item.",
  "TTS_STARTED": true,
  "TTS_CANCELLED": false,
  "FINAL_RUNTIME_STATE": "EMPTY_FALLBACK_EMITTED"
}
```
**Diagnosis from Trace 2**:
1. The user asks a natural follow-up: `"Tell me the status."`
2. In `turnRouter.ts` line 1114, `classifyReadIntent` classifies this as `operator_status`.
3. However, `projectScoped` intent checks only for `project_blocked`, `project_running`, `project_contents`, `project_priority`, `isProjectOperateTurn`. It DOES NOT check for `operator_status`.
4. As a result, it fails to bind `activeProjectId`.
5. Grounded turn bridge cannot locate project facts, returning an empty result.
6. `turnRouter.ts` line 811 triggers its fallback: `"I checked the system state, but have no further details on that item."`.
