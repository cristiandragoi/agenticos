import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../server/.env') });

const key = process.env.DEEPSEEK_API_KEY;

async function testDirectDeepSeek() {
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: 'You are CodeX. Output JSON: { "type": "tool_call", "tool": "readFile", "arguments": { "path": "package.json" } }' },
        { role: 'user', content: 'Inspect package.json' }
      ],
      max_tokens: 500,
      temperature: 0
    })
  });

  console.log('Status:', res.status);
  const text = await res.text();
  console.log('Body:', text);
}

testDirectDeepSeek();
