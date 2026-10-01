import { secretStore } from '../server/src/services/gateway/secretStore.js';

async function checkProError() {
  const apiKey = secretStore.getSync('openrouter') || process.env.OPENROUTER_API_KEY;
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'xiaomi/mimo-v2.6-pro',
      messages: [{ role: 'user', content: 'hello' }],
    }),
  });
  console.log('Status:', res.status);
  console.log('Body:', await res.text());
}

checkProError();
