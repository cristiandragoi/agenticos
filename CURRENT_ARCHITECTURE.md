# Current Architecture Map: AgenticOS / Jarvis Live Runtime

## 1. Overview & Architectural Topology

AgenticOS / Jarvis is a hybrid desktop application combining:
1. **Frontend / GUI Layer**: Electron + React (Vite, TailwindCSS, Zustand/React State, Web Audio API).
2. **Backend Server Layer**: Node.js + Express HTTP + Server-Sent Events (SSE) / WebSocket + SQLite (`better-sqlite3`).
3. **Speech Worker Layer**: Dedicated Python process (`whisper_worker.py`) using `faster-whisper` on CUDA (fallback to CPU).
4. **Execution Layer**: Hybrid deterministic controllers (`UniversalExecutionController`, `TurnRouter`, `SupervisorLoop`) and specialized operators (Playwright browser operator, Shell/Terminal operator, Project/Task store).

---

## 2. End-to-End Runtime Pipeline (From Physical Mic to Speaker)

```mermaid
flowchart TD
    Mic[Physical Microphone] -->|MediaStream AudioWorklet / ScriptProcessor| FrontendAudio[useVoiceIO.ts Audio Pipeline]
    FrontendAudio -->|Sample-rate conversion 48kHz->16kHz mono PCM Float32| VadRms[Frontend RMS / Silence Detector]
    VadRms -->|WAV Blob / FormData POST| TranscribeRoute[/api/voice/transcribe]
    TranscribeRoute --> LocalTranscribe[server/src/domains/voice/localTranscribe.ts]
    LocalTranscribe -->|stdin JSON request| WhisperWorker[server/scripts/whisper_worker.py]
    WhisperWorker -->|faster-whisper model base/small| WhisperWorker
    WhisperWorker -->|stdout JSON transcript + avg_logprob + confidence| LocalTranscribe
    LocalTranscribe --> TranscribeRoute
    TranscribeRoute --> FrontendAudio
    FrontendAudio -->|onTranscriptionResult text| JarvisRuntimeContext[JarvisRuntimeContext.tsx]
    JarvisRuntimeContext -->|SSE POST /api/jarvis/conversations/:id/message/stream| ChatRoute[/api/jarvis/conversations]
    ChatRoute --> TurnRouter[server/src/domains/jarvisNext/turnRouter.ts]
    
    TurnRouter --> ControlIntent[controlIntent.ts - STOP/MUTE/CANCEL]
    TurnRouter --> ReadIntent[classifyReadIntent - Status/Summary/Task queries]
    TurnRouter --> GroundedTurn[groundedTurnBridge.ts - Entity/DB Resolution]
    TurnRouter --> UEC[universalExecutionController.ts - Goal Parser & Planner]
    
    UEC --> SemanticGoalParser[semanticGoalParser.ts]
    SemanticGoalParser --> MultiStepPlan[Execution Plan]
    
    MultiStepPlan --> ProjectIntelligence[ProjectStateContext / SQLite agentic-os.db]
    MultiStepPlan --> StepExecutors[Executors: Navigation / Task / Shell / Browser]
    StepExecutors --> ResultRenderer[resultRenderer.ts / Spoken Text Generation]
    
    ResultRenderer --> TurnRouter
    TurnRouter -->|SSE chunks| ChatRoute
    ChatRoute --> JarvisRuntimeContext
    JarvisRuntimeContext --> FrontendAudio
    FrontendAudio -->|Web SpeechSynthesis / Audio Element / ElevenLabs| PhysicalSpeaker[Physical Speakers / Headphones]
```

---

## 3. Subsystem Breakdown & Source Locations

### A. Audio Capture & Preprocessing (Frontend)
- **Primary Source File**: `src/features/voice/useVoiceIO.ts`
- **Capture Mechanism**:
  - Uses browser `navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })`.
  - In real browsers/Electron, Windows audio devices deliver 44.1kHz or 48kHz audio. `useVoiceIO.ts` uses an `AudioContext` and an `AudioWorklet` / `ScriptProcessorNode` to downsample to 16,000 Hz, 16-bit mono PCM.
  - VAD (Voice Activity Detection): Frontend measures RMS over audio frames. When RMS drops below `silenceThreshold` for `silenceDurationMs` (typically 800ms - 1200ms), speech chunk is finalized.
  - Generates a `audio/wav` blob and sends to `/api/voice/transcribe`.

