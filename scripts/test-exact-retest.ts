const BASE = 'http://localhost:4000';

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runGoal(prompt: string, name: string): Promise<{ success: boolean; durationMs: number; summary: string; tools: string[] }> {
  console.log(`\n================================================================`);
  console.log(`STARTING: ${name}`);
  console.log(`================================================================`);
  const startTime = Date.now();

  const createRes = await fetch(`${BASE}/api/chat/agents/goals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentId: 'agent-codex',
      goal: prompt,
      requiresApproval: false
    })
  });

  if (!createRes.ok) {
    console.error('Failed to create goal:', createRes.status);
    return { success: false, durationMs: 0, summary: 'create_failed', tools: [] };
  }

  const { goalId } = await createRes.json();
  console.log(`Created Goal ID: ${goalId}`);

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

  const durationMs = Date.now() - startTime;
  if (!finalGoal) {
    console.error(`Goal ${goalId} timed out after ${durationMs}ms`);
    return { success: false, durationMs, summary: 'timed_out', tools: [] };
  }

  const history = finalGoal.history || [];
  const finishEvt = history.find((e: any) => e.state === 'completed' || e.tool === 'finish' || e.eventType === 'agent_completed');
  const summary = finishEvt?.message || finalGoal.runSummary || '';
  const success = finalGoal.status === 'completed';
  const tools = history.filter((e: any) => e.state === 'tool_started').map((e: any) => e.tool);

  console.log(`Goal Status: ${finalGoal.status}`);
  console.log(`Duration: ${durationMs}ms`);
  console.log(`Tools executed (${tools.length}):`, tools);
  console.log(`Summary Preview: ${summary.slice(0, 300)}...`);

  return { success, durationMs, summary, tools };
}

async function main() {
  // Multi-step read test
  const t = await runGoal(
    'READ-ONLY: Inspect B:\\AgenticOS\\package.json and then inspect B:\\AgenticOS\\server\\package.json, compare their dependencies, and summarize the key differences.',
    'Multi-Step Inspection: Root package.json vs Server package.json dependency comparison'
  );

  console.log('\n================================================================');
  console.log('RESULT:');
  console.log(`Status: ${t.success ? 'PASS' : 'FAIL'} (${t.durationMs}ms)`);
  console.log(`Tools executed: ${t.tools.join(' -> ')}`);
  console.log('================================================================');
}

main();
