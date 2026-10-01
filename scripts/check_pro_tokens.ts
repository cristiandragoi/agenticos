import { secretStore } from '../server/src/services/gateway/secretStore.js';

async function checkProWithMaxTokens() {
  const apiKey = secretStore.getSync('openrouter') || process.env.OPENROUTER_API_KEY;
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'xiaomi/mimo-v2.6-pro',
      messages: [{ role: 'user', content: 'What is 15 + 27? Answer in 5 words or fewer.' }],
      max_tokens: 1024,
    }),
  });
  console.log('Status:', res.status);
  console.log('Body:', await res.json());
}

checkProWithMaxTokens();
