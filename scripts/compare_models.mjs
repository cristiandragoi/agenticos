import { secretStore } from '../server/dist/services/gateway/secretStore.js';

const key = process.env.OPENROUTER_API_KEY || secretStore.getSync('openrouter');
if (!key) {
  console.error('No OpenRouter API key found!');
  process.exit(1);
}

const candidateModels = [
  { id: 'xiaomi/mimo-v2.6-flash', name: 'MiMo-V2.6-Flash (default)', extra: {} },
  { id: 'xiaomi/mimo-v2.6-flash', name: 'MiMo-V2.6-Flash (reasoning: false)', extra: { reasoning: { enabled: false } } },
  { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash', extra: {} },
  { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B Instruct', extra: {} },
  { id: 'meta-llama/llama-3.1-8b-instruct', name: 'Llama 3.1 8B Instruct', extra: {} },
  { id: 'qwen/qwen-2.5-72b-instruct', name: 'Qwen 2.5 72B Instruct', extra: {} },
  { id: 'deepseek/deepseek-chat', name: 'DeepSeek Chat (V3)', extra: {} },
];

const question = 'Was ist der Unterschied zwischen dir und Hermes?';
const systemPrompt = 'Antworte direkt auf Deutsch in einem oder zwei kurzen Sätzen.';

async function measureTTFT(modelId, extra) {
  const t0 = Date.now();
  const body = {
    model: modelId,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: question }
    ],
    max_tokens: 120,
    stream: true,
    ...extra
  };

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${errText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let ttft = null;
  let firstWord = '';
  let fullText = '';
  let reasoningCount = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const dataStr = trimmed.slice(5).trim();
      if (dataStr === '[DONE]') continue;
      try {
        const parsed = JSON.parse(dataStr);
        const delta = parsed.choices?.[0]?.delta;
        if (delta?.reasoning || delta?.reasoning_content) {
          reasoningCount += (delta.reasoning || delta.reasoning_content || '').length;
        }
        if (delta?.content) {
          if (ttft === null) {
            ttft = Date.now() - t0;
            firstWord = delta.content.trim();
          }
          fullText += delta.content;
        }
      } catch {}
    }
  }

  return {
    ttft: ttft ?? (Date.now() - t0),
    totalMs: Date.now() - t0,
    firstWord,
    fullText: fullText.trim(),
    reasoningCount
  };
}

async function main() {
  console.log(`Starting OpenRouter Model Benchmark (Question: "${question}")\n`);
  const results = [];

  for (const m of candidateModels) {
    console.log(`Testing ${m.name} (${m.id})...`);
    const runs = [];
    let errOccurred = null;

    for (let r = 1; r <= 3; r++) {
      try {
        const res = await measureTTFT(m.id, m.extra);
        runs.push(res);
        console.log(`  Run ${r}: TTFT = ${res.ttft} ms | Total = ${res.totalMs} ms | Reasoning chars = ${res.reasoningCount} | Word = "${res.firstWord}"`);
      } catch (err) {
        console.error(`  Run ${r} ERROR:`, err.message);
        errOccurred = err.message;
        runs.push({ ttft: 99999, totalMs: 99999, error: err.message });
      }
      await new Promise(res => setTimeout(res, 500));
    }

    const validRuns = runs.filter(r => !r.error);
    const avgTtft = validRuns.length ? Math.round(validRuns.reduce((a, b) => a + b.ttft, 0) / validRuns.length) : null;
    results.push({
      id: m.id,
      name: m.name,
      avgTtft,
      runs,
      error: errOccurred,
      sampleText: validRuns[0]?.fullText || ''
    });
    console.log(`  => Average TTFT: ${avgTtft} ms\n`);
  }

  import('node:fs').then(fs => {
    fs.writeFileSync('scripts/model_comparison_results.json', JSON.stringify(results, null, 2));
    console.log('Saved results to scripts/model_comparison_results.json');
  });
}

main().catch(console.error);
