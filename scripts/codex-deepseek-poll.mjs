// Poll the live DeepSeek spike run to terminal.
const BASE = 'http://127.0.0.1:4000';
const runId = process.argv[2] || 'cr-msye8uuf-d0a2cc';
for (let i = 0; i < 45; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const g = await (await fetch(`${BASE}/api/coding/runs/${runId}`)).json();
  if (['awaiting_review', 'completed', 'failed', 'cancelled'].includes(g.status)) {
    console.log('FINAL_STATUS', g.status);
    console.log('ATTEMPTS', JSON.stringify(g.providerAttempts.map((a) => ({ provider: a.provider, outcome: a.outcome, failureClass: a.failureClass, failureReason: (a.failureReason || '').slice(0, 300) }))));
    console.log('CHANGED', JSON.stringify(g.changedFiles));
    console.log('TEST', JSON.stringify(g.testResults));
    console.log('VERIFIER', g.verifierVerdict, g.verifierProvenance);
    console.log('CHECKPOINTS', JSON.stringify(g.checkpoints.map((c) => c.phase)));
    console.log('ERRORS', JSON.stringify(g.errors));
    break;
  }
  if (i % 5 === 0) console.log('poll', i, g.status);
  if (i === 44) console.log('POLL_TIMEOUT', g.status);
}
