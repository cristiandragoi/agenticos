import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../server/.env') });

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';

const CANONICAL_TOOL_PROMPT = `
You are CodeX, a Restricted Process Runner for Agentic OS.
Workspace root is B:\\AgenticOS.

CRITICAL: You MUST respond with exactly one valid JSON object and NOTHING ELSE.
Do not use XML tags.
Do not use markdown code fences.
Do not include conversational preamble or explanations.

Tools:
1. readFile: { "type": "tool_call", "tool": "readFile", "arguments": { "path": "relative/path" } }
2. writeFile: { "type": "tool_call", "tool": "writeFile", "arguments": { "path": "relative/path", "content": "file content" } }
3. finish: { "type": "tool_call", "tool": "finish", "arguments": { "message": "Goal completed." } }
`;

async function testQwenLoop(taskPrompt: string) {
  console.log(`\nTesting task: "${taskPrompt}" with qwen/qwen3.8-max...`);
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://agenticos.dev',
      'X-Title': 'Agentic OS CodeX Test'
    },
    body: JSON.stringify({
      model: 'qwen/qwen3.8-max',
      messages: [
        { role: 'system', content: CANONICAL_TOOL_PROMPT },
        { role: 'user', content: taskPrompt }
      ],
      max_tokens: 120,
      temperature: 0,
      response_format: { type: 'json_object' }
    })
  });

  console.log('HTTP Status:', res.status);
  if (!res.ok) {
    console.log('Error:', await res.text());
    return false;
  }
  const data = await res.json();
  const reply = data.choices?.[0]?.message?.content;
  console.log('Qwen reply:', reply);
  try {
    const parsed = JSON.parse(reply);
    console.log('Parsed successfully:', parsed);
    return parsed.type === 'tool_call' && Boolean(parsed.tool);
  } catch (err: any) {
    console.error('JSON parse failed:', err.message);
    return false;
  }
}

async function run() {
  await testQwenLoop('Inspect B:\\AgenticOS\\package.json and tell me the project name. Read only.');
  await testQwenLoop('Inspect server/src/routers/jarvis.ts and summarize the routes.');
  await testQwenLoop('Write a disposable scratch file named test.txt with content Hello');
}

run();
