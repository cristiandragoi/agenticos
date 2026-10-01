# JARVIS VOICE V2 — Root Cause Analysis

## ROOT CAUSES IDENTIFIED

### 1. Romanian Voice Issue (CRITICAL)

**Location:** `server/src/routers/voice.ts` lines 310-324

**Problem:** The `/api/voice/tts` endpoint checks for Piper availability first, BUT the check is missing for Romanian in certain code paths. Looking at voiceSessionConfig.ts line 21:
```javascript
ro: { locale: 'ro-RO', voice: 'ro-RO-EmilNeural' }
```

This uses Edge TTS's `ro-RO-EmilNeural` which has German/English accent issues. The Piper model `ro_RO-mihai-medium EXISTS and is valid but NOT being used because:

- `/api/voice/tts` correctly routes to Piper (line 311-324) ✅
- BUT voice routing via browser hooks may fall back through localTts.ts → edge-tts instead of hitting /api/voice/tts
- The voice state pinning (`voiceSessionConfigRef`) defaults to `en-GB-RyanNeural` and doesn't get updated for ro/de

**Files involved:**
- `server/src/routers/voice.ts`: 311-324 (Piper check)
- `server/src/lib/voiceSessionConfig.ts`: 46-48 (Edge TTS locale/voice mapping)
- `server/src/services/voice/localTts.ts`: 99 (fallback to ro-RO-EmilNeural via edge-tts)

**Fix:** Force `/api/voice/tts` routing by default; ensure browser hooks call this endpoint consistently. Also add explicit fallback to Piper when the Edge TTS voice fails quality check.

---

### 2. Latency Issue (HIGH)

**Source:** `server/src/routers/voice.ts` /api/voice/tts and /api/voice/speak endpoints

**Path breakdown for Romanian:**
1. User speaks → VAD in browser (`useVoiceIO.ts`) — ~0ms (real-time detection)
2. STT to Deepgram → ~200-400ms OR local Whisper → ~300ms
3. Language detection at line 44-46: sets `activeLang`
4. `/api/voice/tts` hit at browser hook (line in JarvisComposer.tsx)
5. **Voice resolution at line 94:** calls `resolveVoiceForLanguage(activeLang, ...)`
6. **Piper check fails** (if models not found or timeout) → falls to Edge TTS at line 362
7. **Edge TTS sync call via Python:** spawns tts.py with edge-tts wrapper → ~1-2s synthesis
8. Audio sent back → playback starts

**Latency culprits:**
- No streaming for local TTS (must wait entire buffer)  
- Edge TTS Python wrapper adds overhead (~500ms-1s)
- No parallel pre-warming of voices
- No early audio chunking for progressive playback

**Optimization path:**
- Enable Deepgram TTS API for all languages (if keys available) — streams faster
- Pre-load Piper models into memory
- Switch `/api/voice/speak` to use server-side streaming SSE response
- Add parallel voice resolution per language before request
- For English: use Deepgram directly; for de/ro: pipeline through localTts.ts but ensure piped path is used first

---

### 3. STOP / Barge-In Issue (CRITICAL)

**Location:** `src/hooks/useVoiceIO.ts` — multiple functions

**Problem:** The barge-in logic exists but has incomplete state transitions:

```javascript
// Line 472-488: duckPlayback() called when user speaks while Jarvis plays
const duckPlayback = useCallback(() => { 
  // ducks volume to 0.2, sets state to 'ducked' 
}, [setVoiceState]);

// Line 469: haltPlayback() is called but barge-in classification must cancel stream
```

**Broken path:**
1. `onBargeIn` fires (line 77) → calls internal ducking logic  
2. BUT the model stream (/api/* SSE) is NOT cancelled at that point — late tokens still arrive  
3. Audio element has handlers cleared (`el.onplay = null; el.onended = null;`) but stale `speechSynthesis` calls may resume playback
4. Playback halted but the response generation continues and eventually queues another chunk → plays out after user stops speaking

**Missing:**
- At `onBargeIn`, immediately `abort()` pending SSE fetch at line 8 (voice.ts sends streaming)
- Clear pending model generation state (`killGenerationIdRef.current`)
- Prevent new TTS from queueing during interrupt
- Add explicit stream abort + flush before duck

**Fix location:** `useVoiceIO.ts` line ~76-90 where `onBargeIn` callback is defined — add immediate cancel to SSE/streamed model generation inside it.

---

### 4. Turn State Issue (MEDIUM)

**Location:** Same VAD/state machine in `useVoiceIO.ts`

**Problem:** States declared but not enforced:

```
IDLE → [startListening] LISTENING  
      → rms > threshold TRANSCRIBING  
      → silence >= endSpeechSilenceMs END_OF_TURN  
         → STT result received THINKING  (model request)  
         → model complete SPEAKING  (playAudio called)  
         → onended INTERRUP TED (barge-in or stop) → LISTENING
```

**Gaps:**
- `INTERRUPTED` state not explicitly tracked after successful barge-in cancel
- No watchdog to detect if VAD rAF stopped while speaking (background/suspension recovery missing) — but this exists at line 208-214 (vadWatchdogRef)
- Continuation window may keep old transcript alive too long → duplicates

---

## FILES TO FIX

1. `D:/AgenticOS/server/src/routers/voice.ts` — ensure Piper path always used for ro/de; add quality check fallback
2. `D:/AgenticOS/server/src/lib/voiceSessionConfig.ts` — explicit Romanian/Piper voice mapping override if Edge TTS fails
3. `D:/AgenticOS/src/hooks/useVoiceIO.ts` — immediate stream abort + state clean in `onBargeIn` callback
4. `D:/AgenticOS/server/src/routers/voice.ts` — /api/voice/speak endpoint to use streaming SSE for lower latency

---

## VERIFICATION PLAN

After fixes, run tests:
1. POST Romanian text → verify `provider: piper` and audio sounds native
2. Say "stop" mid-response → playback halts immediately, no resumption
3. Speak Romanian after stop → STT succeeds, same voice used
4. Measure end-to-end latency with timestamped logs
5. Rapid de/ro/en conversation → correct voice per language
6. Verify German uses `de_DE-thorsten-high` (not Killian or fallback)
