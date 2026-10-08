/**
 * test-voice-german-benchmark.mjs
 * Plays 5 German sentences sequentially through the exact real microphone pipeline:
 * 1. Audio buffer is sent to transcribeLocally (Whisper on CUDA)
 * 2. Transcribed text is processed by TurnLifecycle / Jarvis routing
 * 3. TTS generates speech audio with aura-2-julius-de
 * 4. Measures: STT latency, Model TTFT / First sentence latency, TTS time to first sound, Total latency
 */
import { synthesizeLocally } from './dist/services/voice/localTts.js';
import { transcribeLocally } from './dist/services/voice/localTranscribe.js';
import { setActiveLanguageState } from './dist/services/language/activeLanguageState.js';
import { turnLifecycle } from './dist/domains/turnLifecycle/index.js';

setActiveLanguageState('de', 'benchmark');

const TEST_SENTENCES = [
  'Hallo Jarvis',
  'Wie spät ist es?',
  'Was kannst du tun?',
  'Erzähl mir einen kurzen Witz.',
  'Danke, das reicht.',
];

async function run() {
  console.log('=== STARTING 5-SENTENCE GERMAN VOICE PIPELINE BENCHMARK ===\n');

  // 1. Pre-synthesize audio for all 5 sentences to simulate microphone speech input
  console.log('Generating test audio for microphone pipeline...');
  const testAudios = [];
  for (const s of TEST_SENTENCES) {
    const audio = await synthesizeLocally(s, 'aura-2-julius-de');
    testAudios.push({ text: s, audio });
  }
  console.log('Test audio generated.\n');

  // Warmup whisper worker
  await transcribeLocally(testAudios[0].audio, '.mp3', 'de', 0, 1000);

  const results = [];

  for (let i = 0; i < testAudios.length; i++) {
    const item = testAudios[i];
    const turnId = i + 1;
    console.log(`--- [Turn ${turnId}] Input: "${item.text}" ---`);

    // Step 1: STT (Whisper on CUDA)
    const tSttStart = Date.now();
    const sttRes = await transcribeLocally(item.audio, '.mp3', 'de', turnId, 1500);
    const sttMs = Date.now() - tSttStart;
    const recognizedText = sttRes.text.trim();

    // Step 2: Routing / Lifecycle to response text
    const tModelStart = Date.now();
    let spokenReply = '';
    let firstSentenceMs = 0;

    const recordRes = await turnLifecycle.submit(
      {
        conversationId: `bench-conv-${Date.now()}`,
        text: recognizedText,
        source: 'voice_livekit',
        externalTurnId: turnId,
        sttConfidence: 0.98,
      },
      {
        speak: async (replyText) => {
          if (!spokenReply) {
            firstSentenceMs = Date.now() - tModelStart;
            spokenReply = replyText;
          }
        },
      }
    );

    const modelMs = firstSentenceMs || (Date.now() - tModelStart);
    const fullText = spokenReply || recordRes.record?.responseText || '';

    // Step 3: TTS time to first audio sound (Stimme bis zum ersten Ton)
    const deepgramKey = process.env.DEEPGRAM_API_KEY || (await import('./dist/services/gateway/secretStore.js')).secretStore.getSync('deepgram');
    const tTtsStart = Date.now();
    let ttsFirstChunkMs = null;
    let ttsAudioLength = 0;
    try {
      const resp = await fetch('https://api.deepgram.com/v1/speak?model=aura-2-julius-de', {
        method: 'POST',
        headers: { Authorization: `Token ${deepgramKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: fullText }),
      });
      for await (const chunk of resp.body) {
        if (ttsFirstChunkMs === null) {
          ttsFirstChunkMs = Date.now() - tTtsStart;
        }
        ttsAudioLength += chunk.length;
      }
    } catch {
      const buf = await synthesizeLocally(fullText, 'aura-2-julius-de');
      ttsAudioLength = buf.length;
      ttsFirstChunkMs = Date.now() - tTtsStart;
    }
    const ttsMs = ttsFirstChunkMs ?? (Date.now() - tTtsStart);

    // Total time from end of user speech (tSttStart) to first sound generated
    const totalMs = sttMs + modelMs + ttsMs;

    console.log(`  STT: ${sttMs}ms ("${recognizedText}")`);
    console.log(`  Modell bis zum ersten Satz: ${modelMs}ms ("${fullText}")`);
    console.log(`  Stimme bis zum ersten Ton: ${ttsMs}ms (${ttsAudioLength} bytes PCM)`);
    console.log(`  Gesamtzeit: ${(totalMs / 1000).toFixed(2)}s - ${totalMs < 3000 ? 'PASS (< 3s)' : 'FAIL (> 3s)'}\n`);

    results.push({
      turn: turnId,
      input: item.text,
      recognized: recognizedText,
      reply: fullText,
      sttMs,
      modelMs,
      ttsMs,
      totalMs,
      passed: totalMs < 3000,
    });
  }

  console.log('=== SUMMARY TABLE ===');
  console.log('| Turn | Eingabe | STT | Modell | TTS | Gesamt | Status |');
  console.log('|---|---|---|---|---|---|---|');
  for (const r of results) {
    console.log(`| ${r.turn} | "${r.input}" | ${r.sttMs}ms | ${r.modelMs}ms | ${r.ttsMs}ms | ${(r.totalMs/1000).toFixed(2)}s | ${r.passed ? 'PASSED' : 'FAILED'} |`);
  }

  const allPassed = results.every((r) => r.passed);
  console.log(`\nAll 5 sentences under 3 seconds: ${allPassed ? 'YES (funktioniert)' : 'NO'}`);

  process.exit(allPassed ? 0 : 1);
}

run().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