### B. Speech-to-Text (STT) Subsystem
- **API Endpoint**: `server/src/domains/voice/localTranscribe.ts` mounted at `/api/voice/transcribe`
- **Worker Process**: `server/scripts/whisper_worker.py`
- **Worker Communication**: Node child process spawned via `child_process.spawn('python', ['server/scripts/whisper_worker.py'])` communicating over line-delimited JSON on `stdin`/`stdout`.
- **Model Configuration**:
  - Model: `base.en` or `small.en` (configurable via `WHISPER_MODEL` env, defaults to `base`).
  - Device: `cuda` (float16) if available, fallback to `cpu` (int8).
  - VAD filter in Whisper: `vad_filter=True, min_silence_duration_ms=500`.
  - Confidence calculation: Computes `math.exp(avg_logprob) * (1.0 - max_no_speech)`.

### C. Conversational Orchestration & Routing
- **Entry Points**:
  - SSE Streaming: `POST /api/jarvis/conversations/:id/message/stream` (`server/src/domains/jarvis/api/chatRoutes.ts`)
  - Direct Turn Router: `server/src/domains/jarvisNext/turnRouter.ts` -> `routeTurn()`
- **Key Routing Branches**:
  1. **Control Intent Detection**: `server/src/domains/jarvisNext/controlIntent.ts`
     - Detects `"stop"`, `"cancel"`, `"pause"`, `"shut up"`, `"quiet"`.
  2. **Wake Word Stripping**: `server/src/domains/jarvis/voice/wakeWord.ts` and `turnRouter.ts`
     - Matches `"jarvis"`, `"hey jarvis"` prefixes.
  3. **Low Confidence Gate**: Evaluates `turn.confidence`. If below threshold, halts execution and requests repetition.
  4. **Entity Resolution**: `server/src/domains/jarvisNext/groundedTurnBridge.ts` via `EntityResolverRegistry`.
  5. **Direct Read/Status Intent**: `classifyReadIntent()` routes queries about status, summary, blockers, tasks.
  6. **Plan Execution**: Falls through to `UniversalExecutionController.handleUserTurn()`.

### D. Goal Parsing & Planning
- **Source**: `server/src/domains/jarvis/execution/semanticGoalParser.ts`
- **Logic**:
  - `splitCompoundGoal()` splits on `" and "`, `" then "`, `" also "`.
  - Attempts to classify each clause into an executable action (`OPEN_PROJECT`, `RUN_TASK`, `STATUS_QUERY`, `BROWSE`, etc.).
  - Scores each clause with a confidence value (0.0 - 1.0).

### E. Execution & Project Data Retrieval
- **Source**: `server/src/domains/jarvis/execution/universalExecutionController.ts`
- **Deterministic Services**:
  - Database: SQLite database (`agentic-os.db`) managed via `server/src/db/index.ts`.
  - Project Store: `server/src/domains/projects/` querying tables `projects`, `project_tasks`, `background_tasks`.
  - Navigation Executor: Emits navigation events to client via WebSocket / SSE to change UI active project.

### F. Response Generation & Speech Output
- **Spoken Text Formatting**: `server/src/domains/jarvisNext/resultRenderer.ts` and `server/src/domains/jarvis/execution/universalExecutionController.ts` (`synthesizeStepSummaries`).
- **Fallthrough LLM (Hermes/Supervisor)**: `server/src/domains/jarvisNext/supervisorLoop.ts` and `server/src/domains/hermes/`.
- **Text-to-Speech (TTS)**:
  - Frontend `useVoiceIO.ts` receives `spokenText` via SSE stream completion and uses Web SpeechSynthesis API or requests `/api/voice/synthesize` (ElevenLabs / Piper / Edge TTS).

---

## 4. Current File Map

| Responsibility | File Path |
|---|---|
| Frontend Voice Capture & Audio Pipeline | `src/features/voice/useVoiceIO.ts` |
| Frontend Jarvis Runtime Context | `src/contexts/JarvisRuntimeContext.tsx` |
| Local Transcribe HTTP Handler | `server/src/domains/voice/localTranscribe.ts` |
| Whisper STT Python Worker | `server/scripts/whisper_worker.py` |
| SSE Streaming Chat API | `server/src/domains/jarvis/api/chatRoutes.ts` |
| Turn Router (Front Door) | `server/src/domains/jarvisNext/turnRouter.ts` |
| Control Intent (Stop/Barge-in) | `server/src/domains/jarvisNext/controlIntent.ts` |
| Entity Resolvers | `server/src/domains/jarvisNext/resolvers/` |
| Grounded Turn Bridge | `server/src/domains/jarvisNext/groundedTurnBridge.ts` |
| Semantic Goal Parser | `server/src/domains/jarvis/execution/semanticGoalParser.ts` |
| Universal Execution Controller | `server/src/domains/jarvis/execution/universalExecutionController.ts` |
| Project State Context | `server/src/domains/jarvisNext/projectStateContext.ts` |
| Result Renderer | `server/src/domains/jarvisNext/resultRenderer.ts` |
| Hermes / LLM Gateway | `server/src/domains/hermes/` |
| SQLite Database Client | `server/src/db/index.ts` |
