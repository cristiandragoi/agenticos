// scripts/benchmark-models.mjs
import { performance } from 'perf_hooks';

const OLLAMA_BASE = 'http://127.0.0.1:11434';
const MODELS = ['qwen2.5:7b', 'qwen3.5:9b'];

const PROMPTS = [
  {
    name: 'Short Greeting',
    messages: [{ role: 'user', content: 'How are you?' }]
  },
  {
    name: 'Model Identity',
    messages: [{ role: 'user', content: 'What model are you using?' }]
  },
  {
    name: 'Correction / Denial',
    messages: [
      { role: 'assistant', content: 'You asked me to check the database job.' },
      { role: 'user', content: 'No, I did not say that.' }
    ]
  },
  {
    name: 'Multilingual (German)',
    messages: [{ role: 'user', content: 'Wie geht es dir?' }]
  },
  {
    name: 'Multilingual (Romanian)',
    messages: [{ role: 'user', content: 'Ce model folosești?' }]
  },
  {
    name: 'Statement vs Command (Deciding not to act)',
    messages: [{ role: 'user', content: 'The weather is quite nice today.' }]
  }
];

async function runBenchmark() {
  console.log('=== BENCHMARKING LOCAL OLLAMA MODELS ===');
  for (const model of MODELS) {
    console.log(`\n--------------------------------------------------`);
    console.log(`Testing Model: ${model}`);
    console.log(`--------------------------------------------------`);
    let totalLatency = 0;
    let testsRun = 0;

    for (const test of PROMPTS) {
      const t0 = performance.now();
      try {
        const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            messages: [
              {
                role: 'system',
                content: 'You are Jarvis, a concise, helpful, grounded AI assistant. When the user denies a statement, acknowledge the correction briefly without inventing tasks.'
              },
              ...test.messages
            ],
            stream: false,
            options: {
              num_predict: 128,
              temperature: 0.3
            }
          })
        });

        const elapsed = Math.round(performance.now() - t0);
        totalLatency += elapsed;
        testsRun++;

        if (!res.ok) {
          console.log(`[${test.name}] Error ${res.status}: ${await res.text()}`);
          continue;
        }

        const data = await res.json();
        const reply = data?.message?.content?.trim() || '';
        console.log(`[${test.name}] (${elapsed}ms):`);
        console.log(`  "${reply.slice(0, 120)}${reply.length > 120 ? '...' : ''}"`);
      } catch (err) {
        console.log(`[${test.name}] Failed: ${err.message}`);
      }
    }

    const avgLatency = Math.round(totalLatency / (testsRun || 1));
    console.log(`\nAverage Latency for ${model}: ${avgLatency}ms`);
  }
}

runBenchmark().catch(console.error);
