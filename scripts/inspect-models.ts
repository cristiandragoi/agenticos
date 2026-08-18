import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../server/.env') });

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';

async function inspectModel(model: string) {
  console.log(`\n========================================`);
  console.log(`INSPECTING MODEL: ${model}`);
  console.log(`========================================`);

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: model,
      messages: [
        { role: 'system', content: 'You are CodeX. Output JSON format: { "type": "tool_call", "tool": "readFile", "arguments": { "path": "package.json" } }' },
        { role: 'user', content: 'Inspect package.json' }
      ],
      max_tokens: 130,
      reasoning: { effort: 'none' },
      temperature: 0
    })
  });

  const raw = await res.text();
  console.log('HTTP Status:', res.status);
  console.log('Raw Response:', raw);
}

async function main() {
  await inspectModel('qwen/qwen3.8-max');
  await inspectModel('deepseek/deepseek-v4-flash');
}

main();
