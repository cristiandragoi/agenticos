import { secretStore } from '../server/src/services/gateway/secretStore.js';

async function checkKeyAndModels() {
  const apiKey = secretStore.getSync('openrouter') || process.env.OPENROUTER_API_KEY;
  const authRes = await fetch('https://openrouter.ai/api/v1/auth/key', {
    headers: { 'Authorization': `Bearer ${apiKey}` }
  });
  console.log('OpenRouter Key Info:', await authRes.json());
}

checkKeyAndModels();
