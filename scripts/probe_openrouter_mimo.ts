import { secretStore } from '../server/src/services/gateway/secretStore.js';

async function testOpenRouterMiMo() {
  const apiKey = secretStore.getSync('openrouter') || process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error('No OpenRouter API key found in secretStore or process.env!');
    process.exit(1);
  }
  console.log('OpenRouter API key detected (length:', apiKey.length, ')');

  const modelsToTest = [
    'xiaomi/mimo-v2.6-flash',
    'xiaomi/mimo-v2.6-pro',
  ];

  for (const modelId of modelsToTest) {
    console.log(`\nTesting OpenRouter with model: ${modelId}...`);
    const t0 = Date.now();
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://agenticos.local',
          'X-Title': 'AgenticOS Jarvis',
        },
        body: JSON.stringify({
          model: modelId,
          messages: [
            { role: 'system', content: 'You are Jarvis in AgenticOS. Be direct and concise.' },
            { role: 'user', content: 'State your model ID in 5 words or fewer.' }
          ],
          max_tokens: 50,
          temperature: 0.1,
        }),
      });

      const latencyMs = Date.now() - t0;
      if (!res.ok) {
        const errorText = await res.text();
        console.error(`FAILED (${res.status} ${res.statusText}) in ${latencyMs}ms:`, errorText);
      } else {
        const data: any = await res.json();
        const reply = data.choices?.[0]?.message?.content;
        console.log(`SUCCESS in ${latencyMs}ms! Reply: "${reply}"`);
        console.log('Usage:', data.usage);
      }
    } catch (err: any) {
      console.error(`ERROR in ${Date.now() - t0}ms:`, err?.message || err);
    }
  }
}

testOpenRouterMiMo();
