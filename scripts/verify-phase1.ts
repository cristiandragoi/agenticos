import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../server/.env') });

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';

const CANONICAL_TOOL_PROMPT = `
You are CodeX, the autonomous engineering worker for Agentic OS.
Your workspace is B:\\AgenticOS.

When you need to take an action, reply ONLY with a valid JSON object matching this exact format:
{
  "type": "tool_call",
  "tool": "readFile",
  "arguments": {
    "path": "package.json"
  }
}

When you have completed the task, reply with:
{
  "type": "finish",
  "result": "<your concise summary here>"
}
`;

async function testModel(modelId: string) {
  console.log(`\n========================================`);
  console.log(`TESTING MODEL: ${modelId}`);
  console.log(`========================================`);

  if (!OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is not set');
  }

  // 1. Basic Completion
  console.log('1. Testing basic completion...');
  const t0 = Date.now();
  const basicRes = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://agenticos.dev',
      'X-Title': 'Agentic OS CodeX Verification'
    },
    body: JSON.stringify({
      model: modelId,
      messages: [
        { role: 'user', content: 'Respond with exactly: CODEX_ONLINE' }
      ],
      max_tokens: 50,
      temperature: 0
    })
  });

  if (!basicRes.ok) {
    const errText = await basicRes.text();
    console.error(`Basic completion failed: ${basicRes.status} ${errText}`);
    return false;
  }

  const basicData = await basicRes.json();
  const basicText = basicData.choices?.[0]?.message?.content?.trim() || '';
  console.log(`Basic completion OK (${Date.now() - t0}ms):`, basicText);

  // 2. Structured JSON Tool Call
  console.log('2. Testing canonical structured JSON tool call...');
  const t1 = Date.now();
  const toolRes = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://agenticos.dev',
      'X-Title': 'Agentic OS CodeX Verification'
    },
    body: JSON.stringify({
      model: modelId,
      messages: [
        { role: 'system', content: CANONICAL_TOOL_PROMPT },
        { role: 'user', content: 'Inspect the root package.json file to check dependencies.' }
      ],
      max_tokens: 150,
      temperature: 0,
      response_format: { type: 'json_object' }
    })
  });

  if (!toolRes.ok) {
    const errText = await toolRes.text();
    console.error(`Tool call failed: ${toolRes.status} ${errText}`);
    return false;
  }

  const toolData = await toolRes.json();
  const toolText = toolData.choices?.[0]?.message?.content?.trim() || '';
  console.log(`Tool response (${Date.now() - t1}ms):`, toolText);

  try {
    const parsed = JSON.parse(toolText);
    if (parsed.type === 'tool_call' && parsed.tool && parsed.arguments) {
      console.log('Canonical tool call parsed successfully: PASS');
      return true;
    } else {
      console.warn('Tool call structure mismatch:', parsed);
      return false;
    }
  } catch (err: any) {
    console.error('Failed to parse JSON tool response:', err.message);
    return false;
  }
}

async function runPhase1() {
  console.log('=== PHASE 1: VERIFY PROVIDER ACCESS ===');
  const qwenOk = await testModel('qwen/qwen3.8-max');
  const deepseekOk = await testModel('deepseek/deepseek-v4-flash');

  console.log('\n=== PHASE 1 SUMMARY ===');
  console.log(`QWEN PROVIDER (qwen/qwen3.8-max): ${qwenOk ? 'PASS' : 'FAIL'}`);
  console.log(`DEEPSEEK PROVIDER (deepseek/deepseek-v4-flash): ${deepseekOk ? 'PASS' : 'FAIL'}`);
}

runPhase1();
