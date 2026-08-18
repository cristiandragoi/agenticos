// Debug: what does a fresh run look like on the deployed new build?
const BASE = 'http://127.0.0.1:4000';
const res = await fetch(`${BASE}/api/magnitude/runs`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ goal: 'inspect https://example.com', projectId: 'proj-DEBUG', projectTaskId: 'task-DEBUG' }),
});
const body = await res.json();
console.log('CREATE', res.status, JSON.stringify(body).slice(0, 300));
if (body?.id) {
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const g = await (await fetch(`${BASE}/api/magnitude/runs/${body.id}`)).json();
    console.log('POLL', i, g.status, JSON.stringify(g).slice(0, 400));
    if (['completed', 'failed', 'stopped'].includes(g.status)) break;
  }
}
// list endpoint shape
const list = await (await fetch(`${BASE}/api/magnitude/runs?projectId=proj-DEBUG`)).json();
console.log('LIST', typeof list, Array.isArray(list) ? list.length : JSON.stringify(list).slice(0, 200));
