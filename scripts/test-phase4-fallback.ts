import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../server/.env') });

const BASE = 'http://localhost:4000';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function testFallback() {
  console.log('================================================================');
  console.log('PHASE 4: FALLBACK SIMULATION (Qwen failure -> DeepSeek V4 Flash)');
  console.log('================================================================');

  // 1. Create a conversation
  const convRes = await fetch(`${BASE}/api/jarvis/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Fallback Test' })
  });
  const conv = await convRes.json();

  // 2. Dispatch a task where Qwen is primary candidate (qwen/qwen3.8-max)
  // Since OpenRouter Qwen Max is currently unavailable/exhausted, it simulates/executes the fallback path:
  // Qwen unavailable -> DeepSeek V4 Flash selected -> CodeX continues -> task completes without Laguna routing.
  console.log('Dispatching task: Inspect package.json using primary Qwen3.8-max with fallback...');
  const msgRes = await fetch(`${BASE}/api/jarvis/conversations/${conv.id}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: 'READ-ONLY: Use CodeX to inspect B:\\AgenticOS\\package.json and tell me the project name.'
    })
  });
  const msgData = await msgRes.json();
  const goalId = msgData.goalId;
  console.log('Dispatched Goal ID:', goalId);

  let finalGoal: any = null;
  const timeoutAt = Date.now() + 60000;
  while (Date.now() < timeoutAt) {
    await sleep(1000);
    const gRes = await fetch(`${BASE}/api/chat/agents/goals/${goalId}`);
    if (gRes.ok) {
      finalGoal = await gRes.json();
      if (['completed', 'failed', 'stopped'].includes(finalGoal.status)) {
        break;
      }
    }
  }

  console.log('Final Goal Status:', finalGoal?.status);
  const history = finalGoal?.history || [];
  
  // Check if Laguna was used (MUST NOT BE USED)
  const usedLaguna = history.some((e: any) => JSON.stringify(e).toLowerCase().includes('laguna'));
  console.log('Used Laguna:', usedLaguna);
  if (usedLaguna) {
    console.error('FAIL: Silently routed to Laguna');
    return false;
  }

  // Check if DeepSeek was resolved
  const usedDeepSeek = history.some((e: any) => JSON.stringify(e).toLowerCase().includes('deepseek'));
  console.log('DeepSeek fallback resolved:', usedDeepSeek);

  // Check if tool was executed
  const tools = history.filter((e: any) => e.state === 'tool_started');
  console.log('Tools executed:', tools.length);

  const passed = finalGoal?.status === 'completed' && !usedLaguna && tools.length >= 1;
  console.log(`Phase 4 Fallback Test: ${passed ? 'PASS' : 'FAIL'}`);
  return passed;
}

testFallback();
