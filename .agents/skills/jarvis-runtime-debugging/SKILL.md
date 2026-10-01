---
name: jarvis-runtime-debugging
description: >-
  Provides diagnostic procedures and architectural invariants for Jarvis voice, chat,
  and ModelGateway runtime debugging in AgenticOS. Use when investigating Jarvis voice turns,
  STT/TTS, streaming chat, or audio controller issues.
---

# Jarvis Runtime Debugging

This skill provides diagnostic protocols and architectural invariants for Jarvis without requiring a complete re-discovery of the entire codebase on every task.

## Discovery First, No Static Assumptions

Do NOT assume file paths or component names remain static across versions. Always discover current locations using pattern search:
- Search for voice IO hooks: `grep_search` for `useVoiceIO` or `voiceRuntime`
- Search for Jarvis chat docks: `UniversalChatDock`, `JarvisWorkspaceBar`, `JarvisStudio`
- Search for backend streaming routes: `server/src/routes/jarvis*` or `server/src/routes/chat*`
- Search for ModelGateway dispatchers: `server/src/services/modelGateway*` or `server/src/services/llm*`

---

## Non-Negotiable Architectural Invariants

When diagnosing or touching Jarvis runtime code, verify that these invariants are strictly upheld:

1. **Single Authoritative Voice Runtime**:
   - There must only be ONE active voice controller/runtime instance across the entire application lifecycle.
   - Secondary docks, sidebars, or floating widgets must bind to the authoritative voice controller or listen to its state; they must never instantiate a second competing audio stream.

2. **Single Submitted Voice Turn Per Utterance**:
   - Exactly one turn submission per user utterance. Duplicate STT finalization events or debouncing failures must not trigger concurrent model queries.

3. **Turn Latch Resets Only on Legitimate Lifecycle Exit**:
   - The turn processing latch (preventing overlapping turns) must only reset when the previous turn has completed streaming, encountered a terminal error, or been explicitly cancelled by the user.

4. **Route Changes Must Not Spawn Duplicate Voice Controllers**:
   - Navigating between views (e.g., Studio, Workspace, Settings) must maintain or cleanly rebind the voice controller. Check unmount/cleanup logic in React components to ensure listeners and audio nodes are cleanly disposed.

5. **Visual Blob / Avatar Separation**:
   - The visual animation or canvas blob is purely a view renderer. It must NEVER own, latch, or manage conversation runtime state or audio streaming buffers.

6. **Execution Evidence for Actions**:
   - Known executable AgenticOS actions (e.g., file creation, tool execution, workspace commands) must never be reported as completed to the user without hard execution evidence (return code, file existence, API response).

7. **Physical Voice vs Synthetic Transcript Tests**:
   - Passing synthetic transcripts into chat handlers verifies text routing, NOT acoustic capture, VAD (Voice Activity Detection), STT latency, or barge-in capability. Always label synthetic tests accurately.

---

## Diagnostic Checklist

When Jarvis voice or chat fails:
1. **Check Backend Port 4600 & `/api/health`**:
   - Is ModelGateway reachable?
   - Is the configured local provider (Ollama / Piper TTS / Whisper) or cloud provider responsive?
2. **Inspect Browser / Electron Console Logs**:
   - Look for audio context suspension, WebRTC/WebSocket disconnects, or unhandled promise rejections in voice hooks.
3. **Trace the Utterance Flow**:
   - Audio Input (Mic) -> STT (Whisper/Native) -> Transcript Debounce -> Authoritative Turn Latch -> Backend Route (`/api/jarvis/stream`) -> ModelGateway -> Stream Response -> TTS (Piper/Native) -> Speaker Playback.
4. **Isolate the Demonstrable Breakpoint**:
   - Determine the exact step in the flow where telemetry or data stopped before proposing any fix.
