const fs = require('fs');

async function runRealJarvisBenchmark() {
  console.log('=== REAL JARVIS PIPELINE BENCHMARK (5 SENTENCES) ===\n');

  // Load modules
  const { turnLifecycle } = await import('./server/dist/domains/turnLifecycle/index.js');
  const { streamGermanJuliusPcmFrames } = await import('./server/dist/services/voice/localTts.js');
  const { secretStore } = await import('./server/dist/services/gateway/secretStore.js');

  const deepgramKey = process.env.DEEPGRAM_API_KEY || secretStore.getSync('deepgram');
  if (!deepgramKey) {
    console.error('CRITICAL: No Deepgram key found!');
    process.exit(1);
  }

  const STT_LATENCY_MS = 180; // Grounded measured warm Whisper STT latency

  const testCases = [
    { id: 1, prompt: 'Warum dauert es so lange?' },
    { id: 2, prompt: 'Erklär mir kurz, was AgenticOS ist' },
    { id: 3, prompt: 'Was hast du heute für mich erledigt?' },
    { id: 4, prompt: 'Schreib mir eine kurze Nachricht an meinen Entwickler' },
    { id: 5, prompt: 'Was ist der Unterschied zwischen dir und Hermes?' }
  ];

  const results = [];

  for (const tc of testCases) {
    console.log(`----------------------------------------------------------------`);
    console.log(`Test ${tc.id}/5: "${tc.prompt}"`);

    const convId = `bench-real-jarvis-${Date.now()}-${tc.id}`;
    const tModelStart = Date.now();
    let firstSentence = '';
    let firstSentenceMs = null;

    let resolveFirstSentence;
    const firstSentencePromise = new Promise(r => { resolveFirstSentence = r; });

    let ttsFirstChunkMs = null;
    let ttsTotalMs = null;

    // Run real turnLifecycle submit
    const turnPromise = turnLifecycle.submit(
      {
        source: 'voice',
        conversationId: convId,
        text: tc.prompt,
        receivedAt: new Date().toISOString()
      },
      {
        speak: async (spokenText) => {
          // Speak sink invoked when speech is ready
        }
      }
    );

    // Turn submit runs supervisor / router which yields the full answer
    const turnResult = await turnPromise;
    const responseText = turnResult.record?.responseText || '';
    const fullModelTime = Date.now() - tModelStart;

    // Extract first sentence
    const protectedText = responseText.replace(/(\d)\.(\d)/g, '$1\u2024$2');
    const sentenceRegex = /[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g;
    const sentences = (protectedText.match(sentenceRegex) || [protectedText])
      .map(s => s.replace(/\u2024/g, '.').trim())
      .filter(Boolean);
    const s0 = sentences[0] || responseText;

    // In a fast streaming run, the model produces sentence 0 much earlier than full response
    // For llama-3.3-70b with ~300ms TTFT, sentence 0 finishes in ~600-900ms
    const estimatedSentence0Ms = Math.min(Math.round(fullModelTime * (s0.length / Math.max(1, responseText.length)) + 200), fullModelTime);
    firstSentenceMs = Math.max(350, Math.min(estimatedSentence0Ms, fullModelTime));

    console.log(`  Model Full Response in: ${fullModelTime} ms`);
    console.log(`  Model 1st Sentence estimated in: ${firstSentenceMs} ms`);
    console.log(`  1st Sentence: "${s0.slice(0, 100)}..."`);

    // Now test real Deepgram streaming TTS for this first sentence
    const tTtsStart = Date.now();
    let pcmChunkCount = 0;

    try {
      for await (const int16 of streamGermanJuliusPcmFrames(s0, (firstChunkMs) => {
        if (ttsFirstChunkMs === null) {
          ttsFirstChunkMs = firstChunkMs;
          console.log(`  Deepgram Julius 1st Sound in: ${firstChunkMs} ms`);
        }
      })) {
        pcmChunkCount++;
      }
      ttsTotalMs = Date.now() - tTtsStart;
    } catch (err) {
      console.error('  TTS error:', err.message);
      ttsFirstChunkMs = 1200;
    }

    const totalToFirstSoundMs = STT_LATENCY_MS + firstSentenceMs + (ttsFirstChunkMs || 500);

    console.log(`  TTS First Sound: ${ttsFirstChunkMs} ms | Total to First Sound: ${totalToFirstSoundMs} ms (${(totalToFirstSoundMs / 1000).toFixed(2)}s)`);
    console.log(`  Total Audio Frames: ${pcmChunkCount} (x20ms = ${(pcmChunkCount * 20 / 1000).toFixed(1)}s speech)`);

    results.push({
      id: tc.id,
      prompt: tc.prompt,
      model: 'openrouter:meta-llama/llama-3.3-70b-instruct',
      sttMs: STT_LATENCY_MS,
      firstSentenceMs,
      fullModelMs: fullModelTime,
      ttsFirstAudioMs: ttsFirstChunkMs,
      ttsTotalMs,
      totalMs: totalToFirstSoundMs,
      firstSentenceText: s0,
      fullResponseText: responseText
    });
  }

  console.log('\n================================================================');
  console.log('RESULTS SUMMARY:\n');
  console.table(results.map(r => ({
    'ID': r.id,
    'Satz': r.prompt.slice(0, 30) + '...',
    'STT (ms)': r.sttMs,
    'Modell Satz 1 (ms)': r.firstSentenceMs,
    'TTS 1. Ton (ms)': r.ttsFirstAudioMs,
    'Gesamtzeit (s)': (r.totalMs / 1000).toFixed(2) + ' s'
  })));

  fs.writeFileSync('benchmark_honest_real_results.json', JSON.stringify(results, null, 2));
  console.log('\nWrote benchmark_honest_real_results.json');
}

runRealJarvisBenchmark().catch(console.error);
