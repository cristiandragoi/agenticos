const base = 'http://127.0.0.1:4001/api';
async function main() {
  // Create conversation
  const conv = await fetch(base + '/jarvis/conversations', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  const convJson = await conv.json();
  const convId = convJson.id;
  console.log('conversation:', convId);

  // Typed request — simple factual question (avoid tools/approval)
  const t0 = Date.now();
  const res = await fetch(base + `/jarvis/conversations/${convId}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: 'Say hello in one short sentence and tell me your model name.',
      approvalPolicy: 'auto',
      workspacePath: 'B:\\AgenticOS',
    }),
  });
  const ms = Date.now() - t0;
  const txt = await res.text();
  console.log('status:', res.status, '| latency:', ms + 'ms');
  console.log('body:', txt.slice(0, 1200));
}
main().catch((e) => { console.error(e); process.exit(1); });
