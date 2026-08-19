// Inspect the acceptance goal's tool result to verify which directory was listed.
(async () => {
  const res = await fetch('http://127.0.0.1:4000/api/chat/agents/goal/goal-927cd64c-');
  const g = await res.json();
  console.log('status:', g.status, '| workspacePath:', g.workspacePath);
  for (const e of (g.history || [])) {
    if (e.state === 'tool_completed' || e.eventType === 'tool_completed') {
      console.log('TOOL RESULT (first 800 chars):');
      console.log(String(e.message || '').slice(0, 800));
    }
  }
  // Also inspect the failed goal for comparison
  const res2 = await fetch('http://127.0.0.1:4000/api/chat/agents/goal/goal-1cedcbbd-');
  const g2 = await res2.json();
  console.log('\nFAILED goal status:', g2.status, '| workspacePath:', g2.workspacePath);
  for (const e of (g2.history || [])) {
    if (e.state === 'failed') console.log('FAIL event:', String(e.message || '').slice(0, 400));
  }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
