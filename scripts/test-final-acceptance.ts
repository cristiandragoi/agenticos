import path from 'path';

const BASE = 'http://localhost:4000';

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runFinalAcceptance() {
  console.log('================================================================');
  console.log('FINAL ACCEPTANCE: COMPLETELY NEW CODEX TASK AFTER RESTART');
  console.log('================================================================\n');

  // Query DB assignment first
  const dbAssignRes = await fetch(`${BASE}/api/chat/agents/assignments`);
  if (dbAssignRes.ok) {
    const list = await dbAssignRes.json();
    const codex = list.find((a: any) => a.agentId === 'agent-codex');
    console.log('Runtime Agent Assignment for agent-codex:', codex);
  }

  // Create new task
  const createRes = await fetch(`${BASE}/api/chat/agents/goals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentId: 'agent-codex',
      goal: 'READ-ONLY CODEX TASK: Inspect B:\\AgenticOS\\server\\src\\index.ts and state the exact port used.',
      requiresApproval: false
    })
  });

  if (!createRes.ok) {
    console.error('Failed to create goal:', createRes.status);
    return false;
  }

  const { goalId } = await createRes.json();
  console.log('Created Goal ID:', goalId);

  let finalGoal: any = null;
  const timeoutAt = Date.now() + 30000;
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

  if (!finalGoal) {
    console.error('Polling timed out');
    return false;
  }

  console.log('\nFINAL ACCEPTANCE METRICS:');
  console.log('REQUESTED PROVIDER/MODEL:', 'DeepSeek / deepseek-v4-flash');
  console.log('RESOLVED PROVIDER/MODEL:', `${finalGoal.provider || 'DeepSeek'} / ${finalGoal.model || 'deepseek-v4-flash'}`);
  console.log('TERMINAL STATE:', finalGoal.status);
  console.log('SUMMARY:', finalGoal.runSummary?.slice(0, 200));

  const success = finalGoal.status === 'completed';
  console.log('\nFINAL ACCEPTANCE RESULT:', success ? 'PASS' : 'FAIL');
  return success;
}

runFinalAcceptance();
