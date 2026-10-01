import { secretStore } from '../server/src/services/gateway/secretStore.js';

async function testMiMoTools() {
  const apiKey = secretStore.getSync('openrouter') || process.env.OPENROUTER_API_KEY;
  const tools = [
    {
      type: 'function',
      function: {
        name: 'open_browser_target',
        description: 'Opens a website target in the visible human browser',
        parameters: {
          type: 'object',
          properties: {
            target: { type: 'string', description: 'Name of the website, e.g., YouTube' },
            url: { type: 'string', description: 'URL to navigate to' }
          },
          required: ['target', 'url']
        }
      }
    }
  ];

  for (const modelId of ['xiaomi/mimo-v2.6-flash', 'xiaomi/mimo-v2.6-pro']) {
    console.log(`\n=== Testing Tool Calling on ${modelId} ===`);
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
            { role: 'system', content: 'You are Jarvis, an executive assistant. Call tools when requested.' },
            { role: 'user', content: 'Jarvis, please open YouTube.' }
          ],
          tools,
          tool_choice: 'auto',
          temperature: 0.1,
        }),
      });

      const latencyMs = Date.now() - t0;
      const data: any = await res.json();
      const choice = data.choices?.[0];
      console.log(`Status: ${res.status} in ${latencyMs}ms`);
      console.log('Tool Calls:', JSON.stringify(choice?.message?.tool_calls, null, 2));
      console.log('Content:', choice?.message?.content);
    } catch (err: any) {
      console.error('Error:', err?.message || err);
    }
  }
}

testMiMoTools();
