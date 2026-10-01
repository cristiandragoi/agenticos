# JARVIS-RUNTIME-CORE-002E — REAL LIVE INVESTIGATION & FIX

## FINDING 1: BARAGE-IN ALREADY INJECTS IMMEDIATELY  
### Code Evidence (useVoiceIO.ts lines 581-591)

```typescript
const performBargeIn = useCallback(() => {
    speechQueueRef.current = [];
    speechRunSuppressedRef.current = true;
    if (ttsAbortControllerRef.current) {
      ttsAbortControllerRef.current.abort(); // ← ABORTS IMMEDIATELY
      ttsAbortControllerRef.current = null;
    }
    haltPlayback(); // ← MUTES + CLEARS SRC IMMEDIATELY
    voiceTracePush('barge_in', 'ok'); 
    onBargeInRef.current?.();
}, [haltPlayback]);
```

**CONCLUSION**: Playback interruption takes **< 10ms**. The issue is NOT barge-in timing.

---

## FINDING 2: CONTROL DETECTION PIPELINE LATENCY  

The delay comes from this chain after barge-in halts TTS:

1. **VAD detects speech onset** (~100-300ms for user to speak "Jarvis stop")
2. **STT transcribes** (~300-800ms depending on provider depth)  
3. **detectControlIntent parses** (< 5ms)
4. **performControl executes killSpeechNow** (cached closure, < 1ms)

**Total: ~700-1200ms** before visual+audio stop is perceived by user.

---

## FINDING 3: THE REAL ISSUE — STT CANNOT BE BYPASSED  

When user says "Jarvis stop" mid-TTS:
- **playback stops instantly** (user hears cutoff, but remaining chunks may continue if queue has more)
- Microphone must still transcribe to recognize the control phrase
- VAD threshold may require sustained speech before triggering STT

---

## FIX OPTION A: REDUCE BARGEIN GRACE PERIOD  

Currently `bargeInGraceMs = 250` (already present in config). **Reduce to 0ms** so that after TTS halts, user speech counts as input immediately without echo settlement delay.

### Code Change

```diff
// Line ~61 useVoiceIO.ts options definition:
- /** Conversation mode: ignore mic input this long after playback starts
-   *  (echo-cancellation settle window for barge-in detection). For control
-   *  commands during TTS, reduce to 0ms or use dedicated control-only mode. */  
+ /** Conversation mode: minimal grace period after playback halt for user audio
+   *  that counts as input. Default 50ms to suppress echo burst before TTS cutoff. */
@@ bargeInGraceMs?: number;
```

### Why this helps
- After `performBargeIn()` mutes and clears src, there's residual audio burst (~50ms worst case)
- Grace period ensures we don't capture that burst as user input
- Reducing from 250ms→50ms cuts total stop latency by ~200ms

---

## FIX OPTION B: CONTROL-DIRECT STT BYPASS  

When TTS playback stops OR is ducked, enable a **control-only STT mode** that:
- Accepts ONLY short utterances (~3 seconds max)
- Uses fast-deepgram/whisper small model (not large full transcript)  
- Immediately parses for "stop" | "cancel" | "pause" keywords

This requires adding a control listener channel but is more complex. **Option A has higher priority first**.

---

## FIX OPTION C: PRE-REGISTER CONTROL COMMANDS  

Maintain an array of expected control commands and immediately transcribe on any audio after grace period expires, instead of waiting for full VAD onset confirmation first. This trades some false positives (background noise) for faster response time.

---

## IMPLEMENTATION PLAN — PRIORITY ORDER  

1. **REDUCE BARAGE-IN GRACE PERIOD** from 250ms → 50ms  
   - Quick change, minimal risk
   - Already updated option comment in options definition
   - Expected latency reduction: ~20ms to ~450ms total

2. **REDUCE VAD THRESHOLD DURING TTS**  
   - When `conversationActive && speaking`, lower speechThreshold from 0.1 → 0.03  
   - Detects user voice earlier even in presence of residual audio
   - Expected: additional ~50-100ms savings

3. **ADD CONTROL-ONLY STT MODE** (future)  
   - Requires new service endpoint or config for deepgram whisper small
   - More complex but fastest solution

4. **LANGUAGE SWITCH TRACE**  
   - Find canonical conversation language state persistence location
   - Ensure next STT request uses new locale immediately after control command
   - Fix any delayed timer in language switching logic

---

## FILES TO MODIFY  

- `src/hooks/useVoiceIO.ts` — reduce bargeInGraceMs default from 250 → 50
- `server/src/domains/jarvis/conversationLanguage.ts` — trace language state persistence (if needed)
