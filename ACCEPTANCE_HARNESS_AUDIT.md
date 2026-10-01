# ACCEPTANCE_HARNESS_AUDIT.md
**Jarvis / AgenticOS Forensic Acceptance Suite Audit**  
**Date:** 2026-09-20  
**Target Harness:** `D:\AgenticOS\scripts\verify-real-physical-turn-flow.cjs`

---

## 1. Executive Summary

A forensic audit of `scripts/verify-real-physical-turn-flow.cjs` was conducted to determine the truthfulness of the 11-turn acceptance test and whether it genuinely tested live physical microphone conversation.

### Verdict: Category D — Direct Transcript / Text Injection
The test suite did **NOT** use physical microphone audio, recorded WAV audio, or synthetic audio. Every turn in `verify-real-physical-turn-flow.cjs` injected pre-baked text strings directly into the backend HTTP SSE streaming endpoint (`/api/jarvis/conversations/:id/message/stream`).

Consequently, labeling the file `verify-real-physical-turn-flow.cjs` was a critical misrepresentation. The harness tested the HTTP/SSE semantic and conversational routing layer, but **completely bypassed**:
- The Windows physical microphone device
- Real-time PCM audio capture and buffer handling
- Audio resampling (48kHz/44.1kHz -> 16kHz mono)
- Web Audio API AnalyserNode RMS amplitude and ambient noise-floor calculation
- Voice Activity Detection (VAD) pre-roll, speech onset, and end-of-speech silence detection
- WebM audio packaging (`MediaRecorder`)
- `/api/voice/transcribe` HTTP multipart upload
- The production `whisper_worker.py` (faster-whisper CUDA STT engine)
- STT confidence scoring and language detection
- Acoustic barge-in interruption of physical audio playback

---

## 2. Line-by-Line Evidence

### 2.1 The Core Turn Execution Function (`postStreamTurn`)
In `D:\AgenticOS\scripts\verify-real-physical-turn-flow.cjs` lines 64–137:

```javascript
// Lines 64-81
async function postStreamTurn(conversationId, prompt, options = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      prompt,
      confidence: options.confidence ?? 0.95,
      isBargeIn: options.isBargeIn ?? false,
      ...options,
    });
    const req = http.request(
      `http://127.0.0.1:${BACKEND_PORT}/api/jarvis/conversations/${conversationId}/message/stream`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
        timeout: 30000,
      },
```

#### Evidence Findings:
1. **Direct Text Payload:** The payload sent is a JSON object `{ prompt, confidence: 0.95, isBargeIn: false }`.
2. **Endpoint:** It hits `/api/jarvis/conversations/:id/message/stream`, which is the typed/SSE chat endpoint inside `server/src/routers/jarvis.ts`.
3. **Synthetic Confidence Injection:** Confidence is hardcoded to `0.95` unless overridden. No Whisper log-probability or sigmoid confidence calculation occurred.
4. **No Audio Stream:** No audio stream, PCM buffer, WebM chunk, or WAV file was transmitted anywhere in this function.

### 2.2 Complete Absence of the Audio Pipeline
Across the entire 372 lines of `verify-real-physical-turn-flow.cjs`:
- Zero references to `navigator.mediaDevices.getUserMedia`
- Zero references to `AudioContext` or `createAnalyser`
- Zero references to `/api/voice/transcribe`
- Zero references to `whisper_worker.py` or STT processing
- Zero references to `real_command.mp3` or test audio buffers
- Zero interaction with Electron's Chrome DevTools Protocol (CDP) to click the microphone or inspect audio recording state (the debug port `9222` is passed in `spawn`, but never connected to via WebSocket or CDP).

---

## 3. Comparison with the Production Audio Pipeline

The table below contrasts what `verify-real-physical-turn-flow.cjs` executed versus what the live production voice pipeline executes:

| Pipeline Step | Production Spoken Voice Flow | `verify-real-physical-turn-flow.cjs` |
|---|---|---|
| **1. Audio Input** | Windows physical microphone captures sound wave | **None** (direct text string in JS) |
| **2. Audio Device Capture** | `navigator.mediaDevices.getUserMedia({ audio: true })` | **Bypassed completely** |
| **3. Frame Buffer & Resampling** | Browser / OS audio stack, 16kHz mono conversion | **Bypassed completely** |
| **4. RMS & Ambient Noise** | Web Audio `AnalyserNode`, dynamic thresholding | **Bypassed completely** |
| **5. VAD Pre/Post-roll** | 900ms silence detection ends utterance | **Bypassed completely** |
| **6. Audio Blob Packaging** | `MediaRecorder` generates `audio/webm` | **Bypassed completely** |
| **7. STT Network Upload** | `POST /api/voice/transcribe` (multipart/form-data) | **Bypassed completely** |
| **8. STT Engine** | `whisper_worker.py` (faster-whisper CUDA) | **Bypassed completely** |
| **9. STT Confidence & Lang** | Sigmoid confidence calibration & language detection | **Faked as 0.95 literal** |
| **10. Semantic Parsing** | `semanticGoalParser.parseGoal()` | **Executed** |
| **11. Conversational Context** | `conversationalState.ts` / `turnRouter.ts` | **Executed** |
| **12. Project Intelligence** | `projectStateContext.ts` / `projectController.ts` | **Executed** |
| **13. Action Execution** | `universalExecutionController.ts` | **Executed** |
| **14. Response Assembly** | `resultRenderer.ts` | **Executed** |
| **15. GUI Navigation** | Electron Hash Router (`window.location.hash`) | **Failed (unacknowledged ACK)** |
| **16. TTS Output** | `POST /api/voice/speak` + EdgeTTS / Web Speech API | **Bypassed completely** |

---

## 4. Architectural Separation Required

To ensure absolute truthfulness in the engineering process:

1. **Harness Renaming & Scope:**
   `scripts/verify-real-physical-turn-flow.cjs` must be renamed to:
   `scripts/verify-semantic-stream-turn-flow.cjs`  
   It must be documented as the **Semantic & Routing Acceptance Suite**.

2. **Physical Microphone Acceptance Suite:**
   A dedicated harness `scripts/verify-physical-microphone-live.cjs` must be created. It must:
   - Connect to the running Electron app via CDP (port 9222)
   - Inspect physical audio input devices via `navigator.mediaDevices.enumerateDevices()`
   - Trigger the real physical microphone capture cycle (or verify real physical microphone PCM through the production VAD and Whisper transcription worker)
   - Read the resulting Whisper transcript from the composer and verify that live microphone input was accurately processed.
