// PART D — combined Magnitude + DeepSeek integration test.
// 1. Magnitude inspects https://example.com (canonical browser run).
// 2. DeepSeek synthesizes a one-sentence explanation from the real result.
// 3. Provenance intact; no raw browser debug in the final answer.
const BASE = 'http://127.0.0.1:4000';

// Step 1: Magnitude run (safe read-only inspect).
const res = await fetch(`${BASE}/api/magnitude/runs`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ goal: 'inspect https://example.com', projectId: 'proj-D-integration', projectTaskId: 'task-D-integration' }),
});
const run = await res.json();
let terminal = null;
for (let i = 0; i < 20; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const g = await (await fetch(`${BASE}/api/magnitude/runs/${run.id}`)).json();
  if (['completed', 'failed', 'stopped'].includes(g.status)) { terminal = g; break; }
}
console.log('D_MAGNITUDE', JSON.stringify({ id: terminal?.id, status: terminal?.status, title: terminal?.result?.title, projectId: terminal?.projectId, screenshotBytes: terminal?.result?.screenshotBytes }));

// Step 2: DeepSeek synthesizes from the REAL browser result via the gateway
// (in-process key from keytar through the evaluation route's provider list is
// not exposed here; use the gateway config directly in this backend context).
if (terminal?.result?.title) {
  const convRes = await fetch(`${BASE}/api/jarvis/conversations`);
  const convs = await convRes.json();
  const convId = Array.isArray(convs) && convs.length ? convs[convs.length - 1].id : null;
  const synthRes = await fetch(`${BASE}/api/jarvis/conversations/${convId}/message/stream`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: `The Magnitude browser inspection of https://example.com returned page title "${terminal.result.title}" and content "${terminal.result.text.slice(0, 120)}". Explain in one sentence what this page is.`,
      operationId: `d-synth-${Date.now()}`, inputChannel: 'typed', approvalPolicy: 'auto',
      routing: { mode: 'forced', providerId: 'prov-deepseek', modelId: 'deepseek-v4-flash' },
    }),
  });
  const text = await synthRes.text();
  const frames = text.split('\n\n');
  const agent = frames.filter((f) => f.startsWith('event: message')).map((f) => {
    const m = f.match(/data: ({.*})/);
    return m ? JSON.parse(m[1]) : null;
  }).find((d) => d?.role === 'agent');
  const route = frames.filter((f) => f.startsWith('event: intent')).map((f) => {
    const m = f.match(/data: ({.*})/);
    return m ? JSON.parse(m[1]) : null;
  })[0];
  console.log('D_DEEPSEEK_ROUTE', JSON.stringify(route));
  console.log('D_SYNTHESIS', JSON.stringify({ role: agent?.role, content: String(agent?.content || '').slice(0, 300) }));
} else {
  console.log('D_MAGNITUDE_NO_RESULT', JSON.stringify(terminal));
}
