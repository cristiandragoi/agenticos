import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../server/.env') });

const BASE = 'http://localhost:4000';

const goals = [
  'goal-54c1dedd-',
  'goal-49c779b5-',
  'goal-7005ac1d-',
  'goal-5abf5199-',
  'goal-bfdf66dc-',
  'goal-38c6c071-',
  'goal-79f7fe07-',
  'goal-5a292ec3-',
  'goal-4a9e3c49-',
  'goal-acf348d0-'
];

async function inspectPhase1() {
  console.log('================================================================');
  console.log('PHASE 1: PROVING WHAT ACTUALLY SERVED THE PRIOR 10/10 RUN');
  console.log('================================================================\n');

  for (let i = 0; i < goals.length; i++) {
    const gid = goals[i];
    const res = await fetch(`${BASE}/api/chat/agents/goal/${gid}`);
    if (!res.ok) {
      console.log(`Task ${i + 1} (${gid}): not found (${res.status})`);
      continue;
    }
    const data = await res.json();
    const history = data.history || [];
    
    // Find provider/model resolution events
    const llmEvents = history.filter((e: any) => e.provider || e.model || e.eventType?.includes('step') || e.state === 'executing' || e.state === 'tool_started');
    const toolEvents = history.filter((e: any) => e.state === 'tool_started');
    const lastEvent = history[history.length - 1];

    console.log(`Task ${i + 1} [${gid}]:`);
    console.log(`  - Goal: ${data.originalGoal?.slice(0, 70)}...`);
    console.log(`  - Status: ${data.status}`);
    console.log(`  - Tools: ${toolEvents.map((e: any) => e.tool).join(', ')}`);
    
    // Check history entries for provider details
    for (const ev of history) {
      if (ev.payload && (ev.payload.provider || ev.payload.model || ev.payload.fallbackProvider)) {
        console.log(`  - Event ${ev.sequence} payload: provider=${ev.payload.provider}, model=${ev.payload.model}`);
      }
    }
  }
}

inspectPhase1();
